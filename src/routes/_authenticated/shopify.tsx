import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { fmtDateTime } from "@/lib/format";
import { RefreshCw, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/shopify")({
  head: () => ({ meta: [{ title: "Shopify Sync — Mansouj" }] }),
  component: ShopifyPage,
});

type SyncResult = { ok: boolean; imported?: number; updated?: number; errors?: string[]; error?: string };
type ConnectionTestResult = {
  success: boolean;
  shop_domain?: string;
  api_version?: string;
  granted_scopes?: string[];
  missing_required_scopes?: string[];
  error?: string | null;
};

function ShopifyPage() {
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const { data: settings, refetch } = useQuery({
    queryKey: ["shopify-settings"],
    queryFn: async () => (await supabase.from("shopify_sync_settings").select("*").eq("id", 1).maybeSingle()).data,
  });

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const connectShopify = () => {
    window.location.href = "/api/shopify/auth/start";
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        toast.error("Please sign in again.");
        setTesting(false);
        return;
      }
      const res = await fetch("/api/shopify/test-connection", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as ConnectionTestResult;
      setTestResult(json);
      if (json.success) {
        toast.success("Shopify connection is working.");
      } else {
        toast.error(json.error ?? "Shopify connection test failed");
      }
    } catch (e) {
      const msg = (e as Error).message;
      setTestResult({ success: false, error: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
      refetch();
    }
  };

  const triggerSync = async () => {
    setSyncing(true);
    setResult(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        toast.error("Please sign in again.");
        setSyncing(false);
        return;
      }
      const res = await fetch("/api/shopify/sync-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ limit: 100 }),
      });
      const json = (await res.json()) as SyncResult;
      setResult(json);
      if (json.ok) {
        toast.success(`Sync complete — ${json.imported ?? 0} imported, ${json.updated ?? 0} updated`);
      } else {
        toast.error(json.error ?? "Sync failed");
      }
    } catch (e) {
      const msg = (e as Error).message;
      setResult({ ok: false, error: msg });
      toast.error(msg);
    } finally {
      setSyncing(false);
      refetch();
    }
  };

  const status = settings?.last_sync_status ?? "idle";
  const statusVariant =
    status === "success" ? "default" : status === "error" ? "destructive" : status === "running" ? "outline" : "secondary";

  return (
    <AppShell title="Shopify Sync">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5" />Shopify integration</CardTitle>
          <CardDescription>Your Shopify store is connected. Credentials are stored securely on the server — never in the frontend.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <div><Label>Store URL</Label><Input value={settings?.shop_domain ?? settings?.store_url ?? ""} readOnly /></div>
            <div><Label>Install status</Label><Input value={settings?.install_status ?? "not_connected"} readOnly /></div>
            <div><Label>Admin API token</Label><Input value={settings?.token_stored ? "Stored server-side" : "Not connected"} readOnly /></div>
            <div><Label>Webhook secret</Label><Input value="●●●●●●●● (managed)" readOnly /></div>
            <div><Label>Last sync</Label><Input value={fmtDateTime(settings?.last_sync_at)} readOnly /></div>
            <div><Label>Last imported</Label><Input value={String(settings?.last_orders_imported ?? 0)} readOnly /></div>
            <div><Label>Last updated</Label><Input value={String(settings?.last_orders_updated ?? 0)} readOnly /></div>
            <div><Label>Last connection test</Label><Input value={settings?.last_connection_test_status ?? "not_tested"} readOnly /></div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm">Status:</span>
            <Badge variant={statusVariant as never}>{status}</Badge>
          </div>
          {settings?.last_error && (
            <div className="text-xs text-destructive border border-destructive/30 rounded-md p-2">
              {settings.last_error}
            </div>
          )}
          {settings?.last_connection_test_error && (
            <div className="text-xs text-destructive border border-destructive/30 rounded-md p-2">
              {settings.last_connection_test_error}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={connectShopify} variant="outline">
              Connect Shopify
            </Button>
            <Button onClick={testConnection} disabled={testing}>
              {testing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
              {testing ? "Testing…" : "Test Shopify Connection"}
            </Button>
            <Button onClick={triggerSync} disabled={syncing}>
              {syncing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              {syncing ? "Syncing…" : "Sync orders now"}
            </Button>
          </div>

          {testResult && (
            <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${testResult.success ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
              {testResult.success ? <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-600" /> : <AlertCircle className="h-4 w-4 mt-0.5 text-destructive" />}
              <div>
                <div className="font-medium">{testResult.success ? "Connection working" : "Connection failed"}</div>
                <div className="text-muted-foreground">
                  {testResult.shop_domain && `${testResult.shop_domain} · `}
                  {testResult.api_version && `API ${testResult.api_version}`}
                  {testResult.error && testResult.error}
                </div>
                {testResult.missing_required_scopes && testResult.missing_required_scopes.length > 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Missing scopes: {testResult.missing_required_scopes.join(", ")}
                  </div>
                )}
              </div>
            </div>
          )}

          {result && (
            <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${result.ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
              {result.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-600" /> : <AlertCircle className="h-4 w-4 mt-0.5 text-destructive" />}
              <div>
                {result.ok ? (
                  <>
                    <div className="font-medium">Sync complete</div>
                    <div className="text-muted-foreground">
                      {result.imported ?? 0} imported · {result.updated ?? 0} updated
                      {result.errors && result.errors.length > 0 && ` · ${result.errors.length} errors`}
                    </div>
                    {result.errors && result.errors.length > 0 && (
                      <ul className="mt-1 list-disc list-inside text-xs text-muted-foreground">
                        {result.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    )}
                  </>
                ) : (
                  <>
                    <div className="font-medium">Sync failed</div>
                    <div className="text-muted-foreground">{result.error}</div>
                  </>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader><CardTitle className="text-base">Webhook endpoints</CardTitle><CardDescription>Configure these in your Shopify admin → Notifications → Webhooks.</CardDescription></CardHeader>
        <CardContent className="space-y-2 font-mono text-xs">
          <div className="border rounded-md p-2"><strong className="mr-2">POST</strong>{baseUrl}/api/public/shopify/webhooks/orders-create</div>
          <div className="border rounded-md p-2"><strong className="mr-2">POST</strong>{baseUrl}/api/public/shopify/webhooks/orders-updated</div>
          <div className="border rounded-md p-2"><strong className="mr-2">POST</strong>{baseUrl}/api/shopify/sync-orders</div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
