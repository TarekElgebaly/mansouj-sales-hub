type SupabaseAdminClient = {
  from: (table: string) => any;
};

export type CostMatchOrderItem = {
  sku?: string | null;
  product_name?: string | null;
  variant?: string | null;
  shopify_product_id?: string | null;
  shopify_variant_id?: string | null;
  inventory_item_id?: string | null;
};

type InventoryRow = {
  id?: string | null;
  sku?: string | null;
  product_name?: string | null;
  product_title?: string | null;
  variant_name?: string | null;
  variant_title?: string | null;
  shopify_product_id?: string | null;
  shopify_variant_id?: string | null;
  shopify_inventory_item_id?: string | null;
  inventory_item_id?: string | null;
  cost?: number | string | null;
  cost_price?: number | string | null;
  unit_cost?: number | string | null;
  is_stale?: boolean | null;
  is_shopify_stale?: boolean | null;
};

type ShopifyVariantRow = {
  shopify_product_id?: string | null;
  shopify_variant_id?: string | null;
  sku?: string | null;
  barcode?: string | null;
  inventory_item_id?: string | null;
};

type ShopifyInventoryItemRow = {
  inventory_item_id: string;
  unit_cost_amount: number | string | null;
};

export type InventoryCostMatch = {
  unitCost: number;
  reason:
    | "matched_by_inventory_item_id"
    | "matched_by_variant_inventory_item_id"
    | "matched_by_variant_id"
    | "matched_by_product_variant_id"
    | "matched_by_exact_sku"
    | "matched_by_normalized_sku"
    | "matched_by_title_variant"
    | "matched_by_shopify_inventory_item";
  source: "inventory" | "shopify_inventory_items";
};

const PAGE_SIZE = 1000;

function isSchemaError(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    /column|schema cache|could not find|does not exist/i.test(message)
  );
}

function numberValue(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function cleanKey(value: string | null | undefined) {
  return String(value ?? "").trim();
}

export function normalizeInventoryKey(value: string | null | undefined) {
  return cleanKey(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, "");
}

function titleVariantKey(
  productTitle: string | null | undefined,
  variantTitle: string | null | undefined,
) {
  const product = normalizeInventoryKey(productTitle);
  const variant = normalizeInventoryKey(variantTitle);
  return product && variant ? `${product}:${variant}` : "";
}

async function loadPaged<T>(supabaseAdmin: SupabaseAdminClient, table: string, columns: string) {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if ((data ?? []).length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function loadInventoryRows(supabaseAdmin: SupabaseAdminClient) {
  const selectors = [
    "id,sku,product_name,product_title,variant_name,variant_title,shopify_product_id,shopify_variant_id,shopify_inventory_item_id,inventory_item_id,cost,cost_price,unit_cost,is_stale,is_shopify_stale",
    "id,sku,product_name,variant_name,shopify_product_id,shopify_variant_id,inventory_item_id,cost_price,is_shopify_stale",
    "id,sku,product_name,variant_name,cost_price",
  ];

  let lastError: unknown = null;
  for (const selector of selectors) {
    try {
      return await loadPaged<InventoryRow>(supabaseAdmin, "inventory", selector);
    } catch (error) {
      lastError = error;
      if (!isSchemaError(error as { message?: string; code?: string })) throw error;
    }
  }
  throw lastError;
}

async function loadShopifyVariants(supabaseAdmin: SupabaseAdminClient) {
  const selectors = [
    "shopify_product_id,shopify_variant_id,sku,barcode,inventory_item_id",
    "shopify_product_id,shopify_variant_id,sku,inventory_item_id",
  ];

  for (const selector of selectors) {
    try {
      return await loadPaged<ShopifyVariantRow>(supabaseAdmin, "shopify_variants", selector);
    } catch (error) {
      if (!isSchemaError(error as { message?: string; code?: string })) throw error;
    }
  }
  return [];
}

async function loadShopifyInventoryItems(supabaseAdmin: SupabaseAdminClient) {
  try {
    return await loadPaged<ShopifyInventoryItemRow>(
      supabaseAdmin,
      "shopify_inventory_items",
      "inventory_item_id,unit_cost_amount",
    );
  } catch (error) {
    if (!isSchemaError(error as { message?: string; code?: string })) throw error;
    return [];
  }
}

function costFromInventory(row: InventoryRow) {
  const cost = numberValue(row.cost ?? row.cost_price ?? row.unit_cost);
  return cost > 0 ? cost : null;
}

function addUniqueIndex<T>(map: Map<string, T[]>, key: string | null | undefined, value: T) {
  const clean = cleanKey(key);
  if (!clean) return;
  const rows = map.get(clean) ?? [];
  rows.push(value);
  map.set(clean, rows);
}

function addNormalizedIndex<T>(map: Map<string, T[]>, key: string | null | undefined, value: T) {
  const clean = normalizeInventoryKey(key);
  if (!clean) return;
  const rows = map.get(clean) ?? [];
  rows.push(value);
  map.set(clean, rows);
}

function singleCostRow(rows: InventoryRow[] | undefined) {
  if (!rows?.length) return null;
  const costRows = rows.filter((row) => costFromInventory(row) != null);
  return costRows.length === 1 ? costRows[0] : null;
}

export async function buildInventoryCostMatcher(supabaseAdmin: SupabaseAdminClient) {
  const [inventoryRowsRaw, shopifyVariants, shopifyInventoryItems] = await Promise.all([
    loadInventoryRows(supabaseAdmin),
    loadShopifyVariants(supabaseAdmin),
    loadShopifyInventoryItems(supabaseAdmin),
  ]);

  const inventoryRows = inventoryRowsRaw.filter(
    (row) => !row.is_stale && !row.is_shopify_stale && costFromInventory(row) != null,
  );

  const inventoryByItemId = new Map<string, InventoryRow[]>();
  const inventoryByVariantId = new Map<string, InventoryRow[]>();
  const inventoryByProductVariantId = new Map<string, InventoryRow[]>();
  const inventoryBySkuExact = new Map<string, InventoryRow[]>();
  const inventoryBySkuNormalized = new Map<string, InventoryRow[]>();
  const inventoryByTitleVariant = new Map<string, InventoryRow[]>();

  for (const row of inventoryRows) {
    addUniqueIndex(inventoryByItemId, row.shopify_inventory_item_id ?? row.inventory_item_id, row);
    addUniqueIndex(inventoryByVariantId, row.shopify_variant_id, row);
    if (row.shopify_product_id && row.shopify_variant_id) {
      addUniqueIndex(
        inventoryByProductVariantId,
        `${row.shopify_product_id}:${row.shopify_variant_id}`,
        row,
      );
    }
    addUniqueIndex(inventoryBySkuExact, row.sku, row);
    addNormalizedIndex(inventoryBySkuNormalized, row.sku, row);
    addUniqueIndex(
      inventoryByTitleVariant,
      titleVariantKey(row.product_title ?? row.product_name, row.variant_title ?? row.variant_name),
      row,
    );
  }

  const variantByVariantId = new Map<string, ShopifyVariantRow>();
  const variantsBySkuExact = new Map<string, ShopifyVariantRow[]>();
  const variantsBySkuNormalized = new Map<string, ShopifyVariantRow[]>();
  for (const variant of shopifyVariants) {
    if (variant.shopify_variant_id) variantByVariantId.set(variant.shopify_variant_id, variant);
    addUniqueIndex(variantsBySkuExact, variant.sku, variant);
    addNormalizedIndex(variantsBySkuNormalized, variant.sku, variant);
  }

  const costByShopifyInventoryItem = new Map<string, number>();
  for (const row of shopifyInventoryItems) {
    const cost = numberValue(row.unit_cost_amount);
    if (row.inventory_item_id && cost > 0) {
      costByShopifyInventoryItem.set(row.inventory_item_id, cost);
    }
  }

  const matchInventoryRow = (
    rows: InventoryRow[] | undefined,
    reason: InventoryCostMatch["reason"],
  ): InventoryCostMatch | null => {
    const row = singleCostRow(rows);
    if (!row) return null;
    const unitCost = costFromInventory(row);
    return unitCost == null ? null : { unitCost, reason, source: "inventory" };
  };

  const variantForItem = (item: CostMatchOrderItem) => {
    const variantId = cleanKey(item.shopify_variant_id);
    if (variantId && variantByVariantId.has(variantId)) return variantByVariantId.get(variantId);

    const sku = cleanKey(item.sku);
    if (!sku) return null;
    const exact = variantsBySkuExact.get(sku);
    if (exact?.length === 1) return exact[0];
    const normalized = variantsBySkuNormalized.get(normalizeInventoryKey(sku));
    if (normalized?.length === 1) return normalized[0];
    return null;
  };

  const resolve = (item: CostMatchOrderItem): InventoryCostMatch | null => {
    const directItemId = cleanKey(item.inventory_item_id);
    if (directItemId) {
      const match = matchInventoryRow(
        inventoryByItemId.get(directItemId),
        "matched_by_inventory_item_id",
      );
      if (match) return match;
    }

    const variant = variantForItem(item);
    const variantInventoryItemId = cleanKey(variant?.inventory_item_id);
    if (variantInventoryItemId) {
      const match = matchInventoryRow(
        inventoryByItemId.get(variantInventoryItemId),
        "matched_by_variant_inventory_item_id",
      );
      if (match) return match;
    }

    const variantId = cleanKey(item.shopify_variant_id);
    if (variantId) {
      const match = matchInventoryRow(inventoryByVariantId.get(variantId), "matched_by_variant_id");
      if (match) return match;
    }

    if (item.shopify_product_id && item.shopify_variant_id) {
      const match = matchInventoryRow(
        inventoryByProductVariantId.get(`${item.shopify_product_id}:${item.shopify_variant_id}`),
        "matched_by_product_variant_id",
      );
      if (match) return match;
    }

    const sku = cleanKey(item.sku);
    if (sku) {
      const exactSku = matchInventoryRow(inventoryBySkuExact.get(sku), "matched_by_exact_sku");
      if (exactSku) return exactSku;

      const normalizedSku = matchInventoryRow(
        inventoryBySkuNormalized.get(normalizeInventoryKey(sku)),
        "matched_by_normalized_sku",
      );
      if (normalizedSku) return normalizedSku;
    }

    const titleKey = titleVariantKey(item.product_name, item.variant);
    if (titleKey) {
      const titleMatch = matchInventoryRow(
        inventoryByTitleVariant.get(titleKey),
        "matched_by_title_variant",
      );
      if (titleMatch) return titleMatch;
    }

    if (variantInventoryItemId) {
      const unitCost = costByShopifyInventoryItem.get(variantInventoryItemId);
      if (unitCost != null && unitCost > 0) {
        return {
          unitCost,
          reason: "matched_by_shopify_inventory_item",
          source: "shopify_inventory_items",
        };
      }
    }

    return null;
  };

  return {
    resolve,
    inventory_rows_indexed: inventoryRows.length,
    shopify_variants_indexed: shopifyVariants.length,
    shopify_inventory_items_indexed: costByShopifyInventoryItem.size,
  };
}
