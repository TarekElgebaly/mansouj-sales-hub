import { createFileRoute } from "@tanstack/react-router";
import { requireOpsUser, saveShopifySyncRun } from "@/lib/shopify-sync.server";

type OrderItemRow = {
  id: string;
  order_id: string;
  sku: string | null;
  product_name: string | null;
  variant: string | null;
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

type MatchReason =
  | "matched_by_variant_id"
  | "matched_by_sku"
  | "matched_by_sku_normalized"
  | "missing_match_keys"
  | "shopify_variant_id_not_found"
  | "missing_sku"
  | "sku_not_found"
  | "duplicate_sku_matches"
  | "variant_missing_inventory_item_id"
  | "inventory_cost_missing";

export const Route = createFileRoute("/api/shopify/backfill-order-item-costs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireOpsUser(request);
        if (!auth.ok) return auth.response;
        const { supabaseAdmin } = auth;

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
        let reasonMissingShopifyVariantId = 0;
        let reasonShopifyVariantIdNotFound = 0;
        let reasonMissingSku = 0;
        let reasonSkuNotFound = 0;
        let reasonDuplicateSkuMatches = 0;
        let reasonVariantMissingInventoryItem = 0;

        const unmatchedSamples: Array<{
          order_number: string | null;
          order_item_title: string | null;
          variant: string | null;
          sku: string | null;
          shopify_variant_id: string | null;
          reason: MatchReason;
        }> = [];

        try {
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
              .select("id,order_id,sku,product_name,variant,quantity,unit_cost")
              .in("order_id", slice);
            if (error) throw new Error(`order_items lookup failed: ${error.message}`);
            items.push(...((data ?? []) as OrderItemRow[]));
          }
          orderItemsChecked = items.length;

          // 3. Collect candidate match keys.
          const variantIdsToFetch = new Set<string>();
          const exactSkus = new Set<string>();
          const normalizedSkus = new Set<string>();
          for (const it of items) {
            const vid = variantIdFromSku(it.sku);
            if (vid) {
              variantIdsToFetch.add(vid);
            } else if (it.sku && it.sku.trim()) {
              exactSkus.add(it.sku.trim());
              normalizedSkus.add(normalizeSku(it.sku));
            }
          }

          // 4. Load variants by Shopify variant id.
          const variantsByVariantId = new Map<string, VariantRow>();
          const variantIdArr = [...variantIdsToFetch];
          for (let i = 0; i < variantIdArr.length; i += 500) {
            const slice = variantIdArr.slice(i, i + 500);
            const { data, error } = await supabaseAdmin
              .from("shopify_variants")
              .select("shopify_variant_id,sku,barcode,inventory_item_id")
              .in("shopify_variant_id", slice);
            if (error)
              throw new Error(`shopify_variants by id lookup failed: ${error.message}`);
            for (const v of (data ?? []) as VariantRow[]) {
              variantsByVariantId.set(v.shopify_variant_id, v);
            }
          }

          // 5. Load ALL variants for sku lookups (so we can build exact + normalized indexes
          //    and detect duplicates). Order data is bounded; variants are too.
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
              if (error)
                throw new Error(`shopify_variants scan failed: ${error.message}`);
              const rows = (data ?? []) as VariantRow[];
              for (const v of rows) {
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

          // 6. Load inventory item costs for ALL variants we might use.
          const inventoryItemIds = new Set<string>();
          for (const v of variantsByVariantId.values()) {
            if (v.inventory_item_id) inventoryItemIds.add(v.inventory_item_id);
          }
          for (const arr of variantsBySkuExact.values()) {
            for (const v of arr) {
              if (v.inventory_item_id) inventoryItemIds.add(v.inventory_item_id);
            }
          }

          const costByInventoryItemId = new Map<string, InventoryCostRow>();
          const invArr = [...inventoryItemIds];
          for (let i = 0; i < invArr.length; i += 500) {
            const slice = invArr.slice(i, i + 500);
            const { data, error } = await supabaseAdmin
              .from("shopify_inventory_items")
              .select("inventory_item_id,unit_cost_amount,unit_cost_currency_code")
              .in("inventory_item_id", slice);
            if (error)
              throw new Error(`shopify_inventory_items lookup failed: ${error.message}`);
            for (const r of (data ?? []) as InventoryCostRow[]) {
              costByInventoryItemId.set(r.inventory_item_id, r);
            }
          }

          // 7. Decide matches & updates.
          type Update = { id: string; unit_cost: number };
          const updates: Update[] = [];

          const recordSample = (
            it: OrderItemRow,
            reason: MatchReason,
            shopifyVariantId: string | null,
          ) => {
            if (unmatchedSamples.length >= 20) return;
            const order = ordersById.get(it.order_id);
            unmatchedSamples.push({
              order_number: order?.order_number ?? null,
              order_item_title: it.product_name,
              variant: it.variant,
              sku: it.sku,
              shopify_variant_id: shopifyVariantId,
              reason,
            });
          };

          for (const it of items) {
            const currentCost = Number(it.unit_cost ?? 0);
            if (currentCost > 0) {
              orderItemsAlreadyHadCost++;
              continue;
            }

            let variant: VariantRow | undefined;
            let matchedVia: "variant_id" | "sku" | "sku_normalized" | null = null;

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
                // C) normalized SKU (case-insensitive + whitespace-stripped)
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
                  reasonSkuNotFound++;
                  recordSample(it, "sku_not_found", null);
                  continue;
                }
              }
            }

            if (!variant.inventory_item_id) {
              reasonVariantMissingInventoryItem++;
              recordSample(
                it,
                "variant_missing_inventory_item_id",
                variant.shopify_variant_id,
              );
              continue;
            }

            const cost = costByInventoryItemId.get(variant.inventory_item_id);
            const amount =
              cost?.unit_cost_amount != null ? Number(cost.unit_cost_amount) : null;
            if (amount == null || !Number.isFinite(amount) || amount <= 0) {
              orderItemsMissingInventoryCost++;
              recordSample(it, "inventory_cost_missing", variant.shopify_variant_id);
              continue;
            }

            if (matchedVia === "variant_id") matchedByVariantId++;
            else if (matchedVia === "sku") matchedBySku++;
            else if (matchedVia === "sku_normalized") matchedBySkuNormalized++;

            updates.push({ id: it.id, unit_cost: amount });
          }

          // 8. Apply updates (only zero/null unit_cost; total_cost is generated).
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

          const orderItemsMissingVariantMatch =
            reasonMissingSku +
            reasonSkuNotFound +
            reasonShopifyVariantIdNotFound +
            reasonDuplicateSkuMatches +
            reasonVariantMissingInventoryItem;

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
            matched_by_barcode: 0,
            matched_by_title_exact: 0,
            mismatch_reasons: {
              missing_shopify_variant_id: reasonMissingShopifyVariantId,
              shopify_variant_id_not_found: reasonShopifyVariantIdNotFound,
              missing_sku: reasonMissingSku,
              sku_not_found: reasonSkuNotFound,
              duplicate_sku_matches: reasonDuplicateSkuMatches,
              variant_missing_inventory_item_id: reasonVariantMissingInventoryItem,
              empty_or_invalid_match_keys: reasonMissingSku,
              other: 0,
            },
            unmatched_samples: unmatchedSamples,
            failed_count: failedCount,
            orders_considered: orderIds.length,
            shopify_write_calls: false,
            source: "local shopify_variants + shopify_inventory_items",
            match_rules:
              "1) shopify-variant-{id} encoded SKU → variant_id, 2) exact SKU (trimmed), 3) normalized SKU (lowercase, whitespace-stripped). Barcode/title disabled: no barcode column on order_items.",
            updates_only_zero_or_null_unit_cost: true,
            touched_order_totals: false,
          };

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

          return Response.json({
            status,
            order_items_checked: orderItemsChecked,
            order_items_updated: orderItemsUpdated,
            order_items_already_had_cost: orderItemsAlreadyHadCost,
            order_items_missing_variant_match: orderItemsMissingVariantMatch,
            order_items_missing_inventory_cost: orderItemsMissingInventoryCost,
            matched_by_variant_id: matchedByVariantId,
            matched_by_sku: matchedBySku,
            matched_by_sku_normalized: matchedBySkuNormalized,
            matched_by_barcode: 0,
            matched_by_title_exact: 0,
            mismatch_reasons: metadata.mismatch_reasons,
            unmatched_samples: unmatchedSamples,
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
