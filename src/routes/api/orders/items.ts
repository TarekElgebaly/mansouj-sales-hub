import { createFileRoute } from "@tanstack/react-router";
import { requireRoles } from "@/lib/route-auth.server";

export const Route = createFileRoute("/api/orders/items")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRoles(request, [
          "admin",
          "operations",
          "finance",
          "shipping",
          "viewer",
        ]);
        if (!auth.ok) return auth.response;

        const url = new URL(request.url);
        const orderId = url.searchParams.get("order_id");
        if (!orderId) {
          return Response.json({ ok: false, error: "Missing order_id." }, { status: 400 });
        }

        const baseColumns = [
          "id",
          "order_id",
          "sku",
          "product_name",
          "variant",
          "color",
          "size",
          "quantity",
          "unit_selling_price",
          "total_selling_price",
        ];
        const enhancedColumns = [
          ...baseColumns,
          "shopify_line_item_id",
          "shopify_admin_graphql_api_id",
          "shopify_variant_id",
          "shopify_product_id",
          "barcode",
          "product_type",
        ];

        const runQuery = (columns: string[]) =>
          auth.supabaseAdmin
            .from("order_items")
            .select(columns.join(","))
            .eq("order_id", orderId)
            .order("created_at", { ascending: true });

        let { data, error } = await runQuery(enhancedColumns);
        if (error && /column/i.test(error.message)) {
          const fallback = await runQuery(baseColumns);
          data = fallback.data;
          error = fallback.error;
        }

        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        return Response.json({
          ok: true,
          order_id: orderId,
          items: data ?? [],
        });
      },
    },
  },
});
