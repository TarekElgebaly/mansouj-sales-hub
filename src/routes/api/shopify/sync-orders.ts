import { createFileRoute } from "@tanstack/react-router";
import { processShopifyOrder, type ShopifyOrderPayload } from "@/lib/shopify-webhook.server";

export const Route = createFileRoute("/api/shopify/sync-orders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Require an authenticated user (any signed-in app user can trigger).
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (!token) return new Response("Unauthorized", { status: 401 });
        const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
        if (userErr || !userData?.user) return new Response("Unauthorized", { status: 401 });

        const apiVersion = process.env.SHOPIFY_API_VERSION || "2025-07";
        const accessToken =
          process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN;
        let domain = process.env.SHOPIFY_STORE_DOMAIN || "";

        if (!domain) {
          const { data: settings } = await supabaseAdmin
            .from("shopify_sync_settings")
            .select("store_url")
            .eq("id", 1)
            .maybeSingle();
          domain = (settings?.store_url ?? "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
        }

        if (!domain || !accessToken) {
          return Response.json(
            { ok: false, error: "Shopify is not configured (missing domain or access token)." },
            { status: 400 }
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
            kind: "sync-orders",
            status: errors.length ? "partial" : "success",
            message: `imported=${imported} updated=${updated} errors=${errors.length}`,
            details: { errors: errors.slice(0, 20) },
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
      },
    },
  },
});
