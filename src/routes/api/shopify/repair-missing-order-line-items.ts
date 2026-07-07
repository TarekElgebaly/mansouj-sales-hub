import { createFileRoute } from "@tanstack/react-router";
import { requireRoles } from "@/lib/route-auth.server";
import {
  fetchShopifyWithRetry,
  getShopifyAdminConfig,
  shopifyHeaders,
} from "@/lib/shopify-sync.server";

type ShopifyLineItem = {
  id?: number | string | null;
  admin_graphql_api_id?: string | null;
  product_id?: number | string | null;
  variant_id?: number | string | null;
  sku?: string | null;
  title?: string | null;
  name?: string | null;
  variant_title?: string | null;
  quantity?: number | string | null;
  current_quantity?: number | string | null;
  price?: number | string | null;
  discounted_price?: number | string | null;
  total_discount?: number | string | null;
};

type ShopifyOrderResponse = {
  order?: {
    id?: number | string | null;
    name?: string | null;
    order_number?: number | string | null;
    line_items?: ShopifyLineItem[] | null;
  } | null;
};

function stringValue(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function numberValue(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function lineQuantity(line: ShopifyLineItem) {
  const current = numberValue(line.current_quantity);
  if (current > 0) return Math.trunc(current);
  const original = numberValue(line.quantity);
  return original > 0 ? Math.trunc(original) : 0;
}

function lineSku(line: ShopifyLineItem) {
  const sku = stringValue(line.sku);
  if (sku) return sku;
  const variantId = stringValue(line.variant_id);
  if (variantId) return `shopify-variant-${variantId}`;
  const lineId = stringValue(line.id);
  return lineId ? `shopify-line-${lineId}` : "shopify-line-item";
}

function lineUnitPrice(line: ShopifyLineItem, quantity: number) {
  const discounted = numberValue(line.discounted_price);
  if (discounted > 0) return discounted;

  const price = numberValue(line.price);
  const discount = numberValue(line.total_discount);
  if (price > 0 && discount > 0 && quantity > 0) return Math.max(0, price - discount / quantity);
  return price;
}

function isSchemaError(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    /column|schema cache|could not find/i.test(message)
  );
}

function fullOrderItemRow(orderId: string, line: ShopifyLineItem) {
  const quantity = lineQuantity(line);
  const variantTitle = stringValue(line.variant_title);
  return {
    order_id: orderId,
    shopify_line_item_id: stringValue(line.id) || null,
    shopify_admin_graphql_api_id: stringValue(line.admin_graphql_api_id) || null,
    shopify_variant_id: stringValue(line.variant_id) || null,
    shopify_product_id: stringValue(line.product_id) || null,
    sku: lineSku(line),
    product_name: stringValue(line.title) || stringValue(line.name) || "Shopify line item",
    variant: variantTitle || null,
    barcode: null,
    product_type: null,
    color: null,
    size: variantTitle || null,
    quantity,
    unit_selling_price: lineUnitPrice(line, quantity),
    unit_cost: 0,
  };
}

function baseOrderItemRow(row: Record<string, unknown>) {
  return {
    order_id: row.order_id,
    sku: row.sku,
    product_name: row.product_name,
    variant: row.variant,
    color: row.color,
    size: row.size,
    quantity: row.quantity,
    unit_selling_price: row.unit_selling_price,
    unit_cost: row.unit_cost,
  };
}

async function insertOrderItems(supabaseAdmin: any, rows: Record<string, unknown>[]) {
  if (!rows.length) return { schemaFallbackUsed: false };

  const { error } = await supabaseAdmin.from("order_items").insert(rows as never);
  if (!error) return { schemaFallbackUsed: false };
  if (!isSchemaError(error)) throw new Error(`order_items insert failed: ${error.message}`);

  const fallback = await supabaseAdmin
    .from("order_items")
    .insert(rows.map(baseOrderItemRow) as never);
  if (fallback.error) throw new Error(`order_items insert failed: ${fallback.error.message}`);
  return { schemaFallbackUsed: true };
}

async function fetchShopifyOrder(shopifyOrderId: string) {
  const config = getShopifyAdminConfig();
  if (!config.ok) throw new Error(config.error);

  const url = `https://${config.domain}/admin/api/${config.apiVersion}/orders/${encodeURIComponent(shopifyOrderId)}.json`;
  const res = await fetchShopifyWithRetry(url, shopifyHeaders(config.accessToken));
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Shopify order lookup failed (${res.status}): ${text.slice(0, 240)}`);
  }

  let json: ShopifyOrderResponse;
  try {
    json = JSON.parse(text) as ShopifyOrderResponse;
  } catch {
    throw new Error("Shopify order lookup returned invalid JSON.");
  }

  return json.order ?? null;
}

async function loadOrderItemOrderIds(supabaseAdmin: any, orderIds: string[]) {
  const found = new Set<string>();
  for (let i = 0; i < orderIds.length; i += 500) {
    const chunk = orderIds.slice(i, i + 500);
    if (!chunk.length) continue;
    const { data, error } = await supabaseAdmin
      .from("order_items")
      .select("order_id")
      .in("order_id", chunk);
    if (error) throw new Error(`Could not inspect local order_items: ${error.message}`);
    for (const row of data ?? []) {
      if (row.order_id) found.add(row.order_id);
    }
  }
  return found;
}

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
          const { data: orders, error: ordersError } = await supabaseAdmin
            .from("orders")
            .select("id,order_number,shopify_order_id,total_selling_price")
            .not("shopify_order_id", "is", null)
            .gt("total_selling_price", 0)
            .order("shopify_created_at", { ascending: false, nullsFirst: false })
            .limit(limit);

          if (ordersError) throw new Error(`Could not load local Shopify orders: ${ordersError.message}`);

          const localOrders = orders ?? [];
          const orderIdsWithItems = await loadOrderItemOrderIds(
            supabaseAdmin,
            localOrders.map((order: { id: string }) => order.id),
          );
          const missingOrders = localOrders.filter(
            (order: { id: string }) => !orderIdsWithItems.has(order.id),
          );

          let repairedOrders = 0;
          let lineItemsInserted = 0;
          let schemaFallbacks = 0;
          let failedCount = 0;
          const errors: string[] = [];
          const repaired: Array<{ order_number: string | null; line_items_inserted: number }> = [];

          for (const order of missingOrders) {
            try {
              const shopifyOrderId = stringValue(order.shopify_order_id);
              if (!shopifyOrderId) continue;

              const shopifyOrder = await fetchShopifyOrder(shopifyOrderId);
              const lineItems = (shopifyOrder?.line_items ?? []).filter(
                (line) => lineQuantity(line) > 0,
              );
              if (!lineItems.length) {
                throw new Error("Shopify returned no line_items for this order.");
              }

              const rows = lineItems.map((line) => fullOrderItemRow(order.id, line));
              const insertResult = await insertOrderItems(supabaseAdmin, rows);
              if (insertResult.schemaFallbackUsed) schemaFallbacks++;

              repairedOrders++;
              lineItemsInserted += rows.length;
              repaired.push({
                order_number: order.order_number ?? shopifyOrder?.name ?? null,
                line_items_inserted: rows.length,
              });
            } catch (error) {
              failedCount++;
              errors.push(
                `${order.order_number ?? order.shopify_order_id}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }

          return Response.json({
            ok: failedCount === 0,
            orders_checked: localOrders.length,
            missing_orders_found: missingOrders.length,
            repaired_orders: repairedOrders,
            line_items_inserted: lineItemsInserted,
            schema_fallbacks_used: schemaFallbacks,
            failed_count: failedCount,
            repaired,
            errors,
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
