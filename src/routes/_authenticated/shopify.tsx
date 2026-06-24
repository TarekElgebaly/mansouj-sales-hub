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

const RESET_CONFIRMATION_MESSAGE =
  "This will delete ALL orders from Mansouj Sales Hub only. It will NOT delete anything from Shopify. Continue?";

function ShopifyPage() {
  const qc = useQueryClient();
  const { canAdmin } = useUser();
  const [testing, setTesting] = useState(false);
  const [syncingRecent, setSyncingRecent] = useState(false);
  const [syncingBackfill, setSyncingBackfill] = useState(false);
  const [resettingOrders, setResettingOrders] = useState(false);
  const [resetResult, setResetResult] = useState<LocalOrdersResetResult | null>(null);

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

      toast.success(
        `${mode === "full_backfill" ? "Full backfill" : "Recent orders sync"} finished: ${json.created ?? 0} new, ${json.updated ?? 0} updated.`,
      );
      await refreshStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      await refreshStatus();
    } finally {
      setBusy(false);
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
                    disabled={syncingRecent || syncingBackfill || resettingOrders}
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${syncingRecent ? "animate-spin" : ""}`} />
                    Sync Recent Orders
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => syncOrders("full_backfill")}
                    disabled={syncingRecent || syncingBackfill || resettingOrders}
                  >
                    <RefreshCw
                      className={`mr-2 h-4 w-4 ${syncingBackfill ? "animate-spin" : ""}`}
                    />
                    Full Backfill Orders
                  </Button>
                  {canAdmin && (
                    <Button
                      variant="destructive"
                      onClick={resetAllLocalOrders}
                      disabled={syncingRecent || syncingBackfill || resettingOrders}
                    >
                      <Trash2
                        className={`mr-2 h-4 w-4 ${resettingOrders ? "animate-pulse" : ""}`}
                      />
                      Reset All Local Orders
                    </Button>
                  )}
                </div>
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
                  <CardDescription>Product sync backend is not enabled yet.</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-3">
                  <Button disabled>Sync Products</Button>
                  <Badge variant="secondary">Coming soon</Badge>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Warehouse className="h-5 w-5" />
                    Inventory & Cost
                  </CardTitle>
                  <CardDescription>
                    Inventory and cost sync backend is not enabled yet.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-3">
                  <Button disabled>Sync Inventory & Cost</Button>
                  <Badge variant="secondary">Coming soon</Badge>
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
