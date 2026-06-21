import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { fmtDateTime } from "@/lib/format";
import { RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/shopify")({
  head: () => ({ meta: [{ title: "Shopify Sync — Mansouj" }] }),
  component: ShopifyPage,
});

function ShopifyPage() {
  const { data: settings, refetch } = useQuery({
    queryKey: ["shopify-settings"],
    queryFn: async () => (await supabase.from("shopify_sync_settings").select("*").eq("id", 1).maybeSingle()).data,
  });

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const triggerSync = async () => {
    toast.info("Sync queued (placeholder — wire to /api/shopify/sync-orders)");
    await supabase.from("shopify_sync_settings").update({
      last_sync_at: new Date().toISOString(), last_sync_status: "queued",
    }).eq("id", 1);
    refetch();
  };

  return (
    <AppShell title="Shopify Sync">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5" />Shopify integration</CardTitle>
          <CardDescription>Your Shopify store is connected. Credentials are stored securely on the server — never in the frontend.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <div><Label>Store URL</Label><Input value={settings?.store_url ?? ""} readOnly /></div>
            <div><Label>Admin API token</Label><Input value="●●●●●●●● (managed)" readOnly /></div>
            <div><Label>Webhook secret</Label><Input value="●●●●●●●● (managed)" readOnly /></div>
            <div><Label>Last sync</Label><Input value={fmtDateTime(settings?.last_sync_at)} readOnly /></div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm">Status:</span>
            <Badge variant={settings?.last_sync_status === "queued" ? "outline" : "secondary"}>{settings?.last_sync_status ?? "idle"}</Badge>
          </div>
          <Button onClick={triggerSync}><RefreshCw className="h-4 w-4 mr-1" />Sync orders now</Button>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader><CardTitle className="text-base">Webhook endpoints</CardTitle><CardDescription>Configure these in your Shopify admin → Notifications → Webhooks.</CardDescription></CardHeader>
        <CardContent className="space-y-2 font-mono text-xs">
          <div className="border rounded-md p-2"><strong className="mr-2">POST</strong>{baseUrl}/api/shopify/webhooks/orders-create</div>
          <div className="border rounded-md p-2"><strong className="mr-2">POST</strong>{baseUrl}/api/shopify/webhooks/orders-updated</div>
          <div className="border rounded-md p-2"><strong className="mr-2">POST</strong>{baseUrl}/api/shopify/sync-orders</div>
          <div className="border rounded-md p-2"><strong className="mr-2">GET</strong>{baseUrl}/api/shopify/sync-status</div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
