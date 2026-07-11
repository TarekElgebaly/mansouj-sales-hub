import { createFileRoute } from "@tanstack/react-router";
import { requireOpsUser, saveShopifySyncRun } from "@/lib/shopify-sync.server";
import { buildInventoryCostMatcher } from "@/lib/inventory-cost-match.server";

type OrderItemRow = {
  id: string;
  order_id: string;
  sku: string | null;
  product_name: string | null;
  variant: string | null;
  inventory_item_id?: string | null;
  shopify_variant_id?: string | null;
  shopify_product_id?: string | null;
  quantity: number | null;
  unit_cost: number | null;
};

type VariantRow = {
  shopify_variant_id: string;
  sku: string | null;
  barcode: string | null;
  inventory_item_id: string | null;
};

type InventoryCostRow = {
  inventory_item_id: string;
  unit_cost_amount: number | null;
  unit_cost_currency_code: string | null;
};

type OrderRow = { id: string; order_number: string | null };

type RemapRow = {
  old_sku: string;
  new_sku: string | null;
  shopify_variant_id: string | null;
  inventory_item_id: string | null;
};

const SHOPIFY_VARIANT_SKU_RE = /^shopify-variant-(\d+)$/i;

function variantIdFromSku(sku: string | null) {
  if (!sku) return null;
  const m = sku.trim().match(SHOPIFY_VARIANT_SKU_RE);
  return m ? m[1] : null;
}

function normalizeSku(sku: string | null): string {
  if (!sku) return "";
  return sku.toLowerCase().replace(/\s+/g, "").trim();
}

function isSchemaError(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    /column|schema cache|could not find/i.test(message)
  );
}

type MatchReason =
  | "matched_by_variant_id"
  | "matched_by_sku"
  | "matched_by_sku_normalized"
  | "matched_by_remap_variant_id"
  | "matched_by_remap_sku"
  | "missing_match_keys"
  | "shopify_variant_id_not_found"
  | "missing_sku"
  | "sku_not_found"
  | "duplicate_sku_matches"
  | "remap_missing_target"
  | "remap_target_not_found"
  | "duplicate_remap_target"
  | "variant_missing_inventory_item_id"
  | "inventory_cost_missing";

export const Route = createFileRoute("/api/shopify/backfill-order-item-costs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireOpsUser(request);
        if (!auth.ok) return auth.response;
        const { supabaseAdmin } = auth;

        const url = new URL(request.url);
        const dryRun =
          url.searchParams.get("dry_run") === "1" || url.searchParams.get("dry_run") === "true";

        const startedAt = new Date().toISOString();
        const syncType = "order_item_cost_backfill";

        let orderItemsChecked = 0;
        let orderItemsUpdated = 0;
        let orderItemsAlreadyHadCost = 0;
        let orderItemsMissingInventoryCost = 0;
        let failedCount = 0;
        let lastError: string | null = null;

        // Detailed counters
        let matchedByVariantId = 0;
        let matchedBySku = 0;
        let matchedBySkuNormalized = 0;
        let matchedByLocalInventory = 0;
        let matchedByRemapVariantId = 0;
        let matchedByRemapSku = 0;
        let reasonMissingShopifyVariantId = 0;
        let reasonShopifyVariantIdNotFound = 0;
        let reasonMissingSku = 0;
        let reasonSkuNotFound = 0;
        let reasonDuplicateSkuMatches = 0;
        let reasonRemapMissingTarget = 0;
        let reasonRemapTargetNotFound = 0;
        let reasonDuplicateRemapTarget = 0;
        let reasonVariantMissingInventoryItem = 0;

        const unmatchedSamples: Array<{
          order_number: string | null;
          order_item_title: string | null;
          variant: string | null;
          sku: string | null;
          shopify_variant_id: string | null;
          reason: MatchReason;
        }> = [];

        // Unmatched SKU report (grouped). Populated regardless of unmatchedSamples cap.
        type UnmatchedSkuAgg = {
          old_sku: string | null;
          item_title: string | null;
          variant: string | null;
          count: number;
          reason: MatchReason;
          example_order_numbers: string[];
        };
        const unmatchedSkuMap = new Map<string, UnmatchedSkuAgg>();

        try {
          const costMatcher = await buildInventoryCostMatcher(supabaseAdmin);

          // 0. Load active SKU remaps.
          const remapByOldSku = new Map<string, RemapRow>();
          const remapByOldSkuNormalized = new Map<string, RemapRow>();
          {
            const { data, error } = await supabaseAdmin
              .from("shopify_sku_remaps")
              .select("old_sku,new_sku,shopify_variant_id,inventory_item_id")
              .eq("is_active", true);
            if (error) throw new Error(`shopify_sku_remaps lookup failed: ${error.message}`);
            for (const r of (data ?? []) as RemapRow[]) {
              if (r.old_sku) {
                remapByOldSku.set(r.old_sku.trim(), r);
                remapByOldSkuNormalized.set(normalizeSku(r.old_sku), r);
              }
            }
          }

          // 1. Load shopify-imported orders.
          const ordersById = new Map<string, OrderRow>();
          const orderIds: string[] = [];
          const pageSize = 1000;
          let from = 0;
          while (true) {
            const { data, error } = await supabaseAdmin
              .from("orders")
              .select("id,order_number")
              .not("shopify_order_id", "is", null)
              .range(from, from + pageSize - 1);
            if (error) throw new Error(`orders lookup failed: ${error.message}`);
            const rows = (data ?? []) as OrderRow[];
            for (const r of rows) {
              ordersById.set(r.id, r);
              orderIds.push(r.id);
            }
            if (rows.length < pageSize) break;
            from += pageSize;
          }

          // 2. Load order_items in chunks.
          const items: OrderItemRow[] = [];
          for (let i = 0; i < orderIds.length; i += 200) {
            const slice = orderIds.slice(i, i + 200);
            const { data, error } = await supabaseAdmin
              .from("order_items")
              .select(
                "id,order_id,sku,product_name,variant,inventory_item_id,shopify_variant_id,shopify_product_id,quantity,unit_cost",
              )
              .in("order_id", slice);
            if (!error) {
              items.push(...((data ?? []) as unknown as OrderItemRow[]));
              continue;
            }
            if (!isSchemaError(error)) {
              throw new Error(`order_items lookup failed: ${error.message}`);
            }
            const fallback = await supabaseAdmin
              .from("order_items")
              .select("id,order_id,sku,product_name,variant,quantity,unit_cost")
              .in("order_id", slice);
            if (fallback.error) {
              throw new Error(`order_items lookup failed: ${fallback.error.message}`);
            }
            items.push(...((fallback.data ?? []) as OrderItemRow[]));
          }
          orderItemsChecked = items.length;

          // 3. Load ALL shopify_variants once for indexes.
          const variantsByVariantId = new Map<string, VariantRow>();
          const variantsBySkuExact = new Map<string, VariantRow[]>();
          const variantsBySkuNormalized = new Map<string, VariantRow[]>();
          {
            const vPageSize = 1000;
            let vFrom = 0;
            while (true) {
              const { data, error } = await supabaseAdmin
                .from("shopify_variants")
                .select("shopify_variant_id,sku,barcode,inventory_item_id")
                .range(vFrom, vFrom + vPageSize - 1);
              if (error) throw new Error(`shopify_variants scan failed: ${error.message}`);
              const rows = (data ?? []) as VariantRow[];
              for (const v of rows) {
                if (v.shopify_variant_id) variantsByVariantId.set(v.shopify_variant_id, v);
                if (v.sku) {
                  const exact = v.sku.trim();
                  const norm = normalizeSku(v.sku);
                  if (exact) {
                    const arr = variantsBySkuExact.get(exact) ?? [];
                    arr.push(v);
                    variantsBySkuExact.set(exact, arr);
                  }
                  if (norm) {
                    const arrN = variantsBySkuNormalized.get(norm) ?? [];
                    arrN.push(v);
                    variantsBySkuNormalized.set(norm, arrN);
                  }
                }
              }
              if (rows.length < vPageSize) break;
              vFrom += vPageSize;
            }
          }

          // 4. Load inventory_item costs for everything we might use.
          const inventoryItemIds = new Set<string>();
          for (const v of variantsByVariantId.values()) {
            if (v.inventory_item_id) inventoryItemIds.add(v.inventory_item_id);
          }
          // Pre-load any direct inventory_item_id targets from remaps.
          for (const r of remapByOldSku.values()) {
            if (r.inventory_item_id) inventoryItemIds.add(r.inventory_item_id);
          }

          const costByInventoryItemId = new Map<string, InventoryCostRow>();
          const invArr = [...inventoryItemIds];
          for (let i = 0; i < invArr.length; i += 500) {
            const slice = invArr.slice(i, i + 500);
            const { data, error } = await supabaseAdmin
              .from("shopify_inventory_items")
              .select("inventory_item_id,unit_cost_amount,unit_cost_currency_code")
              .in("inventory_item_id", slice);
            if (error) throw new Error(`shopify_inventory_items lookup failed: ${error.message}`);
            for (const r of (data ?? []) as InventoryCostRow[]) {
              costByInventoryItemId.set(r.inventory_item_id, r);
            }
          }

          // 5. Decide matches & updates.
          type Update = { id: string; unit_cost: number };
          const updates: Update[] = [];

          const recordSample = (
            it: OrderItemRow,
            reason: MatchReason,
            shopifyVariantId: string | null,
          ) => {
            // Grouped report aggregator (no cap).
            const key = `${(it.sku ?? "").trim().toLowerCase()}|${reason}`;
            const order = ordersById.get(it.order_id);
            const existing = unmatchedSkuMap.get(key);
            if (existing) {
              existing.count++;
              if (order?.order_number && existing.example_order_numbers.length < 5) {
                if (!existing.example_order_numbers.includes(order.order_number)) {
                  existing.example_order_numbers.push(order.order_number);
                }
              }
            } else {
              unmatchedSkuMap.set(key, {
                old_sku: it.sku,
                item_title: it.product_name,
                variant: it.variant,
                count: 1,
                reason,
                example_order_numbers: order?.order_number ? [order.order_number] : [],
              });
            }

            // Preview samples (capped).
            if (unmatchedSamples.length < 20) {
              unmatchedSamples.push({
                order_number: order?.order_number ?? null,
                order_item_title: it.product_name,
                variant: it.variant,
                sku: it.sku,
                shopify_variant_id: shopifyVariantId,
                reason,
              });
            }
          };

          const resolveVariantFromInventoryId = (inventoryItemId: string): VariantRow | null => {
            // Synthetic variant just so downstream cost lookup works.
            return {
              shopify_variant_id: "",
              sku: null,
              barcode: null,
              inventory_item_id: inventoryItemId,
            };
          };

          for (const it of items) {
            const currentCost = Number(it.unit_cost ?? 0);
            if (currentCost > 0) {
              orderItemsAlreadyHadCost++;
              continue;
            }

            const inventoryMatch = costMatcher.resolve(it);
            if (inventoryMatch) {
              matchedByLocalInventory++;
              updates.push({ id: it.id, unit_cost: inventoryMatch.unitCost });
              continue;
            }

            let variant: VariantRow | undefined;
            let matchedVia:
              "variant_id" | "sku" | "sku_normalized" | "remap_variant_id" | "remap_sku" | null =
              null;

            // A) variant id encoded in SKU
            const vid = variantIdFromSku(it.sku);
            if (vid) {
              const found = variantsByVariantId.get(vid);
              if (found) {
                variant = found;
                matchedVia = "variant_id";
              } else {
                reasonShopifyVariantIdNotFound++;
                recordSample(it, "shopify_variant_id_not_found", vid);
                continue;
              }
            }

            // B) exact SKU
            if (!variant) {
              const rawSku = (it.sku ?? "").trim();
              if (!rawSku) {
                reasonMissingSku++;
                reasonMissingShopifyVariantId++;
                recordSample(it, "missing_sku", null);
                continue;
              }
              const exactMatches = variantsBySkuExact.get(rawSku);
              if (exactMatches && exactMatches.length === 1) {
                variant = exactMatches[0];
                matchedVia = "sku";
              } else if (exactMatches && exactMatches.length > 1) {
                reasonDuplicateSkuMatches++;
                recordSample(it, "duplicate_sku_matches", null);
                continue;
              } else {
                // C) normalized SKU
                const norm = normalizeSku(it.sku);
                const normMatches = norm ? variantsBySkuNormalized.get(norm) : undefined;
                if (normMatches && normMatches.length === 1) {
                  variant = normMatches[0];
                  matchedVia = "sku_normalized";
                } else if (normMatches && normMatches.length > 1) {
                  reasonDuplicateSkuMatches++;
                  recordSample(it, "duplicate_sku_matches", null);
                  continue;
                } else {
                  // D) Active SKU remap
                  const remap = remapByOldSku.get(rawSku) ?? remapByOldSkuNormalized.get(norm);
                  if (!remap) {
                    reasonSkuNotFound++;
                    recordSample(it, "sku_not_found", null);
                    continue;
                  }

                  // D1: direct shopify_variant_id on remap
                  if (remap.shopify_variant_id) {
                    const v = variantsByVariantId.get(remap.shopify_variant_id);
                    if (v) {
                      variant = v;
                      matchedVia = "remap_variant_id";
                    } else {
                      reasonRemapTargetNotFound++;
                      recordSample(it, "remap_target_not_found", remap.shopify_variant_id);
                      continue;
                    }
                  } else if (remap.inventory_item_id) {
                    // D1b: direct inventory_item_id on remap
                    const synthetic = resolveVariantFromInventoryId(remap.inventory_item_id);
                    if (synthetic) {
                      variant = synthetic;
                      matchedVia = "remap_variant_id";
                    }
                  } else if (remap.new_sku) {
                    // D2: resolve via new_sku → shopify_variants.sku
                    const newSkuTrim = remap.new_sku.trim();
                    const exact = variantsBySkuExact.get(newSkuTrim);
                    const normMatches2 = variantsBySkuNormalized.get(normalizeSku(remap.new_sku));
                    const pool = exact && exact.length > 0 ? exact : (normMatches2 ?? []);
                    if (pool.length === 1) {
                      variant = pool[0];
                      matchedVia = "remap_sku";
                    } else if (pool.length > 1) {
                      reasonDuplicateRemapTarget++;
                      recordSample(it, "duplicate_remap_target", null);
                      continue;
                    } else {
                      reasonRemapTargetNotFound++;
                      recordSample(it, "remap_target_not_found", null);
                      continue;
                    }
                  } else {
                    reasonRemapMissingTarget++;
                    recordSample(it, "remap_missing_target", null);
                    continue;
                  }
                }
              }
            }

            if (!variant || !variant.inventory_item_id) {
              reasonVariantMissingInventoryItem++;
              recordSample(
                it,
                "variant_missing_inventory_item_id",
                variant?.shopify_variant_id ?? null,
              );
              continue;
            }

            const cost = costByInventoryItemId.get(variant.inventory_item_id);
            const amount = cost?.unit_cost_amount != null ? Number(cost.unit_cost_amount) : null;
            if (amount == null || !Number.isFinite(amount) || amount <= 0) {
              orderItemsMissingInventoryCost++;
              recordSample(it, "inventory_cost_missing", variant.shopify_variant_id || null);
              continue;
            }

            if (matchedVia === "variant_id") matchedByVariantId++;
            else if (matchedVia === "sku") matchedBySku++;
            else if (matchedVia === "sku_normalized") matchedBySkuNormalized++;
            else if (matchedVia === "remap_variant_id") matchedByRemapVariantId++;
            else if (matchedVia === "remap_sku") matchedByRemapSku++;

            updates.push({ id: it.id, unit_cost: amount });
          }

          // 6. Apply updates (only zero/null unit_cost; total_cost is generated).
          if (!dryRun) {
            for (const u of updates) {
              const { error } = await supabaseAdmin
                .from("order_items")
                .update({ unit_cost: u.unit_cost })
                .eq("id", u.id);
              if (error) {
                failedCount++;
                lastError = error.message;
              } else {
                orderItemsUpdated++;
              }
            }
          }

          const orderItemsMissingVariantMatch =
            reasonMissingSku +
            reasonSkuNotFound +
            reasonShopifyVariantIdNotFound +
            reasonDuplicateSkuMatches +
            reasonRemapMissingTarget +
            reasonRemapTargetNotFound +
            reasonDuplicateRemapTarget +
            reasonVariantMissingInventoryItem;

          const remapMatchesCount = matchedByRemapVariantId + matchedByRemapSku;
          const remainingUnmatched = orderItemsMissingVariantMatch;

          // Sort grouped unmatched SKU report by count desc.
          const unmatchedSkuReport = [...unmatchedSkuMap.values()].sort(
            (a, b) => b.count - a.count,
          );

          const finishedAt = new Date().toISOString();
          const status = failedCount === 0 ? "success" : "partial";

          const metadata = {
            order_items_checked: orderItemsChecked,
            order_items_updated: orderItemsUpdated,
            order_items_already_had_cost: orderItemsAlreadyHadCost,
            order_items_missing_variant_match: orderItemsMissingVariantMatch,
            order_items_missing_inventory_cost: orderItemsMissingInventoryCost,
            matched_by_variant_id: matchedByVariantId,
            matched_by_sku: matchedBySku,
            matched_by_sku_normalized: matchedBySkuNormalized,
            matched_by_local_inventory: matchedByLocalInventory,
            matched_by_remap_variant_id: matchedByRemapVariantId,
            matched_by_remap_sku: matchedByRemapSku,
            remap_matches_count: remapMatchesCount,
            remaining_unmatched: remainingUnmatched,
            matched_by_barcode: 0,
            matched_by_title_exact: 0,
            mismatch_reasons: {
              missing_shopify_variant_id: reasonMissingShopifyVariantId,
              shopify_variant_id_not_found: reasonShopifyVariantIdNotFound,
              missing_sku: reasonMissingSku,
              sku_not_found: reasonSkuNotFound,
              duplicate_sku_matches: reasonDuplicateSkuMatches,
              remap_missing_target: reasonRemapMissingTarget,
              remap_target_not_found: reasonRemapTargetNotFound,
              duplicate_remap_target: reasonDuplicateRemapTarget,
              variant_missing_inventory_item_id: reasonVariantMissingInventoryItem,
              empty_or_invalid_match_keys: reasonMissingSku,
              other: 0,
            },
            unmatched_samples: unmatchedSamples,
            unmatched_sku_report: unmatchedSkuReport.slice(0, 200),
            failed_count: failedCount,
            orders_considered: orderIds.length,
            shopify_write_calls: false,
            source:
              "local inventory + shopify_variants + shopify_inventory_items + shopify_sku_remaps",
            match_rules:
              "0) local inventory matcher (inventory item, variant, product+variant, exact SKU, normalized SKU, title+variant), 1) shopify-variant-{id} encoded SKU → variant_id, 2) exact SKU, 3) normalized SKU, 4) active SKU remap (variant_id, inventory_item_id, or new_sku).",
            updates_only_zero_or_null_unit_cost: true,
            touched_order_totals: false,
            cost_matcher: {
              inventory_rows_indexed: costMatcher.inventory_rows_indexed,
              shopify_variants_indexed: costMatcher.shopify_variants_indexed,
              shopify_inventory_items_indexed: costMatcher.shopify_inventory_items_indexed,
            },
          };

          if (!dryRun) {
            await saveShopifySyncRun(supabaseAdmin, {
              syncType,
              status,
              startedAt,
              finishedAt,
              recordsProcessed: orderItemsChecked,
              updatedCount: orderItemsUpdated,
              failedCount,
              pagesFetched: 0,
              errorMessage: lastError,
              metadata,
            });
          }

          return Response.json({
            status,
            dry_run: dryRun,
            order_items_checked: orderItemsChecked,
            order_items_updated: orderItemsUpdated,
            order_items_already_had_cost: orderItemsAlreadyHadCost,
            order_items_missing_variant_match: orderItemsMissingVariantMatch,
            order_items_missing_inventory_cost: orderItemsMissingInventoryCost,
            matched_by_variant_id: matchedByVariantId,
            matched_by_sku: matchedBySku,
            matched_by_sku_normalized: matchedBySkuNormalized,
            matched_by_local_inventory: matchedByLocalInventory,
            matched_by_remap_variant_id: matchedByRemapVariantId,
            matched_by_remap_sku: matchedByRemapSku,
            remap_matches_count: remapMatchesCount,
            remaining_unmatched: remainingUnmatched,
            matched_by_barcode: 0,
            matched_by_title_exact: 0,
            mismatch_reasons: metadata.mismatch_reasons,
            unmatched_samples: unmatchedSamples,
            unmatched_sku_report: unmatchedSkuReport,
            failed_count: failedCount,
            started_at: startedAt,
            finished_at: finishedAt,
            last_error: lastError,
          });
        } catch (err) {
          const finishedAt = new Date().toISOString();
          const message = err instanceof Error ? err.message : String(err);
          try {
            await saveShopifySyncRun(supabaseAdmin, {
              syncType,
              status: "error",
              startedAt,
              finishedAt,
              recordsProcessed: orderItemsChecked,
              updatedCount: orderItemsUpdated,
              failedCount: failedCount + 1,
              pagesFetched: 0,
              errorMessage: message,
              metadata: {
                order_items_checked: orderItemsChecked,
                order_items_updated: orderItemsUpdated,
                order_items_already_had_cost: orderItemsAlreadyHadCost,
                order_items_missing_inventory_cost: orderItemsMissingInventoryCost,
                failed_count: failedCount + 1,
                shopify_write_calls: false,
              },
            });
          } catch {
            // swallow logging failure
          }
          return Response.json(
            {
              status: "error",
              error: message,
              order_items_checked: orderItemsChecked,
              order_items_updated: orderItemsUpdated,
              order_items_already_had_cost: orderItemsAlreadyHadCost,
              order_items_missing_inventory_cost: orderItemsMissingInventoryCost,
              failed_count: failedCount + 1,
              started_at: startedAt,
              finished_at: finishedAt,
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
