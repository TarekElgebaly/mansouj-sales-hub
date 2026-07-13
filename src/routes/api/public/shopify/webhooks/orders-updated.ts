import { createFileRoute } from "@tanstack/react-router";
import { processShopifyOrder, verifyShopifyHmac, type ShopifyOrderPayload } from "@/lib/shopify-webhook.server";
import {
  enqueueInventoryRefresh,
  isDuplicateWebhookDelivery,
  scheduleOpportunisticFlush,
} from "@/lib/inventory-refresh-queue.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Shopify-Hmac-Sha256, X-Shopify-Topic, X-Shopify-Shop-Domain, X-Shopify-Webhook-Id",
};

function collectVariantIds(payload: ShopifyOrderPayload): string[] {
  const items = (payload as unknown as { line_items?: { variant_id?: unknown }[] }).line_items ?? [];
  const out: string[] = [];
  for (const li of items) {
    if (li?.variant_id != null) out.push(String(li.variant_id));
  }
  return out;
}

export const Route = createFileRoute("/api/public/shopify/webhooks/orders-updated")({
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
          const webhookId = request.headers.get("x-shopify-webhook-id");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const shopifyOrderId = payload.id != null ? String(payload.id) : null;
          if (await isDuplicateWebhookDelivery(supabaseAdmin, webhookId, "orders/updated", shopifyOrderId)) {
            return new Response(JSON.stringify({ ok: true, duplicate: true }), {
              status: 200,
              headers: { "Content-Type": "application/json", ...CORS },
            });
          }

          const result = await processShopifyOrder(payload);

          const variantIds = collectVariantIds(payload);
          const enqRes = await enqueueInventoryRefresh(supabaseAdmin, {
            variantIds,
            sourceEventType: "orders/updated",
            sourceOrderId: result.shopifyOrderId,
            sourceOrderNumber: payload.order_number ?? payload.name ?? null,
          });
          scheduleOpportunisticFlush(supabaseAdmin);

          return new Response(JSON.stringify({ ok: true, ...result, inventory_queue: enqRes }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[shopify webhook orders/updated]", msg);
          return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }
      },
    },
  },
});
