import { createFileRoute } from "@tanstack/react-router";
import { requireOpsUser, saveShopifySyncRun } from "@/lib/shopify-sync.server";
import { calculatePackagingCost } from "@/lib/packaging-cost";

type OrderRow = {
  id: string;
  items_cost: number | null;
  packaging_cost: number | null;
};
type ItemRow = {
  order_id: string;
  sku: string | null;
  product_name: string | null;
  variant: string | null;
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
  return (
    "packaging_cost" in details ||
    "new_packaging_cost" in details
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
        let failedCount = 0;
        let lastError: string | null = null;
        const missingCostSamples: Array<{
          order_id: string;
          sku: string | null;
          product_name: string | null;
          variant: string | null;
        }> = [];

        try {
          // Load all orders.
          const orders: OrderRow[] = [];
          const pageSize = 1000;
          let from = 0;
          while (true) {
            const { data, error } = await supabaseAdmin
              .from("orders")
              .select("id,items_cost,packaging_cost")
              .range(from, from + pageSize - 1);
            if (error) throw new Error(`orders lookup failed: ${error.message}`);
            const rows = (data ?? []) as OrderRow[];
            orders.push(...rows);
            if (rows.length < pageSize) break;
            from += pageSize;
          }
          ordersChecked = orders.length;
          const orderIds = orders.map((o) => o.id);

          // Sum order_items by order_id.
          const sumByOrder = new Map<string, number>();
          const itemsByOrder = new Map<string, ItemRow[]>();
          for (let i = 0; i < orderIds.length; i += 200) {
            const slice = orderIds.slice(i, i + 200);
            const { data, error } = await supabaseAdmin
              .from("order_items")
              .select("order_id,sku,product_name,variant,quantity,unit_cost")
              .in("order_id", slice);
            if (error)
              throw new Error(`order_items lookup failed: ${error.message}`);
            for (const it of (data ?? []) as ItemRow[]) {
              orderItemsChecked++;
              const qty = Number(it.quantity ?? 0);
              const cost = Number(it.unit_cost ?? 0);
              if (cost > 0) orderItemsWithCost++;
              else {
                orderItemsMissingCost++;
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
              sumByOrder.set(
                it.order_id,
                (sumByOrder.get(it.order_id) ?? 0) + line,
              );
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
            const after = Number((sumByOrder.get(o.id) ?? 0).toFixed(2));
            const packagingBefore = Number(o.packaging_cost ?? 0);
            const packagingManual = manualPackagingOrderIds.has(o.id);
            const orderHasMissingCost = (itemsByOrder.get(o.id) ?? []).some(
              (item) => Number(item.unit_cost ?? 0) <= 0,
            );
            if (orderHasMissingCost) ordersWithMissingCosts++;
            const calculatedPackaging = Number(
              calculatePackagingCost(itemsByOrder.get(o.id) ?? []).toFixed(2),
            );
            const packagingAfter = packagingManual ? packagingBefore : calculatedPackaging;
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
              orders_with_missing_costs: ordersWithMissingCosts,
              missing_cost_samples: missingCostSamples,
              total_items_cost_before: Number(totalItemsCostBefore.toFixed(2)),
              total_items_cost_after: Number(totalItemsCostAfter.toFixed(2)),
              packaging_costs_checked: packagingCostsChecked,
              packaging_costs_updated: packagingCostsUpdated,
              packaging_costs_preserved_manual: packagingCostsPreservedManual,
              total_packaging_cost_before: Number(totalPackagingCostBefore.toFixed(2)),
              total_packaging_cost_after: Number(totalPackagingCostAfter.toFixed(2)),
              packaging_cost_rule:
                "eligible item quantity * 140 EGP; fitted sheet sets with pillowcases are included; standalone pillows, pillowcases, and duvets excluded",
            },
          });

          return Response.json({
            status: failedCount > 0 ? "partial" : "success",
            orders_checked: ordersChecked,
            orders_updated: ordersUpdated,
            order_items_checked: orderItemsChecked,
            order_items_with_cost: orderItemsWithCost,
            order_items_missing_cost: orderItemsMissingCost,
            orders_with_missing_costs: ordersWithMissingCosts,
            missing_cost_samples: missingCostSamples,
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
              orders_with_missing_costs: ordersWithMissingCosts,
              missing_cost_samples: missingCostSamples,
              packaging_costs_checked: packagingCostsChecked,
              packaging_costs_updated: packagingCostsUpdated,
              packaging_costs_preserved_manual: packagingCostsPreservedManual,
            },
          });
          return Response.json(
            { status: "error", error: message },
            { status: 500 },
          );
        }
      },
    },
  },
});
