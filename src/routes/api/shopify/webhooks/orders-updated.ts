import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/shopify/webhooks/orders-updated")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        console.log("[shopify webhook] orders/updated payload bytes:", body.length);
        return Response.json({ ok: true, received: "orders/updated" });
      },
    },
  },
});
