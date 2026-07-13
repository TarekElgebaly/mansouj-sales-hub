import { createFileRoute } from "@tanstack/react-router";
import {
  enqueueInventoryRefresh,
  isDuplicateWebhookDelivery,
  scheduleOpportunisticFlush,
} from "@/lib/inventory-refresh-queue.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Inventory-Refresh-Secret",
};

export const Route = createFileRoute("/api/inventory/refresh-from-order-event")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const secret = process.env.INVENTORY_REFRESH_EVENT_SECRET;
        if (!secret) {
          return new Response(JSON.stringify({ error: "server_not_configured" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }
        const supplied = request.headers.get("x-inventory-refresh-secret");
        if (!supplied || supplied !== secret) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }
        let body: {
          shopify_order_id?: unknown;
          shopify_order_number?: unknown;
          event_type?: unknown;
          shopify_variant_ids?: unknown;
          shopify_inventory_item_ids?: unknown;
          event_id?: unknown;
        } = {};
        try {
          body = JSON.parse(await request.text());
        } catch {
          return new Response(JSON.stringify({ error: "invalid_json" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }
        const eventType = typeof body.event_type === "string" && body.event_type
          ? body.event_type
          : "manual";
        const variantIds = Array.isArray(body.shopify_variant_ids)
          ? (body.shopify_variant_ids as unknown[])
          : [];
        const inventoryItemIds = Array.isArray(body.shopify_inventory_item_ids)
          ? (body.shopify_inventory_item_ids as unknown[])
          : [];
        const eventId =
          typeof body.event_id === "string" && body.event_id ? body.event_id : null;
        const orderId =
          body.shopify_order_id != null ? String(body.shopify_order_id) : null;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        if (
          await isDuplicateWebhookDelivery(
            supabaseAdmin,
            eventId,
            `manual:${eventType}`,
            orderId,
          )
        ) {
          return new Response(JSON.stringify({ ok: true, duplicate: true }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }

        const res = await enqueueInventoryRefresh(supabaseAdmin, {
          variantIds: variantIds as (string | number)[],
          inventoryItemIds: inventoryItemIds as (string | number)[],
          sourceEventType: eventType,
          sourceOrderId: orderId,
          sourceOrderNumber:
            body.shopify_order_number != null ? String(body.shopify_order_number) : null,
        });
        scheduleOpportunisticFlush(supabaseAdmin);

        return new Response(JSON.stringify({ ok: true, ...res }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS },
        });
      },
    },
  },
});
