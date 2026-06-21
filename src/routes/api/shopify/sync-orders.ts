import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/shopify/sync-orders")({
  server: {
    handlers: {
      POST: async () => {
        // TODO: call Shopify Admin GraphQL to fetch recent orders and upsert into public.orders.
        return Response.json({ ok: true, queued: true });
      },
    },
  },
});
