import { createFileRoute } from "@tanstack/react-router";
import { requireOpsUser, saveShopifySyncRun } from "@/lib/shopify-sync.server";
import { buildInventoryCostMatcher } from "@/lib/inventory-cost-match.server";

type OrderRow = {
  id: string;
  order_number: string | null;
  order_status: string | null;
  items_cost: number | null;
};

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
  unit_cost_amount: number | string | null;
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
  | "matched_by_remap_variant_id"
  | "matched_by_remap_inventory_item_id"
  | "matched_by_remap_sku"
  | "missing_sku"
  | "shopify_variant_id_not_found"
  | "sku_not_found"
  | "duplicate_sku_matches"
  | "barcode_not_found"
  | "duplicate_barcode_matches"
  | "remap_missing_target"
  | "remap_target_not_found"
  | "duplicate_remap_target"
  | "variant_missing_inventory_item_id"
  | "inventory_cost_missing";

const SHOPIFY_VARIANT_SKU_RE = /^shopify-variant-(\d+)$/i;

function variantIdFromSku(sku: string | null) {
  if (!sku) return null;
  const match = sku.trim().match(SHOPIFY_VARIANT_SKU_RE);
  return match ? match[1] : null;
}

function normalizeKey(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function money(value: number) {
  return Number(value.toFixed(2));
}

function isCancelled(status: string | null | undefined) {
  return status === "Cancelled";
}

function isSchemaError(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    /column|schema cache|could not find/i.test(message)
  );
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
  const clean = normalizeKey(key);
  if (!clean) return;
  const rows = map.get(clean) ?? [];
  rows.push(row);
  map.set(clean, rows);
}

function singleMatch(rows: VariantRow[] | undefined) {
  if (!rows?.length) return { variant: null, duplicate: false };
  if (rows.length > 1) return { variant: null, duplicate: true };
  return { variant: rows[0], duplicate: false };
}

export const Route = createFileRoute("/api/shopify/force-update-order-item-costs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireOpsUser(request);
        if (!auth.ok) return auth.response;
        const { supabaseAdmin } = auth;

        const startedAt = new Date().toISOString();
        const syncType = "force_order_item_cost_update";

        let itemsChecked = 0;
        let itemsUpdated = 0;
        let itemsSkipped = 0;
        let missingCost = 0;
        let missingMatch = 0;
        let ordersRecalculated = 0;
        let failedCount = 0;
        let lastError: string | null = null;
        let totalCostBefore = 0;
        let totalCostAfter = 0;
        let missingCostsBefore = 0;
        let missingCostsFixed = 0;
        let missingCostsRemaining = 0;
        let cancelledOrdersNormalized = 0;

        const matchCounts: Record<string, number> = {};
        const mismatchReasons: Record<string, number> = {};
        const samples: Array<{
          order_number: string | null;
          sku: string | null;
          item_title: string | null;
          variant: string | null;
          reason: string;
        }> = [];

        const addMismatch = (
          item: OrderItemRow,
          ordersById: Map<string, OrderRow>,
          reason: MatchReason,
        ) => {
          mismatchReasons[reason] = (mismatchReasons[reason] ?? 0) + 1;
          if (samples.length < 20) {
            samples.push({
              order_number: ordersById.get(item.order_id)?.order_number ?? null,
              sku: item.sku,
              item_title: item.product_name,
              variant: item.variant,
              reason,
            });
          }
        };

        try {
          const costMatcher = await buildInventoryCostMatcher(supabaseAdmin);
          const orders: OrderRow[] = [];
          const pageSize = 1000;
          let from = 0;
          while (true) {
            const { data, error } = await supabaseAdmin
              .from("orders")
              .select("id,order_number,order_status,items_cost")
              .not("shopify_order_id", "is", null)
              .range(from, from + pageSize - 1);
            if (error) throw new Error(`orders lookup failed: ${error.message}`);
            const rows = (data ?? []) as OrderRow[];
            orders.push(...rows);
            if (rows.length < pageSize) break;
            from += pageSize;
          }

          const ordersById = new Map(orders.map((order) => [order.id, order]));
          const orderIds = orders.map((order) => order.id);

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
            if (!isSchemaError(error))
              throw new Error(`order_items lookup failed: ${error.message}`);

            const fallback = await supabaseAdmin
              .from("order_items")
              .select("id,order_id,sku,product_name,variant,quantity,unit_cost")
              .in("order_id", slice);
            if (fallback.error)
              throw new Error(`order_items lookup failed: ${fallback.error.message}`);
            items.push(...((fallback.data ?? []) as OrderItemRow[]));
          }
          itemsChecked = items.length;

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
              remapByOldSkuNormalized.set(normalizeKey(row.old_sku), row);
            }
          }

          const variantsByVariantId = new Map<string, VariantRow>();
          const variantsBySkuExact = new Map<string, VariantRow[]>();
          const variantsBySkuNormalized = new Map<string, VariantRow[]>();
          const variantsByBarcodeExact = new Map<string, VariantRow[]>();
          const variantsByBarcodeNormalized = new Map<string, VariantRow[]>();
          from = 0;
          while (true) {
            const { data, error } = await supabaseAdmin
              .from("shopify_variants")
              .select("shopify_variant_id,sku,barcode,inventory_item_id")
              .range(from, from + pageSize - 1);
            if (error) throw new Error(`shopify_variants scan failed: ${error.message}`);
            const rows = (data ?? []) as VariantRow[];
            for (const variant of rows) {
              if (variant.shopify_variant_id)
                variantsByVariantId.set(variant.shopify_variant_id, variant);
              addToIndex(variantsBySkuExact, variant.sku, variant);
              addToNormalizedIndex(variantsBySkuNormalized, variant.sku, variant);
              addToIndex(variantsByBarcodeExact, variant.barcode, variant);
              addToNormalizedIndex(variantsByBarcodeNormalized, variant.barcode, variant);
            }
            if (rows.length < pageSize) break;
            from += pageSize;
          }

          const inventoryItemIds = new Set<string>();
          for (const variant of variantsByVariantId.values()) {
            if (variant.inventory_item_id) inventoryItemIds.add(variant.inventory_item_id);
          }
          for (const remap of remapByOldSku.values()) {
            if (remap.inventory_item_id) inventoryItemIds.add(remap.inventory_item_id);
          }

          const costByInventoryItemId = new Map<string, number>();
          const inventoryIds = [...inventoryItemIds];
          for (let i = 0; i < inventoryIds.length; i += 500) {
            const slice = inventoryIds.slice(i, i + 500);
            const { data, error } = await supabaseAdmin
              .from("shopify_inventory_items")
              .select("inventory_item_id,unit_cost_amount")
              .in("inventory_item_id", slice);
            if (error) throw new Error(`shopify_inventory_items lookup failed: ${error.message}`);
            for (const row of (data ?? []) as InventoryCostRow[]) {
              const amount = Number(row.unit_cost_amount ?? 0);
              if (Number.isFinite(amount) && amount > 0) {
                costByInventoryItemId.set(row.inventory_item_id, amount);
              }
            }
          }

          const resolveRemapVariant = (
            remap: RemapRow,
          ): { variant: VariantRow | null; reason: MatchReason | null; duplicate?: boolean } => {
            if (remap.shopify_variant_id) {
              return {
                variant: variantsByVariantId.get(remap.shopify_variant_id) ?? null,
                reason: "matched_by_remap_variant_id",
              };
            }
            if (remap.inventory_item_id) {
              return {
                variant: {
                  shopify_variant_id: "",
                  sku: null,
                  barcode: null,
                  inventory_item_id: remap.inventory_item_id,
                },
                reason: "matched_by_remap_inventory_item_id",
              };
            }
            if (!remap.new_sku) return { variant: null, reason: "remap_missing_target" };

            const exact = singleMatch(variantsBySkuExact.get(remap.new_sku.trim()));
            if (exact.duplicate)
              return { variant: null, reason: "duplicate_remap_target", duplicate: true };
            if (exact.variant) return { variant: exact.variant, reason: "matched_by_remap_sku" };

            const normalized = singleMatch(
              variantsBySkuNormalized.get(normalizeKey(remap.new_sku)),
            );
            if (normalized.duplicate)
              return { variant: null, reason: "duplicate_remap_target", duplicate: true };
            if (normalized.variant)
              return { variant: normalized.variant, reason: "matched_by_remap_sku" };

            return { variant: null, reason: "remap_target_not_found" };
          };

          const resolveVariant = (
            item: OrderItemRow,
          ): { variant: VariantRow | null; reason: MatchReason } => {
            if (item.shopify_variant_id) {
              const variant = variantsByVariantId.get(String(item.shopify_variant_id));
              return variant
                ? { variant, reason: "matched_by_variant_id" }
                : { variant: null, reason: "shopify_variant_id_not_found" };
            }

            const variantId = variantIdFromSku(item.sku);
            if (variantId) {
              const variant = variantsByVariantId.get(variantId);
              return variant
                ? { variant, reason: "matched_by_variant_id" }
                : { variant: null, reason: "shopify_variant_id_not_found" };
            }

            const rawSku = String(item.sku ?? "").trim();
            if (!rawSku) return { variant: null, reason: "missing_sku" };

            const exactSku = singleMatch(variantsBySkuExact.get(rawSku));
            if (exactSku.duplicate) return { variant: null, reason: "duplicate_sku_matches" };
            if (exactSku.variant) return { variant: exactSku.variant, reason: "matched_by_sku" };

            const normalizedSku = singleMatch(variantsBySkuNormalized.get(normalizeKey(rawSku)));
            if (normalizedSku.duplicate) return { variant: null, reason: "duplicate_sku_matches" };
            if (normalizedSku.variant)
              return { variant: normalizedSku.variant, reason: "matched_by_sku_normalized" };

            const barcodeCandidates = [rawSku, item.variant, item.product_name].filter(
              Boolean,
            ) as string[];
            for (const candidate of barcodeCandidates) {
              const exactBarcode = singleMatch(variantsByBarcodeExact.get(candidate.trim()));
              if (exactBarcode.duplicate)
                return { variant: null, reason: "duplicate_barcode_matches" };
              if (exactBarcode.variant)
                return { variant: exactBarcode.variant, reason: "matched_by_barcode" };

              const normalizedBarcode = singleMatch(
                variantsByBarcodeNormalized.get(normalizeKey(candidate)),
              );
              if (normalizedBarcode.duplicate)
                return { variant: null, reason: "duplicate_barcode_matches" };
              if (normalizedBarcode.variant) {
                return {
                  variant: normalizedBarcode.variant,
                  reason: "matched_by_barcode_normalized",
                };
              }
            }

            const remap =
              remapByOldSku.get(rawSku) ?? remapByOldSkuNormalized.get(normalizeKey(rawSku));
            if (remap) {
              const resolved = resolveRemapVariant(remap);
              if (resolved.variant && resolved.reason)
                return { variant: resolved.variant, reason: resolved.reason };
              return { variant: null, reason: resolved.reason ?? "remap_target_not_found" };
            }

            return {
              variant: null,
              reason: barcodeCandidates.length ? "barcode_not_found" : "sku_not_found",
            };
          };

          const updates: Array<{ id: string; orderId: string; oldCost: number; newCost: number }> =
            [];
          const newCostByItemId = new Map<string, number>();

          for (const item of items) {
            const oldCost = Number(item.unit_cost ?? 0);
            const qty = Number(item.quantity ?? 0);
            const safeOldCost = Number.isFinite(oldCost) ? oldCost : 0;
            const safeQty = Number.isFinite(qty) ? qty : 0;
            if (safeOldCost <= 0) missingCostsBefore++;

            let newCost: number | null = null;
            let reason = "matched_by_inventory_cost_matcher";
            const inventoryMatch = costMatcher.resolve(item);
            if (inventoryMatch) {
              newCost = inventoryMatch.unitCost;
              reason = inventoryMatch.reason;
            } else {
              const resolved = resolveVariant(item);
              const variant = resolved.variant;
              reason = resolved.reason;

              if (!variant) {
                missingMatch++;
                addMismatch(item, ordersById, resolved.reason);
                if (safeOldCost <= 0) missingCostsRemaining++;
                totalCostBefore += safeQty * safeOldCost;
                totalCostAfter += safeQty * safeOldCost;
                continue;
              }

              if (!variant.inventory_item_id) {
                missingMatch++;
                addMismatch(item, ordersById, "variant_missing_inventory_item_id");
                if (safeOldCost <= 0) missingCostsRemaining++;
                totalCostBefore += safeQty * safeOldCost;
                totalCostAfter += safeQty * safeOldCost;
                continue;
              }

              const resolvedCost = costByInventoryItemId.get(variant.inventory_item_id);
              if (resolvedCost == null || !Number.isFinite(resolvedCost) || resolvedCost <= 0) {
                missingCost++;
                addMismatch(item, ordersById, "inventory_cost_missing");
                if (safeOldCost <= 0) missingCostsRemaining++;
                totalCostBefore += safeQty * safeOldCost;
                totalCostAfter += safeQty * safeOldCost;
                continue;
              }
              newCost = resolvedCost;
            }

            if (newCost == null || !Number.isFinite(newCost) || newCost <= 0) {
              missingCost++;
              addMismatch(item, ordersById, "inventory_cost_missing");
              if (safeOldCost <= 0) missingCostsRemaining++;
              totalCostBefore += safeQty * safeOldCost;
              totalCostAfter += safeQty * safeOldCost;
              continue;
            }

            if (safeOldCost <= 0) missingCostsFixed++;

            matchCounts[reason] = (matchCounts[reason] ?? 0) + 1;
            totalCostBefore += safeQty * safeOldCost;
            totalCostAfter += safeQty * newCost;

            if (Math.abs(safeOldCost - newCost) < 0.005) {
              itemsSkipped++;
              continue;
            }

            updates.push({ id: item.id, orderId: item.order_id, oldCost: safeOldCost, newCost });
            newCostByItemId.set(item.id, newCost);
          }

          const affectedOrderIds = new Set<string>();
          for (const update of updates) {
            const { error } = await supabaseAdmin
              .from("order_items")
              .update({ unit_cost: update.newCost })
              .eq("id", update.id);
            if (error) {
              failedCount++;
              lastError = error.message;
              continue;
            }
            itemsUpdated++;
            affectedOrderIds.add(update.orderId);
          }

          for (const orderId of affectedOrderIds) {
            const order = ordersById.get(orderId);
            const nextItemsCost = isCancelled(order?.order_status)
              ? 0
              : items
                  .filter((item) => item.order_id === orderId)
                  .reduce((sum, item) => {
                    const qty = Number(item.quantity ?? 0);
                    const cost = newCostByItemId.get(item.id) ?? Number(item.unit_cost ?? 0);
                    return (
                      sum + (Number.isFinite(qty) ? qty : 0) * (Number.isFinite(cost) ? cost : 0)
                    );
                  }, 0);

            const { error } = await supabaseAdmin
              .from("orders")
              .update({ items_cost: money(nextItemsCost) })
              .eq("id", orderId);
            if (error) {
              failedCount++;
              lastError = error.message;
            } else {
              ordersRecalculated++;
              if (isCancelled(order?.order_status)) cancelledOrdersNormalized++;
            }
          }

          for (const order of orders) {
            if (
              !affectedOrderIds.has(order.id) &&
              isCancelled(order.order_status) &&
              Number(order.items_cost ?? 0) !== 0
            ) {
              const { error } = await supabaseAdmin
                .from("orders")
                .update({ items_cost: 0 })
                .eq("id", order.id);
              if (error) {
                failedCount++;
                lastError = error.message;
              } else {
                ordersRecalculated++;
                cancelledOrdersNormalized++;
              }
            }
          }

          itemsSkipped += missingMatch + missingCost;
          const finishedAt = new Date().toISOString();
          const status = failedCount > 0 ? "partial" : "success";
          const response = {
            ok: true,
            status,
            items_checked: itemsChecked,
            items_updated: itemsUpdated,
            items_skipped: itemsSkipped,
            missing_cost: missingCost,
            missing_match: missingMatch,
            orders_recalculated: ordersRecalculated,
            missing_costs_before: missingCostsBefore,
            missing_costs_fixed: missingCostsFixed,
            missing_costs_remaining: missingCostsRemaining,
            cancelled_orders_normalized: cancelledOrdersNormalized,
            total_cost_before: money(totalCostBefore),
            total_cost_after: money(totalCostAfter),
            failed_count: failedCount,
            match_counts: matchCounts,
            mismatch_reasons: mismatchReasons,
            samples,
            cost_matcher: {
              inventory_rows_indexed: costMatcher.inventory_rows_indexed,
              shopify_variants_indexed: costMatcher.shopify_variants_indexed,
              shopify_inventory_items_indexed: costMatcher.shopify_inventory_items_indexed,
            },
            started_at: startedAt,
            finished_at: finishedAt,
            last_error: lastError,
          };

          await saveShopifySyncRun(supabaseAdmin, {
            syncType,
            status,
            startedAt,
            finishedAt,
            recordsProcessed: itemsChecked,
            updatedCount: itemsUpdated,
            failedCount,
            pagesFetched: 0,
            errorMessage: lastError,
            metadata: {
              ...response,
              shopify_write_calls: false,
              overwritten_existing_unit_costs: true,
              preserved_fields:
                "selling price, shipping_cost, packaging_cost, confirmation_status, order_status, internal_notes, customer data",
            },
          });

          return Response.json(response);
        } catch (err) {
          const finishedAt = new Date().toISOString();
          const message = err instanceof Error ? err.message : String(err);
          await saveShopifySyncRun(supabaseAdmin, {
            syncType,
            status: "error",
            startedAt,
            finishedAt,
            recordsProcessed: itemsChecked,
            updatedCount: itemsUpdated,
            failedCount: failedCount + 1,
            pagesFetched: 0,
            errorMessage: message,
            metadata: {
              items_checked: itemsChecked,
              items_updated: itemsUpdated,
              missing_cost: missingCost,
              missing_match: missingMatch,
              missing_costs_before: missingCostsBefore,
              missing_costs_fixed: missingCostsFixed,
              missing_costs_remaining: missingCostsRemaining,
              cancelled_orders_normalized: cancelledOrdersNormalized,
              shopify_write_calls: false,
            },
          });
          return Response.json(
            { ok: false, status: "error", error: message, failed_count: failedCount + 1 },
            { status: 500 },
          );
        }
      },
    },
  },
});
