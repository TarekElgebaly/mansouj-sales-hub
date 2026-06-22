import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDateTime } from "@/lib/format";
import { AlertCircle, CheckCircle2, Clock, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/shopify")({
  head: () => ({ meta: [{ title: "Shopify Sync Status — Mansouj" }] }),
  component: ShopifyPage,
});

type ShopifySyncStatus = {
  api_version?: string;
  shop_domain?: string | null;
  configured_shop_domain?: string | null;
  installed_shop_domain?: string | null;
  domain_mismatch?: boolean;
  install_status?: string | null;
  token_stored?: boolean | null;
  granted_scopes?: string[] | null;
  installed_at?: string | null;
  last_sync_at?: string | null;
  last_sync_status?: string | null;
  last_orders_imported?: number | null;
  last_orders_updated?: number | null;
  last_connection_test_at?: string | null;
  last_connection_test_status?: string | null;
  last_error?: string | null;
  last_connection_test_error?: string | null;
  updated_at?: string | null;
};

function ShopifyPage() {
  const { data: settings, isLoading } = useQuery({
    queryKey: ["shopify-settings"],
    queryFn: async () => {
      const res = await fetch("/api/shopify/sync-status");
      if (!res.ok) throw new Error("Could not load Shopify sync status.");
      return (await res.json()) as ShopifySyncStatus;
    },
    refetchInterval: 15000,
  });

  const syncStatus = settings?.last_sync_status ?? "idle";
  const installStatus = settings?.install_status ?? "not_connected";
  const connected =
    installStatus === "connected" ||
    installStatus === "connected_missing_scopes" ||
    Boolean(settings?.token_stored);
  const hasError =
    syncStatus === "error" || Boolean(settings?.last_error || settings?.last_connection_test_error);
  const shopDomain = settings?.shop_domain ?? "Not connected";

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-6 md:px-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Shopify Sync Status</h1>
            <p className="mt-1 text-sm text-muted-foreground">Mansouj Sales Hub</p>
          </div>
          <StatusBadge status={syncStatus} connected={connected} hasError={hasError} />
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              {hasError ? (
                <AlertCircle className="h-5 w-5 text-destructive" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              )}
              Current Status
            </CardTitle>
            <CardDescription>
              This screen is read-only. Tokens stay on the server and are never shown here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {isLoading ? (
              <div className="flex items-center gap-2 rounded-md border p-4 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Loading Shopify status...
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <StatusItem label="Connected shop" value={shopDomain} />
                  {settings?.configured_shop_domain &&
                    settings.configured_shop_domain !== shopDomain && (
                      <StatusItem label="Configured shop" value={settings.configured_shop_domain} />
                    )}
                  <StatusItem label="Install status" value={installStatus} />
                  <StatusItem
                    label="Admin API token"
                    value={settings?.token_stored ? "Stored server-side" : "Not connected"}
                  />
                  <StatusItem
                    label="Connection test"
                    value={settings?.last_connection_test_status ?? "not_tested"}
                  />
                  <StatusItem label="Last sync" value={fmtDateTime(settings?.last_sync_at)} />
                  <StatusItem label="Sync status" value={syncStatus} />
                  <StatusItem
                    label="Orders imported"
                    value={String(settings?.last_orders_imported ?? 0)}
                  />
                  <StatusItem
                    label="Orders updated"
                    value={String(settings?.last_orders_updated ?? 0)}
                  />
                </div>

                <div className="rounded-md border bg-background p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    Last checked
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {fmtDateTime(settings?.last_connection_test_at ?? settings?.updated_at)}
                  </div>
                </div>

                {(settings?.last_error || settings?.last_connection_test_error) && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-destructive">
                      <AlertCircle className="h-4 w-4" />
                      Last problem
                    </div>
                    <div className="space-y-1 text-sm text-destructive">
                      {settings?.last_error && <p>{settings.last_error}</p>}
                      {settings?.last_connection_test_error && (
                        <p>{settings.last_connection_test_error}</p>
                      )}
                    </div>
                  </div>
                )}

                {settings?.granted_scopes && settings.granted_scopes.length > 0 && (
                  <div className="rounded-md border bg-background p-4">
                    <div className="mb-2 text-sm font-medium">Granted Shopify scopes</div>
                    <div className="flex flex-wrap gap-2">
                      {settings.granted_scopes.map((scope) => (
                        <Badge key={scope} variant="secondary">
                          {scope}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
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
  if (status === "success") return <Badge>success</Badge>;
  if (status === "running") return <Badge variant="outline">running</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-4">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-2 break-words text-sm font-medium text-foreground">{value || "—"}</div>
    </div>
  );
}
