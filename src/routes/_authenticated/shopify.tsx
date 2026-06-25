import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUser } from "@/hooks/use-user";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { fmtDateTime } from "@/lib/format";
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
  failed_count: number;
  pages_fetched: number;
};

type UnmatchedSample = {
  order_number: string | null;
  order_item_title: string | null;
  variant: string | null;
  sku: string | null;
  shopify_variant_id: string | null;
  reason: string;
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
  matched_by_barcode: number;
  matched_by_title_exact: number;
  mismatch_reasons: Record<string, number>;
  unmatched_samples: UnmatchedSample[];
  failed_count: number;
};

const RESET_CONFIRMATION_MESSAGE =
  "This will delete ALL orders from Mansouj Sales Hub only. It will NOT delete anything from Shopify. Continue?";
const RESET_SYNC_2026_CONFIRMATION_MESSAGE =
  "This will delete ALL local orders from Mansouj Sales Hub and then import only Shopify orders created in 2026. It will NOT delete anything from Shopify. Continue?";

function ShopifyPage() {
  const qc = useQueryClient();
  const { canAdmin, canOps } = useUser();
  const [testing, setTesting] = useState(false);
  const [syncingRecent, setSyncingRecent] = useState(false);
  const [syncingBackfill, setSyncingBackfill] = useState(false);
  const [syncingProducts, setSyncingProducts] = useState(false);
  const [syncingInventoryCost, setSyncingInventoryCost] = useState(false);
  const [resettingOrders, setResettingOrders] = useState(false);
  const [resetSyncing2026, setResetSyncing2026] = useState(false);
  const [resetResult, setResetResult] = useState<LocalOrdersResetResult | null>(null);
  const [resetSync2026Result, setResetSync2026Result] = useState<ResetSync2026Result | null>(null);
  const [productSyncResult, setProductSyncResult] = useState<ProductSyncResult | null>(null);
  const [inventoryCostSyncResult, setInventoryCostSyncResult] =
    useState<InventoryCostSyncResult | null>(null);
  const [productSyncError, setProductSyncError] = useState<string | null>(null);
  const [inventoryCostSyncError, setInventoryCostSyncError] = useState<string | null>(null);
  const [backfillingCosts, setBackfillingCosts] = useState(false);
  const [backfillResult, setBackfillResult] = useState<BackfillCostResult | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);

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

      const message = `${mode === "full_backfill" ? "Full backfill" : "Recent orders sync"} finished: ${json.created ?? 0} new, ${json.updated ?? 0} updated.`;
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
        failed_count: json.failed_count ?? 0,
        pages_fetched: json.pages_fetched ?? 0,
      };
      setInventoryCostSyncResult(result);
      toast.success(
        `Inventory & cost sync finished: ${result.inventory_items_processed} items, ${result.inventory_items_with_cost} with cost.`,
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
      if (!res.ok || json.status === "error")
        throw new Error(json.error ?? "Backfill failed.");

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
        matched_by_barcode: json.matched_by_barcode ?? 0,
        matched_by_title_exact: json.matched_by_title_exact ?? 0,
        mismatch_reasons: json.mismatch_reasons ?? {},
        unmatched_samples: Array.isArray(json.unmatched_samples)
          ? json.unmatched_samples
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
    <main className="min-h-screen bg-muted/30 px-4 py-6 md:px-8">
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
                    disabled={syncingRecent || syncingBackfill || resettingOrders || resetSyncing2026}
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${syncingRecent ? "animate-spin" : ""}`} />
                    Sync Recent Orders
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => syncOrders("full_backfill")}
                    disabled={syncingRecent || syncingBackfill || resettingOrders || resetSyncing2026}
                  >
                    <RefreshCw
                      className={`mr-2 h-4 w-4 ${syncingBackfill ? "animate-spin" : ""}`}
                    />
                    Full Backfill Orders
                  </Button>
                  {canAdmin && (
                    <>
                      <Button
                        variant="destructive"
                        onClick={resetAndSync2026Orders}
                        disabled={
                          syncingRecent || syncingBackfill || resettingOrders || resetSyncing2026
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
                          syncingRecent || syncingBackfill || resettingOrders || resetSyncing2026
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
                    <StatusItem
                      label="Created"
                      value={String(resetSync2026Result.created_count)}
                    />
                    <StatusItem
                      label="Updated"
                      value={String(resetSync2026Result.updated_count)}
                    />
                    <StatusItem
                      label="Failed"
                      value={String(resetSync2026Result.failed_count)}
                    />
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
                  <Button
                    onClick={syncProducts}
                    disabled={!canOps || syncingProducts || syncingInventoryCost}
                  >
                    <RefreshCw
                      className={`mr-2 h-4 w-4 ${syncingProducts ? "animate-spin" : ""}`}
                    />
                    Sync Products
                  </Button>
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
                        <StatusItem
                          label="Failed"
                          value={String(productSyncResult.failed_count)}
                        />
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
                            productSyncResult.raw_shopify_response_shape_summary?.response_keys?.join(", ") ||
                            "-"
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
                  <Button
                    onClick={syncInventoryCost}
                    disabled={!canOps || syncingProducts || syncingInventoryCost}
                  >
                    <RefreshCw
                      className={`mr-2 h-4 w-4 ${syncingInventoryCost ? "animate-spin" : ""}`}
                    />
                    Sync Inventory & Cost
                  </Button>
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
                        label="Pages fetched"
                        value={String(inventoryCostSyncResult.pages_fetched)}
                      />
                      <StatusItem
                        label="Failed"
                        value={String(inventoryCostSyncResult.failed_count)}
                      />
                    </div>
                  )}

                  <div className="border-t pt-4 space-y-3">
                    <div>
                      <h4 className="text-sm font-medium">Backfill Order Item Costs</h4>
                      <p className="text-xs text-muted-foreground">
                        Updates local order items with synced Shopify product cost. Does not
                        modify Shopify.
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
                        <StatusItem
                          label="Failed"
                          value={String(backfillResult.failed_count)}
                        />
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
                          Unmatched preview (first{" "}
                          {backfillResult.unmatched_samples.length})
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
                                  <td className="px-2 py-1">
                                    {s.order_item_title ?? "—"}
                                  </td>
                                  <td className="px-2 py-1">{s.variant ?? "—"}</td>
                                  <td className="px-2 py-1 font-mono">
                                    {s.sku ?? "—"}
                                  </td>
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
                  </div>
                </CardContent>
              </Card>
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
    </main>
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
