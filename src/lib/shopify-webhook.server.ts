import { createHmac, timingSafeEqual } from "node:crypto";
import { calculatePackagingCost } from "@/lib/packaging-cost";
import { mediaFromVariant, type ShopifyVariantLike } from "@/lib/product-media";
import {
  fetchShopifyWithRetry,
  getShopifyAdminConfig,
  shopifyHeaders,
} from "@/lib/shopify-sync.server";

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
  company?: string | null;
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
  product_id?: number | string | null;
  image_url?: string | null;
  image?: { src?: string | null; url?: string | null } | string | null;
  properties?: Array<{ name: string; value: string }> | null;
};

type ShopifyCustomer = {
  id?: number | string | null;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  default_address?: ShopifyAddress | null;
};

export type ShopifyOrderPayload = {
  id: number | string;
  name?: string | null;
  order_number?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  processed_at?: string | null;
  closed_at?: string | null;
  status?: string | null;
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
  email?: string | null;
  contact_email?: string | null;
  phone?: string | null;
  customer?: ShopifyCustomer | null;
  shipping_address?: ShopifyAddress | null;
  billing_address?: ShopifyAddress | null;
  line_items?: ShopifyLineItem[] | null;
};

type ShopifyOrderLookupResponse = {
  order?: ShopifyOrderPayload | null;
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
  lineItemId: string | null;
  adminGraphqlApiId: string | null;
  variantId: string | null;
  productId: string | null;
  inventoryItemId: string | null;
  barcode: string | null;
  productType: string | null;
  imageUrl: string | null;
  color: string | null;
  size: string | null;
};

type RemovedOrderItemDebug = {
  order_number: string;
  old_sku: string;
  old_product_title: string;
  reason: "removed_from_shopify_order" | "current_quantity_zero";
};

export type CustomerNameOutcome =
  | "preserved_existing"
  | "repaired_from_shopify"
  | "still_unknown";

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
  customer_name_outcome: CustomerNameOutcome;
  contact_fields_preserved: boolean;
  contact_fields_filled_from_shopify: string[];
};

function fullName(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ").trim();
}

function toNumber(value: unknown): number {
  if (value == null || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isSchemaError(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    /column|schema cache|could not find/i.test(message)
  );
}

function shippingCost(p: ShopifyOrderPayload): number {
  const set = p.total_shipping_price_set?.shop_money?.amount;
  if (set) return Number(set) || 0;
  return (p.shipping_lines ?? []).reduce((s, l) => s + (Number(l.price) || 0), 0);
}

function defaultShippingCost(): number {
  return 200;
}

function normalizeStatus(value?: string | null): string {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isShopifyClosedOrArchived(payload: ShopifyOrderPayload): boolean {
  const status = normalizeStatus(payload.status);
  return Boolean(payload.closed_at) || status === "closed" || status === "archived";
}

function mapOrderStatus(payload: ShopifyOrderPayload): string {
  const fulfillmentStatus = normalizeStatus(payload.fulfillment_status);
  const financialStatus = normalizeStatus(payload.financial_status);
  if (payload.cancelled_at || fulfillmentStatus === "cancelled" || financialStatus === "voided") {
    return "Cancelled";
  }
  if (fulfillmentStatus === "fulfilled") {
    return financialStatus === "paid" && isShopifyClosedOrArchived(payload) ? "Delivered" : "Shipped";
  }
  if (fulfillmentStatus === "partially_fulfilled" || fulfillmentStatus === "partial") return "Ready";
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

function lineItemImageUrl(line: ShopifyLineItem) {
  if (line.image_url) return line.image_url;
  if (typeof line.image === "string") return line.image;
  return line.image?.src ?? line.image?.url ?? null;
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
      lineItemId: line.id == null ? null : String(line.id),
      adminGraphqlApiId: line.admin_graphql_api_id ?? null,
      variantId: line.variant_id == null ? null : String(line.variant_id),
      productId: line.product_id == null ? null : String(line.product_id),
      inventoryItemId: null,
      barcode: null,
      productType: null,
      imageUrl: lineItemImageUrl(line),
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

function activityTouchesPackagingCost(action: string | null | undefined, details: unknown) {
  if (action !== "update_costs") return false;
  if (!details || typeof details !== "object" || Array.isArray(details)) return false;
  if ("old_packaging_cost" in details && "new_packaging_cost" in details) {
    const oldValue = toNumber((details as Record<string, unknown>).old_packaging_cost);
    const newValue = toNumber((details as Record<string, unknown>).new_packaging_cost);
    return Math.abs(oldValue - newValue) >= 0.005;
  }
  return (
    "packaging_cost" in details ||
    "new_packaging_cost" in details
  );
}

async function hasManualPackagingCostOverride(supabaseAdmin: any, orderId: string | null) {
  if (!orderId) return false;
  const { data, error } = await supabaseAdmin
    .from("order_activity")
    .select("action,details")
    .eq("order_id", orderId)
    .limit(200);
  if (error) throw new Error(`order_activity inspect failed: ${error.message}`);
  return (data ?? []).some((row: { action: string | null; details: unknown }) =>
    activityTouchesPackagingCost(row.action, row.details),
  );
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

function productFromVariantRelation(row: ShopifyVariantLike) {
  const relation = row.shopify_products;
  return Array.isArray(relation) ? relation[0] ?? null : relation ?? null;
}

function cleanVariantTitle(value: string | null | undefined) {
  const title = String(value ?? "").trim();
  if (!title || title.toLowerCase() === "default title") return null;
  return title;
}

async function enrichLineItemsWithCurrentShopifyProductData(
  supabaseAdmin: any,
  currentItems: PreparedLineItem[],
) {
  const variantIds = Array.from(
    new Set(currentItems.map((item) => item.variantId).filter(Boolean) as string[]),
  );
  if (!variantIds.length) return;

  const variantRows = await safeReadTable<ShopifyVariantLike>(
    supabaseAdmin
      .from("shopify_variants")
      .select(
        "shopify_variant_id,shopify_product_id,sku,barcode,title,inventory_item_id,option1,option2,option3,raw,shopify_products(title,product_type,image,raw)",
      )
      .in("shopify_variant_id", variantIds),
  );
  const variantById = new Map(
    variantRows.map((row) => [String(row.shopify_variant_id), row]),
  );

  for (const item of currentItems) {
    const row = item.variantId ? variantById.get(item.variantId) : null;
    if (!row) continue;

    const media = mediaFromVariant(row);
    const product = productFromVariantRelation(row);
    const currentSku = row.sku?.trim();
    const variantTitle = cleanVariantTitle(media.variantTitle);

    item.sku = currentSku || item.sku;
    item.productName = media.productTitle || item.productName;
    item.variant = variantTitle ?? item.variant;
    item.productId = row.shopify_product_id ? String(row.shopify_product_id) : item.productId;
    item.inventoryItemId = row.inventory_item_id ? String(row.inventory_item_id) : item.inventoryItemId;
    item.barcode = row.barcode ?? item.barcode;
    item.productType = media.productType ?? product?.product_type ?? item.productType;
    item.imageUrl = media.imageUrl ?? item.imageUrl;
    item.color = item.color ?? row.option1 ?? null;
    item.size = item.size ?? row.option2 ?? row.option3 ?? null;
    item.fallbackKey = fallbackItemKey(item.sku, item.variant, item.productName);
  }
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

async function fetchFullShopifyOrderPayload(shopifyOrderId: string) {
  const config = getShopifyAdminConfig();
  if (!config.ok) throw new Error(config.error);

  const url = `https://${config.domain}/admin/api/${config.apiVersion}/orders/${encodeURIComponent(shopifyOrderId)}.json`;
  const res = await fetchShopifyWithRetry(url, shopifyHeaders(config.accessToken));
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Shopify order line item lookup failed (${res.status}): ${text.slice(0, 240)}`);
  }

  let json: ShopifyOrderLookupResponse;
  try {
    json = JSON.parse(text) as ShopifyOrderLookupResponse;
  } catch {
    throw new Error("Shopify order line item lookup returned invalid JSON.");
  }

  return json.order ?? null;
}

async function ensureShopifyOrderLineItems(payload: ShopifyOrderPayload) {
  if (Array.isArray(payload.line_items) && payload.line_items.length > 0) return payload;

  const fullOrder = await fetchFullShopifyOrderPayload(String(payload.id));
  if (!fullOrder?.line_items?.length) return payload;

  return {
    ...payload,
    ...fullOrder,
    line_items: fullOrder.line_items,
  };
}

function fullOrderItemRow(
  orderId: string,
  shopifyOrderId: string,
  item: PreparedLineItem,
  unitCost: number,
) {
  return {
    order_id: orderId,
    shopify_order_id: shopifyOrderId,
    shopify_line_item_id: item.lineItemId,
    shopify_admin_graphql_api_id: item.adminGraphqlApiId,
    shopify_variant_id: item.variantId,
    shopify_product_id: item.productId,
    sku: item.sku,
    product_name: item.productName,
    variant: item.variant,
    barcode: item.barcode,
    product_type: item.productType,
    image_url: item.imageUrl,
    color: item.color,
    size: item.size,
    quantity: item.quantity,
    unit_selling_price: item.unitSellingPrice,
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

async function insertOrderItemRows(supabaseAdmin: any, rows: Record<string, unknown>[]) {
  if (!rows.length) return { schemaFallbackUsed: false };

  const { error } = await supabaseAdmin.from("order_items").insert(rows as never);
  if (!error) return { schemaFallbackUsed: false };
  if (!isSchemaError(error)) throw new Error(`order_items insert failed: ${error.message}`);

  const fallbackRows = rows.map(baseOrderItemRow);
  const fallback = await supabaseAdmin.from("order_items").insert(fallbackRows as never);
  if (fallback.error) throw new Error(`order_items insert failed: ${fallback.error.message}`);
  return { schemaFallbackUsed: true };
}

export async function processShopifyOrder(payload: ShopifyOrderPayload) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  payload = await ensureShopifyOrderLineItems(payload);

  const shopifyOrderId = String(payload.id);
  const orderNumber =
    payload.name ?? (payload.order_number ? `#${payload.order_number}` : shopifyOrderId);
  const mappedOrderStatus = mapOrderStatus(payload);
  const shopifyDelivered = mappedOrderStatus === "Delivered";
  const ship = payload.shipping_address ?? null;
  const bill = payload.billing_address ?? null;
  const cust = payload.customer ?? null;
  const custDefault = cust?.default_address ?? null;
  const orderEmail = payload.email ?? payload.contact_email ?? cust?.email ?? null;

  // Resolve customer name using ordered fallbacks:
  //   Shopify customer > shipping address > billing address > customer default address > email > phone.
  const nonEmpty = (value: string | null | undefined) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  };
  const nameCandidates: (string | null | undefined)[] = [
    fullName([cust?.first_name, cust?.last_name]),
    cust?.name,
    fullName([ship?.first_name, ship?.last_name]),
    ship?.name,
    fullName([bill?.first_name, bill?.last_name]),
    bill?.name,
    fullName([custDefault?.first_name, custDefault?.last_name]),
    custDefault?.name,
    orderEmail,
    ship?.phone ?? bill?.phone ?? cust?.phone ?? payload.phone ?? null,
  ];
  const resolvedName =
    nameCandidates.map(nonEmpty).find((v) => v !== null) ?? null;

  const phone =
    nonEmpty(ship?.phone) ??
    nonEmpty(bill?.phone) ??
    nonEmpty(cust?.phone) ??
    nonEmpty(custDefault?.phone) ??
    nonEmpty(payload.phone) ??
    null;
  const city = nonEmpty(ship?.city) ?? nonEmpty(bill?.city) ?? nonEmpty(custDefault?.city) ?? null;
  const area =
    nonEmpty(ship?.province) ??
    nonEmpty(bill?.province) ??
    nonEmpty(custDefault?.province) ??
    null;
  const address =
    nonEmpty(fullName([ship?.address1, ship?.address2])) ??
    nonEmpty(fullName([bill?.address1, bill?.address2])) ??
    nonEmpty(fullName([custDefault?.address1, custDefault?.address2])) ??
    null;

  const { data: existingOrder } = await supabaseAdmin
    .from("orders")
    .select(
      "id,shipping_cost,packaging_cost,order_status,delivered,confirmation_status,internal_notes,customer_full_name,phone,city,area,full_address",
    )
    .eq("shopify_order_id", shopifyOrderId)
    .maybeSingle();

  // Preserve existing contact fields if the incoming payload resolved nothing useful.
  const existingName = nonEmpty(existingOrder?.customer_full_name);
  const existingNameIsReal = existingName && existingName.toLowerCase() !== "unknown";
  const customerName =
    resolvedName ?? (existingNameIsReal ? (existingName as string) : "Unknown");
  const finalPhone = phone ?? nonEmpty(existingOrder?.phone) ?? null;
  const finalCity = city ?? nonEmpty(existingOrder?.city) ?? null;
  const finalArea = area ?? nonEmpty(existingOrder?.area) ?? null;
  const finalAddress = address ?? nonEmpty(existingOrder?.full_address) ?? null;

  // Upsert customer by phone (best-effort dedupe). Do not overwrite an
  // existing customer's real name with a placeholder.
  let customerId: string | null = null;
  if (finalPhone) {
    const { data: existing } = await supabaseAdmin
      .from("customers")
      .select("id, full_name")
      .eq("phone", finalPhone)
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      customerId = existing.id;
      const existingCustomerName = nonEmpty(existing.full_name);
      const nextCustomerName =
        resolvedName ??
        (existingCustomerName && existingCustomerName.toLowerCase() !== "unknown"
          ? existingCustomerName
          : "Unknown");
      await supabaseAdmin
        .from("customers")
        .update({
          full_name: nextCustomerName,
          city: finalCity,
          area: finalArea,
          full_address: finalAddress,
        })
        .eq("id", customerId);
    } else {
      const { data: created } = await supabaseAdmin
        .from("customers")
        .insert({
          full_name: customerName,
          phone: finalPhone,
          city: finalCity,
          area: finalArea,
          full_address: finalAddress,
        })
        .select("id")
        .single();
      customerId = created?.id ?? null;
    }
  }

  const preserveManualDelivered =
    !shopifyDelivered &&
    mappedOrderStatus !== "Cancelled" &&
    existingOrder?.delivered === true;
  const orderStatus = preserveManualDelivered ? "Delivered" : mappedOrderStatus;
  const isCancelled = orderStatus === "Cancelled";

  const { currentItems, zeroSkipped, zeroExamples } = prepareLineItems(
    payload,
    orderNumber,
    isCancelled,
  );
  await enrichLineItemsWithCurrentShopifyProductData(supabaseAdmin, currentItems);

  if (currentItems.length === 0 && currentOrderTotal(payload, currentItems) > 0) {
    throw new Error(
      `Shopify order ${orderNumber} has no line_items in the Admin API response; refusing to save it without products.`,
    );
  }

  const totalSelling = isCancelled ? 0 : currentOrderTotal(payload, currentItems);
  const shipCost = existingOrder
    ? toNumber(existingOrder.shipping_cost)
    : defaultShippingCost();
  const packagingCostTouched = await hasManualPackagingCostOverride(
    supabaseAdmin,
    existingOrder?.id ?? null,
  );
  const calculatedPackagingCost = calculatePackagingCost(currentItems);
  const packagingCost =
    existingOrder && packagingCostTouched
      ? toNumber(existingOrder.packaging_cost)
      : calculatedPackagingCost;

  const orderRow = {
    shopify_order_id: shopifyOrderId,
    order_number: orderNumber,
    shopify_created_at: payload.created_at ?? payload.processed_at ?? null,
    order_date: (payload.created_at ?? payload.processed_at ?? new Date().toISOString()).slice(0, 10),
    customer_id: customerId,
    customer_full_name: customerName,
    phone: finalPhone ?? "",
    second_phone: null,
    city: finalCity,
    area: finalArea,
    full_address: finalAddress,
    payment_gateway: payload.gateway ?? payload.payment_gateway_names?.[0] ?? null,
    confirmation_status: existingOrder?.confirmation_status ?? "Fresh Calls",
    order_status: orderStatus,
    delivered: orderStatus === "Delivered",
    internal_notes: existingOrder ? existingOrder.internal_notes : payload.note ?? null,
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
    const rows = currentItems.map((item, index) =>
      fullOrderItemRow(orderId, shopifyOrderId, item, isCancelled ? 0 : costs[index] ?? 0),
    );
    await insertOrderItemRows(supabaseAdmin, rows);
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
