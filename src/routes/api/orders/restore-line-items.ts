import { createFileRoute } from "@tanstack/react-router";
import { requireRoles } from "@/lib/route-auth.server";
import {
  fetchShopifyWithRetry,
  getShopifyAdminConfig,
  shopifyHeaders,
} from "@/lib/shopify-sync.server";

type RestoreBody = {
  order_id?: string;
  order_number?: string;
  shopify_order_id?: string | number;
};

type ShopifyOrderLineItem = {
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
};

type ShopifyOrderResponse = {
  order?: {
    id?: number | string | null;
    name?: string | null;
    order_number?: number | string | null;
    line_items?: ShopifyOrderLineItem[] | null;
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

function normalizeOrderNumber(value: unknown) {
  const raw = stringValue(value);
  if (!raw) return "";
  return raw.startsWith("#") ? raw : `#${raw}`;
}

function lineQuantity(line: ShopifyOrderLineItem) {
  const current = Number(line.current_quantity);
  if (Number.isFinite(current) && current > 0) return current;
  const original = Number(line.quantity);
  return Number.isFinite(original) && original > 0 ? original : 0;
}

function buildFallbackSku(line: ShopifyOrderLineItem) {
  const sku = stringValue(line.sku);
  if (sku) return sku;
  const variantId = stringValue(line.variant_id);
  if (variantId) return `shopify-variant-${variantId}`;
  const lineId = stringValue(line.id);
  return lineId ? `shopify-line-${lineId}` : "shopify-line-item";
}

function baseOrderItemRow(orderId: string, line: ShopifyOrderLineItem) {
  const quantity = lineQuantity(line);
  const unitPrice = numberValue(line.price);
  const variantTitle = stringValue(line.variant_title);

  return {
    order_id: orderId,
    sku: buildFallbackSku(line),
    product_name: stringValue(line.title) || stringValue(line.name) || "Shopify line item",
    variant: variantTitle || null,
    color: null,
    size: variantTitle || null,
    quantity,
    unit_selling_price: unitPrice,
    unit_cost: 0,
  };
}

function enhancedOrderItemRow(orderId: string, line: ShopifyOrderLineItem) {
  return {
    ...baseOrderItemRow(orderId, line),
    shopify_line_item_id: stringValue(line.id) || null,
    shopify_admin_graphql_api_id: stringValue(line.admin_graphql_api_id) || null,
    shopify_variant_id: stringValue(line.variant_id) || null,
    shopify_product_id: stringValue(line.product_id) || null,
  };
}

function isSchemaError(error: { message?: string } | null | undefined) {
  return Boolean(error?.message && /column|schema cache/i.test(error.message));
}

async function insertOrderItems(supabaseAdmin: any, rows: Record<string, unknown>[]) {
  if (!rows.length) return;

  const { error } = await supabaseAdmin.from("order_items").insert(rows as never);
  if (!error) return;

  if (!isSchemaError(error)) {
    throw new Error(`Could not restore order line items: ${error.message}`);
  }

  const baseRows = rows.map((row) => ({
    order_id: row.order_id,
    sku: row.sku,
    product_name: row.product_name,
    variant: row.variant,
    color: row.color,
    size: row.size,
    quantity: row.quantity,
    unit_selling_price: row.unit_selling_price,
    unit_cost: row.unit_cost,
  }));

  const fallback = await supabaseAdmin.from("order_items").insert(baseRows as never);
  if (fallback.error) {
    throw new Error(`Could not restore order line items: ${fallback.error.message}`);
  }
}

async function copySiblingItems(supabaseAdmin: any, targetOrderId: string, siblingOrderIds: string[]) {
  if (!siblingOrderIds.length) return { copied: 0, source_order_id: null as string | null };

  const { data, error } = await supabaseAdmin
    .from("order_items")
    .select("*")
    .in("order_id", siblingOrderIds)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Could not inspect sibling order items: ${error.message}`);
  if (!data?.length) return { copied: 0, source_order_id: null as string | null };

  const sourceOrderId = data[0].order_id as string;
  const siblingRows = data.filter((row: any) => row.order_id === sourceOrderId);
  const rows = siblingRows.map((row: any) => {
    const { id, created_at, updated_at, order_id, total_selling_price, total_cost, profit, ...rest } = row;
    void id;
    void created_at;
    void updated_at;
    void order_id;
    void total_selling_price;
    void total_cost;
    void profit;
    return { ...rest, order_id: targetOrderId };
  });

  await insertOrderItems(supabaseAdmin, rows);
  return { copied: rows.length, source_order_id: sourceOrderId };
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

export const Route = createFileRoute("/api/orders/restore-line-items")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireRoles(request, ["admin", "operations"]);
        if (!auth.ok) return auth.response;

        let body: RestoreBody = {};
        try {
          body = (await request.json()) as RestoreBody;
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
        }

        const requestedOrderId = stringValue(body.order_id);
        const requestedShopifyOrderId = stringValue(body.shopify_order_id);
        const requestedOrderNumber = normalizeOrderNumber(body.order_number);

        if (!requestedOrderId && !requestedShopifyOrderId && !requestedOrderNumber) {
          return Response.json(
            { ok: false, error: "Provide order_id, order_number, or shopify_order_id." },
            { status: 400 },
          );
        }

        const orderMatches: any[] = [];

        if (requestedOrderId) {
          const { data, error } = await auth.supabaseAdmin
            .from("orders")
            .select("id,order_number,shopify_order_id")
            .eq("id", requestedOrderId)
            .maybeSingle();
          if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
          if (data) orderMatches.push(data);
        }

        if (!orderMatches.length && requestedShopifyOrderId) {
          const { data, error } = await auth.supabaseAdmin
            .from("orders")
            .select("id,order_number,shopify_order_id")
            .eq("shopify_order_id", requestedShopifyOrderId);
          if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
          orderMatches.push(...(data ?? []));
        }

        if (!orderMatches.length && requestedOrderNumber) {
          const orderNumberVariants = Array.from(
            new Set([requestedOrderNumber, requestedOrderNumber.replace(/^#/, "")]),
          );
          const { data, error } = await auth.supabaseAdmin
            .from("orders")
            .select("id,order_number,shopify_order_id")
            .in("order_number", orderNumberVariants);
          if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
          orderMatches.push(...(data ?? []));
        }

        if (!orderMatches.length) {
          return Response.json({ ok: false, error: "Local order was not found." }, { status: 404 });
        }

        const targetOrder = orderMatches.find((row) => row.id === requestedOrderId) ?? orderMatches[0];
        const duplicateOrders = orderMatches.filter((row) => row.id !== targetOrder.id);
        const siblingIds = new Set<string>(duplicateOrders.map((row) => row.id).filter(Boolean));

        if (targetOrder.shopify_order_id) {
          const { data } = await auth.supabaseAdmin
            .from("orders")
            .select("id")
            .eq("shopify_order_id", targetOrder.shopify_order_id);
          for (const row of data ?? []) {
            if (row.id && row.id !== targetOrder.id) siblingIds.add(row.id);
          }
        }

        if (targetOrder.order_number) {
          const { data } = await auth.supabaseAdmin
            .from("orders")
            .select("id")
            .eq("order_number", targetOrder.order_number);
          for (const row of data ?? []) {
            if (row.id && row.id !== targetOrder.id) siblingIds.add(row.id);
          }
        }

        const { count: existingItemsCount, error: countError } = await auth.supabaseAdmin
          .from("order_items")
          .select("id", { count: "exact", head: true })
          .eq("order_id", targetOrder.id);
        if (countError) {
          return Response.json({ ok: false, error: countError.message }, { status: 500 });
        }

        const duplicateItemCounts: Record<string, number> = {};
        for (const siblingId of siblingIds) {
          const { count } = await auth.supabaseAdmin
            .from("order_items")
            .select("id", { count: "exact", head: true })
            .eq("order_id", siblingId);
          duplicateItemCounts[siblingId] = count ?? 0;
        }

        if ((existingItemsCount ?? 0) > 0) {
          return Response.json({
            ok: true,
            restored: false,
            reason: "order_already_has_line_items",
            order_id: targetOrder.id,
            order_number: targetOrder.order_number,
            shopify_order_id: targetOrder.shopify_order_id,
            existing_items_count: existingItemsCount ?? 0,
            duplicate_orders_count: siblingIds.size,
            duplicate_item_counts: duplicateItemCounts,
            changed_order_totals: false,
            changed_shipping_cost: false,
            changed_packaging_cost: false,
            changed_status: false,
            changed_customer: false,
          });
        }

        const copied = await copySiblingItems(auth.supabaseAdmin, targetOrder.id, Array.from(siblingIds));
        if (copied.copied > 0) {
          return Response.json({
            ok: true,
            restored: true,
            restored_from: "sibling_order_items",
            restored_items_count: copied.copied,
            source_order_id: copied.source_order_id,
            order_id: targetOrder.id,
            order_number: targetOrder.order_number,
            shopify_order_id: targetOrder.shopify_order_id,
            duplicate_orders_count: siblingIds.size,
            duplicate_item_counts: duplicateItemCounts,
            changed_order_totals: false,
            changed_shipping_cost: false,
            changed_packaging_cost: false,
            changed_status: false,
            changed_customer: false,
          });
        }

        const shopifyOrderId = stringValue(targetOrder.shopify_order_id || requestedShopifyOrderId);
        if (!shopifyOrderId) {
          return Response.json(
            {
              ok: false,
              error:
                "This local order has no Shopify order ID, and no sibling line items were found.",
              order_id: targetOrder.id,
              order_number: targetOrder.order_number,
            },
            { status: 400 },
          );
        }

        const shopifyOrder = await fetchShopifyOrder(shopifyOrderId);
        const lineItems = (shopifyOrder?.line_items ?? []).filter((line) => lineQuantity(line) > 0);

        if (!lineItems.length) {
          return Response.json(
            {
              ok: false,
              error: "Shopify returned no restorable line items for this order.",
              order_id: targetOrder.id,
              shopify_order_id: shopifyOrderId,
            },
            { status: 404 },
          );
        }

        const rows = lineItems.map((line) => enhancedOrderItemRow(targetOrder.id, line));
        await insertOrderItems(auth.supabaseAdmin, rows);

        return Response.json({
          ok: true,
          restored: true,
          restored_from: "shopify_order_line_items",
          restored_items_count: rows.length,
          order_id: targetOrder.id,
          order_number: targetOrder.order_number,
          shopify_order_id: shopifyOrderId,
          duplicate_orders_count: siblingIds.size,
          duplicate_item_counts: duplicateItemCounts,
          changed_order_totals: false,
          changed_shipping_cost: false,
          changed_packaging_cost: false,
          changed_status: false,
          changed_customer: false,
        });
      },
    },
  },
});
