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
  missing_on_hand_count: number;
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
const RECALCULATE_FINANCE_COSTS_CONFIRMATION_MESSAGE =
  "This will overwrite existing local order item costs with the latest synced Shopify costs so order profits reflect the current cost per item. It will NOT change Shopify, selling price, shipping cost, packaging cost, Kashier fees, statuses, notes, or customer data. Continue?";
const DAILY_INVENTORY_NOTE_TEXT =
  `Daily inventory update: Click "Sync Inventory from Shopify" after changing products, variants, quantities, prices, costs, SKUs, images, or product status in Shopify.
Important: If Cost per item was changed and you want existing order profits to update, click "Recalculate Finance Costs" manually after syncing inventory. Keep these two actions separate.`;

type DailyInventorySyncResult = {
  products_processed: number;
  variants_processed: number;
  inventory_rows_created: number;
  inventory_rows_updated: number;
  rows_marked_stale: number | null;
  missing_cost_count: number;
  missing_sale_price_count: number | null;
  duplicate_skus_found: number | null;
  failed_count: number;
  last_synced_at: string;
};

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
  const [productSyncError, setProductSyncError] = useState<string | null>(null);
  const [inventoryCostSyncError, setInventoryCostSyncError] = useState<string | null>(null);
  const [inventorySourceRefreshError, setInventorySourceRefreshError] = useState<string | null>(null);
  const [inventoryReconciliationError, setInventoryReconciliationError] = useState<string | null>(null);
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
    order_items_inserted: number;
    order_items_updated: number;
    statuses_updated: number;
    missing_order_line_items_repaired: number;
    customer_fields_preserved: number;
    customer_fields_repaired_from_external_intake: number;
    pending_intake_rows_applied: number;
    still_unknown_count: number | null;
    shopify_orders_found: number;
    date_range_used: { from: string; to: string } | null;
    finished_at: string;
  } | null>(null);

  type RangeMode = "today" | "yesterday" | "last7" | "last30" | "month" | "custom";
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const toIso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
  const nowDate = new Date();
  const [rangeMode, setRangeMode] = useState<RangeMode>("last7");
  const [rangeMonth, setRangeMonth] = useState(String(nowDate.getMonth()));
  const [rangeYear, setRangeYear] = useState(String(nowDate.getFullYear()));
  const [customFrom, setCustomFrom] = useState(toIso(daysAgo(6)));
  const [customTo, setCustomTo] = useState(toIso(nowDate));
  const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const yearsList: number[] = (() => {
    const y = new Date().getFullYear();
    const out: number[] = [];
    for (let i = y - 5; i <= y + 1; i++) out.push(i);
    return out;
  })();
  const resolvedRange: { from: string; to: string } | null = (() => {
    if (rangeMode === "today") { const t = toIso(new Date()); return { from: t, to: t }; }
    if (rangeMode === "yesterday") { const t = toIso(daysAgo(1)); return { from: t, to: t }; }
    if (rangeMode === "last7") return { from: toIso(daysAgo(6)), to: toIso(new Date()) };
    if (rangeMode === "last30") return { from: toIso(daysAgo(29)), to: toIso(new Date()) };
    if (rangeMode === "month") {
      const y = Number(rangeYear); const m = Number(rangeMonth);
      if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
      const first = new Date(y, m, 1); const last = new Date(y, m + 1, 0);
      return { from: toIso(first), to: toIso(last) };
    }
    if (rangeMode === "custom") {
      if (!customFrom || !customTo) return null;
      return customFrom <= customTo ? { from: customFrom, to: customTo } : { from: customTo, to: customFrom };
    }
    return null;
  })();

  const [dailyInventoryRunning, setDailyInventoryRunning] = useState(false);
  const [dailyInventoryResult, setDailyInventoryResult] =
    useState<DailyInventorySyncResult | null>(null);
  const [dailyInventoryError, setDailyInventoryError] = useState<string | null>(null);
  const [lastFinanceRecalcAt, setLastFinanceRecalcAt] = useState<string | null>(null);

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


  const syncOrders = async (mode: "incremental" | "full_backfill" | "date_range") => {
    if (
      mode === "full_backfill" &&
      !window.confirm("This will import all historical Shopify orders and may take time. Continue?")
    ) {
      return;
    }

    let body: Record<string, unknown> = { mode };
    if (mode === "date_range") {
      if (!resolvedRange) { toast.error("Please pick a valid date range."); return; }
      body = { mode: "date_range", date_from: resolvedRange.from, date_to: resolvedRange.to };
    }

    const setBusy = mode === "incremental" ? setSyncingRecent : setSyncingBackfill;
    setBusy(true);
    try {
      const res = await fetch("/api/shopify/sync-orders", {
        method: "POST",
        headers: {
          ...(await authHeader()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Shopify orders sync failed.");

      setOrdersSyncResult({
        mode: json.mode ?? mode,
        created: json.created ?? 0,
        updated: json.updated ?? 0,
        failed: json.failed ?? 0,
        order_items_processed: json.order_items_processed ?? 0,
        order_items_inserted: json.order_items_inserted ?? 0,
        order_items_updated: json.order_items_updated ?? 0,
        statuses_updated: json.statuses_updated ?? 0,
        missing_order_line_items_repaired: json.missing_order_line_items_repaired ?? 0,
        customer_fields_preserved: json.customer_fields_preserved ?? 0,
        customer_fields_repaired_from_external_intake: json.customer_fields_repaired_from_external_intake ?? 0,
        pending_intake_rows_applied: json.pending_intake_rows_applied ?? 0,
        still_unknown_count: json.still_unknown_count ?? null,
        shopify_orders_found: json.shopify_orders_found ?? 0,
        date_range_used: json.date_range_used ?? null,
        finished_at: new Date().toISOString(),
      });

      const message = `Sync finished: ${json.created ?? 0} new, ${json.updated ?? 0} updated.`;
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
        throw new Error(json.error ?? json.errors?.[0] ?? "Could not repair missing order line items.");
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
        toast.success(`Repaired ${result.repaired_orders} orders and inserted ${result.line_items_inserted} line items.`);
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
        missing_on_hand_count: json.missing_on_hand_count ?? 0,
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
        toast.success(`Inventory refreshed from Shopify source data: ${result.variants_processed} variants.`);
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
      setLastFinanceRecalcAt(new Date().toISOString());
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

  const runDailyInventorySync = async () => {
    setDailyInventoryRunning(true);
    setDailyInventoryResult(null);
    setDailyInventoryError(null);
    try {
      const headers = { ...(await authHeader()), "Content-Type": "application/json" };
      toast.info("Syncing products from Shopify…");
      const prodRes = await fetch("/api/shopify/sync-products", { method: "POST", headers });
      const prodJson = await prodRes.json().catch(() => ({}));
      if (!prodRes.ok || !prodJson.ok) {
        throw new Error(prodJson.error ?? "Shopify products sync failed.");
      }
      setProductSyncResult({
        status: prodJson.status ?? "success",
        message: prodJson.message ?? null,
        products_processed: prodJson.products_processed ?? 0,
        products_created: prodJson.products_created ?? 0,
        products_updated: prodJson.products_updated ?? 0,
        variants_processed: prodJson.variants_processed ?? 0,
        variants_created: prodJson.variants_created ?? 0,
        variants_updated: prodJson.variants_updated ?? 0,
        failed_count: prodJson.failed_count ?? 0,
        pages_fetched: prodJson.pages_fetched ?? 0,
        shop_domain_used: prodJson.shop_domain_used ?? null,
        api_version_used: prodJson.api_version_used ?? null,
        api_method_used: prodJson.api_method_used ?? null,
        first_api_response_product_count: prodJson.first_api_response_product_count ?? null,
        stopped_reason: prodJson.stopped_reason ?? null,
        raw_shopify_response_shape_summary: prodJson.raw_shopify_response_shape_summary ?? null,
      });

      toast.info("Syncing inventory levels and costs from Shopify…");
      const invRes = await fetch("/api/shopify/sync-inventory-cost", { method: "POST", headers });
      const invJson = await invRes.json().catch(() => ({}));
      if (!invRes.ok || !invJson.ok) {
        throw new Error(invJson.error ?? "Shopify inventory and cost sync failed.");
      }
      setInventoryCostSyncResult({
        inventory_items_processed: invJson.inventory_items_processed ?? 0,
        inventory_items_with_cost: invJson.inventory_items_with_cost ?? 0,
        inventory_items_missing_cost: invJson.inventory_items_missing_cost ?? 0,
        locations_processed: invJson.locations_processed ?? 0,
        inventory_levels_processed: invJson.inventory_levels_processed ?? 0,
        inventory_levels_with_on_hand: invJson.inventory_levels_with_on_hand ?? 0,
        inventory_levels_missing_on_hand: invJson.inventory_levels_missing_on_hand ?? 0,
        on_hand_quantity_source: invJson.on_hand_quantity_source ?? null,
        on_hand_fallback_used: Boolean(invJson.on_hand_fallback_used),
        variant_on_hand_quantities_processed: invJson.variant_on_hand_quantities_processed ?? 0,
        variant_on_hand_quantities_updated: invJson.variant_on_hand_quantities_updated ?? 0,
        variant_on_hand_quantity_fallbacks: invJson.variant_on_hand_quantity_fallbacks ?? 0,
        failed_count: invJson.failed_count ?? 0,
        pages_fetched: invJson.pages_fetched ?? 0,
      });

      toast.info("Refreshing inventory from Shopify source of truth…");
      const refRes = await fetch("/api/shopify/refresh-inventory-source-of-truth", {
        method: "POST",
        headers,
      });
      const refJson = await refRes.json().catch(() => ({}));
      if (!refRes.ok || !refJson.ok) {
        throw new Error(refJson.error ?? "Inventory source-of-truth refresh failed.");
      }
      setInventorySourceRefreshResult({
        status: refJson.status ?? "success",
        variants_processed: refJson.variants_processed ?? 0,
        inventory_rows_created: refJson.inventory_rows_created ?? 0,
        inventory_rows_updated: refJson.inventory_rows_updated ?? 0,
        stale_rows_marked: refJson.stale_rows_marked ?? 0,
        missing_on_hand_count: refJson.missing_on_hand_count ?? 0,
        source: refJson.source ?? "synced_shopify_products_variants_inventory_levels",
        sku_remaps_used: Boolean(refJson.sku_remaps_used),
        shopify_write_calls: Boolean(refJson.shopify_write_calls),
      });

      // Read-only aggregates against the inventory table (non-stale only).
      let missingSalePriceCount: number | null = null;
      let duplicateSkusFound: number | null = null;
      try {
        const { count: missingCount } = await supabase
          .from("inventory")
          .select("id", { count: "exact", head: true })
          .eq("is_shopify_stale", false)
          .or("sale_price.is.null,sale_price.eq.0");
        missingSalePriceCount = missingCount ?? 0;

        const { data: skuRows } = await supabase
          .from("inventory")
          .select("sku")
          .eq("is_shopify_stale", false);
        if (Array.isArray(skuRows)) {
          const counts = new Map<string, number>();
          for (const row of skuRows) {
            const sku = (row as { sku: string | null }).sku;
            if (!sku) continue;
            counts.set(sku, (counts.get(sku) ?? 0) + 1);
          }
          let dupes = 0;
          for (const v of counts.values()) if (v > 1) dupes++;
          duplicateSkusFound = dupes;
        }
      } catch {
        // Non-fatal — aggregates just stay as "—".
      }

      const merged: DailyInventorySyncResult = {
        products_processed: prodJson.products_processed ?? 0,
        variants_processed: refJson.variants_processed ?? prodJson.variants_processed ?? 0,
        inventory_rows_created: refJson.inventory_rows_created ?? 0,
        inventory_rows_updated: refJson.inventory_rows_updated ?? 0,
        rows_marked_stale: refJson.stale_rows_marked ?? 0,
        missing_cost_count: invJson.inventory_items_missing_cost ?? 0,
        missing_sale_price_count: missingSalePriceCount,
        duplicate_skus_found: duplicateSkusFound,
        failed_count:
          (prodJson.failed_count ?? 0) + (invJson.failed_count ?? 0),
        last_synced_at: new Date().toISOString(),
      };
      setDailyInventoryResult(merged);
      toast.success(
        `Inventory synced: ${merged.products_processed} products, ${merged.variants_processed} variants, ${merged.inventory_rows_updated} rows updated.`,
      );
      await qc.invalidateQueries({ queryKey: ["shopify-settings"] });
      await qc.invalidateQueries({ queryKey: ["shopify-inventory-report"] });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setDailyInventoryError(message);
      toast.error(message);
    } finally {
      setDailyInventoryRunning(false);
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
                  <Warehouse className="h-5 w-5" />
                  Inventory Daily Workflow
                </CardTitle>
                <CardDescription>
                  Two primary buttons for daily inventory management. Run these — nothing else — for
                  routine Shopify updates.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={runDailyInventorySync}
                    disabled={
                      !canOps ||
                      dailyInventoryRunning ||
                      syncingProducts ||
                      syncingInventoryCost ||
                      refreshingInventorySource ||
                      reconcilingInventory
                    }
                  >
                    <RefreshCw
                      className={`mr-2 h-4 w-4 ${dailyInventoryRunning ? "animate-spin" : ""}`}
                    />
                    Sync Inventory from Shopify
                  </Button>
                  <Button
                    onClick={forceUpdateOrderItemCosts}
                    disabled={!canOps || forcingCostUpdate}
                    variant="secondary"
                  >
                    <RefreshCw
                      className={`mr-2 h-4 w-4 ${forcingCostUpdate ? "animate-spin" : ""}`}
                    />
                    Recalculate Finance Costs
                  </Button>
                </div>
                {!canOps && (
                  <p className="text-sm text-muted-foreground">
                    Admin or operations access is required.
                  </p>
                )}
                <div className="whitespace-pre-line rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                  {DAILY_INVENTORY_NOTE_TEXT}
                </div>
                {dailyInventoryError && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {dailyInventoryError}
                  </div>
                )}
                {dailyInventoryResult && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Sync Inventory from Shopify — result</div>
                    <div className="grid gap-3 rounded-md border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-4">
                      <StatusItem
                        label="Products processed"
                        value={String(dailyInventoryResult.products_processed)}
                      />
                      <StatusItem
                        label="Variants processed"
                        value={String(dailyInventoryResult.variants_processed)}
                      />
                      <StatusItem
                        label="Inventory rows created"
                        value={String(dailyInventoryResult.inventory_rows_created)}
                      />
                      <StatusItem
                        label="Inventory rows updated"
                        value={String(dailyInventoryResult.inventory_rows_updated)}
                      />
                      <StatusItem
                        label="Rows marked stale"
                        value={
                          dailyInventoryResult.rows_marked_stale === null
                            ? "—"
                            : String(dailyInventoryResult.rows_marked_stale)
                        }
                      />
                      <StatusItem
                        label="Missing cost count"
                        value={String(dailyInventoryResult.missing_cost_count)}
                      />
                      <StatusItem
                        label="Missing sale price count"
                        value={
                          dailyInventoryResult.missing_sale_price_count === null
                            ? "—"
                            : String(dailyInventoryResult.missing_sale_price_count)
                        }
                      />
                      <StatusItem
                        label="Duplicate Shopify SKUs"
                        value={
                          dailyInventoryResult.duplicate_skus_found === null
                            ? "—"
                            : String(dailyInventoryResult.duplicate_skus_found)
                        }
                      />
                      <StatusItem
                        label="Failed"
                        value={String(dailyInventoryResult.failed_count)}
                      />
                      <StatusItem
                        label="Last synced"
                        value={fmtDateTime(dailyInventoryResult.last_synced_at)}
                      />
                    </div>
                  </div>
                )}
                {forceCostResult && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium">
                      Recalculate Finance Costs — result
                    </div>
                    <div className="grid gap-3 rounded-md border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-3">
                      <StatusItem
                        label="Orders checked"
                        value={String(forceCostResult.orders_recalculated)}
                      />
                      <StatusItem
                        label="Order items recalculated"
                        value={String(forceCostResult.items_updated)}
                      />
                      <StatusItem
                        label="Orders updated"
                        value={String(forceCostResult.orders_recalculated)}
                      />
                      <StatusItem
                        label="Missing cost items"
                        value={String(forceCostResult.missing_cost)}
                      />
                      <StatusItem
                        label="Failed"
                        value={String(forceCostResult.failed_count)}
                      />
                      <StatusItem
                        label="Last recalculated"
                        value={fmtDateTime(lastFinanceRecalcAt)}
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

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
                  Import or refresh all Shopify orders within a specific date range.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="text-xs font-medium">Range</label>
                    <select
                      className="block h-9 w-40 rounded-md border bg-background px-2 text-sm"
                      value={rangeMode}
                      onChange={(e) => setRangeMode(e.target.value as RangeMode)}
                    >
                      <option value="today">Today</option>
                      <option value="yesterday">Yesterday</option>
                      <option value="last7">Last 7 days</option>
                      <option value="last30">Last 30 days</option>
                      <option value="month">Single month</option>
                      <option value="custom">Custom range</option>
                    </select>
                  </div>
                  {rangeMode === "month" && (
                    <>
                      <div>
                        <label className="text-xs font-medium">Month</label>
                        <select
                          className="block h-9 w-32 rounded-md border bg-background px-2 text-sm"
                          value={rangeMonth}
                          onChange={(e) => setRangeMonth(e.target.value)}
                        >
                          {MONTH_LABELS.map((m, i) => (
                            <option key={m} value={String(i)}>{m}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium">Year</label>
                        <select
                          className="block h-9 w-24 rounded-md border bg-background px-2 text-sm"
                          value={rangeYear}
                          onChange={(e) => setRangeYear(e.target.value)}
                        >
                          {yearsList.map((y) => (
                            <option key={y} value={String(y)}>{y}</option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                  {rangeMode === "custom" && (
                    <>
                      <div>
                        <label className="text-xs font-medium">From</label>
                        <input type="date" className="block h-9 w-40 rounded-md border bg-background px-2 text-sm" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                      </div>
                      <div>
                        <label className="text-xs font-medium">To</label>
                        <input type="date" className="block h-9 w-40 rounded-md border bg-background px-2 text-sm" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                      </div>
                    </>
                  )}
                  <Button
                    onClick={() => syncOrders("date_range")}
                    disabled={syncingRecent || syncingBackfill || resettingOrders || !resolvedRange}
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${syncingBackfill ? "animate-spin" : ""}`} />
                    Full Backfill Orders
                  </Button>
                  {resolvedRange && (
                    <span className="text-xs text-muted-foreground pb-2">
                      {resolvedRange.from} → {resolvedRange.to}
                    </span>
                  )}
                </div>

                {ordersSyncResult && (
                  <div className="rounded-md border bg-muted/30 p-4 space-y-2">
                    <div className="text-sm font-medium">
                      Last sync result
                      <span className="ml-2 text-xs text-muted-foreground">({ordersSyncResult.mode})</span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <StatusItem label="Date range used" value={ordersSyncResult.date_range_used ? `${ordersSyncResult.date_range_used.from} → ${ordersSyncResult.date_range_used.to}` : "—"} />
                      <StatusItem label="Shopify orders found" value={String(ordersSyncResult.shopify_orders_found)} />
                      <StatusItem label="Orders created" value={String(ordersSyncResult.created)} />
                      <StatusItem label="Orders updated" value={String(ordersSyncResult.updated)} />
                      <StatusItem label="Items processed" value={String(ordersSyncResult.order_items_processed)} />
                      <StatusItem label="Missing order line items repaired" value={String(ordersSyncResult.missing_order_line_items_repaired)} />
                      <StatusItem label="Order items created" value={String(ordersSyncResult.order_items_inserted)} />
                      <StatusItem label="Order items updated" value={String(ordersSyncResult.order_items_updated)} />
                      <StatusItem label="Statuses updated" value={String(ordersSyncResult.statuses_updated)} />
                      <StatusItem label="Customer fields preserved" value={String(ordersSyncResult.customer_fields_preserved)} />
                      <StatusItem label="Customer fields repaired from external intake" value={String(ordersSyncResult.customer_fields_repaired_from_external_intake)} />
                      <StatusItem label="Pending intake rows applied" value={String(ordersSyncResult.pending_intake_rows_applied)} />
                      <StatusItem label="Still unknown count" value={ordersSyncResult.still_unknown_count == null ? "—" : String(ordersSyncResult.still_unknown_count)} />
                      <StatusItem label="Failed count" value={String(ordersSyncResult.failed)} />
                      <StatusItem label="Last synced" value={new Date(ordersSyncResult.finished_at).toLocaleString()} />
                    </div>
                  </div>
                )}
                {resetResult && (
                  <div className="grid gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 sm:grid-cols-2 lg:grid-cols-5">
                    <StatusItem label="Deleted orders" value={String(resetResult.deleted_orders_count)} />
                    <StatusItem label="Deleted items" value={String(resetResult.deleted_order_items_count)} />
                    <StatusItem label="Deleted notes" value={String(resetResult.deleted_order_notes_count)} />
                    <StatusItem label="Deleted activity" value={String(resetResult.deleted_order_activity_count)} />
                    <StatusItem label="Cursor reset" value={resetResult.cursor_reset ? "true" : "false"} />
                  </div>
                )}
              </CardContent>
            </Card>


            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Setup &amp; Maintenance Tools</CardTitle>
                <CardDescription>
                  Use these tools only when onboarding a new brand, importing historical Shopify
                  data, repairing historical product links, or fixing historical costs. These tools
                  are NOT part of the normal daily workflow.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="whitespace-pre-line rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                  {`For a new brand:
1. First use "Sync Inventory from Shopify" from the Daily Workflow section to import: products, variants, inventory, prices, costs, images, product status.
2. Then use "Full Backfill Orders" to import historical Shopify orders.
3. Only if historical products don't match correctly, use the maintenance tools below.`}
                </div>

                <details className="rounded-md border p-3 group">
                  <summary className="cursor-pointer text-sm font-medium">
                    SKU Mapping
                  </summary>
                  <div className="mt-3 space-y-4">
                    <p className="text-xs text-muted-foreground">
                      Use these tools only when historical order SKUs no longer match current
                      Shopify products or variants.
                    </p>
                    <SkuRemapSection />

                    <div className="rounded-md border p-3 space-y-2">
                      <div>
                        <h4 className="text-sm font-medium">Preview Unmatched SKUs</h4>
                        <p className="text-xs text-muted-foreground">
                          Read-only report showing order item SKUs that do not currently match
                          Shopify products/variants. Use this before creating SKU Remaps for a new
                          brand or historical data repair.
                        </p>
                      </div>
                      <UnmatchedSkuReportSection />
                    </div>

                    <div className="rounded-md border p-3 space-y-2">
                      <h4 className="text-sm font-medium">Auto-create Exact Remaps</h4>
                      <AutoRemapSection />
                    </div>
                  </div>
                </details>

                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    Historical Cost Repair
                  </summary>
                  <div className="mt-3 space-y-4">
                    <p className="text-xs text-muted-foreground">
                      Repairs historical order item costs after importing an old brand or repairing
                      SKU mappings.
                    </p>

                    <div className="space-y-3">
                      <div>
                        <h4 className="text-sm font-medium">Backfill Order Item Costs</h4>
                        <p className="text-xs text-muted-foreground">
                          Fills missing historical order costs using synced Shopify product costs.
                          Safe for imported brands.
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
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          <StatusItem label="Items checked" value={String(backfillResult.order_items_checked)} />
                          <StatusItem label="Items updated" value={String(backfillResult.order_items_updated)} />
                          <StatusItem label="Already had cost" value={String(backfillResult.order_items_already_had_cost)} />
                          <StatusItem label="Missing variant match" value={String(backfillResult.order_items_missing_variant_match)} />
                          <StatusItem label="Missing inventory cost" value={String(backfillResult.order_items_missing_inventory_cost)} />
                          <StatusItem label="Remaining unmatched" value={String(backfillResult.remaining_unmatched)} />
                          <StatusItem label="Failed" value={String(backfillResult.failed_count)} />
                        </div>
                      )}
                    </div>

                    <div className="border-t pt-4 space-y-3">
                      <div>
                        <h4 className="text-sm font-medium">Force Update Order Item Costs</h4>
                        <p className="text-xs text-muted-foreground">
                          Replaces existing historical order costs with current Shopify product
                          costs.
                        </p>
                        <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                          Warning: This may change historical profit calculations.
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
                      {forceCostError && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                          {forceCostError}
                        </div>
                      )}
                      {forceCostResult && (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          <StatusItem label="Items checked" value={String(forceCostResult.items_checked)} />
                          <StatusItem label="Items updated" value={String(forceCostResult.items_updated)} />
                          <StatusItem label="Orders recalculated" value={String(forceCostResult.orders_recalculated)} />
                          <StatusItem label="Missing cost" value={String(forceCostResult.missing_cost)} />
                          <StatusItem label="Failed" value={String(forceCostResult.failed_count)} />
                        </div>
                      )}
                    </div>
                  </div>
                </details>

                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    Order Maintenance
                  </summary>
                  <div className="mt-3 space-y-3">
                    <p className="text-xs text-muted-foreground">
                      One-time repair tools for recalculating historical order values.
                    </p>
                    <div>
                      <h4 className="text-sm font-medium">Recalculate Order &amp; Packaging Costs</h4>
                      <p className="text-xs text-muted-foreground">
                        Recalculates order costs and packaging costs after historical repairs. Not
                        intended for daily use.
                      </p>
                    </div>
                    <Button
                      onClick={() => {
                        if (window.confirm(RECALCULATE_FINANCE_COSTS_CONFIRMATION_MESSAGE)) {
                          void recalculateOrderCosts();
                        }
                      }}
                      disabled={!canOps || recalcingOrderCosts}
                      variant="secondary"
                    >
                      <RefreshCw
                        className={`mr-2 h-4 w-4 ${recalcingOrderCosts ? "animate-spin" : ""}`}
                      />
                      Recalculate Order &amp; Packaging Costs
                    </Button>
                    {recalcError && (
                      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                        {recalcError}
                      </div>
                    )}
                    {recalcResult && (
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <StatusItem label="Orders checked" value={String(recalcResult.orders_checked)} />
                        <StatusItem label="Orders updated" value={String(recalcResult.orders_updated)} />
                        <StatusItem label="Items checked" value={String(recalcResult.order_items_checked)} />
                        <StatusItem label="Packaging updated" value={String(recalcResult.packaging_costs_updated)} />
                        <StatusItem label="Manual packaging preserved" value={String(recalcResult.packaging_costs_preserved_manual)} />
                        <StatusItem label="Failed" value={String(recalcResult.failed_count)} />
                      </div>
                    )}
                  </div>
                </details>
              </CardContent>
            </Card>

            {canAdmin && (
              <details className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <summary className="cursor-pointer text-base font-medium text-destructive">
                  Dangerous Tools
                </summary>
                <div className="mt-3 space-y-3">
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                    Dangerous. This can delete local data. Do not use unless you intentionally want
                    to reset local orders. Shopify data is not modified.
                  </div>
                  <Button
                    variant="destructive"
                    onClick={resetAllLocalOrders}
                    disabled={syncingRecent || syncingBackfill || resettingOrders}
                  >
                    <Trash2 className={`mr-2 h-4 w-4 ${resettingOrders ? "animate-pulse" : ""}`} />
                    Reset All Local Orders
                  </Button>
                  {resetResult && (
                    <div className="grid gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 sm:grid-cols-2 lg:grid-cols-5">
                      <StatusItem label="Deleted orders" value={String(resetResult.deleted_orders_count)} />
                      <StatusItem label="Deleted items" value={String(resetResult.deleted_order_items_count)} />
                      <StatusItem label="Deleted notes" value={String(resetResult.deleted_order_notes_count)} />
                      <StatusItem label="Deleted activity" value={String(resetResult.deleted_order_activity_count)} />
                      <StatusItem label="Cursor reset" value={resetResult.cursor_reset ? "true" : "false"} />
                    </div>
                  )}
                </div>
              </details>
            )}


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
