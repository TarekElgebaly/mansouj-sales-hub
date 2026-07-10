import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUser } from "@/hooks/use-user";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { egp, fmtDateTime } from "@/lib/format";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Package,
  RefreshCw,
  ShoppingBag,
  TestTube2,
  Trash2,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";
import { SkuRemapSection } from "@/components/shopify/sku-remap-section";
import { UnmatchedSkuReportSection } from "@/components/shopify/unmatched-sku-report-section";
import { AutoRemapSection } from "@/components/shopify/auto-remap-section";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/shopify")({
  head: () => ({ meta: [{ title: "Shopify Sync Status — Mansouj" }] }),
  component: ShopifyPage,
});

type ShopifySyncRun = {
  id: string;
  sync_type: string;
  status: string;
  started_at: string;
  finished_at?: string | null;
  records_processed: number;
  created_count: number;
  updated_count: number;
  failed_count: number;
  pages_fetched: number;
  error_message?: string | null;
};

type ShopifySyncStatus = {
  api_version?: string;
  shop_domain?: string | null;
  configured_shop_domain?: string | null;
  installed_shop_domain?: string | null;
  domain_mismatch?: boolean;
  install_status?: string | null;
  token_stored?: boolean | null;
  installed_at?: string | null;
  last_sync_at?: string | null;
  last_sync_mode?: string | null;
  last_sync_status?: string | null;
  last_successful_orders_sync_at?: string | null;
  last_orders_sync_cursor?: string | null;
  last_orders_imported?: number | null;
  last_orders_updated?: number | null;
  last_connection_test_at?: string | null;
  last_connection_test_status?: string | null;
  last_error?: string | null;
  last_connection_test_error?: string | null;
  last_run?: ShopifySyncRun | null;
  recent_runs?: ShopifySyncRun[] | null;
  updated_at?: string | null;
};

type LocalOrdersResetResult = {
  deleted_orders_count: number;
  deleted_order_items_count: number;
  deleted_order_notes_count: number;
  deleted_order_activity_count: number;
  cursor_reset: boolean;
};

type ResetSync2026Result = {
  current_local_orders_count: number;
  current_local_order_items_count: number;
  deleted_orders_count: number;
  deleted_order_items_count: number;
  deleted_order_notes_count: number;
  deleted_order_activity_count: number;
  records_processed: number;
  created_count: number;
  updated_count: number;
  failed_count: number;
  pages_fetched: number;
  first_order_number_imported: string | null;
  last_order_number_imported: string | null;
};

type RepairMissingLineItemsResult = {
  orders_checked: number;
  missing_orders_found: number;
  repaired_orders: number;
  line_items_inserted: number;
  line_items_with_cost: number;
  line_items_missing_cost: number;
  schema_fallbacks_used: number;
  failed_count: number;
  repaired: Array<{ order_number: string | null; line_items_inserted: number }>;
  errors: string[];
};

type ProductSyncResult = {
  status?: string;
  message?: string | null;
  products_processed: number;
  products_created: number;
  products_updated: number;
  variants_processed: number;
  variants_created: number;
  variants_updated: number;
  failed_count: number;
  pages_fetched: number;
  shop_domain_used?: string | null;
  api_version_used?: string | null;
  api_method_used?: string | null;
  first_api_response_product_count?: number | null;
  stopped_reason?: string | null;
  raw_shopify_response_shape_summary?: {
    response_keys?: string[];
    products_is_array?: boolean;
    products_count?: number | null;
    first_product_keys?: string[];
  } | null;
};

type InventoryCostSyncResult = {
  inventory_items_processed: number;
  inventory_items_with_cost: number;
  inventory_items_missing_cost: number;
  locations_processed: number;
  inventory_levels_processed: number;
  inventory_levels_with_on_hand: number;
  inventory_levels_missing_on_hand: number;
  on_hand_quantity_source?: string | null;
  on_hand_fallback_used?: boolean;
  variant_on_hand_quantities_processed: number;
  variant_on_hand_quantities_updated: number;
  variant_on_hand_quantity_fallbacks: number;
  failed_count: number;
  pages_fetched: number;
};

type InventorySourceRefreshResult = {
  status: string;
  variants_processed: number;
  inventory_rows_created: number;
  inventory_rows_updated: number;
  stale_rows_marked: number;
  duplicate_shopify_skus_found: number;
  missing_cost_count: number;
  missing_price_count: number;
  missing_on_hand_count: number;
  last_synced_at?: string | null;
  source: string;
  sku_remaps_used: boolean;
  shopify_write_calls: boolean;
};

type InventoryReconciliationRow = {
  product_title: string;
  variant_title: string | null;
  sku: string;
  shopify_variant_id: string;
  inventory_item_id: string | null;
  shopify_quantity: number;
  mansouj_quantity: number | null;
  difference: number;
  shopify_cost: number;
  mansouj_cost: number | null;
  shopify_price: number;
  mansouj_price: number | null;
  product_status: string | null;
  reason: string;
};

type InventoryReconciliationResult = {
  product_status: string;
  on_hand_missing_count: number;
  shopify_total_skus: number;
  mansouj_local_total_skus: number;
  shopify_on_hand_quantity: number;
  mansouj_on_hand_quantity: number;
  difference_quantity: number;
  shopify_inventory_cost_value: number;
  mansouj_inventory_cost_value: number;
  difference_cost_value: number;
  shopify_retail_value: number;
  mansouj_retail_value: number;
  difference_retail_value: number;
  mismatches_count: number;
  mismatches: InventoryReconciliationRow[];
};

type DailyInventorySyncResult = {
  products_processed: number;
  variants_processed: number;
  inventory_items_processed: number;
  rows_created: number;
  rows_updated: number;
  rows_marked_stale: number;
  duplicate_shopify_skus_found: number;
  missing_cost_count: number;
  missing_price_count: number;
  failed_count: number;
  last_synced_at: string;
  sn29: {
    on_hand: number | null;
    available: number | null;
    committed: number | null;
  } | null;
  satDu400Wh220: {
    active_rows: number;
    on_hand: number | null;
    cost: number | null;
    total_cost: number | null;
  } | null;
};

type UnmatchedSample = {
  order_number: string | null;
  order_item_title: string | null;
  variant: string | null;
  sku: string | null;
  shopify_variant_id: string | null;
  reason: string;
};

type UnmatchedSkuReportRow = {
  old_sku: string | null;
  item_title: string | null;
  variant: string | null;
  count: number;
  reason: string;
  example_order_numbers: string[];
};

type BackfillCostResult = {
  status: string;
  order_items_checked: number;
  order_items_updated: number;
  order_items_already_had_cost: number;
  order_items_missing_variant_match: number;
  order_items_missing_inventory_cost: number;
  matched_by_variant_id: number;
  matched_by_sku: number;
  matched_by_sku_normalized: number;
  matched_by_remap_variant_id: number;
  matched_by_remap_sku: number;
  remap_matches_count: number;
  remaining_unmatched: number;
  matched_by_barcode: number;
  matched_by_title_exact: number;
  mismatch_reasons: Record<string, number>;
  unmatched_samples: UnmatchedSample[];
  unmatched_sku_report: UnmatchedSkuReportRow[];
  failed_count: number;
};

type ForceUpdateCostResult = {
  status: string;
  items_checked: number;
  items_updated: number;
  items_skipped: number;
  missing_cost: number;
  missing_match: number;
  orders_recalculated: number;
  total_cost_before: number;
  total_cost_after: number;
  failed_count: number;
  match_counts: Record<string, number>;
  mismatch_reasons: Record<string, number>;
};

type RefreshOrderItemProductDataResult = {
  status: string;
  items_checked: number;
  items_updated: number;
  items_skipped: number;
  missing_match: number;
  failed_count: number;
  match_counts: Record<string, number>;
  mismatch_reasons: Record<string, number>;
};

const RESET_CONFIRMATION_MESSAGE =
  "This will delete ALL orders from Mansouj Sales Hub only. It will NOT delete anything from Shopify. Continue?";
const RESET_SYNC_2026_CONFIRMATION_MESSAGE =
  "This will delete ALL local orders from Mansouj Sales Hub and then import only Shopify orders created in 2026. It will NOT delete anything from Shopify. Continue?";
const FORCE_UPDATE_COSTS_CONFIRMATION_MESSAGE =
  "This will overwrite existing local order item costs with the latest synced Shopify costs. It will NOT change Shopify, selling price, shipping cost, packaging cost, statuses, notes, or customer data. Continue?";
const REFRESH_PRODUCT_DATA_CONFIRMATION_MESSAGE =
  "This will refresh local order item SKU, product title, variant title, barcode, and product type from the latest synced Shopify product data. It will NOT change quantities, selling prices, costs, shipping, packaging, statuses, notes, or Shopify data. Continue?";

function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportUnmatchedSkuReportCsv(rows: UnmatchedSkuReportRow[]) {
  const header = ["old_sku", "item_title", "variant", "count", "example_order_numbers", "reason"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvEscape(r.old_sku),
        csvEscape(r.item_title),
        csvEscape(r.variant),
        csvEscape(r.count),
        csvEscape(r.example_order_numbers.join(" | ")),
        csvEscape(r.reason),
      ].join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `unmatched-sku-report-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ShopifyPage() {
  const qc = useQueryClient();
  const { canAdmin, canOps } = useUser();
  const [testing, setTesting] = useState(false);
  const [syncingRecent, setSyncingRecent] = useState(false);
  const [syncingBackfill, setSyncingBackfill] = useState(false);
  const [syncingProducts, setSyncingProducts] = useState(false);
  const [syncingInventoryCost, setSyncingInventoryCost] = useState(false);
  const [refreshingInventorySource, setRefreshingInventorySource] = useState(false);
  const [reconcilingInventory, setReconcilingInventory] = useState(false);
  const [syncingDailyInventory, setSyncingDailyInventory] = useState(false);
  const [resettingOrders, setResettingOrders] = useState(false);
  const [resetSyncing2026, setResetSyncing2026] = useState(false);
  const [repairingMissingLineItems, setRepairingMissingLineItems] = useState(false);
  const [resetResult, setResetResult] = useState<LocalOrdersResetResult | null>(null);
  const [resetSync2026Result, setResetSync2026Result] = useState<ResetSync2026Result | null>(null);
  const [repairMissingLineItemsResult, setRepairMissingLineItemsResult] =
    useState<RepairMissingLineItemsResult | null>(null);
  const [productSyncResult, setProductSyncResult] = useState<ProductSyncResult | null>(null);
  const [inventoryCostSyncResult, setInventoryCostSyncResult] =
    useState<InventoryCostSyncResult | null>(null);
  const [inventorySourceRefreshResult, setInventorySourceRefreshResult] =
    useState<InventorySourceRefreshResult | null>(null);
  const [inventoryReconciliationResult, setInventoryReconciliationResult] =
    useState<InventoryReconciliationResult | null>(null);
  const [dailyInventorySyncResult, setDailyInventorySyncResult] =
    useState<DailyInventorySyncResult | null>(null);
  const [productSyncError, setProductSyncError] = useState<string | null>(null);
  const [inventoryCostSyncError, setInventoryCostSyncError] = useState<string | null>(null);
  const [inventorySourceRefreshError, setInventorySourceRefreshError] = useState<string | null>(
    null,
  );
  const [inventoryReconciliationError, setInventoryReconciliationError] = useState<string | null>(
    null,
  );
  const [dailyInventorySyncError, setDailyInventorySyncError] = useState<string | null>(null);
  const [backfillingCosts, setBackfillingCosts] = useState(false);
  const [backfillResult, setBackfillResult] = useState<BackfillCostResult | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [forcingCostUpdate, setForcingCostUpdate] = useState(false);
  const [forceCostResult, setForceCostResult] = useState<ForceUpdateCostResult | null>(null);
  const [forceCostError, setForceCostError] = useState<string | null>(null);
  const [refreshingProductData, setRefreshingProductData] = useState(false);
  const [refreshProductDataResult, setRefreshProductDataResult] =
    useState<RefreshOrderItemProductDataResult | null>(null);
  const [refreshProductDataError, setRefreshProductDataError] = useState<string | null>(null);
  const [recalcingOrderCosts, setRecalcingOrderCosts] = useState(false);
  const [recalcResult, setRecalcResult] = useState<{
    orders_checked: number;
    orders_updated: number;
    order_items_checked: number;
    order_items_with_cost: number;
    order_items_missing_cost: number;
    orders_with_missing_costs: number;
    total_items_cost_before: number;
    total_items_cost_after: number;
    packaging_costs_checked: number;
    packaging_costs_updated: number;
    packaging_costs_preserved_manual: number;
    total_packaging_cost_before: number;
    total_packaging_cost_after: number;
    failed_count: number;
  } | null>(null);
  const [recalcError, setRecalcError] = useState<string | null>(null);
  const [ordersSyncResult, setOrdersSyncResult] = useState<{
    mode: string;
    created: number;
    updated: number;
    failed: number;
    order_items_processed: number;
    order_items_with_cost: number;
    order_items_missing_cost: number;
    order_items_cost_assigned_by_variant_id: number;
    order_items_cost_assigned_by_sku: number;
    order_items_cost_assigned_by_sku_normalized: number;
    order_items_cost_assigned_by_remap: number;
    order_items_cost_preserved: number;
    affected_orders_recalculated: number;
    total_items_cost_after_recalc: number;
  } | null>(null);

  const authHeader = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Please sign in again before using Shopify controls.");
    return { Authorization: `Bearer ${token}` };
  };

  const { data: settings, isLoading } = useQuery({
    queryKey: ["shopify-settings"],
    queryFn: async () => {
      const res = await fetch("/api/shopify/sync-status", {
        headers: await authHeader(),
      });
      if (!res.ok) throw new Error("Could not load Shopify sync status.");
      return (await res.json()) as ShopifySyncStatus;
    },
    refetchInterval: 15000,
  });

  const syncStatus = settings?.last_sync_status ?? "idle";
  const rawConnectionStatus = settings?.install_status ?? "not_connected";
  const connectionStatus =
    settings?.last_connection_test_status === "success" &&
    (rawConnectionStatus === "connected_missing_scopes" ||
      rawConnectionStatus === "manual_token_missing_scopes" ||
      rawConnectionStatus === "manual_token_connected")
      ? "connected"
      : rawConnectionStatus;
  const connected = connectionStatus === "connected" || Boolean(settings?.token_stored);
  const connectionOk = connected && settings?.last_connection_test_status === "success";
  const shopDomain = settings?.shop_domain ?? "Not connected";
  const lastProblem = settings?.last_connection_test_error ?? settings?.last_error ?? null;

  const refreshStatus = async () => {
    await qc.invalidateQueries({ queryKey: ["shopify-settings"] });
    await qc.invalidateQueries({ queryKey: ["orders"] });
    await qc.invalidateQueries({ queryKey: ["order-items"] });
    await qc.invalidateQueries({ queryKey: ["orders-all"] });
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/shopify/test-connection", {
        headers: await authHeader(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success)
        throw new Error(json.error ?? "Shopify connection test failed.");
      toast.success("Shopify connection is working.");
      await refreshStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const syncOrders = async (mode: "incremental" | "full_backfill") => {
    if (
      mode === "full_backfill" &&
      !window.confirm("This will import all historical Shopify orders and may take time. Continue?")
    ) {
      return;
    }

    const setBusy = mode === "full_backfill" ? setSyncingBackfill : setSyncingRecent;
    setBusy(true);
    try {
      const res = await fetch("/api/shopify/sync-orders", {
        method: "POST",
        headers: {
          ...(await authHeader()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Shopify orders sync failed.");

      setOrdersSyncResult({
        mode: json.mode ?? mode,
        created: json.created ?? 0,
        updated: json.updated ?? 0,
        failed: json.failed ?? 0,
        order_items_processed: json.order_items_processed ?? 0,
        order_items_with_cost: json.order_items_with_cost ?? 0,
        order_items_missing_cost: json.order_items_missing_cost ?? 0,
        order_items_cost_assigned_by_variant_id: json.order_items_cost_assigned_by_variant_id ?? 0,
        order_items_cost_assigned_by_sku: json.order_items_cost_assigned_by_sku ?? 0,
        order_items_cost_assigned_by_sku_normalized:
          json.order_items_cost_assigned_by_sku_normalized ?? 0,
        order_items_cost_assigned_by_remap: json.order_items_cost_assigned_by_remap ?? 0,
        order_items_cost_preserved: json.order_items_cost_preserved ?? 0,
        affected_orders_recalculated: json.affected_orders_recalculated ?? 0,
        total_items_cost_after_recalc: Number(json.total_items_cost_after_recalc ?? 0),
      });

      const message = `${mode === "full_backfill" ? "Full backfill" : "Recent orders sync"} finished: ${json.created ?? 0} new, ${json.updated ?? 0} updated · items with cost ${json.order_items_with_cost ?? 0}/${json.order_items_processed ?? 0}.`;
      if (json.completion_warning) toast.warning(json.completion_warning);
      else if (json.status === "partial") toast.warning(message);
      else toast.success(message);
      await refreshStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  };

  const repairMissingOrderLineItems = async () => {
    setRepairingMissingLineItems(true);
    setRepairMissingLineItemsResult(null);
    try {
      const res = await fetch("/api/shopify/repair-missing-order-line-items", {
        method: "POST",
        headers: {
          ...(await authHeader()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ limit: 500 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(
          json.error ?? json.errors?.[0] ?? "Could not repair missing order line items.",
        );
      }

      const result: RepairMissingLineItemsResult = {
        orders_checked: json.orders_checked ?? 0,
        missing_orders_found: json.missing_orders_found ?? 0,
        repaired_orders: json.repaired_orders ?? 0,
        line_items_inserted: json.line_items_inserted ?? 0,
        line_items_with_cost: json.line_items_with_cost ?? 0,
        line_items_missing_cost: json.line_items_missing_cost ?? 0,
        schema_fallbacks_used: json.schema_fallbacks_used ?? 0,
        failed_count: json.failed_count ?? 0,
        repaired: json.repaired ?? [],
        errors: json.errors ?? [],
      };
      setRepairMissingLineItemsResult(result);

      if (result.repaired_orders > 0) {
        toast.success(
          `Repaired ${result.repaired_orders} orders and inserted ${result.line_items_inserted} line items.`,
        );
      } else {
        toast.info("No missing order line items found in the checked orders.");
      }

      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["order-items"] });
      await refreshStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRepairingMissingLineItems(false);
    }
  };

  const loadDailyInventoryLocalSummary = async () => {
    const full = await (supabase as any)
      .from("inventory")
      .select(
        "sku,current_inventory,on_hand_quantity,available_quantity,committed_quantity,cost_price,sale_price,shopify_product_status,is_shopify_stale,is_stale",
      );
    const fallback =
      full.error &&
      String(full.error.message ?? "")
        .toLowerCase()
        .includes("column")
        ? await (supabase as any)
            .from("inventory")
            .select(
              "sku,current_inventory,on_hand_quantity,available_quantity,committed_quantity,cost_price,sale_price,shopify_product_status,is_shopify_stale",
            )
        : full;
    if (fallback.error) {
      throw new Error(`Could not load inventory sync examples: ${fallback.error.message}`);
    }

    const rows = ((fallback.data ?? []) as Array<Record<string, unknown>>).filter((row) => {
      const status = String(row.shopify_product_status ?? "")
        .trim()
        .toLowerCase();
      const stale = Boolean(row.is_shopify_stale) || Boolean(row.is_stale);
      return status === "active" && !stale;
    });

    const skuCounts = new Map<string, number>();
    for (const row of rows) {
      const sku = String(row.sku ?? "")
        .trim()
        .toLowerCase();
      if (!sku) continue;
      skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1);
    }

    const bySku = (sku: string) =>
      rows.filter(
        (row) =>
          String(row.sku ?? "")
            .trim()
            .toLowerCase() === sku.toLowerCase(),
      );
    const numberOrNull = (value: unknown) => {
      if (value === null || value === undefined || value === "") return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const first = (matches: Array<Record<string, unknown>>) => matches[0] ?? null;
    const sn29 = first(bySku("SN29"));
    const satRows = bySku("SAT-DU400 - WH220");
    const sat = first(satRows);
    const satOnHand = sat
      ? (numberOrNull(sat.on_hand_quantity) ?? numberOrNull(sat.current_inventory))
      : null;
    const satCost = sat ? numberOrNull(sat.cost_price) : null;

    return {
      duplicate_shopify_skus_found: Array.from(skuCounts.values()).filter((count) => count > 1)
        .length,
      missing_cost_count: rows.filter((row) => Number(row.cost_price ?? 0) <= 0).length,
      missing_price_count: rows.filter((row) => Number(row.sale_price ?? 0) <= 0).length,
      sn29: sn29
        ? {
            on_hand: numberOrNull(sn29.on_hand_quantity) ?? numberOrNull(sn29.current_inventory),
            available: numberOrNull(sn29.available_quantity),
            committed: numberOrNull(sn29.committed_quantity),
          }
        : null,
      satDu400Wh220: sat
        ? {
            active_rows: satRows.length,
            on_hand: satOnHand,
            cost: satCost,
            total_cost: satOnHand != null && satCost != null ? satOnHand * satCost : null,
          }
        : null,
    };
  };

  const syncDailyInventoryFromShopify = async () => {
    setSyncingDailyInventory(true);
    setDailyInventorySyncResult(null);
    setDailyInventorySyncError(null);
    setProductSyncError(null);
    setInventoryCostSyncError(null);
    setInventorySourceRefreshError(null);
    setInventoryReconciliationError(null);

    try {
      const headers = {
        ...(await authHeader()),
        "Content-Type": "application/json",
      };
      const post = async (url: string, body?: unknown) => {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) throw new Error(json.error ?? `${url} failed.`);
        return json;
      };

      const productsJson = await post("/api/shopify/sync-products");
      const productsResult: ProductSyncResult = {
        status: productsJson.status ?? "success",
        message: productsJson.message ?? null,
        products_processed: productsJson.products_processed ?? 0,
        products_created: productsJson.products_created ?? 0,
        products_updated: productsJson.products_updated ?? 0,
        variants_processed: productsJson.variants_processed ?? 0,
        variants_created: productsJson.variants_created ?? 0,
        variants_updated: productsJson.variants_updated ?? 0,
        failed_count: productsJson.failed_count ?? 0,
        pages_fetched: productsJson.pages_fetched ?? 0,
        shop_domain_used: productsJson.shop_domain_used ?? null,
        api_version_used: productsJson.api_version_used ?? null,
        api_method_used: productsJson.api_method_used ?? null,
        first_api_response_product_count: productsJson.first_api_response_product_count ?? null,
        stopped_reason: productsJson.stopped_reason ?? null,
        raw_shopify_response_shape_summary: productsJson.raw_shopify_response_shape_summary ?? null,
      };
      setProductSyncResult(productsResult);

      const inventoryJson = await post("/api/shopify/sync-inventory-cost");
      const inventoryResult: InventoryCostSyncResult = {
        inventory_items_processed: inventoryJson.inventory_items_processed ?? 0,
        inventory_items_with_cost: inventoryJson.inventory_items_with_cost ?? 0,
        inventory_items_missing_cost: inventoryJson.inventory_items_missing_cost ?? 0,
        locations_processed: inventoryJson.locations_processed ?? 0,
        inventory_levels_processed: inventoryJson.inventory_levels_processed ?? 0,
        inventory_levels_with_on_hand: inventoryJson.inventory_levels_with_on_hand ?? 0,
        inventory_levels_missing_on_hand: inventoryJson.inventory_levels_missing_on_hand ?? 0,
        on_hand_quantity_source: inventoryJson.on_hand_quantity_source ?? null,
        on_hand_fallback_used: Boolean(inventoryJson.on_hand_fallback_used),
        variant_on_hand_quantities_processed:
          inventoryJson.variant_on_hand_quantities_processed ?? 0,
        variant_on_hand_quantities_updated: inventoryJson.variant_on_hand_quantities_updated ?? 0,
        variant_on_hand_quantity_fallbacks: inventoryJson.variant_on_hand_quantity_fallbacks ?? 0,
        failed_count: inventoryJson.failed_count ?? 0,
        pages_fetched: inventoryJson.pages_fetched ?? 0,
      };
      setInventoryCostSyncResult(inventoryResult);

      const refreshJson = await post("/api/shopify/refresh-inventory-source-of-truth");
      const refreshResult: InventorySourceRefreshResult = {
        status: refreshJson.status ?? "success",
        variants_processed: refreshJson.variants_processed ?? 0,
        inventory_rows_created: refreshJson.inventory_rows_created ?? 0,
        inventory_rows_updated: refreshJson.inventory_rows_updated ?? 0,
        stale_rows_marked: refreshJson.stale_rows_marked ?? 0,
        duplicate_shopify_skus_found: refreshJson.duplicate_shopify_skus_found ?? 0,
        missing_cost_count: refreshJson.missing_cost_count ?? 0,
        missing_price_count: refreshJson.missing_price_count ?? 0,
        missing_on_hand_count: refreshJson.missing_on_hand_count ?? 0,
        last_synced_at: refreshJson.last_synced_at ?? null,
        source: refreshJson.source ?? "synced_shopify_products_variants_inventory_levels",
        sku_remaps_used: Boolean(refreshJson.sku_remaps_used),
        shopify_write_calls: Boolean(refreshJson.shopify_write_calls),
      };
      setInventorySourceRefreshResult(refreshResult);

      const reconciliationJson = await post("/api/shopify/inventory-reconciliation", {
        product_status: "active",
      });
      const reconciliationResult: InventoryReconciliationResult = {
        product_status: reconciliationJson.product_status ?? "active",
        on_hand_missing_count: reconciliationJson.on_hand_missing_count ?? 0,
        shopify_total_skus: reconciliationJson.shopify_total_skus ?? 0,
        mansouj_local_total_skus: reconciliationJson.mansouj_local_total_skus ?? 0,
        shopify_on_hand_quantity: reconciliationJson.shopify_on_hand_quantity ?? 0,
        mansouj_on_hand_quantity: reconciliationJson.mansouj_on_hand_quantity ?? 0,
        difference_quantity: reconciliationJson.difference_quantity ?? 0,
        shopify_inventory_cost_value: reconciliationJson.shopify_inventory_cost_value ?? 0,
        mansouj_inventory_cost_value: reconciliationJson.mansouj_inventory_cost_value ?? 0,
        difference_cost_value: reconciliationJson.difference_cost_value ?? 0,
        shopify_retail_value: reconciliationJson.shopify_retail_value ?? 0,
        mansouj_retail_value: reconciliationJson.mansouj_retail_value ?? 0,
        difference_retail_value: reconciliationJson.difference_retail_value ?? 0,
        mismatches_count: reconciliationJson.mismatches_count ?? 0,
        mismatches: Array.isArray(reconciliationJson.mismatches)
          ? reconciliationJson.mismatches
          : [],
      };
      setInventoryReconciliationResult(reconciliationResult);

      const localSummary = await loadDailyInventoryLocalSummary();
      const result: DailyInventorySyncResult = {
        products_processed: productsResult.products_processed,
        variants_processed: productsResult.variants_processed,
        inventory_items_processed: inventoryResult.inventory_items_processed,
        rows_created: refreshResult.inventory_rows_created,
        rows_updated: refreshResult.inventory_rows_updated,
        rows_marked_stale: refreshResult.stale_rows_marked,
        duplicate_shopify_skus_found:
          refreshResult.duplicate_shopify_skus_found || localSummary.duplicate_shopify_skus_found,
        missing_cost_count: refreshResult.missing_cost_count || localSummary.missing_cost_count,
        missing_price_count: refreshResult.missing_price_count || localSummary.missing_price_count,
        failed_count:
          productsResult.failed_count +
          inventoryResult.failed_count +
          (reconciliationResult.mismatches_count > 0 ? 0 : 0),
        last_synced_at: refreshResult.last_synced_at ?? new Date().toISOString(),
        sn29: localSummary.sn29,
        satDu400Wh220: localSummary.satDu400Wh220,
      };
      setDailyInventorySyncResult(result);

      if (reconciliationResult.mismatches_count > 0) {
        toast.warning(
          `Inventory sync finished. Reconciliation found ${reconciliationResult.mismatches_count} active mismatches.`,
        );
      } else {
        toast.success("Inventory sync from Shopify finished.");
      }
      await qc.invalidateQueries({ queryKey: ["shopify-settings"] });
      await qc.invalidateQueries({ queryKey: ["shopify-inventory-report"] });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setDailyInventorySyncError(message);
      toast.error(message);
      await qc.invalidateQueries({ queryKey: ["shopify-settings"] });
    } finally {
      setSyncingDailyInventory(false);
    }
  };

  const syncProducts = async () => {
    setSyncingProducts(true);
    setProductSyncResult(null);
    setProductSyncError(null);
    try {
      const res = await fetch("/api/shopify/sync-products", {
        method: "POST",
        headers: {
          ...(await authHeader()),
          "Content-Type": "application/json",
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Shopify products sync failed.");

      const result: ProductSyncResult = {
        status: json.status ?? "success",
        message: json.message ?? null,
        products_processed: json.products_processed ?? 0,
        products_created: json.products_created ?? 0,
        products_updated: json.products_updated ?? 0,
        variants_processed: json.variants_processed ?? 0,
        variants_created: json.variants_created ?? 0,
        variants_updated: json.variants_updated ?? 0,
        failed_count: json.failed_count ?? 0,
        pages_fetched: json.pages_fetched ?? 0,
        shop_domain_used: json.shop_domain_used ?? null,
        api_version_used: json.api_version_used ?? null,
        api_method_used: json.api_method_used ?? null,
        first_api_response_product_count: json.first_api_response_product_count ?? null,
        stopped_reason: json.stopped_reason ?? null,
        raw_shopify_response_shape_summary: json.raw_shopify_response_shape_summary ?? null,
      };
      setProductSyncResult(result);
      if (result.status === "warning" || result.status === "partial") {
        toast.warning(result.message ?? "Products sync finished with a warning.");
      } else {
        toast.success(
          `Products sync finished: ${result.products_processed} products, ${result.variants_processed} variants.`,
        );
      }
      await qc.invalidateQueries({ queryKey: ["shopify-settings"] });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setProductSyncError(message);
      toast.error(message);
      await qc.invalidateQueries({ queryKey: ["shopify-settings"] });
    } finally {
      setSyncingProducts(false);
    }
  };

  const syncInventoryCost = async () => {
    setSyncingInventoryCost(true);
    setInventoryCostSyncResult(null);
    setInventoryCostSyncError(null);
    try {
      const res = await fetch("/api/shopify/sync-inventory-cost", {
        method: "POST",
        headers: {
          ...(await authHeader()),
          "Content-Type": "application/json",
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok)
        throw new Error(json.error ?? "Shopify inventory and cost sync failed.");

      const result: InventoryCostSyncResult = {
        inventory_items_processed: json.inventory_items_processed ?? 0,
        inventory_items_with_cost: json.inventory_items_with_cost ?? 0,
        inventory_items_missing_cost: json.inventory_items_missing_cost ?? 0,
        locations_processed: json.locations_processed ?? 0,
        inventory_levels_processed: json.inventory_levels_processed ?? 0,
        inventory_levels_with_on_hand: json.inventory_levels_with_on_hand ?? 0,
        inventory_levels_missing_on_hand: json.inventory_levels_missing_on_hand ?? 0,
        on_hand_quantity_source: json.on_hand_quantity_source ?? null,
        on_hand_fallback_used: Boolean(json.on_hand_fallback_used),
        variant_on_hand_quantities_processed: json.variant_on_hand_quantities_processed ?? 0,
        variant_on_hand_quantities_updated: json.variant_on_hand_quantities_updated ?? 0,
        variant_on_hand_quantity_fallbacks: json.variant_on_hand_quantity_fallbacks ?? 0,
        failed_count: json.failed_count ?? 0,
        pages_fetched: json.pages_fetched ?? 0,
      };
      setInventoryCostSyncResult(result);
      toast.success(
        `Inventory & cost sync finished: ${result.inventory_items_processed} items, ${result.variant_on_hand_quantities_updated} on-hand quantities updated.`,
      );
      await qc.invalidateQueries({ queryKey: ["shopify-settings"] });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setInventoryCostSyncError(message);
      toast.error(message);
      await qc.invalidateQueries({ queryKey: ["shopify-settings"] });
    } finally {
      setSyncingInventoryCost(false);
    }
  };

  const refreshInventorySourceOfTruth = async () => {
    setRefreshingInventorySource(true);
    setInventorySourceRefreshResult(null);
    setInventorySourceRefreshError(null);
    try {
      const res = await fetch("/api/shopify/refresh-inventory-source-of-truth", {
        method: "POST",
        headers: {
          ...(await authHeader()),
          "Content-Type": "application/json",
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Inventory source-of-truth refresh failed.");
      }

      const result: InventorySourceRefreshResult = {
        status: json.status ?? "success",
        variants_processed: json.variants_processed ?? 0,
        inventory_rows_created: json.inventory_rows_created ?? 0,
        inventory_rows_updated: json.inventory_rows_updated ?? 0,
        stale_rows_marked: json.stale_rows_marked ?? 0,
        duplicate_shopify_skus_found: json.duplicate_shopify_skus_found ?? 0,
        missing_cost_count: json.missing_cost_count ?? 0,
        missing_price_count: json.missing_price_count ?? 0,
        missing_on_hand_count: json.missing_on_hand_count ?? 0,
        last_synced_at: json.last_synced_at ?? null,
        source: json.source ?? "synced_shopify_products_variants_inventory_levels",
        sku_remaps_used: Boolean(json.sku_remaps_used),
        shopify_write_calls: Boolean(json.shopify_write_calls),
      };
      setInventorySourceRefreshResult(result);
      if (result.status === "partial") {
        toast.warning(
          `Inventory refreshed, but ${result.missing_on_hand_count} variants are missing Shopify on-hand quantity.`,
        );
      } else {
        toast.success(
          `Inventory refreshed from Shopify source data: ${result.variants_processed} variants.`,
        );
      }
      await qc.invalidateQueries({ queryKey: ["shopify-settings"] });
      await qc.invalidateQueries({ queryKey: ["shopify-inventory-report"] });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setInventorySourceRefreshError(message);
      toast.error(message);
      await qc.invalidateQueries({ queryKey: ["shopify-settings"] });
    } finally {
      setRefreshingInventorySource(false);
    }
  };

  const runInventoryReconciliation = async () => {
    setReconcilingInventory(true);
    setInventoryReconciliationResult(null);
    setInventoryReconciliationError(null);
    try {
      const res = await fetch("/api/shopify/inventory-reconciliation", {
        method: "POST",
        headers: {
          ...(await authHeader()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ product_status: "active" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Inventory reconciliation failed.");

      const result: InventoryReconciliationResult = {
        product_status: json.product_status ?? "active",
        on_hand_missing_count: json.on_hand_missing_count ?? 0,
        shopify_total_skus: json.shopify_total_skus ?? 0,
        mansouj_local_total_skus: json.mansouj_local_total_skus ?? 0,
        shopify_on_hand_quantity: json.shopify_on_hand_quantity ?? 0,
        mansouj_on_hand_quantity: json.mansouj_on_hand_quantity ?? 0,
        difference_quantity: json.difference_quantity ?? 0,
        shopify_inventory_cost_value: json.shopify_inventory_cost_value ?? 0,
        mansouj_inventory_cost_value: json.mansouj_inventory_cost_value ?? 0,
        difference_cost_value: json.difference_cost_value ?? 0,
        shopify_retail_value: json.shopify_retail_value ?? 0,
        mansouj_retail_value: json.mansouj_retail_value ?? 0,
        difference_retail_value: json.difference_retail_value ?? 0,
        mismatches_count: json.mismatches_count ?? 0,
        mismatches: Array.isArray(json.mismatches) ? json.mismatches : [],
      };
      setInventoryReconciliationResult(result);
      if (result.mismatches_count > 0) {
        toast.warning(`Inventory reconciliation found ${result.mismatches_count} mismatches.`);
      } else {
        toast.success("Inventory reconciliation matched Shopify for active products.");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setInventoryReconciliationError(message);
      toast.error(message);
    } finally {
      setReconcilingInventory(false);
    }
  };

  const backfillOrderItemCosts = async () => {
    setBackfillingCosts(true);
    setBackfillResult(null);
    setBackfillError(null);
    try {
      const res = await fetch("/api/shopify/backfill-order-item-costs", {
        method: "POST",
        headers: {
          ...(await authHeader()),
          "Content-Type": "application/json",
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.status === "error") throw new Error(json.error ?? "Backfill failed.");

      const result: BackfillCostResult = {
        status: json.status ?? "success",
        order_items_checked: json.order_items_checked ?? 0,
        order_items_updated: json.order_items_updated ?? 0,
        order_items_already_had_cost: json.order_items_already_had_cost ?? 0,
        order_items_missing_variant_match: json.order_items_missing_variant_match ?? 0,
        order_items_missing_inventory_cost: json.order_items_missing_inventory_cost ?? 0,
        matched_by_variant_id: json.matched_by_variant_id ?? 0,
        matched_by_sku: json.matched_by_sku ?? 0,
        matched_by_sku_normalized: json.matched_by_sku_normalized ?? 0,
        matched_by_remap_variant_id: json.matched_by_remap_variant_id ?? 0,
        matched_by_remap_sku: json.matched_by_remap_sku ?? 0,
        remap_matches_count: json.remap_matches_count ?? 0,
        remaining_unmatched: json.remaining_unmatched ?? 0,
        matched_by_barcode: json.matched_by_barcode ?? 0,
        matched_by_title_exact: json.matched_by_title_exact ?? 0,
        mismatch_reasons: json.mismatch_reasons ?? {},
        unmatched_samples: Array.isArray(json.unmatched_samples) ? json.unmatched_samples : [],
        unmatched_sku_report: Array.isArray(json.unmatched_sku_report)
          ? json.unmatched_sku_report
          : [],
        failed_count: json.failed_count ?? 0,
      };
      setBackfillResult(result);
      toast.success(
        `Backfill finished: ${result.order_items_updated} of ${result.order_items_checked} order items updated.`,
      );
      await qc.invalidateQueries({ queryKey: ["shopify-settings"] });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setBackfillError(message);
      toast.error(message);
    } finally {
      setBackfillingCosts(false);
    }
  };

  const forceUpdateOrderItemCosts = async () => {
    if (!window.confirm(FORCE_UPDATE_COSTS_CONFIRMATION_MESSAGE)) return;

    setForcingCostUpdate(true);
    setForceCostResult(null);
    setForceCostError(null);
    try {
      const res = await fetch("/api/shopify/force-update-order-item-costs", {
        method: "POST",
        headers: {
          ...(await authHeader()),
          "Content-Type": "application/json",
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.status === "error") throw new Error(json.error ?? "Force update failed.");

      const result: ForceUpdateCostResult = {
        status: json.status ?? "success",
        items_checked: json.items_checked ?? 0,
        items_updated: json.items_updated ?? 0,
        items_skipped: json.items_skipped ?? 0,
        missing_cost: json.missing_cost ?? 0,
        missing_match: json.missing_match ?? 0,
        orders_recalculated: json.orders_recalculated ?? 0,
        total_cost_before: Number(json.total_cost_before ?? 0),
        total_cost_after: Number(json.total_cost_after ?? 0),
        failed_count: json.failed_count ?? 0,
        match_counts: json.match_counts ?? {},
        mismatch_reasons: json.mismatch_reasons ?? {},
      };
      setForceCostResult(result);
      if (result.status === "partial") {
        toast.warning(
          `Force update finished with ${result.failed_count} failures: ${result.items_updated} items updated.`,
        );
      } else {
        toast.success(
          `Force update finished: ${result.items_updated} items updated, ${result.orders_recalculated} orders recalculated.`,
        );
      }
      await qc.invalidateQueries({ queryKey: ["shopify-settings"] });
      await qc.invalidateQueries({ queryKey: ["orders"] });
      await qc.invalidateQueries({ queryKey: ["orders-all"] });
      await qc.invalidateQueries({ queryKey: ["orders-finance"] });
      await qc.invalidateQueries({ queryKey: ["order-items"] });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setForceCostError(message);
      toast.error(message);
    } finally {
      setForcingCostUpdate(false);
    }
  };

  const refreshOrderItemProductData = async () => {
    if (!window.confirm(REFRESH_PRODUCT_DATA_CONFIRMATION_MESSAGE)) return;

    setRefreshingProductData(true);
    setRefreshProductDataResult(null);
    setRefreshProductDataError(null);
    try {
      const res = await fetch("/api/shopify/refresh-order-item-product-data", {
        method: "POST",
        headers: {
          ...(await authHeader()),
          "Content-Type": "application/json",
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.status === "error") {
        throw new Error(json.error ?? "Product data refresh failed.");
      }

      const result: RefreshOrderItemProductDataResult = {
        status: json.status ?? "success",
        items_checked: json.items_checked ?? 0,
        items_updated: json.items_updated ?? 0,
        items_skipped: json.items_skipped ?? 0,
        missing_match: json.missing_match ?? 0,
        failed_count: json.failed_count ?? 0,
        match_counts: json.match_counts ?? {},
        mismatch_reasons: json.mismatch_reasons ?? {},
      };
      setRefreshProductDataResult(result);
      if (result.status === "partial") {
        toast.warning(
          `Product data refresh finished with ${result.failed_count} failures: ${result.items_updated} items updated.`,
        );
      } else {
        toast.success(`Product data refresh finished: ${result.items_updated} items updated.`);
      }
      await qc.invalidateQueries({ queryKey: ["shopify-settings"] });
      await qc.invalidateQueries({ queryKey: ["orders"] });
      await qc.invalidateQueries({ queryKey: ["orders-all"] });
      await qc.invalidateQueries({ queryKey: ["orders-finance"] });
      await qc.invalidateQueries({ queryKey: ["order-items"] });
      await qc.invalidateQueries({ queryKey: ["product-media"] });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setRefreshProductDataError(message);
      toast.error(message);
    } finally {
      setRefreshingProductData(false);
    }
  };

  const recalculateOrderCosts = async () => {
    setRecalcingOrderCosts(true);
    setRecalcResult(null);
    setRecalcError(null);
    try {
      const res = await fetch("/api/shopify/recalculate-order-costs", {
        method: "POST",
        headers: {
          ...(await authHeader()),
          "Content-Type": "application/json",
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.status === "error") throw new Error(json.error ?? "Recalculate failed.");
      setRecalcResult({
        orders_checked: json.orders_checked ?? 0,
        orders_updated: json.orders_updated ?? 0,
        order_items_checked: json.order_items_checked ?? 0,
        order_items_with_cost: json.order_items_with_cost ?? 0,
        order_items_missing_cost: json.order_items_missing_cost ?? 0,
        orders_with_missing_costs: json.orders_with_missing_costs ?? 0,
        total_items_cost_before: json.total_items_cost_before ?? 0,
        total_items_cost_after: json.total_items_cost_after ?? 0,
        packaging_costs_checked: json.packaging_costs_checked ?? 0,
        packaging_costs_updated: json.packaging_costs_updated ?? 0,
        packaging_costs_preserved_manual: json.packaging_costs_preserved_manual ?? 0,
        total_packaging_cost_before: json.total_packaging_cost_before ?? 0,
        total_packaging_cost_after: json.total_packaging_cost_after ?? 0,
        failed_count: json.failed_count ?? 0,
      });
      toast.success(
        `Recalculated order and packaging costs for ${json.orders_updated ?? 0} of ${json.orders_checked ?? 0} orders.`,
      );
      await qc.invalidateQueries({ queryKey: ["shopify-settings"] });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setRecalcError(message);
      toast.error(message);
    } finally {
      setRecalcingOrderCosts(false);
    }
  };

  const resetAllLocalOrders = async () => {
    if (!window.confirm(RESET_CONFIRMATION_MESSAGE)) return;

    setResettingOrders(true);
    setResetResult(null);
    try {
      const res = await fetch("/api/orders/reset-all", {
        method: "POST",
        headers: {
          ...(await authHeader()),
          "Content-Type": "application/json",
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Local orders reset failed.");

      const result: LocalOrdersResetResult = {
        deleted_orders_count: json.deleted_orders_count ?? 0,
        deleted_order_items_count: json.deleted_order_items_count ?? 0,
        deleted_order_notes_count: json.deleted_order_notes_count ?? 0,
        deleted_order_activity_count: json.deleted_order_activity_count ?? 0,
        cursor_reset: Boolean(json.cursor_reset),
      };
      setResetResult(result);
      toast.success(
        `Deleted ${result.deleted_orders_count} local orders. Shopify was not touched.`,
      );
      await refreshStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      await refreshStatus();
    } finally {
      setResettingOrders(false);
    }
  };

  const resetAndSync2026Orders = async () => {
    if (!window.confirm(RESET_SYNC_2026_CONFIRMATION_MESSAGE)) return;

    setResetSyncing2026(true);
    setResetSync2026Result(null);
    try {
      const res = await fetch("/api/shopify/reset-and-sync-2026-orders", {
        method: "POST",
        headers: {
          ...(await authHeader()),
          "Content-Type": "application/json",
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Reset and 2026 Shopify orders sync failed.");
      }

      const result: ResetSync2026Result = {
        current_local_orders_count: json.current_local_orders_count ?? 0,
        current_local_order_items_count: json.current_local_order_items_count ?? 0,
        deleted_orders_count: json.deleted_orders_count ?? 0,
        deleted_order_items_count: json.deleted_order_items_count ?? 0,
        deleted_order_notes_count: json.deleted_order_notes_count ?? 0,
        deleted_order_activity_count: json.deleted_order_activity_count ?? 0,
        records_processed: json.records_processed ?? 0,
        created_count: json.created_count ?? 0,
        updated_count: json.updated_count ?? 0,
        failed_count: json.failed_count ?? 0,
        pages_fetched: json.pages_fetched ?? 0,
        first_order_number_imported: json.first_order_number_imported ?? null,
        last_order_number_imported: json.last_order_number_imported ?? null,
      };
      setResetSync2026Result(result);
      if (json.status === "partial") {
        toast.warning(
          `2026 orders sync finished with ${result.failed_count} failed orders. Shopify was not changed.`,
        );
      } else {
        toast.success(
          `Reset complete. Imported ${result.created_count} Shopify orders created in 2026.`,
        );
      }
      await refreshStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      await refreshStatus();
    } finally {
      setResetSyncing2026(false);
    }
  };

  return (
    <AppShell title="Shopify Sync">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Shopify Sync Status</h1>
            <p className="mt-1 text-sm text-muted-foreground">Mansouj Sales Hub</p>
          </div>
          <StatusBadge status={syncStatus} connected={connected} hasError={Boolean(lastProblem)} />
        </header>

        <Alert>
          <AlertDescription>
            Use Full Backfill Orders once to import historical data. Use Pull from Shopify for daily
            recent orders.
          </AlertDescription>
        </Alert>

        {isLoading ? (
          <Card>
            <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Loading Shopify status...
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  {connectionOk ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-destructive" />
                  )}
                  Connection
                </CardTitle>
                <CardDescription>
                  Tokens stay on the server and are never shown here.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <StatusItem label="Connected shop" value={shopDomain} />
                  <StatusItem label="Connection status" value={connectionStatus} />
                  <StatusItem
                    label="Connection test"
                    value={settings?.last_connection_test_status ?? "not_tested"}
                  />
                  <StatusItem
                    label="Admin API token"
                    value={settings?.token_stored ? "Stored server-side" : "Not connected"}
                  />
                </div>
                <Button onClick={testConnection} disabled={testing}>
                  <TestTube2 className={`mr-2 h-4 w-4 ${testing ? "animate-spin" : ""}`} />
                  Test Connection
                </Button>
                {lastProblem && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    {lastProblem}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ShoppingBag className="h-5 w-5" />
                  Orders
                </CardTitle>
                <CardDescription>
                  Recent sync uses the cursor and a small overlap. Full backfill imports all
                  historical Shopify orders.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => syncOrders("incremental")}
                    disabled={
                      syncingRecent ||
                      syncingBackfill ||
                      resettingOrders ||
                      resetSyncing2026 ||
                      repairingMissingLineItems
                    }
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${syncingRecent ? "animate-spin" : ""}`} />
                    Sync Recent Orders
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => syncOrders("full_backfill")}
                    disabled={
                      syncingRecent ||
                      syncingBackfill ||
                      resettingOrders ||
                      resetSyncing2026 ||
                      repairingMissingLineItems
                    }
                  >
                    <RefreshCw
                      className={`mr-2 h-4 w-4 ${syncingBackfill ? "animate-spin" : ""}`}
                    />
                    Full Backfill Orders
                  </Button>
                  <Button
                    variant="outline"
                    onClick={repairMissingOrderLineItems}
                    disabled={
                      syncingRecent ||
                      syncingBackfill ||
                      resettingOrders ||
                      resetSyncing2026 ||
                      repairingMissingLineItems
                    }
                  >
                    <RefreshCw
                      className={`mr-2 h-4 w-4 ${repairingMissingLineItems ? "animate-spin" : ""}`}
                    />
                    Repair Missing Order Line Items
                  </Button>
                  {canAdmin && (
                    <>
                      <Button
                        variant="destructive"
                        onClick={resetAndSync2026Orders}
                        disabled={
                          syncingRecent ||
                          syncingBackfill ||
                          resettingOrders ||
                          resetSyncing2026 ||
                          repairingMissingLineItems
                        }
                      >
                        <RefreshCw
                          className={`mr-2 h-4 w-4 ${resetSyncing2026 ? "animate-spin" : ""}`}
                        />
                        Reset & Sync 2026 Orders
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={resetAllLocalOrders}
                        disabled={
                          syncingRecent ||
                          syncingBackfill ||
                          resettingOrders ||
                          resetSyncing2026 ||
                          repairingMissingLineItems
                        }
                      >
                        <Trash2
                          className={`mr-2 h-4 w-4 ${resettingOrders ? "animate-pulse" : ""}`}
                        />
                        Reset All Local Orders
                      </Button>
                    </>
                  )}
                </div>
                {ordersSyncResult && (
                  <div className="space-y-3">
                    {ordersSyncResult.failed === 0 &&
                      ordersSyncResult.affected_orders_recalculated > 0 && (
                        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                          Recent orders synced and costs recalculated successfully.
                        </div>
                      )}
                    {ordersSyncResult.order_items_missing_cost > 0 && (
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-300">
                        Some order items are missing cost. Run Sync Inventory &amp; Cost and
                        Backfill Order Item Costs if needed.
                      </div>
                    )}
                    <div className="grid gap-3 rounded-md border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-4">
                      <StatusItem label="Mode" value={ordersSyncResult.mode} />
                      <StatusItem label="Created" value={String(ordersSyncResult.created)} />
                      <StatusItem label="Updated" value={String(ordersSyncResult.updated)} />
                      <StatusItem label="Failed" value={String(ordersSyncResult.failed)} />
                      <StatusItem
                        label="Items processed"
                        value={String(ordersSyncResult.order_items_processed)}
                      />
                      <StatusItem
                        label="Items with cost"
                        value={String(ordersSyncResult.order_items_with_cost)}
                      />
                      <StatusItem
                        label="Items missing cost"
                        value={String(ordersSyncResult.order_items_missing_cost)}
                      />
                      <StatusItem
                        label="Orders recalculated"
                        value={String(ordersSyncResult.affected_orders_recalculated)}
                      />
                      <StatusItem
                        label="Cost via variant id"
                        value={String(ordersSyncResult.order_items_cost_assigned_by_variant_id)}
                      />
                      <StatusItem
                        label="Cost via SKU"
                        value={String(ordersSyncResult.order_items_cost_assigned_by_sku)}
                      />
                      <StatusItem
                        label="Cost via SKU normalized"
                        value={String(ordersSyncResult.order_items_cost_assigned_by_sku_normalized)}
                      />
                      <StatusItem
                        label="Cost via remap"
                        value={String(ordersSyncResult.order_items_cost_assigned_by_remap)}
                      />
                      <StatusItem
                        label="Cost preserved"
                        value={String(ordersSyncResult.order_items_cost_preserved)}
                      />
                      <StatusItem
                        label="Total items cost after"
                        value={ordersSyncResult.total_items_cost_after_recalc.toLocaleString()}
                      />
                    </div>
                  </div>
                )}
                {repairMissingLineItemsResult && (
                  <div className="space-y-3 rounded-md border bg-muted/30 p-4">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <StatusItem
                        label="Orders checked"
                        value={String(repairMissingLineItemsResult.orders_checked)}
                      />
                      <StatusItem
                        label="Missing item orders"
                        value={String(repairMissingLineItemsResult.missing_orders_found)}
                      />
                      <StatusItem
                        label="Orders repaired"
                        value={String(repairMissingLineItemsResult.repaired_orders)}
                      />
                      <StatusItem
                        label="Line items inserted"
                        value={String(repairMissingLineItemsResult.line_items_inserted)}
                      />
                      <StatusItem
                        label="Items with cost"
                        value={String(repairMissingLineItemsResult.line_items_with_cost)}
                      />
                      <StatusItem
                        label="Items missing cost"
                        value={String(repairMissingLineItemsResult.line_items_missing_cost)}
                      />
                      <StatusItem
                        label="Schema fallbacks"
                        value={String(repairMissingLineItemsResult.schema_fallbacks_used)}
                      />
                      <StatusItem
                        label="Failed"
                        value={String(repairMissingLineItemsResult.failed_count)}
                      />
                    </div>
                    {repairMissingLineItemsResult.repaired.length > 0 && (
                      <div className="text-sm text-muted-foreground">
                        Repaired:{" "}
                        {repairMissingLineItemsResult.repaired
                          .slice(0, 8)
                          .map(
                            (row) => `${row.order_number ?? "order"} (${row.line_items_inserted})`,
                          )
                          .join(", ")}
                      </div>
                    )}
                    {repairMissingLineItemsResult.errors.length > 0 && (
                      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {repairMissingLineItemsResult.errors.slice(0, 3).join(" | ")}
                      </div>
                    )}
                  </div>
                )}
                {canAdmin && (
                  <p className="text-sm text-muted-foreground">
                    Reset & Sync 2026 Orders deletes all local orders from Mansouj Sales Hub, then
                    imports Shopify orders created in 2026 only. Shopify will not be changed.
                  </p>
                )}
                {resetSync2026Result && (
                  <div className="grid gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 sm:grid-cols-2 lg:grid-cols-4">
                    <StatusItem
                      label="Previous local orders"
                      value={String(resetSync2026Result.current_local_orders_count)}
                    />
                    <StatusItem
                      label="Previous local items"
                      value={String(resetSync2026Result.current_local_order_items_count)}
                    />
                    <StatusItem
                      label="Deleted orders"
                      value={String(resetSync2026Result.deleted_orders_count)}
                    />
                    <StatusItem
                      label="Deleted items"
                      value={String(resetSync2026Result.deleted_order_items_count)}
                    />
                    <StatusItem
                      label="Deleted notes"
                      value={String(resetSync2026Result.deleted_order_notes_count)}
                    />
                    <StatusItem
                      label="Deleted activity"
                      value={String(resetSync2026Result.deleted_order_activity_count)}
                    />
                    <StatusItem
                      label="Records processed"
                      value={String(resetSync2026Result.records_processed)}
                    />
                    <StatusItem label="Created" value={String(resetSync2026Result.created_count)} />
                    <StatusItem label="Updated" value={String(resetSync2026Result.updated_count)} />
                    <StatusItem label="Failed" value={String(resetSync2026Result.failed_count)} />
                    <StatusItem
                      label="Pages fetched"
                      value={String(resetSync2026Result.pages_fetched)}
                    />
                    <StatusItem
                      label="First imported"
                      value={resetSync2026Result.first_order_number_imported ?? "None"}
                    />
                    <StatusItem
                      label="Last imported"
                      value={resetSync2026Result.last_order_number_imported ?? "None"}
                    />
                  </div>
                )}
                {resetResult && (
                  <div className="grid gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 sm:grid-cols-2 lg:grid-cols-5">
                    <StatusItem
                      label="Deleted orders"
                      value={String(resetResult.deleted_orders_count)}
                    />
                    <StatusItem
                      label="Deleted items"
                      value={String(resetResult.deleted_order_items_count)}
                    />
                    <StatusItem
                      label="Deleted notes"
                      value={String(resetResult.deleted_order_notes_count)}
                    />
                    <StatusItem
                      label="Deleted activity"
                      value={String(resetResult.deleted_order_activity_count)}
                    />
                    <StatusItem
                      label="Cursor reset"
                      value={resetResult.cursor_reset ? "true" : "false"}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Package className="h-5 w-5" />
                    Products
                  </CardTitle>
                  <CardDescription>
                    Sync Shopify products and variants. No Shopify data is modified.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                    Product and variant sync is included in Sync Inventory from Shopify. The manual
                    Sync Products button is now under Inventory &amp; Cost → Advanced Tools.
                  </div>
                  {!canOps && (
                    <p className="text-sm text-muted-foreground">
                      Admin or operations access is required to run this sync.
                    </p>
                  )}
                  {productSyncError && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      {productSyncError}
                    </div>
                  )}
                  {productSyncResult && (
                    <div className="space-y-3">
                      {productSyncResult.message && (
                        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                          {productSyncResult.message}
                        </div>
                      )}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <StatusItem
                          label="Products processed"
                          value={String(productSyncResult.products_processed)}
                        />
                        <StatusItem
                          label="Products created"
                          value={String(productSyncResult.products_created)}
                        />
                        <StatusItem
                          label="Products updated"
                          value={String(productSyncResult.products_updated)}
                        />
                        <StatusItem
                          label="Variants processed"
                          value={String(productSyncResult.variants_processed)}
                        />
                        <StatusItem
                          label="Variants created"
                          value={String(productSyncResult.variants_created)}
                        />
                        <StatusItem
                          label="Variants updated"
                          value={String(productSyncResult.variants_updated)}
                        />
                        <StatusItem
                          label="Pages fetched"
                          value={String(productSyncResult.pages_fetched)}
                        />
                        <StatusItem label="Failed" value={String(productSyncResult.failed_count)} />
                        <StatusItem
                          label="Shop domain"
                          value={productSyncResult.shop_domain_used ?? "-"}
                        />
                        <StatusItem
                          label="API version"
                          value={productSyncResult.api_version_used ?? "-"}
                        />
                        <StatusItem
                          label="API method"
                          value={productSyncResult.api_method_used ?? "-"}
                        />
                        <StatusItem
                          label="First response count"
                          value={String(productSyncResult.first_api_response_product_count ?? "-")}
                        />
                        <StatusItem
                          label="Stopped reason"
                          value={productSyncResult.stopped_reason ?? "-"}
                        />
                        <StatusItem
                          label="Response shape"
                          value={`keys: ${
                            productSyncResult.raw_shopify_response_shape_summary?.response_keys?.join(
                              ", ",
                            ) || "-"
                          }; products array: ${
                            productSyncResult.raw_shopify_response_shape_summary
                              ?.products_is_array === true
                              ? "true"
                              : productSyncResult.raw_shopify_response_shape_summary
                                    ?.products_is_array === false
                                ? "false"
                                : "-"
                          }`}
                        />
                      </div>
                    </div>
                  )}

                  <div className="border-t pt-4 space-y-3">
                    <div>
                      <h4 className="text-sm font-medium">Refresh Order Item Product Data</h4>
                      <p className="text-xs text-muted-foreground">
                        Updates existing local order items to display the latest synced Shopify SKU,
                        product title, variant title, barcode, and product type. Does not change
                        quantities, selling prices, costs, shipping, packaging, statuses, notes, or
                        Shopify data.
                      </p>
                    </div>
                    <Button
                      onClick={refreshOrderItemProductData}
                      disabled={!canOps || refreshingProductData || syncingProducts}
                      variant="secondary"
                    >
                      <RefreshCw
                        className={`mr-2 h-4 w-4 ${refreshingProductData ? "animate-spin" : ""}`}
                      />
                      Refresh Order Item Product Data
                    </Button>
                    {refreshProductDataError && (
                      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                        {refreshProductDataError}
                      </div>
                    )}
                    {refreshProductDataResult && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <StatusItem
                          label="Items checked"
                          value={String(refreshProductDataResult.items_checked)}
                        />
                        <StatusItem
                          label="Items updated"
                          value={String(refreshProductDataResult.items_updated)}
                        />
                        <StatusItem
                          label="Items skipped"
                          value={String(refreshProductDataResult.items_skipped)}
                        />
                        <StatusItem
                          label="Missing match"
                          value={String(refreshProductDataResult.missing_match)}
                        />
                        <StatusItem
                          label="Failed"
                          value={String(refreshProductDataResult.failed_count)}
                        />
                      </div>
                    )}
                    {refreshProductDataResult &&
                      Object.keys(refreshProductDataResult.match_counts).length > 0 && (
                        <div className="space-y-2">
                          <h5 className="text-sm font-medium">Product data match summary</h5>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {Object.entries(refreshProductDataResult.match_counts).map(
                              ([reason, count]) => (
                                <div
                                  key={reason}
                                  className="flex items-center justify-between rounded border px-3 py-2 text-xs"
                                >
                                  <span className="text-muted-foreground">{reason}</span>
                                  <span className="font-mono">{count}</span>
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      )}
                    {refreshProductDataResult &&
                      Object.keys(refreshProductDataResult.mismatch_reasons).length > 0 && (
                        <div className="space-y-2">
                          <h5 className="text-sm font-medium">Unmatched product data reasons</h5>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {Object.entries(refreshProductDataResult.mismatch_reasons).map(
                              ([reason, count]) => (
                                <div
                                  key={reason}
                                  className="flex items-center justify-between rounded border px-3 py-2 text-xs"
                                >
                                  <span className="text-muted-foreground">{reason}</span>
                                  <span className="font-mono">{count}</span>
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Warehouse className="h-5 w-5" />
                    Inventory & Cost
                  </CardTitle>
                  <CardDescription>
                    Sync Shopify locations, inventory levels, and InventoryItem unit cost.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3 rounded-md border bg-muted/30 p-4">
                    <div>
                      <h4 className="text-sm font-medium">Daily inventory update</h4>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Click “Sync Inventory from Shopify” after changing products, prices, costs,
                        quantities, SKUs, images, or product status in Shopify.
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Important: If Cost per item was changed and you want Finance/order profits
                        to update for existing orders, click “Recalculate Finance Costs” separately.
                        Inventory sync must not automatically rewrite old order profits.
                      </p>
                    </div>
                    <Button
                      onClick={syncDailyInventoryFromShopify}
                      disabled={
                        !canOps ||
                        syncingDailyInventory ||
                        syncingProducts ||
                        syncingInventoryCost ||
                        refreshingInventorySource ||
                        reconcilingInventory
                      }
                    >
                      <RefreshCw
                        className={`mr-2 h-4 w-4 ${syncingDailyInventory ? "animate-spin" : ""}`}
                      />
                      Sync Inventory from Shopify
                    </Button>
                  </div>
                  {dailyInventorySyncError && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      {dailyInventorySyncError}
                    </div>
                  )}
                  {dailyInventorySyncResult && (
                    <div className="space-y-3 rounded-md border bg-muted/30 p-4">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <StatusItem
                          label="Products processed"
                          value={String(dailyInventorySyncResult.products_processed)}
                        />
                        <StatusItem
                          label="Variants processed"
                          value={String(dailyInventorySyncResult.variants_processed)}
                        />
                        <StatusItem
                          label="Inventory items processed"
                          value={String(dailyInventorySyncResult.inventory_items_processed)}
                        />
                        <StatusItem
                          label="Rows created"
                          value={String(dailyInventorySyncResult.rows_created)}
                        />
                        <StatusItem
                          label="Rows updated"
                          value={String(dailyInventorySyncResult.rows_updated)}
                        />
                        <StatusItem
                          label="Rows marked stale"
                          value={String(dailyInventorySyncResult.rows_marked_stale)}
                        />
                        <StatusItem
                          label="Duplicate Shopify SKUs"
                          value={String(dailyInventorySyncResult.duplicate_shopify_skus_found)}
                        />
                        <StatusItem
                          label="Missing cost"
                          value={String(dailyInventorySyncResult.missing_cost_count)}
                        />
                        <StatusItem
                          label="Missing price"
                          value={String(dailyInventorySyncResult.missing_price_count)}
                        />
                        <StatusItem
                          label="Failed"
                          value={String(dailyInventorySyncResult.failed_count)}
                        />
                        <StatusItem
                          label="Last synced"
                          value={fmtDateTime(dailyInventorySyncResult.last_synced_at)}
                        />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <StatusItem
                          label="SN29 check"
                          value={
                            dailyInventorySyncResult.sn29
                              ? `On hand ${dailyInventorySyncResult.sn29.on_hand ?? "—"} · Available ${dailyInventorySyncResult.sn29.available ?? "—"} · Committed ${dailyInventorySyncResult.sn29.committed ?? "—"}`
                              : "Not found in active inventory"
                          }
                        />
                        <StatusItem
                          label="SAT-DU400 - WH220 check"
                          value={
                            dailyInventorySyncResult.satDu400Wh220
                              ? `Active rows ${dailyInventorySyncResult.satDu400Wh220.active_rows} · On hand ${dailyInventorySyncResult.satDu400Wh220.on_hand ?? "—"} · Cost ${dailyInventorySyncResult.satDu400Wh220.cost ?? "—"} · Total cost ${dailyInventorySyncResult.satDu400Wh220.total_cost ?? "—"}`
                              : "Not found in active inventory"
                          }
                        />
                      </div>
                    </div>
                  )}
                  <details className="rounded-md border bg-background p-4">
                    <summary className="cursor-pointer text-sm font-medium">Advanced Tools</summary>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        onClick={syncProducts}
                        disabled={
                          !canOps ||
                          syncingDailyInventory ||
                          syncingProducts ||
                          syncingInventoryCost
                        }
                        variant="outline"
                      >
                        <RefreshCw
                          className={`mr-2 h-4 w-4 ${syncingProducts ? "animate-spin" : ""}`}
                        />
                        Sync Products
                      </Button>
                      <Button
                        onClick={syncInventoryCost}
                        disabled={
                          !canOps ||
                          syncingDailyInventory ||
                          syncingProducts ||
                          syncingInventoryCost ||
                          refreshingInventorySource ||
                          reconcilingInventory
                        }
                        variant="outline"
                      >
                        <RefreshCw
                          className={`mr-2 h-4 w-4 ${syncingInventoryCost ? "animate-spin" : ""}`}
                        />
                        Sync Inventory & Cost
                      </Button>
                      <Button
                        onClick={refreshInventorySourceOfTruth}
                        disabled={
                          !canOps ||
                          syncingDailyInventory ||
                          syncingProducts ||
                          syncingInventoryCost ||
                          refreshingInventorySource ||
                          reconcilingInventory
                        }
                        variant="outline"
                      >
                        <RefreshCw
                          className={`mr-2 h-4 w-4 ${
                            refreshingInventorySource ? "animate-spin" : ""
                          }`}
                        />
                        Refresh Inventory From Shopify Source of Truth
                      </Button>
                      <Button
                        onClick={runInventoryReconciliation}
                        disabled={
                          !canOps ||
                          syncingDailyInventory ||
                          syncingProducts ||
                          syncingInventoryCost ||
                          refreshingInventorySource ||
                          reconcilingInventory
                        }
                        variant="outline"
                      >
                        <RefreshCw
                          className={`mr-2 h-4 w-4 ${reconcilingInventory ? "animate-spin" : ""}`}
                        />
                        Inventory Reconciliation
                      </Button>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Advanced flow: Sync Products → Sync Inventory &amp; Cost → Refresh Inventory
                      From Shopify Source of Truth → Inventory Reconciliation. The report uses
                      Active products by default to match the Inventory page default filter.
                    </p>
                  </details>
                  {!canOps && (
                    <p className="text-sm text-muted-foreground">
                      Admin or operations access is required to run this sync.
                    </p>
                  )}
                  {inventoryCostSyncError && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      {inventoryCostSyncError}
                    </div>
                  )}
                  {inventorySourceRefreshError && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      {inventorySourceRefreshError}
                    </div>
                  )}
                  {inventoryReconciliationError && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      {inventoryReconciliationError}
                    </div>
                  )}
                  {inventoryCostSyncResult && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <StatusItem
                        label="Inventory items"
                        value={String(inventoryCostSyncResult.inventory_items_processed)}
                      />
                      <StatusItem
                        label="Items with cost"
                        value={String(inventoryCostSyncResult.inventory_items_with_cost)}
                      />
                      <StatusItem
                        label="Items missing cost"
                        value={String(inventoryCostSyncResult.inventory_items_missing_cost)}
                      />
                      <StatusItem
                        label="Locations"
                        value={String(inventoryCostSyncResult.locations_processed)}
                      />
                      <StatusItem
                        label="Inventory levels"
                        value={String(inventoryCostSyncResult.inventory_levels_processed)}
                      />
                      <StatusItem
                        label="Levels with on hand"
                        value={String(inventoryCostSyncResult.inventory_levels_with_on_hand)}
                      />
                      <StatusItem
                        label="Levels missing on hand"
                        value={String(inventoryCostSyncResult.inventory_levels_missing_on_hand)}
                      />
                      <StatusItem
                        label="On hand source"
                        value={inventoryCostSyncResult.on_hand_quantity_source ?? "missing"}
                      />
                      <StatusItem
                        label="On hand checked"
                        value={String(inventoryCostSyncResult.variant_on_hand_quantities_processed)}
                      />
                      <StatusItem
                        label="On hand updated"
                        value={String(inventoryCostSyncResult.variant_on_hand_quantities_updated)}
                      />
                      <StatusItem
                        label="Fallback used"
                        value={inventoryCostSyncResult.on_hand_fallback_used ? "true" : "false"}
                      />
                      <StatusItem
                        label="Pages fetched"
                        value={String(inventoryCostSyncResult.pages_fetched)}
                      />
                      <StatusItem
                        label="Failed"
                        value={String(inventoryCostSyncResult.failed_count)}
                      />
                    </div>
                  )}
                  {inventorySourceRefreshResult && (
                    <div className="space-y-3 rounded-md border bg-muted/30 p-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <StatusItem
                          label="Variants processed"
                          value={String(inventorySourceRefreshResult.variants_processed)}
                        />
                        <StatusItem
                          label="Rows created"
                          value={String(inventorySourceRefreshResult.inventory_rows_created)}
                        />
                        <StatusItem
                          label="Rows updated"
                          value={String(inventorySourceRefreshResult.inventory_rows_updated)}
                        />
                        <StatusItem
                          label="Stale rows marked"
                          value={String(inventorySourceRefreshResult.stale_rows_marked)}
                        />
                        <StatusItem
                          label="Duplicate Shopify SKUs"
                          value={String(inventorySourceRefreshResult.duplicate_shopify_skus_found)}
                        />
                        <StatusItem
                          label="Missing cost"
                          value={String(inventorySourceRefreshResult.missing_cost_count)}
                        />
                        <StatusItem
                          label="Missing price"
                          value={String(inventorySourceRefreshResult.missing_price_count)}
                        />
                        <StatusItem
                          label="Missing on hand"
                          value={String(inventorySourceRefreshResult.missing_on_hand_count)}
                        />
                        <StatusItem
                          label="Last synced"
                          value={fmtDateTime(inventorySourceRefreshResult.last_synced_at)}
                        />
                        <StatusItem
                          label="SKU remaps used"
                          value={inventorySourceRefreshResult.sku_remaps_used ? "true" : "false"}
                        />
                      </div>
                      {inventorySourceRefreshResult.missing_on_hand_count > 0 && (
                        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                          Shopify did not return on-hand quantity for some variants. Those rows are
                          not filled from stale local inventory.
                        </div>
                      )}
                    </div>
                  )}
                  {inventoryReconciliationResult && (
                    <div className="space-y-3 rounded-md border bg-muted/30 p-4">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <StatusItem
                          label="Product status"
                          value={inventoryReconciliationResult.product_status}
                        />
                        <StatusItem
                          label="Shopify total SKUs"
                          value={String(inventoryReconciliationResult.shopify_total_skus)}
                        />
                        <StatusItem
                          label="Mansouj local SKUs"
                          value={String(inventoryReconciliationResult.mansouj_local_total_skus)}
                        />
                        <StatusItem
                          label="Shopify on hand"
                          value={String(inventoryReconciliationResult.shopify_on_hand_quantity)}
                        />
                        <StatusItem
                          label="Mansouj on hand"
                          value={String(inventoryReconciliationResult.mansouj_on_hand_quantity)}
                        />
                        <StatusItem
                          label="Quantity difference"
                          value={String(inventoryReconciliationResult.difference_quantity)}
                        />
                        <StatusItem
                          label="Shopify inventory cost"
                          value={egp(inventoryReconciliationResult.shopify_inventory_cost_value)}
                        />
                        <StatusItem
                          label="Mansouj inventory cost"
                          value={egp(inventoryReconciliationResult.mansouj_inventory_cost_value)}
                        />
                        <StatusItem
                          label="Cost difference"
                          value={egp(inventoryReconciliationResult.difference_cost_value)}
                        />
                        <StatusItem
                          label="Shopify retail value"
                          value={egp(inventoryReconciliationResult.shopify_retail_value)}
                        />
                        <StatusItem
                          label="Mansouj retail value"
                          value={egp(inventoryReconciliationResult.mansouj_retail_value)}
                        />
                        <StatusItem
                          label="Retail difference"
                          value={egp(inventoryReconciliationResult.difference_retail_value)}
                        />
                      </div>
                      {inventoryReconciliationResult.on_hand_missing_count > 0 && (
                        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                          Shopify did not return on-hand quantity for{" "}
                          {inventoryReconciliationResult.on_hand_missing_count} active variants.
                        </div>
                      )}
                      {inventoryReconciliationResult.mismatches.length > 0 && (
                        <div className="overflow-x-auto rounded border max-h-96">
                          <table className="w-full text-xs">
                            <thead className="bg-muted/40 sticky top-0">
                              <tr>
                                <th className="px-2 py-1 text-left">Product</th>
                                <th className="px-2 py-1 text-left">Variant</th>
                                <th className="px-2 py-1 text-left">SKU</th>
                                <th className="px-2 py-1 text-left">Variant ID</th>
                                <th className="px-2 py-1 text-left">Inventory Item</th>
                                <th className="px-2 py-1 text-right">Shopify Qty</th>
                                <th className="px-2 py-1 text-right">Mansouj Qty</th>
                                <th className="px-2 py-1 text-right">Diff</th>
                                <th className="px-2 py-1 text-right">Shopify Cost</th>
                                <th className="px-2 py-1 text-right">Mansouj Cost</th>
                                <th className="px-2 py-1 text-right">Shopify Price</th>
                                <th className="px-2 py-1 text-right">Mansouj Price</th>
                                <th className="px-2 py-1 text-left">Status</th>
                                <th className="px-2 py-1 text-left">Reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {inventoryReconciliationResult.mismatches.map((row, idx) => (
                                <tr key={`${row.shopify_variant_id}-${idx}`} className="border-t">
                                  <td className="px-2 py-1">{row.product_title}</td>
                                  <td className="px-2 py-1">{row.variant_title ?? "—"}</td>
                                  <td className="px-2 py-1 font-mono">{row.sku}</td>
                                  <td className="px-2 py-1 font-mono">{row.shopify_variant_id}</td>
                                  <td className="px-2 py-1 font-mono">
                                    {row.inventory_item_id ?? "—"}
                                  </td>
                                  <td className="px-2 py-1 text-right">{row.shopify_quantity}</td>
                                  <td className="px-2 py-1 text-right">
                                    {row.mansouj_quantity ?? "—"}
                                  </td>
                                  <td className="px-2 py-1 text-right">{row.difference}</td>
                                  <td className="px-2 py-1 text-right">{egp(row.shopify_cost)}</td>
                                  <td className="px-2 py-1 text-right">
                                    {row.mansouj_cost == null ? "—" : egp(row.mansouj_cost)}
                                  </td>
                                  <td className="px-2 py-1 text-right">{egp(row.shopify_price)}</td>
                                  <td className="px-2 py-1 text-right">
                                    {row.mansouj_price == null ? "—" : egp(row.mansouj_price)}
                                  </td>
                                  <td className="px-2 py-1">{row.product_status ?? "—"}</td>
                                  <td className="px-2 py-1">{row.reason}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="border-t pt-4 space-y-3">
                    <div>
                      <h4 className="text-sm font-medium">Backfill Order Item Costs</h4>
                      <p className="text-xs text-muted-foreground">
                        Updates local order items with synced Shopify product cost. Does not modify
                        Shopify.
                      </p>
                    </div>
                    <Button
                      onClick={backfillOrderItemCosts}
                      disabled={!canOps || backfillingCosts}
                      variant="secondary"
                    >
                      <RefreshCw
                        className={`mr-2 h-4 w-4 ${backfillingCosts ? "animate-spin" : ""}`}
                      />
                      Backfill Order Item Costs
                    </Button>
                    {backfillError && (
                      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                        {backfillError}
                      </div>
                    )}
                    {backfillResult && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <StatusItem
                          label="Items checked"
                          value={String(backfillResult.order_items_checked)}
                        />
                        <StatusItem
                          label="Items updated"
                          value={String(backfillResult.order_items_updated)}
                        />
                        <StatusItem
                          label="Already had cost"
                          value={String(backfillResult.order_items_already_had_cost)}
                        />
                        <StatusItem
                          label="Missing variant match"
                          value={String(backfillResult.order_items_missing_variant_match)}
                        />
                        <StatusItem
                          label="Missing inventory cost"
                          value={String(backfillResult.order_items_missing_inventory_cost)}
                        />
                        <StatusItem label="Failed" value={String(backfillResult.failed_count)} />
                        <StatusItem
                          label="Matched by variant ID"
                          value={String(backfillResult.matched_by_variant_id)}
                        />
                        <StatusItem
                          label="Matched by SKU (exact)"
                          value={String(backfillResult.matched_by_sku)}
                        />
                        <StatusItem
                          label="Matched by SKU (normalized)"
                          value={String(backfillResult.matched_by_sku_normalized)}
                        />
                        <StatusItem
                          label="Matched by barcode"
                          value={String(backfillResult.matched_by_barcode)}
                        />
                        <StatusItem
                          label="Matched by title (exact)"
                          value={String(backfillResult.matched_by_title_exact)}
                        />
                      </div>
                    )}
                    {backfillResult &&
                      backfillResult.mismatch_reasons &&
                      Object.keys(backfillResult.mismatch_reasons).length > 0 && (
                        <div className="space-y-2">
                          <h5 className="text-sm font-medium">Mismatch reasons</h5>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {Object.entries(backfillResult.mismatch_reasons).map(
                              ([reason, count]) => (
                                <div
                                  key={reason}
                                  className="flex items-center justify-between rounded border px-3 py-2 text-xs"
                                >
                                  <span className="text-muted-foreground">{reason}</span>
                                  <span className="font-mono">{count}</span>
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      )}
                    {backfillResult && backfillResult.unmatched_samples.length > 0 && (
                      <div className="space-y-2">
                        <h5 className="text-sm font-medium">
                          Unmatched preview (first {backfillResult.unmatched_samples.length})
                        </h5>
                        <div className="overflow-x-auto rounded border">
                          <table className="w-full text-xs">
                            <thead className="bg-muted/40">
                              <tr>
                                <th className="px-2 py-1 text-left">Order #</th>
                                <th className="px-2 py-1 text-left">Item</th>
                                <th className="px-2 py-1 text-left">Variant</th>
                                <th className="px-2 py-1 text-left">SKU</th>
                                <th className="px-2 py-1 text-left">Shopify variant ID</th>
                                <th className="px-2 py-1 text-left">Reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {backfillResult.unmatched_samples.map((s, idx) => (
                                <tr key={idx} className="border-t">
                                  <td className="px-2 py-1">{s.order_number ?? "—"}</td>
                                  <td className="px-2 py-1">{s.order_item_title ?? "—"}</td>
                                  <td className="px-2 py-1">{s.variant ?? "—"}</td>
                                  <td className="px-2 py-1 font-mono">{s.sku ?? "—"}</td>
                                  <td className="px-2 py-1 font-mono">
                                    {s.shopify_variant_id ?? "—"}
                                  </td>
                                  <td className="px-2 py-1">{s.reason}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    {backfillResult && (
                      <div className="grid gap-3 sm:grid-cols-3">
                        <StatusItem
                          label="Matched by remap (variant ID)"
                          value={String(backfillResult.matched_by_remap_variant_id)}
                        />
                        <StatusItem
                          label="Matched by remap (SKU)"
                          value={String(backfillResult.matched_by_remap_sku)}
                        />
                        <StatusItem
                          label="Remap matches total"
                          value={String(backfillResult.remap_matches_count)}
                        />
                        <StatusItem
                          label="Remaining unmatched"
                          value={String(backfillResult.remaining_unmatched)}
                        />
                      </div>
                    )}
                    {backfillResult &&
                      backfillResult.unmatched_sku_report &&
                      backfillResult.unmatched_sku_report.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <h5 className="text-sm font-medium">
                              Unmatched SKU report ({backfillResult.unmatched_sku_report.length})
                            </h5>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                exportUnmatchedSkuReportCsv(backfillResult.unmatched_sku_report)
                              }
                            >
                              Export CSV
                            </Button>
                          </div>
                          <div className="overflow-x-auto rounded border max-h-96">
                            <table className="w-full text-xs">
                              <thead className="bg-muted/40 sticky top-0">
                                <tr>
                                  <th className="px-2 py-1 text-left">Old SKU</th>
                                  <th className="px-2 py-1 text-left">Item</th>
                                  <th className="px-2 py-1 text-left">Variant</th>
                                  <th className="px-2 py-1 text-left">Count</th>
                                  <th className="px-2 py-1 text-left">Example orders</th>
                                  <th className="px-2 py-1 text-left">Reason</th>
                                </tr>
                              </thead>
                              <tbody>
                                {backfillResult.unmatched_sku_report.map((r, idx) => (
                                  <tr key={idx} className="border-t">
                                    <td className="px-2 py-1 font-mono">{r.old_sku ?? "—"}</td>
                                    <td className="px-2 py-1">{r.item_title ?? "—"}</td>
                                    <td className="px-2 py-1">{r.variant ?? "—"}</td>
                                    <td className="px-2 py-1 font-mono">{r.count}</td>
                                    <td className="px-2 py-1 font-mono">
                                      {r.example_order_numbers.join(", ") || "—"}
                                    </td>
                                    <td className="px-2 py-1">{r.reason}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                  </div>

                  <div className="border-t pt-4 space-y-3">
                    <div>
                      <h4 className="text-sm font-medium">
                        Force Update Order Item Costs from Current Shopify Product Costs
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        Overwrites existing local order item unit costs with the latest synced
                        Shopify InventoryItem costs. Does not modify Shopify or change selling
                        price, shipping, packaging, statuses, notes, or customer data.
                      </p>
                    </div>
                    <Button
                      onClick={forceUpdateOrderItemCosts}
                      disabled={!canOps || forcingCostUpdate}
                      variant="secondary"
                    >
                      <RefreshCw
                        className={`mr-2 h-4 w-4 ${forcingCostUpdate ? "animate-spin" : ""}`}
                      />
                      Force Update Order Item Costs
                    </Button>
                    {!canOps && (
                      <p className="text-sm text-muted-foreground">
                        Admin or operations access is required.
                      </p>
                    )}
                    {forceCostError && (
                      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                        {forceCostError}
                      </div>
                    )}
                    {forceCostResult && (
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <StatusItem
                          label="Items checked"
                          value={String(forceCostResult.items_checked)}
                        />
                        <StatusItem
                          label="Items updated"
                          value={String(forceCostResult.items_updated)}
                        />
                        <StatusItem
                          label="Items skipped"
                          value={String(forceCostResult.items_skipped)}
                        />
                        <StatusItem
                          label="Missing cost"
                          value={String(forceCostResult.missing_cost)}
                        />
                        <StatusItem
                          label="Missing match"
                          value={String(forceCostResult.missing_match)}
                        />
                        <StatusItem
                          label="Orders recalculated"
                          value={String(forceCostResult.orders_recalculated)}
                        />
                        <StatusItem
                          label="Total cost before"
                          value={forceCostResult.total_cost_before.toFixed(2)}
                        />
                        <StatusItem
                          label="Total cost after"
                          value={forceCostResult.total_cost_after.toFixed(2)}
                        />
                        <StatusItem label="Failed" value={String(forceCostResult.failed_count)} />
                      </div>
                    )}
                    {forceCostResult && Object.keys(forceCostResult.match_counts).length > 0 && (
                      <div className="space-y-2">
                        <h5 className="text-sm font-medium">Match summary</h5>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {Object.entries(forceCostResult.match_counts).map(([reason, count]) => (
                            <div
                              key={reason}
                              className="flex items-center justify-between rounded border px-3 py-2 text-xs"
                            >
                              <span className="text-muted-foreground">{reason}</span>
                              <span className="font-mono">{count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {forceCostResult &&
                      Object.keys(forceCostResult.mismatch_reasons).length > 0 && (
                        <div className="space-y-2">
                          <h5 className="text-sm font-medium">Skipped reasons</h5>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {Object.entries(forceCostResult.mismatch_reasons).map(
                              ([reason, count]) => (
                                <div
                                  key={reason}
                                  className="flex items-center justify-between rounded border px-3 py-2 text-xs"
                                >
                                  <span className="text-muted-foreground">{reason}</span>
                                  <span className="font-mono">{count}</span>
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      )}
                  </div>

                  <div className="border-t pt-4 space-y-3">
                    <div>
                      <h4 className="text-sm font-medium">Recalculate Order & Packaging Costs</h4>
                      <p className="text-xs text-muted-foreground">
                        Recomputes each local order's items_cost from order_items (quantity ×
                        unit_cost), and updates Packaging Cost to 140 EGP per eligible item. Fitted
                        sheet sets with pillowcases are included; standalone pillows, pillowcases,
                        and duvets are excluded. Manual packaging edits are preserved. Does not
                        modify Shopify or change order revenue.
                      </p>
                    </div>
                    <Button
                      onClick={recalculateOrderCosts}
                      disabled={!canOps || recalcingOrderCosts}
                      variant="secondary"
                    >
                      <RefreshCw
                        className={`mr-2 h-4 w-4 ${recalcingOrderCosts ? "animate-spin" : ""}`}
                      />
                      Recalculate Order & Packaging Costs
                    </Button>
                    {!canOps && (
                      <p className="text-sm text-muted-foreground">
                        Admin or operations access is required.
                      </p>
                    )}
                    {recalcError && (
                      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                        {recalcError}
                      </div>
                    )}
                    {recalcResult && (
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <StatusItem
                          label="Orders checked"
                          value={String(recalcResult.orders_checked)}
                        />
                        <StatusItem
                          label="Orders updated"
                          value={String(recalcResult.orders_updated)}
                        />
                        <StatusItem
                          label="Items checked"
                          value={String(recalcResult.order_items_checked)}
                        />
                        <StatusItem
                          label="Items with cost"
                          value={String(recalcResult.order_items_with_cost)}
                        />
                        <StatusItem
                          label="Items missing cost"
                          value={String(recalcResult.order_items_missing_cost)}
                        />
                        <StatusItem
                          label="Orders missing cost"
                          value={String(recalcResult.orders_with_missing_costs)}
                        />
                        <StatusItem
                          label="Total items_cost before"
                          value={recalcResult.total_items_cost_before.toFixed(2)}
                        />
                        <StatusItem
                          label="Total items_cost after"
                          value={recalcResult.total_items_cost_after.toFixed(2)}
                        />
                        <StatusItem
                          label="Packaging checked"
                          value={String(recalcResult.packaging_costs_checked)}
                        />
                        <StatusItem
                          label="Packaging updated"
                          value={String(recalcResult.packaging_costs_updated)}
                        />
                        <StatusItem
                          label="Manual packaging preserved"
                          value={String(recalcResult.packaging_costs_preserved_manual)}
                        />
                        <StatusItem
                          label="Total packaging before"
                          value={recalcResult.total_packaging_cost_before.toFixed(2)}
                        />
                        <StatusItem
                          label="Total packaging after"
                          value={recalcResult.total_packaging_cost_after.toFixed(2)}
                        />
                        <StatusItem label="Failed" value={String(recalcResult.failed_count)} />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <SkuRemapSection />
              <AutoRemapSection />
              <UnmatchedSkuReportSection />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Clock className="h-5 w-5" />
                  Logs / Last Run
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <StatusItem label="Last sync date" value={fmtDateTime(settings?.last_sync_at)} />
                  <StatusItem
                    label="Last sync mode"
                    value={settings?.last_sync_mode ?? "not_run"}
                  />
                  <StatusItem
                    label="Orders imported"
                    value={String(settings?.last_orders_imported ?? 0)}
                  />
                  <StatusItem
                    label="Orders updated"
                    value={String(settings?.last_orders_updated ?? 0)}
                  />
                  <StatusItem label="Sync status" value={syncStatus} />
                  <StatusItem
                    label="Orders cursor"
                    value={fmtDateTime(settings?.last_orders_sync_cursor)}
                  />
                  <StatusItem
                    label="Last successful sync"
                    value={fmtDateTime(settings?.last_successful_orders_sync_at)}
                  />
                  <StatusItem label="Last error" value={settings?.last_error ?? "None"} />
                </div>

                {settings?.recent_runs && settings.recent_runs.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Recent Shopify runs</div>
                    <div className="space-y-2">
                      {settings.recent_runs.map((run) => (
                        <div
                          key={run.id}
                          className="grid gap-2 rounded-md border bg-background p-3 text-sm md:grid-cols-[1fr_auto_auto_auto]"
                        >
                          <div>
                            <div className="font-medium">{run.sync_type}</div>
                            <div className="text-xs text-muted-foreground">
                              {fmtDateTime(run.started_at)}
                            </div>
                            {run.error_message && (
                              <div className="mt-1 text-xs text-destructive">
                                {run.error_message}
                              </div>
                            )}
                          </div>
                          <Badge variant={run.status === "success" ? "default" : "destructive"}>
                            {run.status}
                          </Badge>
                          <div className="text-xs text-muted-foreground">
                            {run.records_processed} records
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {run.pages_fetched} pages
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}

function StatusBadge({
  status,
  connected,
  hasError,
}: {
  status: string;
  connected: boolean;
  hasError: boolean;
}) {
  if (hasError) return <Badge variant="destructive">error</Badge>;
  if (!connected) return <Badge variant="secondary">not connected</Badge>;
  if (status === "running") return <Badge variant="outline">running</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-4">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-2 break-words text-sm font-medium text-foreground">{value || "-"}</div>
    </div>
  );
}
