import { createFileRoute } from "@tanstack/react-router";
import { requireOpsUser, saveShopifySyncRun } from "@/lib/shopify-sync.server";
import { calculatePackagingCost } from "@/lib/packaging-cost";
import { buildInventoryCostMatcher } from "@/lib/inventory-cost-match.server";

type OrderRow = {
  id: string;
  order_status: string | null;
  items_cost: number | null;
  packaging_cost: number | null;
};
type ItemRow = {
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
type ActivityRow = {
  order_id: string | null;
  action: string | null;
  details: unknown;
};

function activityTouchesPackagingCost(action: string | null | undefined, details: unknown) {
  if (action !== "update_costs") return false;
  if (!details || typeof details !== "object" || Array.isArray(details)) return false;
  if ("old_packaging_cost" in details && "new_packaging_cost" in details) {
    const oldValue = Number((details as Record<string, unknown>).old_packaging_cost ?? 0);
    const newValue = Number((details as Record<string, unknown>).new_packaging_cost ?? 0);
    if (Number.isFinite(oldValue) && Number.isFinite(newValue)) {
      return Math.abs(oldValue - newValue) >= 0.005;
    }
  }
  return "packaging_cost" in details || "new_packaging_cost" in details;
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

export const Route = createFileRoute("/api/shopify/recalculate-order-costs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireOpsUser(request);
        if (!auth.ok) return auth.response;
        const { supabaseAdmin } = auth;

        const startedAt = new Date().toISOString();
        const syncType = "recalculate_order_costs";

        let ordersChecked = 0;
        let ordersUpdated = 0;
        let orderItemsChecked = 0;
        let orderItemsWithCost = 0;
        let orderItemsMissingCost = 0;
        let ordersWithMissingCosts = 0;
        let totalItemsCostBefore = 0;
        let totalItemsCostAfter = 0;
        let packagingCostsChecked = 0;
        let packagingCostsUpdated = 0;
        let packagingCostsPreservedManual = 0;
        let totalPackagingCostBefore = 0;
        let totalPackagingCostAfter = 0;
        let missingCostsBefore = 0;
        let missingCostsFixed = 0;
        let missingCostsRemaining = 0;
        let cancelledOrdersNormalized = 0;
        let failedCount = 0;
        let lastError: string | null = null;
        const missingCostSamples: Array<{
          order_id: string;
          sku: string | null;
          product_name: string | null;
          variant: string | null;
        }> = [];

        try {
          const costMatcher = await buildInventoryCostMatcher(supabaseAdmin);

          // Load all orders.
          const orders: OrderRow[] = [];
          const pageSize = 1000;
          let from = 0;
          while (true) {
            const { data, error } = await supabaseAdmin
              .from("orders")
              .select("id,order_status,items_cost,packaging_cost")
              .range(from, from + pageSize - 1);
            if (error) throw new Error(`orders lookup failed: ${error.message}`);
            const rows = (data ?? []) as OrderRow[];
            orders.push(...rows);
            if (rows.length < pageSize) break;
            from += pageSize;
          }
          ordersChecked = orders.length;
          const orderIds = orders.map((o) => o.id);
          const ordersById = new Map(orders.map((order) => [order.id, order]));

          // Sum order_items by order_id.
          const sumByOrder = new Map<string, number>();
          const itemsByOrder = new Map<string, ItemRow[]>();
          for (let i = 0; i < orderIds.length; i += 200) {
            const slice = orderIds.slice(i, i + 200);
            const { data, error } = await supabaseAdmin
              .from("order_items")
              .select(
                "id,order_id,sku,product_name,variant,inventory_item_id,shopify_variant_id,shopify_product_id,quantity,unit_cost",
              )
              .in("order_id", slice);

            let rows = (data ?? []) as unknown as ItemRow[];
            if (error) {
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
              rows = (fallback.data ?? []) as ItemRow[];
            }

            for (const it of rows) {
              orderItemsChecked++;
              const qty = Number(it.quantity ?? 0);
              let cost = Number(it.unit_cost ?? 0);
              const parentOrder = ordersById.get(it.order_id);
              const cancelled = isCancelled(parentOrder?.order_status);
              if (cost > 0) {
                orderItemsWithCost++;
              } else if (!cancelled) {
                missingCostsBefore++;
                const match = costMatcher.resolve(it);
                if (match && match.unitCost > 0) {
                  const { error: updateCostError } = await supabaseAdmin
                    .from("order_items")
                    .update({ unit_cost: match.unitCost })
                    .eq("id", it.id);
                  if (updateCostError) {
                    failedCount++;
                    lastError = updateCostError.message;
                  } else {
                    cost = match.unitCost;
                    it.unit_cost = match.unitCost;
                    missingCostsFixed++;
                    orderItemsWithCost++;
                  }
                }
              }

              if (cost <= 0 && !cancelled) {
                orderItemsMissingCost++;
                missingCostsRemaining++;
                if (missingCostSamples.length < 20) {
                  missingCostSamples.push({
                    order_id: it.order_id,
                    sku: it.sku,
                    product_name: it.product_name,
                    variant: it.variant,
                  });
                }
              }
              const line = qty * cost;
              sumByOrder.set(it.order_id, (sumByOrder.get(it.order_id) ?? 0) + line);
              const existing = itemsByOrder.get(it.order_id) ?? [];
              existing.push(it);
              itemsByOrder.set(it.order_id, existing);
            }
          }

          const manualPackagingOrderIds = new Set<string>();
          let activityFrom = 0;
          while (true) {
            const { data, error } = await supabaseAdmin
              .from("order_activity")
              .select("order_id,action,details")
              .range(activityFrom, activityFrom + pageSize - 1);
            if (error) throw new Error(`order_activity lookup failed: ${error.message}`);
            const rows = (data ?? []) as ActivityRow[];
            for (const row of rows) {
              if (row.order_id && activityTouchesPackagingCost(row.action, row.details)) {
                manualPackagingOrderIds.add(row.order_id);
              }
            }
            if (rows.length < pageSize) break;
            activityFrom += pageSize;
          }

          // Update orders where items_cost or non-manual packaging_cost differs.
          // profit/net_profit are generated columns and refresh automatically.
          for (const o of orders) {
            const before = Number(o.items_cost ?? 0);
            const cancelled = isCancelled(o.order_status);
            const after = cancelled ? 0 : Number((sumByOrder.get(o.id) ?? 0).toFixed(2));
            const packagingBefore = Number(o.packaging_cost ?? 0);
            const packagingManual = manualPackagingOrderIds.has(o.id);
            const orderHasMissingCost =
              (itemsByOrder.get(o.id) ?? []).some((item) => Number(item.unit_cost ?? 0) <= 0) &&
              !cancelled;
            if (orderHasMissingCost) ordersWithMissingCosts++;
            const calculatedPackaging = Number(
              calculatePackagingCost(itemsByOrder.get(o.id) ?? []).toFixed(2),
            );
            const packagingAfter = cancelled
              ? packagingBefore
              : packagingManual
                ? packagingBefore
                : calculatedPackaging;
            totalItemsCostBefore += before;
            totalItemsCostAfter += after;
            totalPackagingCostBefore += packagingBefore;
            totalPackagingCostAfter += packagingAfter;
            packagingCostsChecked++;
            if (packagingManual) packagingCostsPreservedManual++;

            const itemsChanged = Math.abs(before - after) >= 0.005;
            const packagingChanged =
              !packagingManual && Math.abs(packagingBefore - packagingAfter) >= 0.005;
            if (!itemsChanged && !packagingChanged) continue;

            const { error } = await supabaseAdmin
              .from("orders")
              .update({
                items_cost: after,
                ...(packagingChanged ? { packaging_cost: packagingAfter } : {}),
              })
              .eq("id", o.id);
            if (error) {
              failedCount++;
              lastError = error.message;
            } else {
              ordersUpdated++;
              if (packagingChanged) packagingCostsUpdated++;
              if (cancelled && itemsChanged) cancelledOrdersNormalized++;
            }
          }

          const finishedAt = new Date().toISOString();
          await saveShopifySyncRun(supabaseAdmin, {
            syncType,
            status: failedCount > 0 ? "partial" : "success",
            startedAt,
            finishedAt,
            recordsProcessed: ordersChecked,
            updatedCount: ordersUpdated,
            failedCount,
            pagesFetched: 0,
            errorMessage: lastError,
            metadata: {
              order_items_checked: orderItemsChecked,
              order_items_with_cost: orderItemsWithCost,
              order_items_missing_cost: orderItemsMissingCost,
              missing_costs_before: missingCostsBefore,
              missing_costs_fixed: missingCostsFixed,
              missing_costs_remaining: missingCostsRemaining,
              orders_with_missing_costs: ordersWithMissingCosts,
              missing_cost_samples: missingCostSamples,
              cancelled_orders_normalized: cancelledOrdersNormalized,
              total_items_cost_before: Number(totalItemsCostBefore.toFixed(2)),
              total_items_cost_after: Number(totalItemsCostAfter.toFixed(2)),
              packaging_costs_checked: packagingCostsChecked,
              packaging_costs_updated: packagingCostsUpdated,
              packaging_costs_preserved_manual: packagingCostsPreservedManual,
              total_packaging_cost_before: Number(totalPackagingCostBefore.toFixed(2)),
              total_packaging_cost_after: Number(totalPackagingCostAfter.toFixed(2)),
              packaging_cost_rule:
                "eligible item quantity * 140 EGP; fitted sheet sets with pillowcases are included; standalone pillows, pillowcases, and duvets excluded",
              cost_matcher: {
                inventory_rows_indexed: costMatcher.inventory_rows_indexed,
                shopify_variants_indexed: costMatcher.shopify_variants_indexed,
                shopify_inventory_items_indexed: costMatcher.shopify_inventory_items_indexed,
              },
            },
          });

          return Response.json({
            status: failedCount > 0 ? "partial" : "success",
            orders_checked: ordersChecked,
            orders_updated: ordersUpdated,
            order_items_checked: orderItemsChecked,
            order_items_with_cost: orderItemsWithCost,
            order_items_missing_cost: orderItemsMissingCost,
            missing_costs_before: missingCostsBefore,
            missing_costs_fixed: missingCostsFixed,
            missing_costs_remaining: missingCostsRemaining,
            orders_with_missing_costs: ordersWithMissingCosts,
            missing_cost_samples: missingCostSamples,
            cancelled_orders_normalized: cancelledOrdersNormalized,
            total_items_cost_before: Number(totalItemsCostBefore.toFixed(2)),
            total_items_cost_after: Number(totalItemsCostAfter.toFixed(2)),
            packaging_costs_checked: packagingCostsChecked,
            packaging_costs_updated: packagingCostsUpdated,
            packaging_costs_preserved_manual: packagingCostsPreservedManual,
            total_packaging_cost_before: Number(totalPackagingCostBefore.toFixed(2)),
            total_packaging_cost_after: Number(totalPackagingCostAfter.toFixed(2)),
            failed_count: failedCount,
            error: lastError,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await saveShopifySyncRun(supabaseAdmin, {
            syncType,
            status: "error",
            startedAt,
            finishedAt: new Date().toISOString(),
            recordsProcessed: ordersChecked,
            updatedCount: ordersUpdated,
            failedCount: failedCount + 1,
            pagesFetched: 0,
            errorMessage: message,
            metadata: {
              order_items_checked: orderItemsChecked,
              order_items_with_cost: orderItemsWithCost,
              order_items_missing_cost: orderItemsMissingCost,
              missing_costs_before: missingCostsBefore,
              missing_costs_fixed: missingCostsFixed,
              missing_costs_remaining: missingCostsRemaining,
              orders_with_missing_costs: ordersWithMissingCosts,
              missing_cost_samples: missingCostSamples,
              cancelled_orders_normalized: cancelledOrdersNormalized,
              packaging_costs_checked: packagingCostsChecked,
              packaging_costs_updated: packagingCostsUpdated,
              packaging_costs_preserved_manual: packagingCostsPreservedManual,
            },
          });
          return Response.json({ status: "error", error: message }, { status: 500 });
        }
      },
    },
  },
});
