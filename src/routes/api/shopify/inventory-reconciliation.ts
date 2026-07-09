import { createFileRoute } from "@tanstack/react-router";
import { mediaFromVariant, ShopifyVariantLike } from "@/lib/product-media";
import { requireOpsUser } from "@/lib/shopify-sync.server";

type ProductStatus = "active" | "draft" | "archived" | "all";

type ShopifyProduct = {
  title: string | null;
  product_type: string | null;
  status: string | null;
  image: unknown;
  raw: unknown;
};

type ShopifyVariant = ShopifyVariantLike & {
  shopify_variant_id: string;
  shopify_product_id: string;
  sku: string | null;
  barcode: string | null;
  title: string | null;
  price: number | string | null;
  inventory_item_id: string | null;
  raw: unknown;
  shopify_products?: ShopifyProduct | ShopifyProduct[] | null;
};

type InventoryItem = {
  inventory_item_id: string;
  unit_cost_amount: number | string | null;
};

type InventoryLevel = {
  inventory_item_id: string;
  available: number | null;
  available_quantity?: number | null;
  on_hand?: number | null;
  on_hand_quantity?: number | null;
  committed_quantity?: number | null;
  unavailable_quantity?: number | null;
  incoming_quantity?: number | null;
};

type LocalInventoryRow = {
  id: string;
  sku: string;
  product_name: string;
  variant_name: string | null;
  shopify_variant_id?: string | null;
  shopify_product_id?: string | null;
  inventory_item_id?: string | null;
  shopify_product_status?: string | null;
  current_inventory: number | null;
  on_hand_quantity: number | null;
  cost_price: number | string | null;
  sale_price: number | string | null;
  is_shopify_stale: boolean | null;
};

type ReconciliationRow = {
  product_title: string;
  variant_title: string | null;
  sku: string;
  shopify_variant_id: string;
  inventory_item_id: string | null;
  shopify_quantity: number;
  mansouj_quantity: number | null;
  difference: number;
  shopify_cost: number;
  mansouj_cost: number | null;
  shopify_price: number;
  mansouj_price: number | null;
  product_status: string | null;
  reason: string;
};

function productRelation(value: ShopifyVariant["shopify_products"]) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function normalizeStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase() || null;
}

function numberValue(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function addQuantity(map: Map<string, number>, itemId: string | null | undefined, value: number | null) {
  if (!itemId || value == null || !Number.isFinite(value)) return;
  map.set(itemId, (map.get(itemId) ?? 0) + Number(value));
}

function statusMatches(status: string | null, filter: ProductStatus) {
  return filter === "all" || status === filter;
}

function localMatchesStatus(row: LocalInventoryRow, filter: ProductStatus) {
  if (filter === "all") return true;
  return normalizeStatus(row.shopify_product_status) === filter;
}

function nearlyEqual(a: number | null, b: number | null) {
  if (a == null || b == null) return a === b;
  return Math.abs(a - b) < 0.005;
}

function buildLocalIndexes(rows: LocalInventoryRow[]) {
  const byInventoryItemId = new Map<string, LocalInventoryRow>();
  const byVariantId = new Map<string, LocalInventoryRow>();
  const bySku = new Map<string, LocalInventoryRow>();

  for (const row of rows) {
    if (row.inventory_item_id) byInventoryItemId.set(row.inventory_item_id, row);
    if (row.shopify_variant_id) byVariantId.set(row.shopify_variant_id, row);
    if (row.sku) bySku.set(row.sku.trim(), row);
  }

  return { byInventoryItemId, byVariantId, bySku };
}

function isMissingColumnError(error: unknown, column?: string) {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  const lower = message.toLowerCase();
  return lower.includes("column") && (!column || message.includes(column));
}

async function loadInventoryLevels(supabaseAdmin: any) {
  const withOnHand = await supabaseAdmin
    .from("shopify_inventory_levels")
    .select("inventory_item_id,available,available_quantity,on_hand,on_hand_quantity,committed_quantity,unavailable_quantity,incoming_quantity");
  if (!withOnHand.error) {
    return { data: (withOnHand.data ?? []) as InventoryLevel[], hasOnHandColumn: true };
  }
  if (!isMissingColumnError(withOnHand.error)) {
    throw new Error(`Could not load shopify_inventory_levels: ${withOnHand.error.message}`);
  }
  const legacyWithOnHand = await supabaseAdmin
    .from("shopify_inventory_levels")
    .select("inventory_item_id,available,on_hand");
  if (!legacyWithOnHand.error) {
    return { data: (legacyWithOnHand.data ?? []) as InventoryLevel[], hasOnHandColumn: true };
  }
  if (!isMissingColumnError(legacyWithOnHand.error, "on_hand")) {
    throw new Error(`Could not load shopify_inventory_levels: ${legacyWithOnHand.error.message}`);
  }
  const availableOnly = await supabaseAdmin
    .from("shopify_inventory_levels")
    .select("inventory_item_id,available");
  if (availableOnly.error) {
    throw new Error(`Could not load shopify_inventory_levels: ${availableOnly.error.message}`);
  }
  return { data: (availableOnly.data ?? []) as InventoryLevel[], hasOnHandColumn: false };
}

async function loadLocalInventory(supabaseAdmin: any) {
  const full = await supabaseAdmin
    .from("inventory")
    .select(
      "id,sku,product_name,variant_name,shopify_variant_id,shopify_product_id,inventory_item_id,shopify_product_status,current_inventory,on_hand_quantity,cost_price,sale_price,is_shopify_stale",
    );
  if (!full.error) return { data: (full.data ?? []) as LocalInventoryRow[], hasSourceColumns: true };
  if (!isMissingColumnError(full.error)) {
    throw new Error(`Could not load local inventory: ${full.error.message}`);
  }
  const legacy = await supabaseAdmin
    .from("inventory")
    .select("id,sku,product_name,variant_name,current_inventory,cost_price,sale_price");
  if (legacy.error) throw new Error(`Could not load local inventory: ${legacy.error.message}`);
  return { data: (legacy.data ?? []) as LocalInventoryRow[], hasSourceColumns: false };
}

export const Route = createFileRoute("/api/shopify/inventory-reconciliation")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireOpsUser(request);
        if (!auth.ok) return auth.response;
        const { supabaseAdmin } = auth;

        const body = await request.json().catch(() => ({}));
        const productStatus = ["active", "draft", "archived", "all"].includes(
          String(body.product_status ?? ""),
        )
          ? (body.product_status as ProductStatus)
          : "active";

        const [variantsResult, itemsResult, levelsResult, localResult] = await Promise.all([
          supabaseAdmin
            .from("shopify_variants")
            .select(
              "shopify_variant_id,shopify_product_id,sku,barcode,title,option1,option2,option3,price,inventory_item_id,raw,shopify_products(title,product_type,status,image,raw)",
            ),
          supabaseAdmin
            .from("shopify_inventory_items")
            .select("inventory_item_id,unit_cost_amount"),
          loadInventoryLevels(supabaseAdmin),
          loadLocalInventory(supabaseAdmin),
        ]);

        if (variantsResult.error) {
          return Response.json(
            { ok: false, error: `Could not load shopify_variants: ${variantsResult.error.message}` },
            { status: 500 },
          );
        }
        if (itemsResult.error) {
          return Response.json(
            { ok: false, error: `Could not load shopify_inventory_items: ${itemsResult.error.message}` },
            { status: 500 },
          );
        }
        const variants = (variantsResult.data ?? []) as ShopifyVariant[];
        const items = (itemsResult.data ?? []) as InventoryItem[];
        const levels = levelsResult.data;
        const localRows = localResult.data.filter(
          (row) => !row.is_shopify_stale && localMatchesStatus(row, productStatus),
        );

        const costByItemId = new Map(
          items.map((item) => [item.inventory_item_id, numberValue(item.unit_cost_amount)]),
        );
        const onHandByItemId = new Map<string, number>();
        for (const level of levels) {
          addQuantity(
            onHandByItemId,
            level.inventory_item_id,
            levelsResult.hasOnHandColumn
              ? level.on_hand_quantity ?? level.on_hand ?? null
              : null,
          );
        }

        const localIndexes = buildLocalIndexes(localRows);
        const matchedLocalIds = new Set<string>();
        const mismatches: ReconciliationRow[] = [];
        let shopifyTotalSkus = 0;
        let shopifyOnHandQuantity = 0;
        let shopifyInventoryCostValue = 0;
        let shopifyRetailValue = 0;
        let mansoujOnHandQuantity = 0;
        let mansoujInventoryCostValue = 0;
        let mansoujRetailValue = 0;
        let onHandMissingCount = 0;

        for (const variant of variants) {
          const product = productRelation(variant.shopify_products);
          const status = normalizeStatus(product?.status);
          if (!statusMatches(status, productStatus)) continue;

          const media = mediaFromVariant(variant);
          const inventoryItemId = variant.inventory_item_id ?? null;
          const hasOnHand = inventoryItemId ? onHandByItemId.has(inventoryItemId) : false;
          if (!hasOnHand) onHandMissingCount++;

          const shopifyQuantity = inventoryItemId ? onHandByItemId.get(inventoryItemId) ?? 0 : 0;
          const shopifyCost = inventoryItemId ? costByItemId.get(inventoryItemId) ?? 0 : 0;
          const shopifyPrice = numberValue(variant.price);
          const sku = variant.sku?.trim() || `shopify-variant-${variant.shopify_variant_id}`;
          const local =
            (inventoryItemId ? localIndexes.byInventoryItemId.get(inventoryItemId) : null) ??
            localIndexes.byVariantId.get(variant.shopify_variant_id) ??
            localIndexes.bySku.get(sku) ??
            null;

          shopifyTotalSkus++;
          shopifyOnHandQuantity += shopifyQuantity;
          shopifyInventoryCostValue += shopifyQuantity * shopifyCost;
          shopifyRetailValue += shopifyQuantity * shopifyPrice;

          const localQuantity = local ? Number(local.on_hand_quantity ?? local.current_inventory ?? 0) : null;
          const localCost = local ? numberValue(local.cost_price) : null;
          const localPrice = local ? numberValue(local.sale_price) : null;
          if (local) {
            matchedLocalIds.add(local.id);
            mansoujOnHandQuantity += localQuantity ?? 0;
            mansoujInventoryCostValue += (localQuantity ?? 0) * (localCost ?? 0);
            mansoujRetailValue += (localQuantity ?? 0) * (localPrice ?? 0);
          }

          const reasonParts: string[] = [];
          if (!local) reasonParts.push("missing_local_inventory_row");
          if (!hasOnHand) reasonParts.push("shopify_on_hand_missing");
          if (local && localQuantity !== shopifyQuantity) reasonParts.push("quantity_mismatch");
          if (local && !nearlyEqual(localCost, shopifyCost)) reasonParts.push("cost_mismatch");
          if (local && !nearlyEqual(localPrice, shopifyPrice)) reasonParts.push("price_mismatch");

          if (reasonParts.length) {
            mismatches.push({
              product_title: product?.title ?? media.productTitle ?? "Untitled product",
              variant_title: media.variantTitle ?? variant.title ?? null,
              sku,
              shopify_variant_id: variant.shopify_variant_id,
              inventory_item_id: inventoryItemId,
              shopify_quantity: shopifyQuantity,
              mansouj_quantity: localQuantity,
              difference: shopifyQuantity - (localQuantity ?? 0),
              shopify_cost: shopifyCost,
              mansouj_cost: localCost,
              shopify_price: shopifyPrice,
              mansouj_price: localPrice,
              product_status: status,
              reason: reasonParts.join(", "),
            });
          }
        }

        for (const local of localRows) {
          if (matchedLocalIds.has(local.id)) continue;
          const localQuantity = Number(local.on_hand_quantity ?? local.current_inventory ?? 0);
          const localCost = numberValue(local.cost_price);
          const localPrice = numberValue(local.sale_price);
          mansoujOnHandQuantity += localQuantity;
          mansoujInventoryCostValue += localQuantity * localCost;
          mansoujRetailValue += localQuantity * localPrice;
          mismatches.push({
            product_title: local.product_name,
            variant_title: local.variant_name,
            sku: local.sku,
            shopify_variant_id: local.shopify_variant_id ?? "—",
            inventory_item_id: local.inventory_item_id ?? null,
            shopify_quantity: 0,
            mansouj_quantity: localQuantity,
            difference: -localQuantity,
            shopify_cost: 0,
            mansouj_cost: localCost,
            shopify_price: 0,
            mansouj_price: localPrice,
            product_status: normalizeStatus(local.shopify_product_status),
            reason: "extra_local_inventory_row",
          });
        }

        return Response.json({
          ok: true,
          product_status: productStatus,
          sku_remaps_used: false,
          on_hand_quantity_source: levelsResult.hasOnHandColumn
            ? "shopify_inventory_levels.on_hand_quantity"
            : "missing_from_shopify_inventory_level_quantities",
          on_hand_column_present: levelsResult.hasOnHandColumn,
          inventory_source_columns_present: localResult.hasSourceColumns,
          on_hand_missing_count: onHandMissingCount,
          shopify_total_skus: shopifyTotalSkus,
          mansouj_local_total_skus: localRows.length,
          shopify_on_hand_quantity: shopifyOnHandQuantity,
          mansouj_on_hand_quantity: mansoujOnHandQuantity,
          difference_quantity: shopifyOnHandQuantity - mansoujOnHandQuantity,
          shopify_inventory_cost_value: shopifyInventoryCostValue,
          mansouj_inventory_cost_value: mansoujInventoryCostValue,
          difference_cost_value: shopifyInventoryCostValue - mansoujInventoryCostValue,
          shopify_retail_value: shopifyRetailValue,
          mansouj_retail_value: mansoujRetailValue,
          difference_retail_value: shopifyRetailValue - mansoujRetailValue,
          mismatches_count: mismatches.length,
          mismatches: mismatches.slice(0, 250),
        });
      },
    },
  },
});
