import { createFileRoute } from "@tanstack/react-router";
import { requireOpsUser, saveShopifySyncRun } from "@/lib/shopify-sync.server";

type OrderRow = { id: string; items_cost: number | null };
type ItemRow = {
  order_id: string;
  quantity: number | null;
  unit_cost: number | null;
};

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
        let totalItemsCostBefore = 0;
        let totalItemsCostAfter = 0;
        let failedCount = 0;
        let lastError: string | null = null;

        try {
          // Load all orders.
          const orders: OrderRow[] = [];
          const pageSize = 1000;
          let from = 0;
          while (true) {
            const { data, error } = await supabaseAdmin
              .from("orders")
              .select("id,items_cost")
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
          for (let i = 0; i < orderIds.length; i += 200) {
            const slice = orderIds.slice(i, i + 200);
            const { data, error } = await supabaseAdmin
              .from("order_items")
              .select("order_id,quantity,unit_cost")
              .in("order_id", slice);
            if (error)
              throw new Error(`order_items lookup failed: ${error.message}`);
            for (const it of (data ?? []) as ItemRow[]) {
              orderItemsChecked++;
              const qty = Number(it.quantity ?? 0);
              const cost = Number(it.unit_cost ?? 0);
              if (cost > 0) orderItemsWithCost++;
              else orderItemsMissingCost++;
              const line = qty * cost;
              sumByOrder.set(
                it.order_id,
                (sumByOrder.get(it.order_id) ?? 0) + line,
              );
            }
          }

          // Update orders where items_cost differs. profit/net_profit are
          // generated columns and refresh automatically.
          for (const o of orders) {
            const before = Number(o.items_cost ?? 0);
            const after = Number((sumByOrder.get(o.id) ?? 0).toFixed(2));
            totalItemsCostBefore += before;
            totalItemsCostAfter += after;
            if (Math.abs(before - after) < 0.005) continue;
            const { error } = await supabaseAdmin
              .from("orders")
              .update({ items_cost: after })
              .eq("id", o.id);
            if (error) {
              failedCount++;
              lastError = error.message;
            } else {
              ordersUpdated++;
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
              total_items_cost_before: Number(totalItemsCostBefore.toFixed(2)),
              total_items_cost_after: Number(totalItemsCostAfter.toFixed(2)),
            },
          });

          return Response.json({
            status: failedCount > 0 ? "partial" : "success",
            orders_checked: ordersChecked,
            orders_updated: ordersUpdated,
            order_items_checked: orderItemsChecked,
            order_items_with_cost: orderItemsWithCost,
            order_items_missing_cost: orderItemsMissingCost,
            total_items_cost_before: Number(totalItemsCostBefore.toFixed(2)),
            total_items_cost_after: Number(totalItemsCostAfter.toFixed(2)),
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
