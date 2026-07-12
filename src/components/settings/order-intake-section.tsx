import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type IntakeLog = {
  id: string;
  received_at: string;
  source: string | null;
  order_number: string | null;
  status: string;
  repaired_fields: unknown;
  error_message: string | null;
};

const SUCCESS_STATUSES = new Set(["repaired", "matched_no_changes", "duplicate"]);
const FAIL_STATUSES = new Set(["error", "not_found"]);

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "repaired") return "default";
  if (status === "matched_no_changes" || status === "duplicate") return "secondary";
  if (FAIL_STATUSES.has(status)) return "destructive";
  return "outline";
}

function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return v;
  }
}

export function OrderIntakeSection() {
  const webhookUrl = useMemo(
    () =>
      typeof window !== "undefined"
        ? `${window.location.origin}/api/orders/external-order-intake`
        : "/api/orders/external-order-intake",
    [],
  );
  const [copied, setCopied] = useState(false);

  const { data: status } = useQuery({
    queryKey: ["order-intake-status"],
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/orders/external-order-intake-status", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return { secretConfigured: false };
      return (await res.json()) as { secretConfigured: boolean };
    },
  });

  const { data: logs } = useQuery({
    queryKey: ["order-intake-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_intake_logs")
        .select("id,received_at,source,order_number,status,repaired_fields,error_message")
        .order("received_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as IntakeLog[];
    },
    refetchInterval: 15_000,
  });

  const { data: stats } = useQuery({
    queryKey: ["order-intake-stats"],
    queryFn: async () => {
      const { data: lastSuccess } = await supabase
        .from("order_intake_logs")
        .select("received_at")
        .in("status", ["repaired", "matched_no_changes", "duplicate"])
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: lastFail } = await supabase
        .from("order_intake_logs")
        .select("received_at")
        .in("status", ["error", "not_found"])
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { count } = await supabase
        .from("order_intake_logs")
        .select("id", { count: "exact", head: true })
        .eq("status", "repaired");
      return {
        lastSuccess: (lastSuccess?.received_at as string | undefined) ?? null,
        lastFail: (lastFail?.received_at as string | undefined) ?? null,
        repairedCount: count ?? 0,
      };
    },
    refetchInterval: 30_000,
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success("Webhook URL copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>External Order Data Intake</CardTitle>
        <CardDescription>
          Receive customer name/phone/address for existing orders from a trusted external Shopify
          automation. Contact fields only — never touches totals, costs, or statuses.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-xs text-muted-foreground">Webhook URL</label>
          <div className="flex gap-2 mt-1">
            <code className="flex-1 text-xs bg-muted px-2 py-1.5 rounded break-all">
              {webhookUrl}
            </code>
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Sender must include header <code>x-order-intake-secret</code> matching{" "}
            <code>ORDER_INTAKE_SECRET</code>.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <div className="text-xs text-muted-foreground">Secret configured</div>
            <div className="mt-1">
              <Badge variant={status?.secretConfigured ? "default" : "destructive"}>
                {status?.secretConfigured ? "Yes" : "No"}
              </Badge>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Last successful intake</div>
            <div className="text-sm">{fmtDate(stats?.lastSuccess)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Last failed intake</div>
            <div className="text-sm">{fmtDate(stats?.lastFail)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Orders repaired</div>
            <div className="text-sm font-medium">{stats?.repairedCount ?? 0}</div>
          </div>
        </div>

        <div>
          <div className="text-xs text-muted-foreground mb-2">Recent activity</div>
          <div className="border rounded overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">Received</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Order #</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Repaired fields</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(logs ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-4">
                      No intake events yet.
                    </TableCell>
                  </TableRow>
                )}
                {logs?.map((l) => {
                  const fields = Array.isArray(l.repaired_fields)
                    ? (l.repaired_fields as string[])
                    : [];
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {fmtDate(l.received_at)}
                      </TableCell>
                      <TableCell className="text-xs">{l.source ?? "—"}</TableCell>
                      <TableCell className="text-xs">{l.order_number ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(l.status)}>{l.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{fields.join(", ") || "—"}</TableCell>
                      <TableCell className="text-xs text-destructive">
                        {l.error_message ?? ""}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
