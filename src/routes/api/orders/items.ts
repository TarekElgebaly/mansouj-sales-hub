import { createFileRoute } from "@tanstack/react-router";
import { requireRoles } from "@/lib/route-auth.server";

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

function isColumnError(error: { message?: string } | null | undefined) {
  return Boolean(error?.message && /column|schema cache/i.test(error.message));
}

function orderNumberVariants(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  const withoutHash = raw.replace(/^#/, "");
  return Array.from(new Set([raw, withoutHash, `#${withoutHash}`].filter(Boolean)));
}

async function loadOrderItems(supabaseAdmin: any, orderIds: string[]) {
  if (!orderIds.length) return { data: [], error: null };

  const runQuery = (columns: string[]) =>
    supabaseAdmin
      .from("order_items")
      .select(columns.join(","))
      .in("order_id", orderIds)
      .order("created_at", { ascending: true });

  let { data, error } = await runQuery(enhancedColumns);
  if (isColumnError(error)) {
    const fallback = await runQuery(baseColumns);
    data = fallback.data;
    error = fallback.error;
  }

  return { data: data ?? [], error };
}

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

        let matchedBy = "order_id";
        let sourceOrderIds = [orderId];
        let { data, error } = await loadOrderItems(auth.supabaseAdmin, sourceOrderIds);

        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        if (!data?.length) {
          const { data: orderRow } = await auth.supabaseAdmin
            .from("orders")
            .select("id,shopify_order_id,order_number")
            .eq("id", orderId)
            .maybeSingle();

          const siblingIds = new Set<string>();

          if (orderRow?.shopify_order_id) {
            const { data: shopifyMatches } = await auth.supabaseAdmin
              .from("orders")
              .select("id")
              .eq("shopify_order_id", orderRow.shopify_order_id);
            for (const row of shopifyMatches ?? []) {
              if (row.id && row.id !== orderId) siblingIds.add(row.id);
            }
          }

          const numberVariants = orderNumberVariants(orderRow?.order_number);
          if (numberVariants.length) {
            const { data: numberMatches } = await auth.supabaseAdmin
              .from("orders")
              .select("id")
              .in("order_number", numberVariants);
            for (const row of numberMatches ?? []) {
              if (row.id && row.id !== orderId) siblingIds.add(row.id);
            }
          }

          if (siblingIds.size) {
            const fallback = await loadOrderItems(auth.supabaseAdmin, Array.from(siblingIds));
            if (fallback.error) {
              return Response.json({ ok: false, error: fallback.error.message }, { status: 500 });
            }
            if (fallback.data.length) {
              data = fallback.data;
              sourceOrderIds = Array.from(siblingIds);
              matchedBy = "sibling_order_snapshot";
            }
          }
        }

        return Response.json({
          ok: true,
          order_id: orderId,
          source_order_ids: sourceOrderIds,
          matched_by: matchedBy,
          items: data ?? [],
        });
      },
    },
  },
});
