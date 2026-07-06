import { createFileRoute } from "@tanstack/react-router";
import { mediaFromVariant, ShopifyVariantLike } from "@/lib/product-media";
import {
  requireOpsUser,
  saveShopifySyncRun,
  updateShopifySyncSettings,
} from "@/lib/shopify-sync.server";

type ShopifyProduct = {
  title: string | null;
  product_type: string | null;
  status: string | null;
  image: unknown;
  raw: unknown;
};

type ShopifyVariant = ShopifyVariantLike & {
  id: string;
  shopify_variant_id: string;
  shopify_product_id: string;
  sku: string | null;
  barcode: string | null;
  title: string | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
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
  on_hand?: number | null;
};

type LocalInventoryRow = {
  id: string;
  sku: string;
  shopify_variant_id?: string | null;
  inventory_item_id?: string | null;
  current_inventory: number;
  cost_price: number;
  sale_price: number;
};

function productRelation(value: ShopifyVariant["shopify_products"]) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function cleanOption(value: string | null | undefined) {
  if (!value || value === "Default Title") return null;
  return value;
}

function stockStatus(quantity: number) {
  if (quantity <= 0) return "Out of Stock";
  if (quantity <= 5) return "Low Stock";
  return "In Stock";
}

function numberValue(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function addQuantity(map: Map<string, number>, itemId: string | null | undefined, value: number | null) {
  if (!itemId || value == null || !Number.isFinite(value)) return;
  map.set(itemId, (map.get(itemId) ?? 0) + Number(value));
}

function buildIndexes(rows: LocalInventoryRow[]) {
  const byVariantId = new Map<string, LocalInventoryRow>();
  const byInventoryItemId = new Map<string, LocalInventoryRow>();
  const bySku = new Map<string, LocalInventoryRow>();

  for (const row of rows) {
    if (row.shopify_variant_id) byVariantId.set(row.shopify_variant_id, row);
    if (row.inventory_item_id) byInventoryItemId.set(row.inventory_item_id, row);
    if (row.sku) bySku.set(row.sku.trim(), row);
  }

  return { byVariantId, byInventoryItemId, bySku };
}

function isMissingColumnError(error: unknown, column?: string) {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  const lower = message.toLowerCase();
  return lower.includes("column") && (!column || message.includes(column));
}

function stripSourceColumns(payload: Record<string, unknown>) {
  const {
    shopify_product_id: _shopifyProductId,
    shopify_variant_id: _shopifyVariantId,
    inventory_item_id: _inventoryItemId,
    shopify_product_status: _shopifyProductStatus,
    shopify_product_type: _shopifyProductType,
    shopify_synced_at: _shopifySyncedAt,
    is_shopify_stale: _isShopifyStale,
    shopify_raw: _shopifyRaw,
    on_hand_quantity: _onHandQuantity,
    available_quantity: _availableQuantity,
    ...legacyPayload
  } = payload;
  return legacyPayload;
}

async function loadInventoryLevels(supabaseAdmin: any) {
  const withOnHand = await supabaseAdmin
    .from("shopify_inventory_levels")
    .select("inventory_item_id,available,on_hand");
  if (!withOnHand.error) {
    return {
      data: (withOnHand.data ?? []) as InventoryLevel[],
      hasOnHandColumn: true,
    };
  }
  if (!isMissingColumnError(withOnHand.error, "on_hand")) {
    throw new Error(`Could not load shopify_inventory_levels: ${withOnHand.error.message}`);
  }
  const availableOnly = await supabaseAdmin
    .from("shopify_inventory_levels")
    .select("inventory_item_id,available");
  if (availableOnly.error) {
    throw new Error(`Could not load shopify_inventory_levels: ${availableOnly.error.message}`);
  }
  return {
    data: (availableOnly.data ?? []) as InventoryLevel[],
    hasOnHandColumn: false,
  };
}

async function loadLocalInventory(supabaseAdmin: any) {
  const full = await supabaseAdmin
    .from("inventory")
    .select("id,sku,shopify_variant_id,inventory_item_id,current_inventory,cost_price,sale_price");
  if (!full.error) return { data: (full.data ?? []) as LocalInventoryRow[], hasSourceColumns: true };
  if (!isMissingColumnError(full.error)) {
    throw new Error(`Could not load local inventory: ${full.error.message}`);
  }
  const legacy = await supabaseAdmin
    .from("inventory")
    .select("id,sku,current_inventory,cost_price,sale_price");
  if (legacy.error) throw new Error(`Could not load local inventory: ${legacy.error.message}`);
  return { data: (legacy.data ?? []) as LocalInventoryRow[], hasSourceColumns: false };
}

async function updateInventoryRow(
  supabaseAdmin: any,
  id: string,
  payload: Record<string, unknown>,
  hasSourceColumns: boolean,
) {
  const rowPayload = hasSourceColumns ? payload : stripSourceColumns(payload);
  const { error } = await supabaseAdmin.from("inventory").update(rowPayload).eq("id", id);
  if (!error) return hasSourceColumns;
  if (!hasSourceColumns || !isMissingColumnError(error)) {
    throw new Error(`Could not update inventory row ${id}: ${error.message}`);
  }
  const fallback = stripSourceColumns(payload);
  const fallbackResult = await supabaseAdmin.from("inventory").update(fallback).eq("id", id);
  if (fallbackResult.error) {
    throw new Error(`Could not update inventory row ${id}: ${fallbackResult.error.message}`);
  }
  return false;
}

async function insertInventoryRow(
  supabaseAdmin: any,
  payload: Record<string, unknown>,
  hasSourceColumns: boolean,
) {
  const rowPayload = hasSourceColumns ? payload : stripSourceColumns(payload);
  const { error } = await supabaseAdmin.from("inventory").insert(rowPayload);
  if (!error) return { inserted: true, hasSourceColumns };
  if (hasSourceColumns && isMissingColumnError(error)) {
    const fallback = await supabaseAdmin.from("inventory").insert(stripSourceColumns(payload));
    if (!fallback.error) return { inserted: true, hasSourceColumns: false };
    return { inserted: false, hasSourceColumns: false, error: fallback.error };
  }
  return { inserted: false, hasSourceColumns, error };
}

async function updateInventoryRowBySku(
  supabaseAdmin: any,
  sku: string,
  payload: Record<string, unknown>,
  hasSourceColumns: boolean,
) {
  const rowPayload = hasSourceColumns ? payload : stripSourceColumns(payload);
  const { error } = await supabaseAdmin.from("inventory").update(rowPayload).eq("sku", sku);
  if (!error) return hasSourceColumns;
  if (!hasSourceColumns || !isMissingColumnError(error)) {
    throw new Error(`Could not update inventory row for duplicate SKU ${sku}: ${error.message}`);
  }
  const fallback = await supabaseAdmin
    .from("inventory")
    .update(stripSourceColumns(payload))
    .eq("sku", sku);
  if (fallback.error) {
    throw new Error(`Could not update inventory row for duplicate SKU ${sku}: ${fallback.error.message}`);
  }
  return false;
}

export const Route = createFileRoute("/api/shopify/refresh-inventory-source-of-truth")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireOpsUser(request);
        if (!auth.ok) return auth.response;
        const { supabaseAdmin } = auth;

        const startedAt = new Date().toISOString();
        const syncType = "inventory_source_of_truth_refresh";
        let finishedAt: string | null = null;
        let variantsProcessed = 0;
        let rowsCreated = 0;
        let rowsUpdated = 0;
        let staleRowsMarked = 0;
        let missingOnHandCount = 0;
        let hasOnHandColumn = true;
        let hasInventorySourceColumns = true;
        let failedCount = 0;
        let stoppedReason = "not_started";

        const metadata = (extra: Record<string, unknown> = {}) => ({
          source: "synced_shopify_products_variants_inventory_levels",
          variants_processed: variantsProcessed,
          inventory_rows_created: rowsCreated,
          inventory_rows_updated: rowsUpdated,
          stale_rows_marked: staleRowsMarked,
          missing_on_hand_count: missingOnHandCount,
          on_hand_column_present: hasOnHandColumn,
          inventory_source_columns_present: hasInventorySourceColumns,
          matching_priority: [
            "shopify_inventory_item_id",
            "shopify_variant_id",
            "shopify_product_id_plus_variant_id",
            "sku_fallback",
          ],
          sku_remaps_used: false,
          shopify_write_calls: false,
          failed_count: failedCount,
          stopped_reason: stoppedReason,
          ...extra,
        });

        try {
          await updateShopifySyncSettings(supabaseAdmin, {
            last_sync_mode: syncType,
            last_sync_status: "running",
            last_error: null,
            updated_at: startedAt,
          });

          stoppedReason = "loading_synced_shopify_tables";
          const [variantsResult, itemsResult, levelsResult, localResult] = await Promise.all([
            supabaseAdmin
              .from("shopify_variants")
              .select(
                "id,shopify_variant_id,shopify_product_id,sku,barcode,title,option1,option2,option3,price,inventory_item_id,raw,shopify_products(title,product_type,status,image,raw)",
              ),
            supabaseAdmin
              .from("shopify_inventory_items")
              .select("inventory_item_id,unit_cost_amount"),
            loadInventoryLevels(supabaseAdmin),
            loadLocalInventory(supabaseAdmin),
          ]);

          if (variantsResult.error) {
            throw new Error(`Could not load shopify_variants: ${variantsResult.error.message}`);
          }
          if (itemsResult.error) {
            throw new Error(`Could not load shopify_inventory_items: ${itemsResult.error.message}`);
          }

          const variants = (variantsResult.data ?? []) as ShopifyVariant[];
          const items = (itemsResult.data ?? []) as InventoryItem[];
          const levels = levelsResult.data;
          const localRows = localResult.data;
          hasOnHandColumn = levelsResult.hasOnHandColumn;
          hasInventorySourceColumns = localResult.hasSourceColumns;
          variantsProcessed = variants.length;

          const costByItemId = new Map(
            items.map((item) => [item.inventory_item_id, numberValue(item.unit_cost_amount)]),
          );
          const availableByItemId = new Map<string, number>();
          const onHandByItemId = new Map<string, number>();
          for (const level of levels) {
            addQuantity(availableByItemId, level.inventory_item_id, level.available);
            addQuantity(onHandByItemId, level.inventory_item_id, level.on_hand ?? null);
          }

          const localIndexes = buildIndexes(localRows);
          const currentVariantIds = new Set(variants.map((variant) => String(variant.shopify_variant_id)));
          const currentInventoryItemIds = new Set(
            variants.map((variant) => variant.inventory_item_id).filter(Boolean) as string[],
          );
          const refreshedAt = new Date().toISOString();

          stoppedReason = "refreshing_local_inventory_rows";
          for (const variant of variants) {
            const product = productRelation(variant.shopify_products);
            const media = mediaFromVariant(variant);
            const inventoryItemId = variant.inventory_item_id ?? null;
            const hasOnHand = inventoryItemId ? onHandByItemId.has(inventoryItemId) : false;
            const available = inventoryItemId ? availableByItemId.get(inventoryItemId) ?? 0 : 0;
            const onHand = inventoryItemId
              ? onHandByItemId.get(inventoryItemId) ?? available
              : 0;
            if (!hasOnHand) missingOnHandCount++;

            const color = cleanOption(variant.option1);
            const size = cleanOption(variant.option2);
            const variantName =
              cleanOption(variant.title) ??
              ([color, size, cleanOption(variant.option3)].filter(Boolean).join(" / ") || null);
            const sku = variant.sku?.trim() || `shopify-variant-${variant.shopify_variant_id}`;
            const payload: any = {
              sku,
              product_name: product?.title ?? media.productTitle ?? "Untitled product",
              variant_name: variantName,
              color,
              size,
              barcode: variant.barcode ?? null,
              current_inventory: onHand,
              on_hand_quantity: hasOnHand ? onHand : null,
              available_quantity: available,
              cost_price: inventoryItemId ? costByItemId.get(inventoryItemId) ?? 0 : 0,
              sale_price: numberValue(variant.price),
              status: stockStatus(onHand),
              product_images: media.imageUrl ? [media.imageUrl] : [],
              shopify_product_id: variant.shopify_product_id,
              shopify_variant_id: variant.shopify_variant_id,
              inventory_item_id: inventoryItemId,
              shopify_product_status: String(product?.status ?? "").trim().toLowerCase() || null,
              shopify_product_type: product?.product_type ?? null,
              shopify_synced_at: refreshedAt,
              is_shopify_stale: false,
              shopify_raw: {
                product: product?.raw ?? null,
                variant: variant.raw ?? null,
                on_hand_quantity_source: hasOnHand
                  ? "shopify_inventory_levels.on_hand"
                  : "missing_from_shopify_response",
              },
            };

            const existing =
              (inventoryItemId ? localIndexes.byInventoryItemId.get(inventoryItemId) : null) ??
              localIndexes.byVariantId.get(variant.shopify_variant_id) ??
              localIndexes.bySku.get(sku);

            if (existing) {
              hasInventorySourceColumns = await updateInventoryRow(
                supabaseAdmin,
                existing.id,
                payload,
                hasInventorySourceColumns,
              );
              rowsUpdated++;
              localIndexes.byVariantId.set(variant.shopify_variant_id, { ...existing, ...payload });
              if (inventoryItemId) {
                localIndexes.byInventoryItemId.set(inventoryItemId, { ...existing, ...payload });
              }
              localIndexes.bySku.set(sku, { ...existing, ...payload });
              continue;
            }

            const insertResult = await insertInventoryRow(
              supabaseAdmin,
              payload,
              hasInventorySourceColumns,
            );
            hasInventorySourceColumns = insertResult.hasSourceColumns;
            if (insertResult.inserted) {
              rowsCreated++;
              continue;
            }

            if (!String(insertResult.error?.message ?? "").toLowerCase().includes("duplicate")) {
              throw new Error(`Could not insert inventory row for ${sku}: ${insertResult.error?.message}`);
            }

            hasInventorySourceColumns = await updateInventoryRowBySku(
              supabaseAdmin,
              sku,
              payload,
              hasInventorySourceColumns,
            );
            rowsUpdated++;
          }

          stoppedReason = "marking_stale_local_inventory_rows";
          const staleIds = hasInventorySourceColumns ? localRows
            .filter((row) => {
              if (row.shopify_variant_id) return !currentVariantIds.has(row.shopify_variant_id);
              if (row.inventory_item_id) return !currentInventoryItemIds.has(row.inventory_item_id);
              return false;
            })
            .map((row) => row.id) : [];

          if (staleIds.length) {
            const { error } = await supabaseAdmin
              .from("inventory")
              .update({
                is_shopify_stale: true,
                current_inventory: 0,
                on_hand_quantity: 0,
                available_quantity: 0,
                shopify_synced_at: refreshedAt,
              })
              .in("id", staleIds);
            if (error) throw new Error(`Could not mark stale inventory rows: ${error.message}`);
            staleRowsMarked = staleIds.length;
          }

          stoppedReason = "success";
          finishedAt = new Date().toISOString();
          await updateShopifySyncSettings(supabaseAdmin, {
            last_sync_at: finishedAt,
            last_sync_mode: syncType,
            last_sync_status: missingOnHandCount > 0 ? "partial" : "success",
            last_error:
              missingOnHandCount > 0
                ? "Some Shopify inventory levels did not include on_hand quantity."
                : null,
            updated_at: finishedAt,
          });
          await saveShopifySyncRun(supabaseAdmin, {
            syncType,
            status: missingOnHandCount > 0 ? "partial" : "success",
            startedAt,
            finishedAt,
            recordsProcessed: variantsProcessed,
            createdCount: rowsCreated,
            updatedCount: rowsUpdated + staleRowsMarked,
            failedCount,
            pagesFetched: 0,
            metadata: metadata(),
          });

          return Response.json({
            ok: true,
            status: missingOnHandCount > 0 ? "partial" : "success",
            variants_processed: variantsProcessed,
            inventory_rows_created: rowsCreated,
            inventory_rows_updated: rowsUpdated,
            stale_rows_marked: staleRowsMarked,
            missing_on_hand_count: missingOnHandCount,
            on_hand_column_present: hasOnHandColumn,
            inventory_source_columns_present: hasInventorySourceColumns,
            source: "synced_shopify_products_variants_inventory_levels",
            sku_remaps_used: false,
            shopify_write_calls: false,
          });
        } catch (error) {
          finishedAt = new Date().toISOString();
          failedCount = 1;
          const message = error instanceof Error ? error.message : String(error);
          await updateShopifySyncSettings(supabaseAdmin, {
            last_sync_at: finishedAt,
            last_sync_mode: syncType,
            last_sync_status: "error",
            last_error: message,
            updated_at: finishedAt,
          }).catch(() => undefined);
          await saveShopifySyncRun(supabaseAdmin, {
            syncType,
            status: "error",
            startedAt,
            finishedAt,
            recordsProcessed: variantsProcessed,
            createdCount: rowsCreated,
            updatedCount: rowsUpdated + staleRowsMarked,
            failedCount,
            pagesFetched: 0,
            errorMessage: message,
            metadata: metadata(),
          }).catch(() => undefined);

          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
