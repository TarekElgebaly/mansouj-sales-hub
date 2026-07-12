import { createFileRoute } from "@tanstack/react-router";
import { requireRoles } from "@/lib/route-auth.server";
import { applyPendingIntake } from "@/lib/order-intake.server";

export const Route = createFileRoute("/api/orders/apply-pending-intake")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireRoles(request, ["admin", "operations"]);
        if (!auth.ok) return auth.response;

        let limit = 200;
        try {
          const body = (await request.json().catch(() => ({}))) as { limit?: unknown };
          if (typeof body.limit === "number" && body.limit > 0) limit = body.limit;
        } catch {
          // ignore
        }

        try {
          const summary = await applyPendingIntake(auth.supabaseAdmin, { limit });
          return Response.json({ ok: true, ...summary });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },
    },
  },
});
