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
import { Badge } from "@/components/ui/badge";
import { Loader2, Wand2, PlayCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type AutoStatus =
  | "exact_match_available"
  | "ambiguous"
  | "no_match"
  | "remap_exists";

type ResultRow = {
  old_sku: string;
  example_item_title: string | null;
  example_variant: string | null;
  count: number;
  status: AutoStatus;
  candidates_count?: number;
  matched_variant?: {
    shopify_variant_id: string;
    sku: string | null;
    inventory_item_id: string | null;
    product_title: string | null;
    variant_title: string | null;
  } | null;
};

type ApiResult = {
  apply: boolean;
  checked_sku_groups: number;
  auto_match_count: number;
  already_exists_count: number;
  no_match_count: number;
  ambiguous_match_count: number;
  auto_remaps_created: number;
  failed: number;
  last_error: string | null;
  results: ResultRow[];
};

async function callApi(apply: boolean): Promise<ApiResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(
    `/api/shopify/auto-remap-suggest${apply ? "?apply=1" : ""}`,
    {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? "Auto remap request failed");
  return json as ApiResult;
}

function statusBadge(s: AutoStatus) {
  switch (s) {
    case "exact_match_available":
      return <Badge className="bg-emerald-600 hover:bg-emerald-600">exact_match_available</Badge>;
    case "remap_exists":
      return <Badge variant="secondary">remap_exists</Badge>;
    case "ambiguous":
      return <Badge className="bg-amber-500 hover:bg-amber-500">ambiguous</Badge>;
    case "no_match":
      return <Badge variant="outline">no_match</Badge>;
  }
}

export function AutoRemapSection() {
  const { canOps } = useUser();
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canOps) return null;

  const preview = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await callApi(false);
      setResult(r);
      toast.success(
        `Preview: ${r.auto_match_count} exact, ${r.ambiguous_match_count} ambiguous, ${r.no_match_count} no match.`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      const r = await callApi(true);
      setResult(r);
      toast.success(
        `Created ${r.auto_remaps_created} remap(s). Run Backfill Order Item Costs manually.`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setApplying(false);
      setConfirmOpen(false);
    }
  };

  const hasExact = (result?.auto_match_count ?? 0) > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wand2 className="h-4 w-4 text-primary" />
              Auto-create exact remaps
            </CardTitle>
            <CardDescription>
              Suggests SKU remaps by matching unmatched order item titles +
              variant strings to local Shopify products/variants. Exact match
              only (case-insensitive, whitespace and <code>* × x</code> between
              digits normalized). No Shopify API calls. No order changes. No
              backfill is triggered.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={preview} disabled={loading || applying}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="mr-2 h-4 w-4" />
              )}
              Preview auto remaps
            </Button>
            <Button
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={!hasExact || loading || applying}
            >
              {applying ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="mr-2 h-4 w-4" />
              )}
              Create auto remaps
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        )}
        {!result && !loading && !error && (
          <div className="text-sm text-muted-foreground">
            Click <span className="font-medium">Preview auto remaps</span> to
            analyse unmatched SKUs. Nothing is saved.
          </div>
        )}
        {result && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
              <div className="rounded border p-2">
                <div className="text-muted-foreground">Checked groups</div>
                <div className="font-semibold text-base">{result.checked_sku_groups}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-muted-foreground">Exact match</div>
                <div className="font-semibold text-base text-emerald-600">{result.auto_match_count}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-muted-foreground">Already exists</div>
                <div className="font-semibold text-base">{result.already_exists_count}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-muted-foreground">Ambiguous</div>
                <div className="font-semibold text-base text-amber-600">{result.ambiguous_match_count}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-muted-foreground">No match</div>
                <div className="font-semibold text-base">{result.no_match_count}</div>
              </div>
            </div>
            {result.apply && (
              <div className="text-xs text-muted-foreground">
                Created {result.auto_remaps_created} remap(s) · {result.failed} failed.
                {" "}Run <span className="font-medium">Backfill Order Item Costs</span> manually to apply costs.
              </div>
            )}
            {result.results.length > 0 && (
              <div className="border rounded-md max-h-[480px] overflow-auto">
                <Table className="min-w-[820px]">
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="w-[140px]">Old SKU</TableHead>
                      <TableHead className="w-[70px] text-right">Count</TableHead>
                      <TableHead className="min-w-[200px]">Example title</TableHead>
                      <TableHead className="min-w-[140px]">Example variant</TableHead>
                      <TableHead className="w-[180px]">Auto match status</TableHead>
                      <TableHead className="min-w-[220px]">Matched / candidates</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.results.map((r, i) => (
                      <TableRow key={`${r.old_sku}-${i}`}>
                        <TableCell className="font-mono text-xs">{r.old_sku}</TableCell>
                        <TableCell className="text-right font-medium">{r.count}</TableCell>
                        <TableCell className="text-xs max-w-[260px] truncate">
                          {r.example_item_title ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs max-w-[180px] truncate">
                          {r.example_variant ?? "—"}
                        </TableCell>
                        <TableCell>{statusBadge(r.status)}</TableCell>
                        <TableCell className="text-xs">
                          {r.matched_variant ? (
                            <span className="font-mono">
                              {r.matched_variant.product_title} / {r.matched_variant.variant_title}
                              {r.matched_variant.sku ? ` · ${r.matched_variant.sku}` : ""}
                            </span>
                          ) : r.status === "ambiguous" ? (
                            <span className="text-muted-foreground">
                              {r.candidates_count} candidates — resolve manually
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
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

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create auto remaps?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create active SKU remaps for unmatched SKUs that have
              exactly one matching Shopify product and variant. It will not
              modify Shopify or order items. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applying}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={apply} disabled={applying}>
              {applying ? "Creating…" : "Create remaps"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
