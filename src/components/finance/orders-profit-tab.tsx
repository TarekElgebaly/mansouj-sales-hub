import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ORDER_STATUSES, egp, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { OrderDetail } from "@/components/order-detail";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
};
const cell = (v: number | null) => (v === null ? <span className="text-muted-foreground">—</span> : egp(v));

export function OrdersProfitTab() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);
  const [from, setFrom] = useState(monthAgo.toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [orderStatus, setOrderStatus] = useState<string>("all");
  const [city, setCity] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const qc = useQueryClient();
  const { data: orders } = useQuery({
    queryKey: ["orders-finance", from, to],
    queryFn: async () => (await supabase.from("orders").select("*")
      .gte("order_date", from).lte("order_date", to)
      .order("order_date", { ascending: false })
      .order("created_at", { ascending: false })).data ?? [],
  });
  const { data: items } = useQuery({
    queryKey: ["order-items"],
    queryFn: async () => (await supabase.from("order_items").select("*")).data ?? [],
  });

  const openOrder = orders?.find((o) => o.id === openId);
  const openItems = items?.filter((i) => i.order_id === openId) ?? [];

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

  return (
    <>
      <Card>
        <CardContent className="p-3 flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44 h-9" />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44 h-9" />
          </div>
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
              {rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setOpenId(r.id)}>
                  <TableCell className="font-medium text-primary underline-offset-2 hover:underline">{r.order_number}</TableCell>
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
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No orders match.</TableCell></TableRow>
              )}
            </TableBody>
            {rows.length > 0 && (
              <TableFooter>
                <TableRow>
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
              <OrderDetail order={openOrder} items={openItems} onChanged={() => {
                qc.invalidateQueries({ queryKey: ["orders-finance"] });
                qc.invalidateQueries({ queryKey: ["order-items"] });
              }} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
