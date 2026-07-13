import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { CONFIRMATION_STATUSES, ORDER_STATUSES, egp, fmtDate, statusTone } from "@/lib/format";
import { useUser } from "@/hooks/use-user";
import { Download, LayoutGrid, Loader2, Plus, RefreshCw, Table as TableIcon, X } from "lucide-react";
import Papa from "papaparse";
import { toast } from "sonner";
import { OrderDetail } from "@/components/order-detail";
import { saveOrderCosts } from "@/lib/order-costs";
import { calculatePackagingCost } from "@/lib/packaging-cost";
import { DateScopeFilter } from "@/components/date-scope-filter";
import { createDefaultDateScope, dateInScope, getDateScopeRange } from "@/lib/date-scope";
import { calculateKashierFees } from "@/lib/kashier-fees";

type SyncResult = {
  mode?: string;
  status?: string;
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
  finished_at: string;
};

export const Route = createFileRoute("/_authenticated/orders")({
  head: () => ({ meta: [{ title: "Orders — Mansouj" }] }),
  component: OrdersPage,
});

function OrdersPage() {
  const qc = useQueryClient();
  const { canOps, canFinance } = useUser();
  const canEditCosts = canOps || canFinance;
  const [search, setSearch] = useState("");
  const [city, setCity] = useState<string>("all");
  const [confStatus, setConfStatus] = useState<string>("all");
  const [orderStatus, setOrderStatus] = useState<string>("all");
  const [shipping, setShipping] = useState<string>("all");
  const [dateScope, setDateScope] = useState(() => createDefaultDateScope());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncingRange, setSyncingRange] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [restoringLineItems, setRestoringLineItems] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const now = new Date();
  const [rangeMode, setRangeMode] = useState<RangeMode>("last7");
  const [rangeMonth, setRangeMonth] = useState(String(now.getMonth()));
  const [rangeYear, setRangeYear] = useState(String(now.getFullYear()));
  const [customFrom, setCustomFrom] = useState(toIso(daysAgo(6)));
  const [customTo, setCustomTo] = useState(toIso(now));

  const resolvedRange = useMemo(
    () => computeRange(rangeMode, rangeMonth, rangeYear, customFrom, customTo),
    [rangeMode, rangeMonth, rangeYear, customFrom, customTo],
  );

  const applySyncJson = (json: any) => {
    setSyncResult({
      mode: json.mode,
      status: json.status,
      created: json.created ?? 0,
      updated: json.updated ?? 0,
      failed: json.failed ?? 0,
      order_items_processed: json.order_items_processed ?? 0,
      order_items_inserted: json.order_items_inserted ?? 0,
      order_items_updated: json.order_items_updated ?? 0,
      stale_order_items_removed: json.stale_order_items_removed ?? 0,
      affected_orders_recalculated: json.affected_orders_recalculated ?? 0,
      statuses_updated: json.statuses_updated ?? 0,
      cancelled_orders_updated: json.cancelled_orders_updated ?? 0,
      fulfillment_updates: json.fulfillment_updates ?? 0,
      customer_fields_preserved: json.customer_fields_preserved ?? 0,
      customer_fields_repaired_from_shopify: json.customer_fields_repaired_from_shopify ?? 0,
      customer_fields_repaired_from_external_intake: json.customer_fields_repaired_from_external_intake ?? 0,
      pending_intake_rows_applied: json.pending_intake_rows_applied ?? 0,
      still_unknown_count: json.still_unknown_count ?? null,
      shopify_orders_found: json.shopify_orders_found,
      date_range_used: json.date_range_used ?? null,
      finished_at: new Date().toISOString(),
    });
    qc.invalidateQueries({ queryKey: ["orders"] });
    qc.invalidateQueries({ queryKey: ["order-items"] });
    qc.invalidateQueries({ queryKey: ["orders-all"] });
    qc.invalidateQueries({ queryKey: ["shopify-settings"] });
  };

  const pullShopify = async () => {
    setSyncing(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) { toast.error("Please sign in again."); return; }
      const res = await fetch("/api/shopify/sync-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mode: "incremental" }),
      });
      const json = await res.json();
      if (json.ok) {
        applySyncJson(json);
        toast.success(`Synced recent orders — ${json.created ?? 0} new, ${json.updated ?? 0} updated${json.errors?.length ? `, ${json.errors.length} errors` : ""}`);
      } else {
        toast.error(json.error ?? "Shopify sync failed");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const syncByDateRange = async () => {
    if (!resolvedRange) {
      toast.error("Please pick a valid date range.");
      return;
    }
    setSyncingRange(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) { toast.error("Please sign in again."); return; }
      const res = await fetch("/api/shopify/sync-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          mode: "date_range",
          date_from: resolvedRange.from,
          date_to: resolvedRange.to,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        applySyncJson(json);
        toast.success(`Synced ${json.shopify_orders_found ?? 0} Shopify orders in range — ${json.created ?? 0} new, ${json.updated ?? 0} updated`);
      } else {
        toast.error(json.error ?? "Date-range sync failed");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncingRange(false);
    }
  };


  const repairUnknownCustomers = async () => {
    setRepairing(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) { toast.error("Please sign in again."); return; }
      const res = await fetch("/api/shopify/repair-unknown-customers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? "Repair failed");
        return;
      }
      toast.success(
        `Repair complete — ${json.updated ?? 0} updated, ${json.skipped ?? 0} skipped, ${json.failed ?? 0} failed (of ${json.candidates ?? 0} candidates)`,
      );
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["orders-all"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRepairing(false);
    }
  };

  const restoreOpenOrderLineItems = async () => {
    if (!openOrder) return;

    setRestoringLineItems(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        toast.error("Please sign in again.");
        return;
      }

      const res = await fetch("/api/orders/restore-line-items", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          order_id: openOrder.id,
          order_number: openOrder.order_number,
          shopify_order_id: openOrder.shopify_order_id,
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Could not restore line items.");
      }

      if (json.restored) {
        toast.success(`Restored ${json.restored_items_count ?? 0} line items for ${openOrder.order_number}`);
      } else {
        toast.info("This order already has local line items.");
      }

      qc.invalidateQueries({ queryKey: ["order-items"] });
      qc.invalidateQueries({ queryKey: ["order-items", openOrder.id] });
    } catch (error: any) {
      toast.error(error?.message || "Could not restore line items.");
    } finally {
      setRestoringLineItems(false);
    }
  };

  const { data: orders } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => (await supabase.from("orders").select("*").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: items } = useQuery({
    queryKey: ["order-items"],
    queryFn: async () => (await supabase.from("order_items").select("*")).data ?? [],
  });

  const cities = useMemo(() => Array.from(new Set((orders ?? []).map((o) => o.city).filter(Boolean))), [orders]);
  const shippingCos = useMemo(() => Array.from(new Set((orders ?? []).map((o) => o.shipping_company).filter(Boolean))), [orders]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return (orders ?? []).filter((o) => {
      if (q && ![o.order_number, o.customer_full_name, o.phone, o.shopify_order_id].some((v) => v?.toLowerCase().includes(q))) {
        const orderSkus = items?.filter((i) => i.order_id === o.id).map((i) => i.sku.toLowerCase()) ?? [];
        if (!orderSkus.some((s) => s.includes(q))) return false;
      }
      if (!dateInScope(o.order_date, dateScope)) return false;
      if (city !== "all" && o.city !== city) return false;
      if (confStatus !== "all" && o.confirmation_status !== confStatus) return false;
      if (orderStatus !== "all" && o.order_status !== orderStatus) return false;
      if (shipping !== "all" && o.shipping_company !== shipping) return false;
      return true;
    });
  }, [orders, items, search, city, confStatus, orderStatus, shipping, dateScope]);

  const dateScopeLabel = useMemo(() => getDateScopeRange(dateScope).label, [dateScope]);

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((o) => o.id)));
  };
  const toggle = (id: string) => {
    const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n);
  };

  const bulkStatus = async (status: string) => {
    if (!selected.size) return;
    const { error } = await supabase
      .from("orders")
      .update({ order_status: status as any, delivered: status === "Delivered" })
      .in("id", [...selected]);
    if (error) return toast.error(error.message);
    toast.success(`Updated ${selected.size} orders`);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["orders"] });
  };

  const exportCsv = () => {
    const csv = Papa.unparse(filtered);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `orders-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const openOrder = orders?.find((o) => o.id === openId);
  const openItemsSnapshot = useMemo(
    () => (items ?? []).filter((item) => item.order_id === openId),
    [items, openId],
  );
  const { data: openItems, isLoading: openItemsLoading, error: openItemsError } = useQuery({
    queryKey: ["order-items", openId],
    enabled: !!openId,
    queryFn: async () => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Please sign in again before opening order items.");
      const params = new URLSearchParams({ order_id: openId! });
      const res = await fetch(`/api/orders/items?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Could not load order line items.");
      }
      return Array.isArray(json.items) ? json.items : [];
    },
  });
  const detailItems = openItems?.length ? openItems : openItemsSnapshot;
  const detailItemsLoading = openItemsLoading && detailItems.length === 0;
  const detailItemsError =
    openItemsError instanceof Error && detailItems.length === 0 ? openItemsError.message : null;

  const yearsList = useMemo(() => {
    const y = new Date().getFullYear();
    const out: number[] = [];
    for (let i = y - 5; i <= y + 1; i++) out.push(i);
    return out;
  }, []);

  return (
    <AppShell title="Orders" search={search} onSearch={setSearch}
      actions={
        <div className="flex items-center gap-2">
          {canOps && <Button size="sm" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4 mr-1" />New Order</Button>}
          <Button size="sm" variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-1" />Export CSV</Button>
        </div>
      }>
      {canOps && (
        <Card className="mb-4">
          <CardContent className="p-4 space-y-4">
            <div className="text-sm font-semibold">Orders Sync</div>
            <div className="flex flex-wrap items-end gap-3">
              <Button size="sm" onClick={pullShopify} disabled={syncing || syncingRange}>
                <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing..." : "Sync Recent Orders"}
              </Button>

              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <Label className="text-xs">Range</Label>
                  <Select value={rangeMode} onValueChange={(v) => setRangeMode(v as RangeMode)}>
                    <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="today">Today</SelectItem>
                      <SelectItem value="yesterday">Yesterday</SelectItem>
                      <SelectItem value="last7">Last 7 days</SelectItem>
                      <SelectItem value="last30">Last 30 days</SelectItem>
                      <SelectItem value="month">Single month</SelectItem>
                      <SelectItem value="custom">Custom range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {rangeMode === "month" && (
                  <>
                    <div>
                      <Label className="text-xs">Month</Label>
                      <Select value={rangeMonth} onValueChange={setRangeMonth}>
                        <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {MONTHS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Year</Label>
                      <Select value={rangeYear} onValueChange={setRangeYear}>
                        <SelectTrigger className="h-9 w-24"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {yearsList.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
                {rangeMode === "custom" && (
                  <>
                    <div>
                      <Label className="text-xs">From</Label>
                      <Input type="date" className="h-9 w-40" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">To</Label>
                      <Input type="date" className="h-9 w-40" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                    </div>
                  </>
                )}
                <Button size="sm" variant="outline" onClick={syncByDateRange} disabled={syncing || syncingRange || !resolvedRange}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${syncingRange ? "animate-spin" : ""}`} />
                  {syncingRange ? "Syncing..." : "Sync Orders by Date Range"}
                </Button>
                {resolvedRange && (
                  <span className="text-xs text-muted-foreground pb-2">
                    {fmtRangeLabel(resolvedRange.from, resolvedRange.to)}
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground whitespace-pre-line">
              {`Use "Sync Recent Orders" for daily updates, new orders, and Shopify status/item changes.
Use "Sync Orders by Date Range" when you want to import or refresh all orders within a specific period.`}
            </div>

            {syncResult && (
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium">
                    Last sync result
                    {syncResult.mode ? <span className="ml-2 text-xs text-muted-foreground">({syncResult.mode})</span> : null}
                  </div>
                  <Button size="icon" variant="ghost" className="h-6 w-6 -mt-1 -mr-1" onClick={() => setSyncResult(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {syncResult.date_range_used && (
                  <div className="text-xs text-muted-foreground">
                    Date range used: {syncResult.date_range_used.from} → {syncResult.date_range_used.to}
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2 text-xs">
                  <Stat label="Orders created" value={syncResult.created} />
                  <Stat label="Orders updated" value={syncResult.updated} />
                  <Stat label="Items processed" value={syncResult.order_items_processed} />
                  <Stat label="Order items created" value={syncResult.order_items_inserted} />
                  <Stat label="Order items updated" value={syncResult.order_items_updated} />
                  <Stat label="Order items removed" value={syncResult.stale_order_items_removed} />
                  <Stat label="Orders recalculated" value={syncResult.affected_orders_recalculated} />
                  <Stat label="Statuses updated" value={syncResult.statuses_updated} />
                  <Stat label="Cancelled orders updated" value={syncResult.cancelled_orders_updated} />
                  <Stat label="Fulfillment/delivery updates" value={syncResult.fulfillment_updates} />
                  <Stat label="Customer fields preserved" value={syncResult.customer_fields_preserved} />
                  <Stat label="Customer fields repaired (Shopify)" value={syncResult.customer_fields_repaired_from_shopify} />
                  <Stat label="Customer fields repaired (external intake)" value={syncResult.customer_fields_repaired_from_external_intake} />
                  <Stat label="Pending intake rows applied" value={syncResult.pending_intake_rows_applied} />
                  <Stat label="Still unknown" value={syncResult.still_unknown_count ?? "—"} />
                  <Stat label="Failed" value={syncResult.failed} />
                  {syncResult.date_range_used && (
                    <Stat label="Shopify orders found" value={syncResult.shopify_orders_found ?? 0} />
                  )}
                  <Stat label="Last synced" value={new Date(syncResult.finished_at).toLocaleString()} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canOps && (
        <details className="mb-4 rounded-md border bg-muted/20">
          <summary className="cursor-pointer select-none px-4 py-2 text-sm font-medium">
            Advanced Tools
          </summary>
          <div className="px-4 pb-4 pt-2 space-y-3">
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              These tools are for one-time repairs only. Do not use them for daily order sync.
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={repairUnknownCustomers}
              disabled={repairing}
              title="Fetch each order flagged Unknown from Shopify and fill in missing customer name / phone / city / address"
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${repairing ? "animate-spin" : ""}`} />
              {repairing ? "Repairing..." : "Repair unknown customers"}
            </Button>
          </div>
        </details>
      )}

      <Card>
        <CardContent className="p-3 flex flex-wrap items-end gap-2">
          <DateScopeFilter value={dateScope} onChange={setDateScope} allowAllMonths />
          <Select value={city} onValueChange={setCity}><SelectTrigger className="w-36 h-9"><SelectValue placeholder="City" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All cities</SelectItem>{cities.map((c) => <SelectItem key={c!} value={c!}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={confStatus} onValueChange={setConfStatus}><SelectTrigger className="w-44 h-9"><SelectValue placeholder="Confirmation" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All confirmation</SelectItem>{CONFIRMATION_STATUSES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={orderStatus} onValueChange={setOrderStatus}><SelectTrigger className="w-44 h-9"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All statuses</SelectItem>{ORDER_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={shipping} onValueChange={setShipping}><SelectTrigger className="w-40 h-9"><SelectValue placeholder="Shipping" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All carriers</SelectItem>{shippingCos.map((c) => <SelectItem key={c!} value={c!}>{c}</SelectItem>)}</SelectContent>
          </Select>
          {selected.size > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{selected.size} selected</span>
              <Select onValueChange={bulkStatus}><SelectTrigger className="w-44 h-9"><SelectValue placeholder="Bulk: set status…" /></SelectTrigger>
                <SelectContent>{ORDER_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="ml-auto text-xs text-muted-foreground">{dateScopeLabel} · {filtered.length} orders</div>
        </CardContent>
      </Card>

      <Tabs defaultValue="table" className="mt-4">
        <TabsList>
          <TabsTrigger value="table"><TableIcon className="h-4 w-4 mr-1" />Table</TabsTrigger>
          <TabsTrigger value="kanban"><LayoutGrid className="h-4 w-4 mr-1" />Kanban</TabsTrigger>
        </TabsList>
        <TabsContent value="table">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"><Checkbox checked={filtered.length > 0 && selected.size === filtered.length} onCheckedChange={toggleAll} /></TableHead>
                    <TableHead>Order</TableHead><TableHead>Customer</TableHead><TableHead>Phone</TableHead>
                    <TableHead>City</TableHead><TableHead>Date</TableHead>
                    <TableHead>Confirmation</TableHead><TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Kashier Fees</TableHead>
                    <TableHead className="text-right">Shipping Cost</TableHead>
                    <TableHead className="text-right">Packaging Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((o) => (
                    <TableRow key={o.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setOpenId(o.id)}>
                      <TableCell onClick={(e) => e.stopPropagation()}><Checkbox checked={selected.has(o.id)} onCheckedChange={() => toggle(o.id)} /></TableCell>
                      <TableCell className="font-medium">{o.order_number}</TableCell>
                      <TableCell>{o.customer_full_name}</TableCell>
                      <TableCell className="font-mono text-xs">{o.phone}</TableCell>
                      <TableCell>{o.city}<div className="text-xs text-muted-foreground">{o.area}</div></TableCell>
                      <TableCell>{fmtDate(o.order_date)}</TableCell>
                      <TableCell><Badge variant={statusTone(o.confirmation_status)}>{o.confirmation_status}</Badge></TableCell>
                      <TableCell><Badge variant={statusTone(o.order_status)}>{o.order_status}</Badge></TableCell>
                      <TableCell className="text-right">{egp(Number(o.total_selling_price ?? 0))}</TableCell>
                      <TableCell className="text-right">{egp(calculateKashierFees(o))}</TableCell>
                      <OrderCostCells
                        order={o}
                        canEdit={canEditCosts}
                        onSaved={() => {
                          qc.invalidateQueries({ queryKey: ["orders"] });
                          qc.invalidateQueries({ queryKey: ["orders-finance"] });
                        }}
                      />
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-8">No orders match.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="kanban">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {ORDER_STATUSES.map((status) => {
              const col = filtered.filter((o) => o.order_status === status);
              return (
                <div key={status} className="bg-muted/40 rounded-md p-2 min-h-32">
                  <div className="flex items-center justify-between mb-2 px-1"><span className="text-xs font-semibold">{status}</span><Badge variant="secondary">{col.length}</Badge></div>
                  <div className="space-y-2">
                    {col.map((o) => (
                      <Card key={o.id} className="cursor-pointer hover:border-primary" onClick={() => setOpenId(o.id)}>
                        <CardContent className="p-3">
                          <div className="text-xs font-semibold">{o.order_number}</div>
                          <div className="text-sm">{o.customer_full_name}</div>
                          <div className="text-xs text-muted-foreground">{o.city} · {egp(Number(o.total_selling_price ?? 0))}</div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      <Sheet open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {openOrder && (
            <>
              <SheetHeader>
                <SheetTitle>{openOrder.order_number}</SheetTitle>
                <SheetDescription>{openOrder.customer_full_name} · {fmtDate(openOrder.order_date)}</SheetDescription>
              </SheetHeader>
              <OrderDetail
                order={openOrder}
                items={detailItems}
                itemsLoading={detailItemsLoading}
                itemsError={detailItemsError}
                restoringLineItems={restoringLineItems}
                onRestoreLineItems={canOps ? restoreOpenOrderLineItems : undefined}
                onChanged={() => {
                qc.invalidateQueries({ queryKey: ["orders"] });
                qc.invalidateQueries({ queryKey: ["orders-finance"] });
                qc.invalidateQueries({ queryKey: ["order-items", openId] });
              }} />
            </>
          )}
        </SheetContent>
      </Sheet>
      <NewOrderDialog open={openNew} onOpenChange={setOpenNew} onCreated={() => qc.invalidateQueries({ queryKey: ["orders"] })} />
    </AppShell>
  );
}

function OrderCostCells({ order, canEdit, onSaved }: { order: any; canEdit: boolean; onSaved: () => void }) {
  const [shippingCost, setShippingCost] = useState(String(order.shipping_cost ?? 0));
  const [packagingCost, setPackagingCost] = useState(String(order.packaging_cost ?? 0));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setShippingCost(String(order.shipping_cost ?? 0));
    setPackagingCost(String(order.packaging_cost ?? 0));
  }, [order.shipping_cost, order.packaging_cost]);

  const parseCost = (value: string): number | null => {
    if (value.trim() === "") return 0;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  };

  const shipping = parseCost(shippingCost);
  const packaging = parseCost(packagingCost);
  const dirty =
    canEdit &&
    shipping !== null &&
    packaging !== null &&
    (shipping !== Number(order.shipping_cost ?? 0) || packaging !== Number(order.packaging_cost ?? 0));

  const save = async () => {
    const s = parseCost(shippingCost);
    const p = parseCost(packagingCost);
    if (s === null || p === null) {
      toast.error("Shipping and packaging must be zero or more.");
      return;
    }

    setSaving(true);
    try {
      await saveOrderCosts({
        orderId: order.id,
        shippingCost: s,
        packagingCost: p,
        source: "orders_table",
      });

      toast.success(`Saved costs for ${order.order_number}`);
      onSaved();
    } catch (e: any) {
      const raw = e?.message || String(e ?? "");
      const friendly = /Unexpected token .* is not valid JSON/i.test(raw) || /Forbidden/i.test(raw)
        ? "You do not have permission to update order costs. Ask an admin to grant the finance or operations role."
        : raw || "Failed to save costs";
      toast.error(friendly);
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    return (
      <>
        <TableCell className="text-right">{egp(Number(order.shipping_cost ?? 0))}</TableCell>
        <TableCell className="text-right">{egp(Number(order.packaging_cost ?? 0))}</TableCell>
      </>
    );
  }

  return (
    <>
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
        <Input
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          className="h-8 w-24 ml-auto text-right"
          value={shippingCost}
          disabled={saving}
          onChange={(e) => setShippingCost(e.target.value)}
        />
      </TableCell>
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-2">
          <Input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            className="h-8 w-24 text-right"
            value={packagingCost}
            disabled={saving}
            onChange={(e) => setPackagingCost(e.target.value)}
          />
          <Button
            size="sm"
            variant={dirty ? "default" : "outline"}
            disabled={!dirty || saving}
            onClick={save}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
          </Button>
        </div>
      </TableCell>
    </>
  );
}

function NewOrderDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated?: () => void }) {
  const [saving, setSaving] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");
  const [address, setAddress] = useState("");
  const [sku, setSku] = useState("");
  const [productName, setProductName] = useState("");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState("");

  const reset = () => {
    setOrderNumber(""); setName(""); setPhone(""); setCity(""); setArea(""); setAddress("");
    setSku(""); setProductName(""); setQty(1); setPrice("");
  };

  const submit = async () => {
    if (!orderNumber.trim() || !name.trim() || !phone.trim() || !sku.trim() || !productName.trim()) {
      toast.error("Please fill in order number, customer name, phone, SKU and product name.");
      return;
    }
    const unitPrice = Number(price);
    if (!unitPrice || unitPrice <= 0) { toast.error("Please enter a valid unit selling price."); return; }

    setSaving(true);
    const totalSelling = unitPrice * qty;
    const packagingCost = calculatePackagingCost([
      {
        productName: productName.trim(),
        sku: sku.trim(),
        quantity: qty,
      },
    ]);

    const { data: orderData, error: orderErr } = await supabase.from("orders").insert({
      order_number: orderNumber.trim(),
      customer_full_name: name.trim(),
      phone: phone.trim(),
      city: city.trim() || null,
      area: area.trim() || null,
      full_address: address.trim() || null,
      total_selling_price: totalSelling,
      confirmation_status: "Fresh Calls",
      order_status: "New",
      shipping_cost: 200,
      packaging_cost: packagingCost,
    }).select("id").single();

    if (orderErr || !orderData) {
      setSaving(false);
      toast.error(orderErr?.message ?? "Failed to create order");
      return;
    }

    const { error: itemErr } = await supabase.from("order_items").insert({
      order_id: orderData.id,
      sku: sku.trim(),
      product_name: productName.trim(),
      quantity: qty,
      unit_selling_price: unitPrice,
    });

    if (itemErr) {
      setSaving(false);
      toast.error(itemErr.message);
      return;
    }

    toast.success("Order created");
    reset();
    onOpenChange(false);
    onCreated?.();
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Order</DialogTitle>
          <DialogDescription>Create a simple manual order.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Order #</Label><Input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="ORD-001" /></div>
            <div><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxx" /></div>
          </div>
          <div><Label>Customer name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>City</Label><Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Cairo" /></div>
            <div><Label>Area</Label><Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Nasr City" /></div>
          </div>
          <div><Label>Full address</Label><Textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} /></div>
          <div className="border rounded-md p-3 space-y-3">
            <div className="font-medium text-sm">Item</div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>SKU</Label><Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU-123" /></div>
              <div><Label>Product name</Label><Input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Product name" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Qty</Label><Input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} /></div>
              <div><Label>Unit price (EGP)</Label><Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Create order"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-2 py-1.5">
      <div className="text-muted-foreground text-[10px] uppercase tracking-wide">{label}</div>
      <div className="font-medium text-sm">{value}</div>
    </div>
  );
}
