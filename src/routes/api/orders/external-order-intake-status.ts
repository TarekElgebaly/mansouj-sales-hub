import { createFileRoute } from "@tanstack/react-router";
import { requireRoles } from "@/lib/route-auth.server";

export const Route = createFileRoute("/api/orders/external-order-intake-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRoles(request, ["admin", "operations"]);
        if (!auth.ok) return auth.response;
        const secretConfigured = Boolean(process.env.ORDER_INTAKE_SECRET);
        return Response.json({ ok: true, secretConfigured });
      },
    },
  },
});
