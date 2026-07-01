import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyShopifyHmac(rawBody: string, hmacHeader: string | null): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret || !hmacHeader) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

type ShopifyAddress = {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  phone?: string | null;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

type ShopifyLineItem = {
  id?: number | string | null;
  admin_graphql_api_id?: string | null;
  sku?: string | null;
  title?: string | null;
  name?: string | null;
  variant_title?: string | null;
  quantity?: number | null;
  current_quantity?: number | null;
  price?: string | null;
  discounted_price?: string | null;
  total_discount?: string | null;
  variant_id?: number | string | null;
  properties?: Array<{ name: string; value: string }> | null;
};

type ShopifyCustomer = {
  id?: number | string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type ShopifyOrderPayload = {
  id: number | string;
  name?: string | null;
  order_number?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  processed_at?: string | null;
  current_total_price?: string | null;
  total_price?: string | null;
  current_subtotal_price?: string | null;
  subtotal_price?: string | null;
  total_shipping_price_set?: { shop_money?: { amount?: string } } | null;
  shipping_lines?: Array<{ price?: string | null }> | null;
  gateway?: string | null;
  payment_gateway_names?: string[] | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  cancelled_at?: string | null;
  note?: string | null;
  tags?: string | null;
  customer?: ShopifyCustomer | null;
  shipping_address?: ShopifyAddress | null;
  billing_address?: ShopifyAddress | null;
  line_items?: ShopifyLineItem[] | null;
};

type ExistingOrderItem = {
  id: string;
  sku: string;
  product_name: string;
  variant: string | null;
  quantity: number;
  unit_cost: number;
};

type PreparedLineItem = {
  line: ShopifyLineItem;
  stableKey: string;
  fallbackKey: string;
  sku: string;
  productName: string;
  variant: string | null;
  quantity: number;
  unitSellingPrice: number;
  variantId: string | null;
  inventoryItemId: string | null;
  color: string | null;
  size: string | null;
};

type RemovedOrderItemDebug = {
  order_number: string;
  old_sku: string;
  old_product_title: string;
  reason: "removed_from_shopify_order" | "current_quantity_zero";
};

export type ShopifyOrderProcessResult = {
  orderId: string;
  shopifyOrderId: string;
  orderNumber: string;
  order_items_processed: number;
  order_items_inserted: number;
  order_items_updated: number;
  stale_order_items_removed: number;
  zero_quantity_items_skipped: number;
  order_items_with_cost: number;
  order_items_missing_cost: number;
  affected_orders_recalculated: number;
  stale_order_item_examples: RemovedOrderItemDebug[];
};

function fullName(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ").trim();
}

function toNumber(value: unknown): number {
  if (value == null || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function shippingCost(p: ShopifyOrderPayload): number {
  const set = p.total_shipping_price_set?.shop_money?.amount;
  if (set) return Number(set) || 0;
  return (p.shipping_lines ?? []).reduce((s, l) => s + (Number(l.price) || 0), 0);
}

function defaultShippingCost(): number {
  return 200;
}

function defaultPackagingCost(currentItems: PreparedLineItem[]): number {
  return currentItems.reduce((sum, item) => sum + item.quantity, 0) * 100;
}

function mapOrderStatus(payload: ShopifyOrderPayload): string {
  const fulfillmentStatus = (payload.fulfillment_status ?? "").toLowerCase();
  const financialStatus = (payload.financial_status ?? "").toLowerCase();
  if (payload.cancelled_at || fulfillmentStatus === "cancelled" || financialStatus === "voided") {
    return "Cancelled";
  }
  if (fulfillmentStatus === "fulfilled") return "Delivered";
  if (fulfillmentStatus === "partially_fulfilled") return "Ready";
  if (!fulfillmentStatus || fulfillmentStatus === "unfulfilled") return "New";
  return "New";
}

function normalizeSku(value?: string | null): string {
  return (value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function lineItemEffectiveQuantity(line: ShopifyLineItem, preserveOriginalQuantity = false): number {
  if (preserveOriginalQuantity) return Math.max(0, Math.trunc(toNumber(line.quantity)));
  if (line.current_quantity != null) return Math.max(0, Math.trunc(toNumber(line.current_quantity)));
  return Math.max(0, Math.trunc(toNumber(line.quantity)));
}

function lineItemSku(line: ShopifyLineItem): string {
  return line.sku || `shopify-variant-${line.variant_id ?? "unknown"}`;
}

function fallbackItemKey(sku: string, variant?: string | null, productName?: string | null): string {
  return [
    normalizeSku(sku),
    (variant ?? "").trim().toLowerCase(),
    (productName ?? "").trim().toLowerCase(),
  ].join("|");
}

function lineItemStableKey(line: ShopifyLineItem, sku: string): string {
  if (line.id != null) return `shopify-line:${line.id}`;
  if (line.admin_graphql_api_id) return `shopify-gid:${line.admin_graphql_api_id}`;
  if (line.variant_id != null || sku) {
    return `shopify-variant:${line.variant_id ?? "unknown"}:${normalizeSku(sku) || sku}`;
  }
  return `shopify-title:${fallbackItemKey(sku, line.variant_title, line.title ?? line.name)}`;
}

function lineItemUnitSellingPrice(line: ShopifyLineItem, quantity: number): number {
  const discounted = toNumber(line.discounted_price);
  if (discounted > 0) return discounted;

  const price = toNumber(line.price);
  const discount = toNumber(line.total_discount);
  if (price > 0 && discount > 0 && quantity > 0) {
    return Math.max(0, price - discount / quantity);
  }
  return price;
}

function prepareLineItems(
  payload: ShopifyOrderPayload,
  orderNumber: string,
  preserveOriginalQuantities = false,
): { currentItems: PreparedLineItem[]; zeroSkipped: number; zeroExamples: RemovedOrderItemDebug[] } {
  const currentItems: PreparedLineItem[] = [];
  const zeroExamples: RemovedOrderItemDebug[] = [];
  let zeroSkipped = 0;

  for (const line of payload.line_items ?? []) {
    const quantity = lineItemEffectiveQuantity(line, preserveOriginalQuantities);
    const sku = lineItemSku(line);
    const productName = line.title ?? line.name ?? "Unknown";
    const variant = line.variant_title ?? null;

    if (quantity <= 0) {
      zeroSkipped++;
      if (zeroExamples.length < 10) {
        zeroExamples.push({
          order_number: orderNumber,
          old_sku: sku,
          old_product_title: productName,
          reason: "current_quantity_zero",
        });
      }
      continue;
    }

    const color =
      line.properties?.find((p) => p.name?.toLowerCase() === "color")?.value ?? null;
    const size = line.properties?.find((p) => p.name?.toLowerCase() === "size")?.value ?? null;

    currentItems.push({
      line,
      stableKey: lineItemStableKey(line, sku),
      fallbackKey: fallbackItemKey(sku, variant, productName),
      sku,
      productName,
      variant,
      quantity,
      unitSellingPrice: lineItemUnitSellingPrice(line, quantity),
      variantId: line.variant_id == null ? null : String(line.variant_id),
      inventoryItemId: null,
      color,
      size,
    });
  }

  return { currentItems, zeroSkipped, zeroExamples };
}

async function readExistingOrderItems(supabaseAdmin: any, orderId: string) {
  const { data, error } = await supabaseAdmin
    .from("order_items")
    .select("id,sku,product_name,variant,quantity,unit_cost")
    .eq("order_id", orderId);
  if (error) throw new Error(`order_items inspect failed: ${error.message}`);
  return (data ?? []) as ExistingOrderItem[];
}

async function safeReadTable<T>(
  query: PromiseLike<{ data: T[] | null; error: { message?: string; code?: string } | null }>,
): Promise<T[]> {
  const { data, error } = await query;
  if (!error) return data ?? [];

  const msg = error.message ?? "";
  if (
    error.code === "PGRST205" ||
    msg.includes("schema cache") ||
    msg.includes("Could not find the table")
  ) {
    return [];
  }
  throw new Error(msg || "database read failed");
}

function addCost(map: Map<string, number>, key: string | null | undefined, value: unknown) {
  const cost = toNumber(value);
  if (!key || cost <= 0) return;
  map.set(key, cost);
}

async function resolveLineItemCosts(
  supabaseAdmin: any,
  currentItems: PreparedLineItem[],
  existingItems: ExistingOrderItem[],
) {
  const variantIds = Array.from(
    new Set(currentItems.map((item) => item.variantId).filter(Boolean) as string[]),
  );
  const rawSkus = Array.from(new Set(currentItems.map((item) => item.sku).filter(Boolean)));
  const normalizedSkus = new Set(rawSkus.map(normalizeSku).filter(Boolean));

  const existingCostByFallback = new Map<string, number>();
  const existingCostBySku = new Map<string, number>();
  for (const item of existingItems) {
    const cost = toNumber(item.unit_cost);
    if (cost <= 0) continue;
    addCost(existingCostByFallback, fallbackItemKey(item.sku, item.variant, item.product_name), cost);
    addCost(existingCostBySku, item.sku, cost);
    addCost(existingCostBySku, normalizeSku(item.sku), cost);
  }

  const variantRows = variantIds.length
    ? await safeReadTable<{
        shopify_variant_id: string;
        sku: string | null;
        inventory_item_id: string | null;
      }>(
        supabaseAdmin
          .from("shopify_variants")
          .select("shopify_variant_id,sku,inventory_item_id")
          .in("shopify_variant_id", variantIds),
      )
    : [];

  const variantById = new Map(variantRows.map((row) => [String(row.shopify_variant_id), row]));
  for (const item of currentItems) {
    const variantRow = item.variantId ? variantById.get(item.variantId) : null;
    if (variantRow?.inventory_item_id) item.inventoryItemId = String(variantRow.inventory_item_id);
  }

  const inventoryItemIds = Array.from(
    new Set(currentItems.map((item) => item.inventoryItemId).filter(Boolean) as string[]),
  );

  const shopifyCostByInventoryItemId = new Map<string, number>();
  const shopifyCostBySku = new Map<string, number>();
  const inventoryRows = inventoryItemIds.length
    ? await safeReadTable<{
        inventory_item_id: string;
        sku: string | null;
        unit_cost_amount: number | string | null;
      }>(
        supabaseAdmin
          .from("shopify_inventory_items")
          .select("inventory_item_id,sku,unit_cost_amount")
          .in("inventory_item_id", inventoryItemIds),
      )
    : [];

  for (const row of inventoryRows) {
    addCost(shopifyCostByInventoryItemId, String(row.inventory_item_id), row.unit_cost_amount);
    addCost(shopifyCostBySku, row.sku, row.unit_cost_amount);
    addCost(shopifyCostBySku, normalizeSku(row.sku), row.unit_cost_amount);
  }

  const shopifySkuRows = rawSkus.length
    ? await safeReadTable<{
        sku: string | null;
        unit_cost_amount: number | string | null;
      }>(
        supabaseAdmin
          .from("shopify_inventory_items")
          .select("sku,unit_cost_amount")
          .in("sku", rawSkus),
      )
    : [];
  for (const row of shopifySkuRows) {
    addCost(shopifyCostBySku, row.sku, row.unit_cost_amount);
    addCost(shopifyCostBySku, normalizeSku(row.sku), row.unit_cost_amount);
  }

  const localInventoryRows = rawSkus.length
    ? await safeReadTable<{ sku: string | null; cost_price: number | string | null }>(
        supabaseAdmin.from("inventory").select("sku,cost_price").in("sku", rawSkus),
      )
    : [];
  const localInventoryCostBySku = new Map<string, number>();
  for (const row of localInventoryRows) {
    addCost(localInventoryCostBySku, row.sku, row.cost_price);
    addCost(localInventoryCostBySku, normalizeSku(row.sku), row.cost_price);
  }

  if (normalizedSkus.size && localInventoryRows.length !== rawSkus.length) {
    const { data } = await supabaseAdmin.from("inventory").select("sku,cost_price");
    for (const row of data ?? []) {
      if (!normalizedSkus.has(normalizeSku(row.sku))) continue;
      addCost(localInventoryCostBySku, row.sku, row.cost_price);
      addCost(localInventoryCostBySku, normalizeSku(row.sku), row.cost_price);
    }
  }

  return currentItems.map((item) => {
    const normalizedSku = normalizeSku(item.sku);
    return (
      (item.inventoryItemId && shopifyCostByInventoryItemId.get(item.inventoryItemId)) ||
      shopifyCostBySku.get(item.sku) ||
      shopifyCostBySku.get(normalizedSku) ||
      localInventoryCostBySku.get(item.sku) ||
      localInventoryCostBySku.get(normalizedSku) ||
      existingCostByFallback.get(item.fallbackKey) ||
      existingCostBySku.get(item.sku) ||
      existingCostBySku.get(normalizedSku) ||
      0
    );
  });
}

function currentOrderTotal(payload: ShopifyOrderPayload, currentItems: PreparedLineItem[]) {
  return (
    toNumber(payload.current_total_price) ||
    toNumber(payload.total_price) ||
    toNumber(payload.current_subtotal_price) ||
    toNumber(payload.subtotal_price) ||
    currentItems.reduce((sum, item) => sum + item.unitSellingPrice * item.quantity, 0)
  );
}

export async function processShopifyOrder(payload: ShopifyOrderPayload) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const shopifyOrderId = String(payload.id);
  const orderNumber =
    payload.name ?? (payload.order_number ? `#${payload.order_number}` : shopifyOrderId);
  const orderStatus = mapOrderStatus(payload);
  const isCancelled = orderStatus === "Cancelled";
  const ship = payload.shipping_address ?? payload.billing_address ?? null;
  const cust = payload.customer ?? null;

  const customerName =
    fullName([ship?.first_name, ship?.last_name]) ||
    ship?.name ||
    fullName([cust?.first_name, cust?.last_name]) ||
    "Unknown";
  const phone = ship?.phone ?? cust?.phone ?? null;
  const city = ship?.city ?? null;
  const area = ship?.province ?? null;
  const address = fullName([ship?.address1, ship?.address2]) || null;

  // Upsert customer by phone (best-effort dedupe)
  let customerId: string | null = null;
  if (phone) {
    const { data: existing } = await supabaseAdmin
      .from("customers")
      .select("id")
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      customerId = existing.id;
      await supabaseAdmin
        .from("customers")
        .update({
          full_name: customerName,
          city,
          area,
          full_address: address,
        })
        .eq("id", customerId);
    } else {
      const { data: created } = await supabaseAdmin
        .from("customers")
        .insert({
          full_name: customerName,
          phone,
          city,
          area,
          full_address: address,
        })
        .select("id")
        .single();
      customerId = created?.id ?? null;
    }
  }

  const { currentItems, zeroSkipped, zeroExamples } = prepareLineItems(
    payload,
    orderNumber,
    isCancelled,
  );

  const { data: existingOrder } = await supabaseAdmin
    .from("orders")
    .select("id,shipping_cost,packaging_cost")
    .eq("shopify_order_id", shopifyOrderId)
    .maybeSingle();

  const totalSelling = isCancelled ? 0 : currentOrderTotal(payload, currentItems);
  const shipCost = existingOrder
    ? toNumber(existingOrder.shipping_cost)
    : defaultShippingCost();
  const packagingCost = existingOrder
    ? toNumber(existingOrder.packaging_cost)
    : defaultPackagingCost(currentItems);

  const orderRow = {
    shopify_order_id: shopifyOrderId,
    order_number: orderNumber,
    shopify_created_at: payload.created_at ?? payload.processed_at ?? null,
    order_date: (payload.created_at ?? payload.processed_at ?? new Date().toISOString()).slice(0, 10),
    customer_id: customerId,
    customer_full_name: customerName,
    phone: phone ?? "",
    second_phone: null,
    city,
    area,
    full_address: address,
    payment_gateway: payload.gateway ?? payload.payment_gateway_names?.[0] ?? null,
    confirmation_status: "Fresh Calls",
    order_status: orderStatus,
    internal_notes: payload.note ?? null,
    total_selling_price: totalSelling,
    items_cost: 0,
    shipping_cost: shipCost,
    packaging_cost: packagingCost,
    tags: payload.tags
      ? payload.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : [],
  };

  const { data: upserted, error: upsertErr } = await supabaseAdmin
    .from("orders")
    .upsert(orderRow as never, { onConflict: "shopify_order_id" })
    .select("id")
    .single();

  if (upsertErr || !upserted) {
    throw new Error(`order upsert failed: ${upsertErr?.message ?? "unknown"}`);
  }
  const orderId = upserted.id;

  const existingItems = await readExistingOrderItems(supabaseAdmin, orderId);
  const existingFallbackKeys = new Set(
    existingItems.map((item) => fallbackItemKey(item.sku, item.variant, item.product_name)),
  );
  const currentFallbackKeys = new Set(currentItems.map((item) => item.fallbackKey));
  const staleExamples: RemovedOrderItemDebug[] = [];
  const staleItems = existingItems.filter((item) => {
    const isStale = !currentFallbackKeys.has(fallbackItemKey(item.sku, item.variant, item.product_name));
    if (isStale && staleExamples.length < 10) {
      staleExamples.push({
        order_number: orderNumber,
        old_sku: item.sku,
        old_product_title: item.product_name,
        reason: "removed_from_shopify_order",
      });
    }
    return isStale;
  });

  const costs = await resolveLineItemCosts(supabaseAdmin, currentItems, existingItems);
  const resolvedItemsCost = currentItems.reduce(
    (sum, item, index) => sum + item.quantity * (costs[index] ?? 0),
    0,
  );
  const itemsCost = isCancelled ? 0 : resolvedItemsCost;

  const { error: deleteErr } = await supabaseAdmin.from("order_items").delete().eq("order_id", orderId);
  if (deleteErr) throw new Error(`order_items replace delete failed: ${deleteErr.message}`);

  if (currentItems.length) {
    const rows = currentItems.map((item, index) => {
      return {
        order_id: orderId,
        sku: item.sku,
        product_name: item.productName,
        variant: item.variant,
        color: item.color,
        size: item.size,
        quantity: item.quantity,
        unit_selling_price: item.unitSellingPrice,
        unit_cost: isCancelled ? 0 : costs[index] ?? 0,
      };
    });
    const { error: itemsErr } = await supabaseAdmin.from("order_items").insert(rows as never);
    if (itemsErr) throw new Error(`order_items insert failed: ${itemsErr.message}`);
  }

  const { error: costUpdateErr } = await supabaseAdmin
    .from("orders")
    .update({ items_cost: itemsCost } as never)
    .eq("id", orderId);
  if (costUpdateErr) throw new Error(`order cost recalc failed: ${costUpdateErr.message}`);

  const orderItemsUpdated = currentItems.filter((item) => existingFallbackKeys.has(item.fallbackKey)).length;
  const orderItemsInserted = currentItems.length - orderItemsUpdated;
  const withCost = isCancelled ? 0 : costs.filter((cost) => cost > 0).length;

  return {
    orderId,
    shopifyOrderId,
    orderNumber,
    order_items_processed: currentItems.length,
    order_items_inserted: orderItemsInserted,
    order_items_updated: orderItemsUpdated,
    stale_order_items_removed: staleItems.length,
    zero_quantity_items_skipped: zeroSkipped,
    order_items_with_cost: withCost,
    order_items_missing_cost: currentItems.length - withCost,
    affected_orders_recalculated: 1,
    stale_order_item_examples: [...staleExamples, ...zeroExamples].slice(0, 10),
  } satisfies ShopifyOrderProcessResult;
}
