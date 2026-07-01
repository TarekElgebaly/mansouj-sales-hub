import { createFileRoute } from "@tanstack/react-router";
import { requireRoles } from "@/lib/route-auth.server";

function parseCost(value: unknown, label: string) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${label} must be zero or more.`);
  }
  return number;
}

export const Route = createFileRoute("/api/orders/update-costs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireRoles(request, ["admin", "operations", "finance"]);
        if (!auth.ok) return auth.response;

        let body: any;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body." }, { status: 400 });
        }

        const orderId = String(body?.order_id ?? body?.orderId ?? "");
        if (!orderId) {
          return Response.json({ error: "Missing order_id." }, { status: 400 });
        }

        let shippingCost: number;
        let packagingCost: number;
        try {
          shippingCost = parseCost(body?.shipping_cost, "Shipping cost");
          packagingCost = parseCost(body?.packaging_cost, "Packaging cost");
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Invalid costs." },
            { status: 400 },
          );
        }

        const source = typeof body?.source === "string" ? body.source.slice(0, 80) : "unknown";
        const { supabaseAdmin, userId } = auth;

        const { data: existing, error: existingError } = await supabaseAdmin
          .from("orders")
          .select("id,order_number,shipping_cost,packaging_cost")
          .eq("id", orderId)
          .maybeSingle();

        if (existingError) {
          return Response.json({ error: existingError.message }, { status: 500 });
        }
        if (!existing) {
          return Response.json({ error: "Order not found." }, { status: 404 });
        }

        const { data: updated, error: updateError } = await supabaseAdmin
          .from("orders")
          .update({
            shipping_cost: shippingCost,
            packaging_cost: packagingCost,
          })
          .eq("id", orderId)
          .select("id,order_number,shipping_cost,packaging_cost,total_selling_price,items_cost,net_profit")
          .single();

        if (updateError) {
          return Response.json({ error: updateError.message }, { status: 500 });
        }

        const { error: activityError } = await supabaseAdmin.from("order_activity").insert({
          order_id: orderId,
          user_id: userId,
          action: "update_costs",
          details: {
            old_shipping_cost: existing.shipping_cost,
            new_shipping_cost: shippingCost,
            old_packaging_cost: existing.packaging_cost,
            new_packaging_cost: packagingCost,
            source,
          },
        } as never);
        if (activityError) {
          console.warn("[orders/update-costs] Could not write activity log", {
            order_id: orderId,
            error: activityError.message,
          });
        }

        return Response.json({ ok: true, order: updated });
      },
    },
  },
});
