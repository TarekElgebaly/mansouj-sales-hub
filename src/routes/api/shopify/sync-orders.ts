import { createFileRoute } from "@tanstack/react-router";
import { processShopifyOrder, type ShopifyOrderPayload } from "@/lib/shopify-webhook.server";
import { getShopifyApiVersion, normalizeShopDomain } from "@/lib/shopify-auth.server";

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
          const { data: installation } = await supabaseAdmin
            .from("shopify_sync_settings")
            .select("shop_domain,access_token")
            .eq("id", 1)
            .maybeSingle();

          const { data: settings } = await supabaseAdmin
            .from("shopify_sync_settings")
            .select("shop_domain,store_url")
            .eq("id", 1)
            .maybeSingle();

          const configuredDomain = normalizeShopDomain(
            process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_STORE_DOMAIN || "",
          );
          const installedDomain = normalizeShopDomain(installation?.shop_domain || "");
          const settingsDomain = normalizeShopDomain(
            settings?.shop_domain || settings?.store_url || "",
          );
          if (configuredDomain && installedDomain && configuredDomain !== installedDomain) {
            const msg = `Configured Shopify store is ${configuredDomain}, but the saved OAuth install is for ${installedDomain}. Reinstall the Shopify app for ${configuredDomain}.`;
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

          let accessToken =
            installation?.access_token && installation.access_token !== "pending"
              ? installation.access_token
              : "";
          let domain = configuredDomain || installedDomain || settingsDomain;

          // Temporary fallback for older deployments that still use manual token secrets.
          if (!accessToken) {
            accessToken =
              process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN || "";
          }
          domain = normalizeShopDomain(domain);

          if (!domain || !accessToken || accessToken === "pending") {
            return Response.json(
              {
                ok: false,
                error:
                  "Shopify is not configured. Connect Shopify first, then test the connection.",
              },
              { status: 400 },
            );
          }

          const body = await request.json().catch(() => ({}) as { limit?: number; since?: string });
          const limit = Math.min(Math.max(Number(body?.limit) || 50, 1), 250);

          // Mark in-progress
          await supabaseAdmin
            .from("shopify_sync_settings")
            .update({ last_sync_status: "running", last_error: null })
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
              })
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
