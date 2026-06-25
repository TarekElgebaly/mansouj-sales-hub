import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUser } from "@/hooks/use-user";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, RefreshCcw, Download, AlertTriangle, Plus } from "lucide-react";
import { toast } from "sonner";
import { CreateRemapDialog } from "./create-remap-dialog";

type ReportRow = {
  old_sku: string | null;
  item_title: string | null;
  variant: string | null;
  count: number;
  reason: string;
  example_order_numbers: string[];
};

type ReportResult = {
  generated_at: string;
  order_items_checked: number;
  remaining_unmatched: number;
  rows: ReportRow[];
};

function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportCsv(rows: ReportRow[]) {
  const header = [
    "old_sku",
    "count",
    "example_item_title",
    "example_variant",
    "example_order_numbers",
    "reason",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvEscape(r.old_sku),
        csvEscape(r.count),
        csvEscape(r.item_title),
        csvEscape(r.variant),
        csvEscape(r.example_order_numbers.join(" | ")),
        csvEscape(r.reason),
      ].join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `unmatched-sku-report-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function UnmatchedSkuReportSection() {
  const { canOps } = useUser();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remapTarget, setRemapTarget] = useState<ReportRow | null>(null);

  if (!canOps) return null;

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(
        "/api/shopify/backfill-order-item-costs?dry_run=1",
        {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to load unmatched report.");
      }
      const rows: ReportRow[] = Array.isArray(json.unmatched_sku_report)
        ? json.unmatched_sku_report
        : [];
      rows.sort((a, b) => b.count - a.count);
      setResult({
        generated_at: json.finished_at ?? new Date().toISOString(),
        order_items_checked: Number(json.order_items_checked ?? 0),
        remaining_unmatched: Number(json.remaining_unmatched ?? 0),
        rows,
      });
      toast.success(`Found ${rows.length} unmatched SKU groups.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Unmatched SKU Report
            </CardTitle>
            <CardDescription>
              Read-only analysis of order items that cannot be matched to a
              Shopify variant or active SKU remap. Grouped by old SKU, sorted
              by count. Does not modify any data.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={generate}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="mr-2 h-4 w-4" />
              )}
              {result ? "Refresh report" : "Generate report"}
            </Button>
            {result && result.rows.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => exportCsv(result.rows)}
              >
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="text-sm text-destructive">{error}</div>
        )}
        {!result && !loading && !error && (
          <div className="text-sm text-muted-foreground">
            Click <span className="font-medium">Generate report</span> to scan
            current order items against Shopify variants and active SKU
            remaps. No data will be changed.
          </div>
        )}
        {result && (
          <>
            <div className="text-xs text-muted-foreground">
              Checked {result.order_items_checked} order items ·{" "}
              {result.remaining_unmatched} still unmatched ·{" "}
              {result.rows.length} unique SKU groups · generated{" "}
              {new Date(result.generated_at).toLocaleString()}
            </div>
            {result.rows.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No unmatched SKUs. 🎉
              </div>
            ) : (
              <div className="border rounded-md max-h-[480px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Old SKU</TableHead>
                      <TableHead className="text-right">Count</TableHead>
                      <TableHead>Example item title</TableHead>
                      <TableHead>Example variant</TableHead>
                      <TableHead>Example order numbers</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.rows.map((r, idx) => (
                      <TableRow key={`${r.old_sku ?? "null"}-${r.reason}-${idx}`}>
                        <TableCell className="font-mono text-xs">
                          {r.old_sku ?? <span className="text-muted-foreground italic">null</span>}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {r.count}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.item_title ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.variant ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.example_order_numbers.length > 0
                            ? r.example_order_numbers.join(", ")
                            : "—"}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {r.reason}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
