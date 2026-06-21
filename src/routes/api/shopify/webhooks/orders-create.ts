import { createFileRoute } from "@tanstack/react-router";

// Placeholder webhook endpoint — verify HMAC + map payload to orders/customers/inventory.
export const Route = createFileRoute("/api/shopify/webhooks/orders-create")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        console.log("[shopify webhook] orders/create payload bytes:", body.length);
        // TODO: verify x-shopify-hmac-sha256 with SHOPIFY_WEBHOOK_SECRET, parse JSON, upsert order.
        return Response.json({ ok: true, received: "orders/create" });
      },
    },
  },
});
