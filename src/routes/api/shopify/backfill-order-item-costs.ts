import { createFileRoute } from "@tanstack/react-router";
import { requireOpsUser, saveShopifySyncRun } from "@/lib/shopify-sync.server";

type OrderItemRow = {
  id: string;
  order_id: string;
  sku: string | null;
  quantity: number | null;
  unit_cost: number | null;
};

type VariantRow = {
  shopify_variant_id: string;
  sku: string | null;
  inventory_item_id: string | null;
};

type InventoryCostRow = {
  inventory_item_id: string;
  unit_cost_amount: number | null;
  unit_cost_currency_code: string | null;
};

const SHOPIFY_VARIANT_SKU_RE = /^shopify-variant-(\d+)$/i;

function variantIdFromSku(sku: string | null) {
  if (!sku) return null;
  const m = sku.match(SHOPIFY_VARIANT_SKU_RE);
  return m ? m[1] : null;
}

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
        let orderItemsMissingVariantMatch = 0;
        let orderItemsMissingInventoryCost = 0;
        let failedCount = 0;
        let lastError: string | null = null;

        try {
          // 1. Load shopify-imported orders (only those with a shopify_order_id).
          const orderIds: string[] = [];
          const pageSize = 1000;
          let from = 0;
          while (true) {
            const { data, error } = await supabaseAdmin
              .from("orders")
              .select("id")
              .not("shopify_order_id", "is", null)
              .range(from, from + pageSize - 1);
            if (error) throw new Error(`orders lookup failed: ${error.message}`);
            const rows = (data ?? []) as { id: string }[];
            orderIds.push(...rows.map((r) => r.id));
            if (rows.length < pageSize) break;
            from += pageSize;
          }

          if (orderIds.length === 0) {
            const finishedAt = new Date().toISOString();
            await saveShopifySyncRun(supabaseAdmin, {
              syncType,
              status: "success",
              startedAt,
              finishedAt,
              recordsProcessed: 0,
              updatedCount: 0,
              failedCount: 0,
              pagesFetched: 0,
              metadata: {
                order_items_checked: 0,
                order_items_updated: 0,
                order_items_already_had_cost: 0,
                order_items_missing_variant_match: 0,
                order_items_missing_inventory_cost: 0,
                failed_count: 0,
                shopify_write_calls: false,
                source: "local shopify_variants + shopify_inventory_items",
              },
            });
            return Response.json({
              status: "success",
              order_items_checked: 0,
              order_items_updated: 0,
              order_items_already_had_cost: 0,
              order_items_missing_variant_match: 0,
              order_items_missing_inventory_cost: 0,
              failed_count: 0,
              started_at: startedAt,
              finished_at: finishedAt,
            });
          }

          // 2. Load order_items in chunks (by order_id IN ...).
          const items: OrderItemRow[] = [];
          for (let i = 0; i < orderIds.length; i += 200) {
            const slice = orderIds.slice(i, i + 200);
            const { data, error } = await supabaseAdmin
              .from("order_items")
              .select("id,order_id,sku,quantity,unit_cost")
              .in("order_id", slice);
            if (error) throw new Error(`order_items lookup failed: ${error.message}`);
            items.push(...((data ?? []) as OrderItemRow[]));
          }
          orderItemsChecked = items.length;

          // 3. Collect candidate variant ids and SKUs for matching.
          const variantIdsToFetch = new Set<string>();
          const skusToFetch = new Set<string>();
          for (const it of items) {
            const vid = variantIdFromSku(it.sku);
            if (vid) variantIdsToFetch.add(vid);
            else if (it.sku) skusToFetch.add(it.sku);
          }

          // 4. Load variants by shopify_variant_id and sku.
          const variantsByVariantId = new Map<string, VariantRow>();
          const variantsBySku = new Map<string, VariantRow>();

          const variantIdArr = [...variantIdsToFetch];
          for (let i = 0; i < variantIdArr.length; i += 500) {
            const slice = variantIdArr.slice(i, i + 500);
            const { data, error } = await supabaseAdmin
              .from("shopify_variants")
              .select("shopify_variant_id,sku,inventory_item_id")
              .in("shopify_variant_id", slice);
            if (error) throw new Error(`shopify_variants by id lookup failed: ${error.message}`);
            for (const v of (data ?? []) as VariantRow[]) {
              variantsByVariantId.set(v.shopify_variant_id, v);
              if (v.sku) variantsBySku.set(v.sku, v);
            }
          }

          const skuArr = [...skusToFetch];
          for (let i = 0; i < skuArr.length; i += 500) {
            const slice = skuArr.slice(i, i + 500);
            const { data, error } = await supabaseAdmin
              .from("shopify_variants")
              .select("shopify_variant_id,sku,inventory_item_id")
              .in("sku", slice);
            if (error) throw new Error(`shopify_variants by sku lookup failed: ${error.message}`);
            for (const v of (data ?? []) as VariantRow[]) {
              if (v.sku && !variantsBySku.has(v.sku)) variantsBySku.set(v.sku, v);
            }
          }

          // 5. Load inventory item costs for needed inventory_item_ids.
          const inventoryItemIds = new Set<string>();
          for (const v of variantsByVariantId.values()) {
            if (v.inventory_item_id) inventoryItemIds.add(v.inventory_item_id);
          }
          for (const v of variantsBySku.values()) {
            if (v.inventory_item_id) inventoryItemIds.add(v.inventory_item_id);
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

          // 6. Decide updates. Only update zero/null unit_cost (no manual-override
          //    column exists; the safe rule per spec is leave non-zero values alone).
          type Update = { id: string; unit_cost: number };
          const updates: Update[] = [];

          for (const it of items) {
            const currentCost = Number(it.unit_cost ?? 0);
            if (currentCost > 0) {
              orderItemsAlreadyHadCost++;
              continue;
            }

            const vid = variantIdFromSku(it.sku);
            let variant: VariantRow | undefined;
            if (vid) variant = variantsByVariantId.get(vid);
            if (!variant && it.sku) variant = variantsBySku.get(it.sku);

            if (!variant || !variant.inventory_item_id) {
              orderItemsMissingVariantMatch++;
              continue;
            }

            const cost = costByInventoryItemId.get(variant.inventory_item_id);
            const amount =
              cost?.unit_cost_amount != null ? Number(cost.unit_cost_amount) : null;
            if (amount == null || !Number.isFinite(amount) || amount <= 0) {
              orderItemsMissingInventoryCost++;
              continue;
            }

            updates.push({ id: it.id, unit_cost: amount });
          }

          // 7. Apply updates one-by-one (chunked) — only writing unit_cost.
          //    total_cost is a generated column; order totals are NOT touched.
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

          const finishedAt = new Date().toISOString();
          const status = failedCount === 0 ? "success" : "partial";

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
            metadata: {
              order_items_checked: orderItemsChecked,
              order_items_updated: orderItemsUpdated,
              order_items_already_had_cost: orderItemsAlreadyHadCost,
              order_items_missing_variant_match: orderItemsMissingVariantMatch,
              order_items_missing_inventory_cost: orderItemsMissingInventoryCost,
              failed_count: failedCount,
              orders_considered: orderIds.length,
              shopify_write_calls: false,
              source: "local shopify_variants + shopify_inventory_items",
              match_rules: "shopify-variant-{id} SKU → variant_id; otherwise SKU → variant",
              updates_only_zero_or_null_unit_cost: true,
              touched_order_totals: false,
            },
          });

          return Response.json({
            status,
            order_items_checked: orderItemsChecked,
            order_items_updated: orderItemsUpdated,
            order_items_already_had_cost: orderItemsAlreadyHadCost,
            order_items_missing_variant_match: orderItemsMissingVariantMatch,
            order_items_missing_inventory_cost: orderItemsMissingInventoryCost,
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
                order_items_missing_variant_match: orderItemsMissingVariantMatch,
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
              order_items_missing_variant_match: orderItemsMissingVariantMatch,
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
