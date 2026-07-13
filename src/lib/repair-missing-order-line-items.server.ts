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
  image_url?: string | null;
  image?: { src?: string | null; url?: string | null } | string | null;
};

type ShopifyOrderResponse = {
  order?: {
    id?: number | string | null;
    name?: string | null;
    order_number?: number | string | null;
    line_items?: ShopifyLineItem[] | null;
  } | null;
};

export type RepairMissingOrderLineItemsResult = {
  orders_checked: number;
  missing_orders_found: number;
  repaired_orders: number;
  line_items_inserted: number;
  line_items_with_cost: number;
  line_items_missing_cost: number;
  schema_fallbacks_used: number;
  failed_count: number;
  repaired: Array<{ order_number: string | null; line_items_inserted: number }>;
  errors: string[];
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

function normalizeKey(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function lineImageUrl(line: ShopifyLineItem) {
  if (line.image_url) return line.image_url;
  if (typeof line.image === "string") return line.image;
  return line.image?.src ?? line.image?.url ?? null;
}

function isSchemaError(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    /column|schema cache|could not find/i.test(message)
  );
}

function numberCost(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function safeReadTable<T>(
  query: PromiseLike<{ data: T[] | null; error: { message?: string; code?: string } | null }>,
) {
  const { data, error } = await query;
  if (!error) return data ?? [];
  if (isSchemaError(error)) return [];
  throw new Error(error.message ?? "database read failed");
}

async function resolveRepairLineCosts(supabaseAdmin: any, lineItems: ShopifyLineItem[]) {
  const variantIds = Array.from(
    new Set(lineItems.map((line) => stringValue(line.variant_id)).filter(Boolean)),
  );
  const skus = Array.from(new Set(lineItems.map((line) => stringValue(line.sku)).filter(Boolean)));

  type VariantRow = {
    shopify_variant_id: string;
    sku: string | null;
    inventory_item_id: string | null;
  };
  const variantRows: VariantRow[] = [];
  if (variantIds.length) {
    variantRows.push(
      ...(await safeReadTable<VariantRow>(
        supabaseAdmin
          .from("shopify_variants")
          .select("shopify_variant_id,sku,inventory_item_id")
          .in("shopify_variant_id", variantIds),
      )),
    );
  }
  if (skus.length) {
    variantRows.push(
      ...(await safeReadTable<VariantRow>(
        supabaseAdmin
          .from("shopify_variants")
          .select("shopify_variant_id,sku,inventory_item_id")
          .in("sku", skus),
      )),
    );
  }

  const variantById = new Map(variantRows.map((row) => [String(row.shopify_variant_id), row]));
  const variantBySku = new Map<string, VariantRow>();
  for (const row of variantRows) {
    if (row.sku) {
      variantBySku.set(row.sku, row);
      variantBySku.set(normalizeKey(row.sku), row);
    }
  }

  const inventoryIds = Array.from(
    new Set(variantRows.map((row) => row.inventory_item_id).filter(Boolean) as string[]),
  );
  type InventoryRow = {
    inventory_item_id: string;
    sku: string | null;
    unit_cost_amount: number | string | null;
  };
  const inventoryRows: InventoryRow[] = [];
  if (inventoryIds.length) {
    inventoryRows.push(
      ...(await safeReadTable<InventoryRow>(
        supabaseAdmin
          .from("shopify_inventory_items")
          .select("inventory_item_id,sku,unit_cost_amount")
          .in("inventory_item_id", inventoryIds),
      )),
    );
  }
  if (skus.length) {
    inventoryRows.push(
      ...(await safeReadTable<InventoryRow>(
        supabaseAdmin
          .from("shopify_inventory_items")
          .select("inventory_item_id,sku,unit_cost_amount")
          .in("sku", skus),
      )),
    );
  }

  const costByInventoryId = new Map<string, number>();
  const costBySku = new Map<string, number>();
  for (const row of inventoryRows) {
    const cost = numberCost(row.unit_cost_amount);
    if (cost <= 0) continue;
    costByInventoryId.set(String(row.inventory_item_id), cost);
    if (row.sku) {
      costBySku.set(row.sku, cost);
      costBySku.set(normalizeKey(row.sku), cost);
    }
  }

  return lineItems.map((line) => {
    const variant =
      variantById.get(stringValue(line.variant_id)) ??
      variantBySku.get(stringValue(line.sku)) ??
      variantBySku.get(normalizeKey(stringValue(line.sku)));
    return (
      (variant?.inventory_item_id && costByInventoryId.get(variant.inventory_item_id)) ||
      costBySku.get(stringValue(line.sku)) ||
      costBySku.get(normalizeKey(stringValue(line.sku))) ||
      0
    );
  });
}

function fullOrderItemRow(
  orderId: string,
  shopifyOrderId: string,
  line: ShopifyLineItem,
  unitCost: number,
) {
  const quantity = lineQuantity(line);
  const variantTitle = stringValue(line.variant_title);
  return {
    order_id: orderId,
    shopify_order_id: shopifyOrderId,
    shopify_line_item_id: stringValue(line.id) || null,
    shopify_admin_graphql_api_id: stringValue(line.admin_graphql_api_id) || null,
    shopify_variant_id: stringValue(line.variant_id) || null,
    shopify_product_id: stringValue(line.product_id) || null,
    sku: lineSku(line),
    product_name: stringValue(line.title) || stringValue(line.name) || "Shopify line item",
    variant: variantTitle || null,
    barcode: null,
    product_type: null,
    image_url: lineImageUrl(line),
    color: null,
    size: variantTitle || null,
    quantity,
    unit_selling_price: lineUnitPrice(line, quantity),
    unit_cost: unitCost,
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

export async function repairMissingOrderLineItems(
  supabaseAdmin: any,
  opts: { limit?: number; createdAtMin?: string; createdAtMax?: string } = {},
): Promise<RepairMissingOrderLineItemsResult> {
  let query = supabaseAdmin
    .from("orders")
    .select("id,order_number,shopify_order_id,total_selling_price")
    .not("shopify_order_id", "is", null)
    .gt("total_selling_price", 0);

  if (opts.createdAtMin) query = query.gte("shopify_created_at", opts.createdAtMin);
  if (opts.createdAtMax) query = query.lte("shopify_created_at", opts.createdAtMax);

  query = query.order("shopify_created_at", { ascending: false, nullsFirst: false });
  if (opts.limit && opts.limit > 0) query = query.limit(opts.limit);

  const { data: orders, error: ordersError } = await query;
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
  let lineItemsWithCost = 0;
  let lineItemsMissingCost = 0;
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

      const costs = await resolveRepairLineCosts(supabaseAdmin, lineItems);
      const rows = lineItems.map((line, index) =>
        fullOrderItemRow(order.id, shopifyOrderId, line, costs[index] ?? 0),
      );
      lineItemsWithCost += rows.filter((row) => numberValue(row.unit_cost) > 0).length;
      lineItemsMissingCost += rows.filter((row) => numberValue(row.unit_cost) <= 0).length;
      const insertResult = await insertOrderItems(supabaseAdmin, rows);
      if (insertResult.schemaFallbackUsed) schemaFallbacks++;

      const nextItemsCost = rows.reduce(
        (sum, row) => sum + numberValue(row.quantity) * numberValue(row.unit_cost),
        0,
      );
      await supabaseAdmin
        .from("orders")
        .update({ items_cost: Number(nextItemsCost.toFixed(2)) } as never)
        .eq("id", order.id);

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

  return {
    orders_checked: localOrders.length,
    missing_orders_found: missingOrders.length,
    repaired_orders: repairedOrders,
    line_items_inserted: lineItemsInserted,
    line_items_with_cost: lineItemsWithCost,
    line_items_missing_cost: lineItemsMissingCost,
    schema_fallbacks_used: schemaFallbacks,
    failed_count: failedCount,
    repaired,
    errors,
  };
}
