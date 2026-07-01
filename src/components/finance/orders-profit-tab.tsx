import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ORDER_STATUSES, egp, fmtDate, statusTone } from "@/lib/format";
import { financeNullable, isCancelledOrder } from "@/lib/order-finance";
import { cn } from "@/lib/utils";
import { OrderDetail } from "@/components/order-detail";
import { usePeriod } from "./period-filter";
import { useUser } from "@/hooks/use-user";

function CostInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Input
      type="number"
      min={0}
      step="0.01"
      inputMode="decimal"
      className="h-8 w-28 ml-auto text-right"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

type Row = {
  id: string;
  order_number: string | null;
  order_status: string | null;
  selling: number | null;
  cost: number | null;
  gross: number | null;
  shipping: number | null;
  packaging: number | null;
  net: number | null;
};

function Summary({ label, value, accent }: { label: string; value: number | null; accent?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn(
        "font-medium",
        accent && value !== null ? (value >= 0 ? "text-emerald-600" : "text-red-600") : "",
      )}>
        {value === null ? <span className="text-muted-foreground">—</span> : egp(value)}
      </div>
    </div>
  );
}

function EditableCostRow({
  r,
  isOpen,
  onToggle,
  onOpen,
  canEdit,
  onSaved,
}: {
  r: Row;
  isOpen: boolean;
  onToggle: () => void;
  onOpen: () => void;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const cancelled = isCancelledOrder(r);
  const [ship, setShip] = useState<string>(r.shipping === null ? "" : String(r.shipping));
  const [pack, setPack] = useState<string>(r.packaging === null ? "" : String(r.packaging));
  const [saving, setSaving] = useState(false);

  // Reset local state when underlying row changes (e.g., after refetch)
  useEffect(() => {
    setShip(r.shipping === null ? "" : String(r.shipping));
    setPack(r.packaging === null ? "" : String(r.packaging));
  }, [r.shipping, r.packaging]);

  const parse = (v: string): number | null => {
    if (v.trim() === "") return 0;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (n < 0) return null;
    return n;
  };

  const dirty =
    canEdit &&
    (parse(ship) !== (r.shipping ?? 0) || parse(pack) !== (r.packaging ?? 0));

  const save = async () => {
    const s = parse(ship);
    const p = parse(pack);
    if (s === null || p === null) {
      toast.error("Shipping and packaging must be numbers ≥ 0");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("orders")
        .update({ shipping_cost: s, packaging_cost: p })
        .eq("id", r.id);
      if (error) throw error;

      // Best-effort activity log (ignored if role can't insert)
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        await supabase.from("order_activity").insert({
          order_id: r.id,
          user_id: u.user.id,
          action: "update_costs",
          details: {
            old_shipping_cost: r.shipping,
            new_shipping_cost: s,
            old_packaging_cost: r.packaging,
            new_packaging_cost: p,
          },
        });
      }

      toast.success(`Saved costs for ${r.order_number}`);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Failed to save costs");
    } finally {
      setSaving(false);
    }
  };

  const selling = r.selling;
  const cost = r.cost;
  const gross = r.gross;
  const shipNum = parse(ship) ?? 0;
  const packNum = parse(pack) ?? 0;
  const liveNet = gross === null ? null : gross - shipNum - packNum;

  return (
    <TableRow className="hover:bg-muted/50">
      <TableCell className="w-10">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onToggle}
          aria-label={isOpen ? "Collapse" : "Expand"}
        >
          <ChevronRight className={cn("h-4 w-4 transition-transform", isOpen && "rotate-90")} />
        </Button>
      </TableCell>
      <TableCell>
        <button
          type="button"
          className="font-medium text-primary underline-offset-2 hover:underline"
          onClick={onOpen}
        >
          {r.order_number}
        </button>
      </TableCell>
      <TableCell>
        <Badge variant={statusTone(r.order_status ?? "")}>
          {cancelled ? "Cancelled" : r.order_status ?? "—"}
        </Badge>
      </TableCell>
      <TableCell className="text-right">{cell(selling)}</TableCell>
      <TableCell className="text-right">{cell(cost)}</TableCell>
      <TableCell className={cn(
        "text-right font-medium",
        gross === null ? "" : gross >= 0 ? "text-emerald-600" : "text-red-600",
      )}>
        {cell(gross)}
      </TableCell>
      <TableCell className="text-right">
        {canEdit ? (
          <CostInput value={ship} onChange={setShip} disabled={saving} />
        ) : (
          cell(r.shipping)
        )}
      </TableCell>
      <TableCell className="text-right">
        {canEdit ? (
          <CostInput value={pack} onChange={setPack} disabled={saving} />
        ) : (
          cell(r.packaging)
        )}
      </TableCell>
      <TableCell className={cn(
        "text-right font-medium",
        liveNet === null ? "" : liveNet >= 0 ? "text-emerald-600" : "text-red-600",
      )}>
        {cell(liveNet)}
      </TableCell>
      {canEdit && (
        <TableCell className="text-right">
          <Button
            size="sm"
            variant={dirty ? "default" : "outline"}
            disabled={!dirty || saving}
            onClick={save}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
          </Button>
        </TableCell>
      )}
    </TableRow>
  );
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
};
const cell = (v: number | null) => (v === null ? <span className="text-muted-foreground">—</span> : egp(v));
const dash = <span className="text-muted-foreground">—</span>;

function ExpandedItems({ orderId, cancelled }: { orderId: string; cancelled: boolean }) {
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
            const unitPrice = num(it.unit_selling_price ?? it.unit_price);
            const unitCost = cancelled ? 0 : num(it.unit_cost);
            const lineTotal = num(it.total_selling_price) ?? (unitPrice === null ? null : unitPrice * qty);
            const lineCost = cancelled ? 0 : unitCost === null ? null : unitCost * qty;
            const lineProfit = cancelled ? 0 : lineTotal === null ? null : lineTotal - (lineCost ?? 0);
            const productTitle = it.product_name ?? it.product_title;
            const variantTitle = it.variant ?? it.variant_title;
            return (
              <TableRow key={it.id}>
                <TableCell className="font-mono text-xs">{it.sku || dash}</TableCell>
                <TableCell>{productTitle || dash}</TableCell>
                <TableCell>{variantTitle || dash}</TableCell>
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
  const { canFinance, canAdmin } = useUser();
  const canEditCosts = canAdmin || canFinance;


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
        const selling = financeNullable(o, "total_selling_price");
        const cost = financeNullable(o, "items_cost");
        const shipping = financeNullable(o, "shipping_cost");
        const packaging = financeNullable(o, "packaging_cost");
        const gross = selling === null ? null : selling - (cost ?? 0);
        const net = gross === null ? null : gross - (shipping ?? 0) - (packaging ?? 0);
        return { id: o.id, order_number: o.order_number, order_status: o.order_status, selling, cost, gross, shipping, packaging, net };
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
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Selling Price</TableHead>
                <TableHead className="text-right">Order Cost</TableHead>
                <TableHead className="text-right">Gross Profit</TableHead>
                <TableHead className="text-right">Shipping Cost</TableHead>
                <TableHead className="text-right">Packaging Cost</TableHead>
                <TableHead className="text-right">Net Profit</TableHead>
                {canEditCosts && <TableHead className="text-right w-24">Save</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const isOpen = !!expanded[r.id];
                const colCount = canEditCosts ? 10 : 9;
                return (
                  <Fragment key={r.id}>
                    <EditableCostRow
                      r={r}
                      isOpen={isOpen}
                      onToggle={() => toggle(r.id)}
                      onOpen={() => setOpenId(r.id)}
                      canEdit={canEditCosts}
                      onSaved={() => {
                        qc.invalidateQueries({ queryKey: ["orders-finance"] });
                        qc.invalidateQueries({ queryKey: ["orders"] });
                      }}
                    />
                    {isOpen && (
                      <TableRow key={`${r.id}-items`}>
                        <TableCell colSpan={colCount} className="p-0">
                          <ExpandedItems orderId={r.id} cancelled={isCancelledOrder(r)} />
                          <div className="px-4 py-3 border-t bg-background/50 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                            <Summary label="Selling Price" value={r.selling} />
                            <Summary label="Order Cost" value={r.cost} />
                            <Summary label="Gross Profit" value={r.gross} accent />
                            <Summary label="Shipping Cost" value={r.shipping} />
                            <Summary label="Packaging Cost" value={r.packaging} />
                            <Summary label="Net Profit" value={r.net} accent />
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={canEditCosts ? 10 : 9} className="text-center text-muted-foreground py-8">No orders match.</TableCell></TableRow>
              )}
            </TableBody>
            {rows.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell></TableCell>
                  <TableCell className="font-semibold">Totals</TableCell>
                  <TableCell></TableCell>
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
                  {canEditCosts && <TableCell />}
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
                qc.invalidateQueries({ queryKey: ["orders"] });
                qc.invalidateQueries({ queryKey: ["order-items", openId] });
              }} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
