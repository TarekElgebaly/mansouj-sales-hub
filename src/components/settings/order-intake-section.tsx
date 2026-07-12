import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "repaired") return "default";
  if (status === "matched_no_changes" || status === "duplicate") return "secondary";
  if (status === "pending_not_found") return "outline";
  if (status === "error" || status === "not_found") return "destructive";
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
  const queryClient = useQueryClient();
  const [applying, setApplying] = useState(false);
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
      const [pending, repaired, notFound, lastRetry] = await Promise.all([
        supabase
          .from("order_intake_logs")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending_not_found"),
        supabase
          .from("order_intake_logs")
          .select("id", { count: "exact", head: true })
          .eq("status", "repaired"),
        supabase
          .from("order_intake_logs")
          .select("id", { count: "exact", head: true })
          .eq("status", "not_found"),
        supabase
          .from("order_intake_logs")
          .select("last_retry_at")
          .not("last_retry_at", "is", null)
          .order("last_retry_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        pendingCount: pending.count ?? 0,
        repairedCount: repaired.count ?? 0,
        notFoundCount: notFound.count ?? 0,
        lastRetryAt: (lastRetry.data?.last_retry_at as string | undefined) ?? null,
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

  const applyPending = async () => {
    setApplying(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/orders/apply-pending-intake", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ limit: 200 }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        attempted?: number;
        repaired?: number;
        matched_no_changes?: number;
        still_pending?: number;
        errors?: number;
      };
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? "Failed to apply pending intake");
      } else {
        toast.success(
          `Repaired ${json.repaired ?? 0}, matched no-changes ${json.matched_no_changes ?? 0}, still pending ${json.still_pending ?? 0}${json.errors ? `, errors ${json.errors}` : ""}`,
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["order-intake-stats"] }),
        queryClient.invalidateQueries({ queryKey: ["order-intake-logs"] }),
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to apply pending intake");
    } finally {
      setApplying(false);
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

        <div className="flex items-center gap-3">
          <Badge variant={status?.secretConfigured ? "default" : "destructive"}>
            Secret {status?.secretConfigured ? "configured" : "missing"}
          </Badge>
          <Button size="sm" onClick={applyPending} disabled={applying}>
            {applying ? "Applying…" : "Apply Pending Intake Data"}
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <div className="text-xs text-muted-foreground">Pending intake</div>
            <div className="text-sm font-medium">{stats?.pendingCount ?? 0}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Orders repaired</div>
            <div className="text-sm font-medium">{stats?.repairedCount ?? 0}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Not found (legacy)</div>
            <div className="text-sm font-medium">{stats?.notFoundCount ?? 0}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Last pending retry</div>
            <div className="text-sm">{fmtDate(stats?.lastRetryAt)}</div>
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
