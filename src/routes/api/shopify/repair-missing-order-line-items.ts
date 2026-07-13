import { createFileRoute } from "@tanstack/react-router";
import { requireRoles } from "@/lib/route-auth.server";
import { repairMissingOrderLineItems } from "@/lib/repair-missing-order-line-items.server";

export const Route = createFileRoute("/api/shopify/repair-missing-order-line-items")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireRoles(request, ["admin", "operations"]);
        if (!auth.ok) return auth.response;
        const { supabaseAdmin } = auth;

        const body = (await request.json().catch(() => ({}))) as { limit?: unknown };
        const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 500);

        try {
          const result = await repairMissingOrderLineItems(supabaseAdmin, { limit });
          return Response.json({
            ok: result.failed_count === 0,
            ...result,
            preserved_order_fields: true,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
