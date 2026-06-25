import { Fragment, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ORDER_STATUSES, egp, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { OrderDetail } from "@/components/order-detail";
import { usePeriod } from "./period-filter";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
};
const cell = (v: number | null) => (v === null ? <span className="text-muted-foreground">—</span> : egp(v));
const dash = <span className="text-muted-foreground">—</span>;

function ExpandedItems({ orderId }: { orderId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["order-items", orderId],
    queryFn: async () =>
      (await supabase.from("order_items").select("*").eq("order_id", orderId)).data ?? [],
  });

  if (isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading line items…</div>;
  }
  if (!data || data.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No line items found for this order.</div>;
  }

  return (
    <div className="p-3 bg-muted/30">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead>
            <TableHead>Product title</TableHead>
            <TableHead>Variant title</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Unit price</TableHead>
            <TableHead className="text-right">Line total</TableHead>
            <TableHead className="text-right">Unit cost</TableHead>
            <TableHead className="text-right">Line cost</TableHead>
            <TableHead className="text-right">Line profit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((it: any) => {
            const qty = Number(it.quantity) || 0;
            const unitPrice = num(it.unit_price);
            const unitCost = num(it.unit_cost);
            const lineTotal = unitPrice === null ? null : unitPrice * qty;
            const lineCost = unitCost === null ? null : unitCost * qty;
            const lineProfit = lineTotal === null ? null : lineTotal - (lineCost ?? 0);
            return (
              <TableRow key={it.id}>
                <TableCell className="font-mono text-xs">{it.sku || dash}</TableCell>
                <TableCell>{it.product_title || dash}</TableCell>
                <TableCell>{it.variant_title || dash}</TableCell>
                <TableCell className="text-right">{qty}</TableCell>
                <TableCell className="text-right">{cell(unitPrice)}</TableCell>
                <TableCell className="text-right">{cell(lineTotal)}</TableCell>
                <TableCell className="text-right">{cell(unitCost)}</TableCell>
                <TableCell className="text-right">{cell(lineCost)}</TableCell>
                <TableCell className={cn(
                  "text-right font-medium",
                  lineProfit === null ? "" : lineProfit >= 0 ? "text-emerald-600" : "text-red-600",
                )}>
                  {cell(lineProfit)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function OrdersProfitTab() {
  const { from, to, label } = usePeriod();
  const [orderStatus, setOrderStatus] = useState<string>("all");
  const [city, setCity] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const qc = useQueryClient();
  const { data: orders } = useQuery({
    queryKey: ["orders-finance", from, to],
    queryFn: async () => (await supabase.from("orders").select("*")
      .gte("order_date", from).lte("order_date", to)
      .order("order_date", { ascending: false })
      .order("created_at", { ascending: false })).data ?? [],
  });

  const openOrder = orders?.find((o) => o.id === openId);
  const { data: openItems } = useQuery({
    queryKey: ["order-items", openId],
    queryFn: async () =>
      (await supabase.from("order_items").select("*").eq("order_id", openId!)).data ?? [],
    enabled: !!openId,
  });

  const cities = useMemo(
    () => Array.from(new Set((orders ?? []).map((o) => o.city).filter(Boolean))) as string[],
    [orders],
  );

  const rows = useMemo(() => {
    return (orders ?? [])
      .filter((o) => orderStatus === "all" || o.order_status === orderStatus)
      .filter((o) => city === "all" || o.city === city)
      .map((o) => {
        const selling = num(o.total_selling_price);
        const cost = num(o.items_cost);
        const shipping = num(o.shipping_cost);
        const packaging = num(o.packaging_cost);
        const gross = selling === null ? null : selling - (cost ?? 0);
        const net = gross === null ? null : gross - (shipping ?? 0) - (packaging ?? 0);
        return { id: o.id, order_number: o.order_number, selling, cost, gross, shipping, packaging, net };
      });
  }, [orders, orderStatus, city]);

  const totals = useMemo(() => {
    const t = { selling: 0, cost: 0, gross: 0, shipping: 0, packaging: 0, net: 0 };
    rows.forEach((r) => {
      t.selling += r.selling ?? 0;
      t.cost += r.cost ?? 0;
      t.gross += r.gross ?? 0;
      t.shipping += r.shipping ?? 0;
      t.packaging += r.packaging ?? 0;
      t.net += r.net ?? 0;
    });
    return t;
  }, [rows]);

  const toggle = (id: string) => setExpanded((m) => ({ ...m, [id]: !m[id] }));

  return (
    <>
      <Card>
        <CardContent className="p-3 flex flex-wrap items-end gap-3">
          <div className="text-xs text-muted-foreground self-center">{label}</div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={orderStatus} onValueChange={setOrderStatus}>
              <SelectTrigger className="w-44 h-9"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {ORDER_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">City</Label>
            <Select value={city} onValueChange={setCity}>
              <SelectTrigger className="w-44 h-9"><SelectValue placeholder="City" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All cities</SelectItem>
                {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto text-sm text-muted-foreground">{rows.length} orders</div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Order Number</TableHead>
                <TableHead className="text-right">Selling Price</TableHead>
                <TableHead className="text-right">Order Cost</TableHead>
                <TableHead className="text-right">Gross Profit</TableHead>
                <TableHead className="text-right">Shipping Cost</TableHead>
                <TableHead className="text-right">Packaging Cost</TableHead>
                <TableHead className="text-right">Net Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const isOpen = !!expanded[r.id];
                return (
                  <>
                    <TableRow key={r.id} className="hover:bg-muted/50">
                      <TableCell className="w-10">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => toggle(r.id)}
                          aria-label={isOpen ? "Collapse" : "Expand"}
                        >
                          <ChevronRight className={cn("h-4 w-4 transition-transform", isOpen && "rotate-90")} />
                        </Button>
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="font-medium text-primary underline-offset-2 hover:underline"
                          onClick={() => setOpenId(r.id)}
                        >
                          {r.order_number}
                        </button>
                      </TableCell>
                      <TableCell className="text-right">{cell(r.selling)}</TableCell>
                      <TableCell className="text-right">{cell(r.cost)}</TableCell>
                      <TableCell className={cn(
                        "text-right font-medium",
                        r.gross === null ? "" : r.gross >= 0 ? "text-emerald-600" : "text-red-600",
                      )}>
                        {cell(r.gross)}
                      </TableCell>
                      <TableCell className="text-right">{cell(r.shipping)}</TableCell>
                      <TableCell className="text-right">{cell(r.packaging)}</TableCell>
                      <TableCell className={cn(
                        "text-right font-medium",
                        r.net === null ? "" : r.net >= 0 ? "text-emerald-600" : "text-red-600",
                      )}>
                        {cell(r.net)}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow key={`${r.id}-items`}>
                        <TableCell colSpan={8} className="p-0">
                          <ExpandedItems orderId={r.id} />
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No orders match.</TableCell></TableRow>
              )}
            </TableBody>
            {rows.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell></TableCell>
                  <TableCell className="font-semibold">Totals</TableCell>
                  <TableCell className="text-right font-semibold">{egp(totals.selling)}</TableCell>
                  <TableCell className="text-right font-semibold">{egp(totals.cost)}</TableCell>
                  <TableCell className={cn(
                    "text-right font-semibold",
                    totals.gross >= 0 ? "text-emerald-600" : "text-red-600",
                  )}>
                    {egp(totals.gross)}
                  </TableCell>
                  <TableCell className="text-right font-semibold">{egp(totals.shipping)}</TableCell>
                  <TableCell className="text-right font-semibold">{egp(totals.packaging)}</TableCell>
                  <TableCell className={cn(
                    "text-right font-semibold",
                    totals.net >= 0 ? "text-emerald-600" : "text-red-600",
                  )}>
                    {egp(totals.net)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>

      <Sheet open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {openOrder && (
            <>
              <SheetHeader>
                <SheetTitle>{openOrder.order_number}</SheetTitle>
                <SheetDescription>{openOrder.customer_full_name} · {fmtDate(openOrder.order_date)}</SheetDescription>
              </SheetHeader>
              <OrderDetail order={openOrder} items={openItems ?? []} onChanged={() => {
                qc.invalidateQueries({ queryKey: ["orders-finance"] });
                qc.invalidateQueries({ queryKey: ["order-items", openId] });
              }} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
