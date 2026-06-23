import { createFileRoute } from "@tanstack/react-router";
import { processShopifyOrder, type ShopifyOrderPayload } from "@/lib/shopify-webhook.server";
import {
  getShopifyAdminAccessToken,
  getShopifyApiVersion,
  getShopifyDomainValidationError,
  normalizeShopDomain,
  validateShopDomain,
} from "@/lib/shopify-auth.server";

export const Route = createFileRoute("/api/shopify/sync-orders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Require an authenticated user (any signed-in app user can trigger).
          const authHeader = request.headers.get("authorization") ?? "";
          const token = authHeader.replace(/^Bearer\s+/i, "");
          if (!token) return new Response("Unauthorized", { status: 401 });
          const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
          if (userErr || !userData?.user) return new Response("Unauthorized", { status: 401 });

          // Require admin or operations role to trigger a Shopify sync.
          const { data: roleRow } = await supabaseAdmin
            .from("user_roles")
            .select("role")
            .eq("user_id", userData.user.id)
            .in("role", ["admin", "operations"])
            .maybeSingle();
          if (!roleRow) return new Response("Forbidden", { status: 403 });

          const apiVersion = getShopifyApiVersion();
          const configuredDomain = normalizeShopDomain(process.env.SHOPIFY_SHOP_DOMAIN || "");
          const domain = configuredDomain;
          if (!domain) {
            const msg = "Missing SHOPIFY_SHOP_DOMAIN in Lovable Secrets.";
            await supabaseAdmin
              .from("shopify_sync_settings")
              .update({
                last_sync_at: new Date().toISOString(),
                last_sync_status: "error",
                last_error: msg,
              })
              .eq("id", 1);
            return Response.json({ ok: false, error: msg }, { status: 500 });
          }

          if (!validateShopDomain(domain)) {
            const msg = getShopifyDomainValidationError(domain);
            await supabaseAdmin
              .from("shopify_sync_settings")
              .update({
                last_sync_at: new Date().toISOString(),
                last_sync_status: "error",
                last_error: msg,
              })
              .eq("id", 1);
            return Response.json({ ok: false, error: msg }, { status: 400 });
          }

          const accessToken = getShopifyAdminAccessToken();

          if (!accessToken) {
            const msg =
              "Missing SHOPIFY_ADMIN_ACCESS_TOKEN in Lovable Secrets. SHOPIFY_ACCESS_TOKEN is supported only as a fallback.";
            await supabaseAdmin
              .from("shopify_sync_settings")
              .update({
                install_status: "missing_manual_token",
                token_stored: false,
                last_sync_at: new Date().toISOString(),
                last_sync_status: "error",
                last_error: msg,
              } as never)
              .eq("id", 1);
            return Response.json(
              {
                ok: false,
                error: msg,
              },
              { status: 400 },
            );
          }

          const body = await request.json().catch(() => ({}) as { limit?: number; since?: string });
          const limit = Math.min(Math.max(Number(body?.limit) || 50, 1), 250);

          // Mark in-progress
          await supabaseAdmin
            .from("shopify_sync_settings")
            .update({
              shop_domain: domain,
              store_url: domain,
              token_stored: true,
              last_sync_status: "running",
              last_error: null,
            } as never)
            .eq("id", 1);

          const url = new URL(`https://${domain}/admin/api/${apiVersion}/orders.json`);
          url.searchParams.set("status", "any");
          url.searchParams.set("limit", String(limit));
          if (body?.since) url.searchParams.set("updated_at_min", body.since);

          let imported = 0;
          let updated = 0;
          const errors: string[] = [];

          try {
            const res = await fetch(url.toString(), {
              headers: {
                "X-Shopify-Access-Token": accessToken,
                "Content-Type": "application/json",
              },
            });
            if (!res.ok) {
              const text = await res.text();
              if (res.status === 401) {
                const msg = `SHOPIFY_ADMIN_ACCESS_TOKEN was rejected by Shopify for ${domain}. Confirm the token belongs to this store and has Admin API access.`;
                await supabaseAdmin
                  .from("shopify_sync_settings")
                  .update({
                    install_status: "invalid_manual_token",
                    token_stored: false,
                    last_connection_test_status: "invalid_token",
                    last_connection_test_error: msg,
                    last_sync_at: new Date().toISOString(),
                    last_sync_status: "error",
                    last_error: msg,
                  } as never)
                  .eq("id", 1);
                return Response.json({ ok: false, error: msg }, { status: 401 });
              }
              if (res.status === 403) {
                const msg = `SHOPIFY_ADMIN_ACCESS_TOKEN is valid but Shopify denied order access for ${domain}. Check read_orders/read_all_orders permissions.`;
                await supabaseAdmin
                  .from("shopify_sync_settings")
                  .update({
                    install_status: "manual_token_missing_scopes",
                    token_stored: true,
                    last_connection_test_status: "permission_denied",
                    last_connection_test_error: msg,
                    last_sync_at: new Date().toISOString(),
                    last_sync_status: "error",
                    last_error: msg,
                  } as never)
                  .eq("id", 1);
                return Response.json({ ok: false, error: msg }, { status: 403 });
              }
              throw new Error(`Shopify ${res.status}: ${text.slice(0, 300)}`);
            }
            const json = (await res.json()) as { orders: ShopifyOrderPayload[] };
            const orders = json.orders ?? [];

            for (const order of orders) {
              try {
                const sid = String(order.id);
                const { data: existing } = await supabaseAdmin
                  .from("orders")
                  .select("id")
                  .eq("shopify_order_id", sid)
                  .maybeSingle();
                await processShopifyOrder(order);
                if (existing?.id) updated++;
                else imported++;
              } catch (e) {
                errors.push(`order ${order.id}: ${(e as Error).message}`);
              }
            }

            await supabaseAdmin.from("migration_logs").insert({
              source: "shopify",
              entity: "orders",
              status: errors.length ? "partial" : "success",
              message: `imported=${imported} updated=${updated} errors=${errors.length}${errors.length ? " | " + errors.slice(0, 3).join(" | ") : ""}`,
              rows_processed: imported + updated,
            } as never);

            await supabaseAdmin
              .from("shopify_sync_settings")
              .update({
                last_sync_at: new Date().toISOString(),
                last_sync_status: errors.length ? "partial" : "success",
                last_orders_imported: imported,
                last_orders_updated: updated,
                last_error: errors.length ? errors.slice(0, 5).join(" | ") : null,
              } as never)
              .eq("id", 1);

            return Response.json({ ok: true, imported, updated, errors });
          } catch (e) {
            const msg = (e as Error).message;
            await supabaseAdmin
              .from("shopify_sync_settings")
              .update({
                last_sync_at: new Date().toISOString(),
                last_sync_status: "error",
                last_error: msg,
              })
              .eq("id", 1);
            return Response.json({ ok: false, error: msg }, { status: 500 });
          }
        } catch (outer) {
          console.error("sync-orders fatal:", outer);
          const msg = outer instanceof Error ? outer.message : String(outer);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },
    },
  },
});
