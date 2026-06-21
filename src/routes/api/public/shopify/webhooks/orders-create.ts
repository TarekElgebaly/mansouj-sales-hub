import { createFileRoute } from "@tanstack/react-router";
import { processShopifyOrder, verifyShopifyHmac, type ShopifyOrderPayload } from "@/lib/shopify-webhook.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Shopify-Hmac-Sha256, X-Shopify-Topic, X-Shopify-Shop-Domain",
};

export const Route = createFileRoute("/api/public/shopify/webhooks/orders-create")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const raw = await request.text();
        const hmac = request.headers.get("x-shopify-hmac-sha256");
        if (!verifyShopifyHmac(raw, hmac)) {
          return new Response(JSON.stringify({ error: "invalid signature" }), {
            status: 401,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }
        try {
          const payload = JSON.parse(raw) as ShopifyOrderPayload;
          const result = await processShopifyOrder(payload);
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.from("migration_logs").insert({
            source: "shopify_webhook",
            kind: "orders/create",
            status: "ok",
            message: `order ${result.shopifyOrderId} upserted`,
          } as never).then(() => null, () => null);
          return new Response(JSON.stringify({ ok: true, ...result }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[shopify webhook orders/create]", msg);
          return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }
      },
    },
  },
});
