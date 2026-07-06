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
  on_hand: number | null;
};

type LocalInventoryRow = {
  id: string;
  sku: string;
  shopify_variant_id: string | null;
  inventory_item_id: string | null;
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
        let failedCount = 0;
        let stoppedReason = "not_started";

        const metadata = (extra: Record<string, unknown> = {}) => ({
          source: "synced_shopify_products_variants_inventory_levels",
          variants_processed: variantsProcessed,
          inventory_rows_created: rowsCreated,
          inventory_rows_updated: rowsUpdated,
          stale_rows_marked: staleRowsMarked,
          missing_on_hand_count: missingOnHandCount,
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
            supabaseAdmin
              .from("shopify_inventory_levels")
              .select("inventory_item_id,available,on_hand"),
            supabaseAdmin
              .from("inventory")
              .select("id,sku,shopify_variant_id,inventory_item_id,current_inventory,cost_price,sale_price"),
          ]);

          if (variantsResult.error) {
            throw new Error(`Could not load shopify_variants: ${variantsResult.error.message}`);
          }
          if (itemsResult.error) {
            throw new Error(`Could not load shopify_inventory_items: ${itemsResult.error.message}`);
          }
          if (levelsResult.error) {
            throw new Error(`Could not load shopify_inventory_levels: ${levelsResult.error.message}`);
          }
          if (localResult.error) {
            throw new Error(`Could not load local inventory: ${localResult.error.message}`);
          }

          const variants = (variantsResult.data ?? []) as ShopifyVariant[];
          const items = (itemsResult.data ?? []) as InventoryItem[];
          const levels = (levelsResult.data ?? []) as InventoryLevel[];
          const localRows = (localResult.data ?? []) as LocalInventoryRow[];
          variantsProcessed = variants.length;

          const costByItemId = new Map(
            items.map((item) => [item.inventory_item_id, numberValue(item.unit_cost_amount)]),
          );
          const availableByItemId = new Map<string, number>();
          const onHandByItemId = new Map<string, number>();
          for (const level of levels) {
            addQuantity(availableByItemId, level.inventory_item_id, level.available);
            addQuantity(onHandByItemId, level.inventory_item_id, level.on_hand);
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
            const onHand = inventoryItemId ? onHandByItemId.get(inventoryItemId) ?? 0 : 0;
            const available = inventoryItemId ? availableByItemId.get(inventoryItemId) ?? 0 : 0;
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
              const { error } = await supabaseAdmin.from("inventory").update(payload).eq("id", existing.id);
              if (error) throw new Error(`Could not update inventory row ${existing.id}: ${error.message}`);
              rowsUpdated++;
              localIndexes.byVariantId.set(variant.shopify_variant_id, { ...existing, ...payload });
              if (inventoryItemId) {
                localIndexes.byInventoryItemId.set(inventoryItemId, { ...existing, ...payload });
              }
              localIndexes.bySku.set(sku, { ...existing, ...payload });
              continue;
            }

            const { error: insertError } = await supabaseAdmin.from("inventory").insert(payload);
            if (!insertError) {
              rowsCreated++;
              continue;
            }

            if (!String(insertError.message ?? "").toLowerCase().includes("duplicate")) {
              throw new Error(`Could not insert inventory row for ${sku}: ${insertError.message}`);
            }

            const { error: updateBySkuError } = await supabaseAdmin
              .from("inventory")
              .update(payload)
              .eq("sku", sku);
            if (updateBySkuError) {
              throw new Error(`Could not update inventory row for duplicate SKU ${sku}: ${updateBySkuError.message}`);
            }
            rowsUpdated++;
          }

          stoppedReason = "marking_stale_local_inventory_rows";
          const staleIds = localRows
            .filter((row) => {
              if (row.shopify_variant_id) return !currentVariantIds.has(row.shopify_variant_id);
              if (row.inventory_item_id) return !currentInventoryItemIds.has(row.inventory_item_id);
              return false;
            })
            .map((row) => row.id);

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
