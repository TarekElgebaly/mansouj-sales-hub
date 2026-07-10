import { createFileRoute } from "@tanstack/react-router";
import { requireOpsUser, saveShopifySyncRun } from "@/lib/shopify-sync.server";
import {
  mediaFromVariant,
  normalizeProductKey,
  productTitleKey,
  type ShopifyVariantLike,
  variantIdFromSku,
} from "@/lib/product-media";

type OrderItemRow = {
  id: string;
  order_id: string;
  sku: string | null;
  product_name: string | null;
  variant: string | null;
  color: string | null;
  size: string | null;
  shopify_variant_id: string | null;
  shopify_product_id: string | null;
  barcode: string | null;
  product_type: string | null;
};

type RemapRow = {
  old_sku: string;
  new_sku: string | null;
  shopify_variant_id: string | null;
  inventory_item_id: string | null;
};

type MatchReason =
  | "matched_by_variant_id"
  | "matched_by_sku"
  | "matched_by_sku_normalized"
  | "matched_by_barcode"
  | "matched_by_barcode_normalized"
  | "matched_by_product_title"
  | "matched_by_product_id_single_variant"
  | "matched_by_remap_variant_id"
  | "matched_by_remap_sku"
  | "missing_sku"
  | "shopify_variant_id_not_found"
  | "sku_not_found"
  | "duplicate_sku_matches"
  | "barcode_not_found"
  | "duplicate_barcode_matches"
  | "duplicate_title_matches"
  | "duplicate_product_id_matches"
  | "remap_missing_target"
  | "remap_target_not_found"
  | "duplicate_remap_target";

type VariantRow = ShopifyVariantLike & {
  shopify_variant_id: string;
  shopify_product_id: string;
};

function productFromRelation(row: ShopifyVariantLike) {
  const relation = row.shopify_products;
  return Array.isArray(relation) ? relation[0] ?? null : relation ?? null;
}

function cleanVariantTitle(value: string | null | undefined) {
  const title = String(value ?? "").trim();
  if (!title || title.toLowerCase() === "default title") return null;
  return title;
}

function addToIndex(
  map: Map<string, VariantRow[]>,
  key: string | null | undefined,
  row: VariantRow,
) {
  const clean = String(key ?? "").trim();
  if (!clean) return;
  const rows = map.get(clean) ?? [];
  rows.push(row);
  map.set(clean, rows);
}

function addToNormalizedIndex(
  map: Map<string, VariantRow[]>,
  key: string | null | undefined,
  row: VariantRow,
) {
  const clean = normalizeProductKey(key);
  if (!clean) return;
  const rows = map.get(clean) ?? [];
  rows.push(row);
  map.set(clean, rows);
}

function singleMatch(rows: VariantRow[] | undefined, duplicateReason: MatchReason) {
  if (!rows?.length) return { variant: null as VariantRow | null, reason: null };
  if (rows.length > 1) return { variant: null as VariantRow | null, reason: duplicateReason };
  return { variant: rows[0], reason: null };
}

function changedPatch(item: OrderItemRow, patch: Record<string, unknown>) {
  return Object.entries(patch).some(([key, value]) => {
    const current = (item as unknown as Record<string, unknown>)[key];
    return String(current ?? "") !== String(value ?? "");
  });
}

export const Route = createFileRoute("/api/shopify/refresh-order-item-product-data")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireOpsUser(request);
        if (!auth.ok) return auth.response;
        const { supabaseAdmin } = auth;

        const startedAt = new Date().toISOString();
        const syncType = "order_item_product_data_refresh";
        let itemsChecked = 0;
        let itemsUpdated = 0;
        let itemsSkipped = 0;
        let missingMatch = 0;
        let failedCount = 0;
        let lastError: string | null = null;
        let pagesFetched = 0;
        const matchCounts: Record<string, number> = {};
        const mismatchReasons: Record<string, number> = {};
        const examples: Array<{
          order_item_id: string;
          old_sku: string | null;
          product_name: string | null;
          variant: string | null;
          reason: string;
        }> = [];

        const addMismatch = (item: OrderItemRow, reason: MatchReason) => {
          missingMatch++;
          mismatchReasons[reason] = (mismatchReasons[reason] ?? 0) + 1;
          if (examples.length < 20) {
            examples.push({
              order_item_id: item.id,
              old_sku: item.sku,
              product_name: item.product_name,
              variant: item.variant,
              reason,
            });
          }
        };

        try {
          const variantsByVariantId = new Map<string, VariantRow>();
          const variantsBySkuExact = new Map<string, VariantRow[]>();
          const variantsBySkuNormalized = new Map<string, VariantRow[]>();
          const variantsByBarcodeExact = new Map<string, VariantRow[]>();
          const variantsByBarcodeNormalized = new Map<string, VariantRow[]>();
          const variantsByTitle = new Map<string, VariantRow[]>();
          const variantsByProductId = new Map<string, VariantRow[]>();

          const pageSize = 1000;
          let from = 0;
          while (true) {
            const { data, error } = await supabaseAdmin
              .from("shopify_variants")
              .select(
                "shopify_variant_id,shopify_product_id,sku,barcode,title,inventory_item_id,option1,option2,option3,raw,shopify_products(title,product_type,image,raw)",
              )
              .range(from, from + pageSize - 1);
            if (error) throw new Error(`shopify_variants scan failed: ${error.message}`);
            const rows = (data ?? []) as VariantRow[];
            pagesFetched++;
            for (const row of rows) {
              const media = mediaFromVariant(row);
              variantsByVariantId.set(row.shopify_variant_id, row);
              addToIndex(variantsBySkuExact, row.sku, row);
              addToNormalizedIndex(variantsBySkuNormalized, row.sku, row);
              addToIndex(variantsByBarcodeExact, row.barcode, row);
              addToNormalizedIndex(variantsByBarcodeNormalized, row.barcode, row);
              addToIndex(variantsByTitle, productTitleKey(media.productTitle, media.variantTitle), row);
              addToIndex(variantsByProductId, row.shopify_product_id, row);
            }
            if (rows.length < pageSize) break;
            from += pageSize;
          }

          const remapByOldSku = new Map<string, RemapRow>();
          const remapByOldSkuNormalized = new Map<string, RemapRow>();
          {
            const { data, error } = await supabaseAdmin
              .from("shopify_sku_remaps")
              .select("old_sku,new_sku,shopify_variant_id,inventory_item_id")
              .eq("is_active", true);
            if (error) throw new Error(`shopify_sku_remaps lookup failed: ${error.message}`);
            for (const row of (data ?? []) as RemapRow[]) {
              if (!row.old_sku) continue;
              remapByOldSku.set(row.old_sku.trim(), row);
              remapByOldSkuNormalized.set(normalizeProductKey(row.old_sku), row);
            }
          }

          const resolveRemapVariant = (
            remap: RemapRow,
          ): { variant: VariantRow | null; reason: MatchReason | null } => {
            if (remap.shopify_variant_id) {
              return {
                variant: variantsByVariantId.get(remap.shopify_variant_id) ?? null,
                reason: "matched_by_remap_variant_id",
              };
            }
            if (!remap.new_sku) return { variant: null, reason: "remap_missing_target" };

            const exact = singleMatch(
              variantsBySkuExact.get(remap.new_sku.trim()),
              "duplicate_remap_target",
            );
            if (exact.reason) return { variant: null, reason: exact.reason };
            if (exact.variant) return { variant: exact.variant, reason: "matched_by_remap_sku" };

            const normalized = singleMatch(
              variantsBySkuNormalized.get(normalizeProductKey(remap.new_sku)),
              "duplicate_remap_target",
            );
            if (normalized.reason) return { variant: null, reason: normalized.reason };
            if (normalized.variant) {
              return { variant: normalized.variant, reason: "matched_by_remap_sku" };
            }

            return { variant: null, reason: "remap_target_not_found" };
          };

          const resolveVariant = (
            item: OrderItemRow,
          ): { variant: VariantRow | null; reason: MatchReason } => {
            const explicitVariantId = item.shopify_variant_id || variantIdFromSku(item.sku);
            if (explicitVariantId) {
              const variant = variantsByVariantId.get(explicitVariantId);
              return variant
                ? { variant, reason: "matched_by_variant_id" }
                : { variant: null, reason: "shopify_variant_id_not_found" };
            }

            const rawSku = String(item.sku ?? "").trim();
            if (!rawSku) return { variant: null, reason: "missing_sku" };

            const exactSku = singleMatch(variantsBySkuExact.get(rawSku), "duplicate_sku_matches");
            if (exactSku.reason) return { variant: null, reason: exactSku.reason };
            if (exactSku.variant) return { variant: exactSku.variant, reason: "matched_by_sku" };

            const normalizedSku = singleMatch(
              variantsBySkuNormalized.get(normalizeProductKey(rawSku)),
              "duplicate_sku_matches",
            );
            if (normalizedSku.reason) return { variant: null, reason: normalizedSku.reason };
            if (normalizedSku.variant) {
              return { variant: normalizedSku.variant, reason: "matched_by_sku_normalized" };
            }

            const barcodeCandidates = [rawSku, item.barcode, item.variant, item.product_name].filter(
              Boolean,
            ) as string[];
            for (const candidate of barcodeCandidates) {
              const exactBarcode = singleMatch(
                variantsByBarcodeExact.get(candidate.trim()),
                "duplicate_barcode_matches",
              );
              if (exactBarcode.reason) return { variant: null, reason: exactBarcode.reason };
              if (exactBarcode.variant) {
                return { variant: exactBarcode.variant, reason: "matched_by_barcode" };
              }

              const normalizedBarcode = singleMatch(
                variantsByBarcodeNormalized.get(normalizeProductKey(candidate)),
                "duplicate_barcode_matches",
              );
              if (normalizedBarcode.reason) return { variant: null, reason: normalizedBarcode.reason };
              if (normalizedBarcode.variant) {
                return { variant: normalizedBarcode.variant, reason: "matched_by_barcode_normalized" };
              }
            }

            const remap =
              remapByOldSku.get(rawSku) ?? remapByOldSkuNormalized.get(normalizeProductKey(rawSku));
            if (remap) {
              const resolved = resolveRemapVariant(remap);
              if (resolved.variant && resolved.reason) {
                return { variant: resolved.variant, reason: resolved.reason };
              }
              return { variant: null, reason: resolved.reason ?? "remap_target_not_found" };
            }

            const titleMatch = singleMatch(
              variantsByTitle.get(productTitleKey(item.product_name, item.variant)),
              "duplicate_title_matches",
            );
            if (titleMatch.reason) return { variant: null, reason: titleMatch.reason };
            if (titleMatch.variant) {
              return { variant: titleMatch.variant, reason: "matched_by_product_title" };
            }

            if (item.shopify_product_id) {
              const productMatch = singleMatch(
                variantsByProductId.get(item.shopify_product_id),
                "duplicate_product_id_matches",
              );
              if (productMatch.reason) return { variant: null, reason: productMatch.reason };
              if (productMatch.variant) {
                return {
                  variant: productMatch.variant,
                  reason: "matched_by_product_id_single_variant",
                };
              }
            }

            return {
              variant: null,
              reason: barcodeCandidates.length ? "barcode_not_found" : "sku_not_found",
            };
          };

          const items: OrderItemRow[] = [];
          from = 0;
          while (true) {
            const { data, error } = await supabaseAdmin
              .from("order_items")
              .select(
                "id,order_id,sku,product_name,variant,color,size,shopify_variant_id,shopify_product_id,barcode,product_type",
              )
              .range(from, from + pageSize - 1);
            if (error) throw new Error(`order_items lookup failed: ${error.message}`);
            const rows = (data ?? []) as unknown as OrderItemRow[];
            items.push(...rows);
            if (rows.length < pageSize) break;
            from += pageSize;
          }
          itemsChecked = items.length;

          for (const item of items) {
            const { variant, reason } = resolveVariant(item);
            if (!variant) {
              addMismatch(item, reason);
              continue;
            }

            const media = mediaFromVariant(variant);
            const product = productFromRelation(variant);
            const patch = {
              shopify_variant_id: variant.shopify_variant_id,
              shopify_product_id: variant.shopify_product_id,
              sku: media.sku || item.sku || `shopify-variant-${variant.shopify_variant_id}`,
              product_name: media.productTitle || item.product_name || "Unknown",
              variant: cleanVariantTitle(media.variantTitle) ?? item.variant,
              color: item.color ?? variant.option1 ?? null,
              size: item.size ?? variant.option2 ?? variant.option3 ?? null,
              barcode: media.barcode ?? item.barcode ?? null,
              product_type: media.productType ?? product?.product_type ?? item.product_type ?? null,
            };

            matchCounts[reason] = (matchCounts[reason] ?? 0) + 1;
            if (!changedPatch(item, patch)) {
              itemsSkipped++;
              continue;
            }

            const { error } = await supabaseAdmin
              .from("order_items")
              .update(patch)
              .eq("id", item.id);
            if (error) {
              failedCount++;
              lastError = error.message;
            } else {
              itemsUpdated++;
            }
          }

          itemsSkipped += missingMatch;
          const finishedAt = new Date().toISOString();
          const status = failedCount > 0 ? "partial" : "success";
          await saveShopifySyncRun(supabaseAdmin, {
            syncType,
            status,
            startedAt,
            finishedAt,
            recordsProcessed: itemsChecked,
            updatedCount: itemsUpdated,
            failedCount,
            pagesFetched,
            errorMessage: lastError,
            metadata: {
              items_checked: itemsChecked,
              items_updated: itemsUpdated,
              items_skipped: itemsSkipped,
              missing_match: missingMatch,
              match_counts: matchCounts,
              mismatch_reasons: mismatchReasons,
              examples,
              shopify_write_calls: false,
              touched_costs: false,
              touched_prices: false,
              touched_orders: false,
            },
          });

          return Response.json({
            ok: true,
            status,
            items_checked: itemsChecked,
            items_updated: itemsUpdated,
            items_skipped: itemsSkipped,
            missing_match: missingMatch,
            failed_count: failedCount,
            match_counts: matchCounts,
            mismatch_reasons: mismatchReasons,
            examples,
          });
        } catch (error) {
          const finishedAt = new Date().toISOString();
          const message = error instanceof Error ? error.message : String(error);
          failedCount = Math.max(failedCount, 1);
          await saveShopifySyncRun(supabaseAdmin, {
            syncType,
            status: "error",
            startedAt,
            finishedAt,
            recordsProcessed: itemsChecked,
            updatedCount: itemsUpdated,
            failedCount,
            pagesFetched,
            errorMessage: message,
            metadata: { last_error: message, shopify_write_calls: false },
          }).catch(() => undefined);

          return Response.json(
            {
              ok: false,
              status: "error",
              error: message,
              items_checked: itemsChecked,
              items_updated: itemsUpdated,
              failed_count: failedCount,
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
