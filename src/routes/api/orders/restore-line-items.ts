import { createFileRoute } from "@tanstack/react-router";
import { requireRoles } from "@/lib/route-auth.server";
import {
  fetchShopifyWithRetry,
  getShopifyAdminConfig,
  shopifyHeaders,
  toNullableDate,
  toNullableNumber,
  upsertRows,
} from "@/lib/shopify-sync.server";

type RestoreBody = {
  order_id?: string;
  order_number?: string;
  shopify_order_id?: string | number;
  refresh_details?: boolean;
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

type ShopifyVariant = {
  id: number | string;
  product_id: number | string;
  title?: string | null;
  sku?: string | null;
  barcode?: string | null;
  price?: string | number | null;
  compare_at_price?: string | number | null;
  inventory_item_id?: number | string | null;
  inventory_quantity?: number | null;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ShopifyProduct = {
  id: number | string;
  title?: string | null;
  handle?: string | null;
  vendor?: string | null;
  product_type?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  image?: unknown;
  images?: unknown[];
  options?: unknown[];
  variants?: ShopifyVariant[];
};

type ShopifyOrderResponse = {
  order?: {
    id?: number | string | null;
    name?: string | null;
    order_number?: number | string | null;
    line_items?: ShopifyOrderLineItem[] | null;
  } | null;
};

type ShopifyProductResponse = {
  product?: ShopifyProduct | null;
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

function orderItemPayload(line: ShopifyOrderLineItem) {
  const quantity = lineQuantity(line);
  const unitPrice = numberValue(line.price);
  const variantTitle = stringValue(line.variant_title);

  return {
    sku: buildFallbackSku(line),
    product_name: stringValue(line.title) || stringValue(line.name) || "Shopify line item",
    variant: variantTitle || null,
    color: null,
    size: variantTitle || null,
    quantity,
    unit_selling_price: unitPrice,
  };
}

function baseOrderItemRow(orderId: string, line: ShopifyOrderLineItem, unitCost = 0) {
  return {
    order_id: orderId,
    ...orderItemPayload(line),
    unit_cost: unitCost,
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

async function updateOrderItem(
  supabaseAdmin: any,
  itemId: string,
  line: ShopifyOrderLineItem,
) {
  const patch = {
    ...orderItemPayload(line),
    shopify_line_item_id: stringValue(line.id) || null,
    shopify_admin_graphql_api_id: stringValue(line.admin_graphql_api_id) || null,
    shopify_variant_id: stringValue(line.variant_id) || null,
    shopify_product_id: stringValue(line.product_id) || null,
  };

  const { error } = await supabaseAdmin.from("order_items").update(patch as never).eq("id", itemId);
  if (!error) return;

  if (!isSchemaError(error)) {
    throw new Error(`Could not update order line item details: ${error.message}`);
  }

  const fallback = await supabaseAdmin
    .from("order_items")
    .update(orderItemPayload(line) as never)
    .eq("id", itemId);
  if (fallback.error) {
    throw new Error(`Could not update order line item details: ${fallback.error.message}`);
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

function productRow(product: ShopifyProduct) {
  return {
    shopify_product_id: String(product.id),
    title: product.title || "Untitled product",
    handle: product.handle ?? null,
    vendor: product.vendor ?? null,
    product_type: product.product_type ?? null,
    status: product.status ?? null,
    shopify_created_at: toNullableDate(product.created_at),
    shopify_updated_at: toNullableDate(product.updated_at),
    image: product.image ?? product.images?.[0] ?? null,
    raw: product,
  };
}

function variantRow(product: ShopifyProduct, variant: ShopifyVariant) {
  return {
    shopify_variant_id: String(variant.id),
    shopify_product_id: String(product.id),
    title: variant.title ?? null,
    sku: variant.sku || null,
    barcode: variant.barcode || null,
    price: toNullableNumber(variant.price),
    compare_at_price: toNullableNumber(variant.compare_at_price),
    inventory_item_id:
      variant.inventory_item_id == null ? null : String(variant.inventory_item_id),
    inventory_quantity: variant.inventory_quantity ?? null,
    option1: variant.option1 ?? null,
    option2: variant.option2 ?? null,
    option3: variant.option3 ?? null,
    options: {
      option1: variant.option1 ?? null,
      option2: variant.option2 ?? null,
      option3: variant.option3 ?? null,
      product_options: product.options ?? [],
    },
    shopify_created_at: toNullableDate(variant.created_at),
    shopify_updated_at: toNullableDate(variant.updated_at),
    raw: variant,
  };
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

async function fetchShopifyProduct(
  config: Extract<ReturnType<typeof getShopifyAdminConfig>, { ok: true }>,
  productId: string,
) {
  const url = `https://${config.domain}/admin/api/${config.apiVersion}/products/${encodeURIComponent(productId)}.json`;
  const res = await fetchShopifyWithRetry(url, shopifyHeaders(config.accessToken));
  if (!res.ok) return null;
  const json = (await res.json()) as ShopifyProductResponse;
  return json.product ?? null;
}

async function syncProductSnapshotsForLineItems(
  supabaseAdmin: any,
  lineItems: ShopifyOrderLineItem[],
) {
  const config = getShopifyAdminConfig();
  if (!config.ok) return { products_synced: 0, variants_synced: 0 };

  const productIds = Array.from(
    new Set(lineItems.map((line) => stringValue(line.product_id)).filter(Boolean)),
  );
  const products: ShopifyProduct[] = [];

  for (const productId of productIds) {
    const product = await fetchShopifyProduct(config, productId);
    if (product) products.push(product);
  }

  if (!products.length) return { products_synced: 0, variants_synced: 0 };

  const productRows = products.map(productRow);
  const variantRows = products.flatMap((product) =>
    (product.variants ?? []).map((variant) => variantRow(product, variant)),
  );

  await upsertRows(supabaseAdmin, "shopify_products", productRows, "shopify_product_id");
  await upsertRows(supabaseAdmin, "shopify_variants", variantRows, "shopify_variant_id");

  return { products_synced: productRows.length, variants_synced: variantRows.length };
}

type ExistingOrderItem = {
  id: string;
  sku: string | null;
  product_name: string | null;
  variant: string | null;
  unit_cost: number | null;
  shopify_line_item_id?: string | null;
  shopify_variant_id?: string | null;
  shopify_product_id?: string | null;
};

function firstUniqueMatch(
  line: ShopifyOrderLineItem,
  items: ExistingOrderItem[],
  usedItemIds: Set<string>,
  column: keyof ExistingOrderItem,
  value: string,
) {
  if (!value) return null;
  const matches = items.filter((item) => !usedItemIds.has(item.id) && stringValue(item[column]) === value);
  return matches.length === 1 ? matches[0] : null;
}

function matchExistingItem(
  line: ShopifyOrderLineItem,
  items: ExistingOrderItem[],
  usedItemIds: Set<string>,
) {
  return (
    firstUniqueMatch(line, items, usedItemIds, "shopify_line_item_id", stringValue(line.id)) ??
    firstUniqueMatch(line, items, usedItemIds, "shopify_variant_id", stringValue(line.variant_id)) ??
    firstUniqueMatch(line, items, usedItemIds, "shopify_product_id", stringValue(line.product_id)) ??
    firstUniqueMatch(line, items, usedItemIds, "sku", stringValue(line.sku))
  );
}

async function refreshOrderItemsFromShopifyOrder(
  supabaseAdmin: any,
  orderId: string,
  lineItems: ShopifyOrderLineItem[],
) {
  const { data, error } = await supabaseAdmin
    .from("order_items")
    .select(
      "id,sku,product_name,variant,unit_cost,shopify_line_item_id,shopify_variant_id,shopify_product_id",
    )
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Could not load local order line items: ${error.message}`);

  const existingItems = (data ?? []) as ExistingOrderItem[];
  const usedItemIds = new Set<string>();
  let updated = 0;
  let inserted = 0;

  for (const line of lineItems) {
    const match = matchExistingItem(line, existingItems, usedItemIds);
    if (match) {
      usedItemIds.add(match.id);
      await updateOrderItem(supabaseAdmin, match.id, line);
      updated++;
    } else {
      await insertOrderItems(supabaseAdmin, [
        enhancedOrderItemRow(orderId, line),
      ]);
      inserted++;
    }
  }

  const staleIds = existingItems
    .filter((item) => !usedItemIds.has(item.id))
    .map((item) => item.id);

  if (staleIds.length) {
    const { error: deleteError } = await supabaseAdmin
      .from("order_items")
      .delete()
      .in("id", staleIds);
    if (deleteError) throw new Error(`Could not remove stale local line items: ${deleteError.message}`);
  }

  return {
    updated,
    inserted,
    stale_removed: staleIds.length,
    checked: existingItems.length,
    shopify_line_items: lineItems.length,
  };
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
        const refreshDetails = body.refresh_details === true;

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

        if ((existingItemsCount ?? 0) > 0 && !refreshDetails) {
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

        const shopifyOrderId = stringValue(targetOrder.shopify_order_id || requestedShopifyOrderId);
        if (!shopifyOrderId && !refreshDetails) {
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
        if (!shopifyOrderId) {
          return Response.json(
            {
              ok: false,
              error: "This local order has no Shopify order ID, so line items cannot be refreshed from Shopify.",
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

        let productSnapshot = { products_synced: 0, variants_synced: 0 };
        try {
          productSnapshot = await syncProductSnapshotsForLineItems(auth.supabaseAdmin, lineItems);
        } catch (error) {
          console.warn("[orders] Could not refresh Shopify product snapshots for order line items", {
            order_id: targetOrder.id,
            order_number: targetOrder.order_number,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        const refreshResult = await refreshOrderItemsFromShopifyOrder(
          auth.supabaseAdmin,
          targetOrder.id,
          lineItems,
        );

        return Response.json({
          ok: true,
          restored: true,
          restored_from: refreshDetails ? "shopify_order_line_items_refresh" : "shopify_order_line_items",
          restored_items_count: refreshResult.inserted,
          refreshed_items_count: refreshResult.updated,
          stale_items_removed: refreshResult.stale_removed,
          shopify_line_items_count: refreshResult.shopify_line_items,
          local_items_checked: refreshResult.checked,
          products_synced: productSnapshot.products_synced,
          variants_synced: productSnapshot.variants_synced,
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
