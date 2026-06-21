import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/shopify/sync-status")({
  server: {
    handlers: {
      GET: async () => Response.json({ status: "idle" }),
    },
  },
});
