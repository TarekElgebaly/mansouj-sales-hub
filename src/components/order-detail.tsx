import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CONFIRMATION_STATUSES, ORDER_STATUSES, egp } from "@/lib/format";
import { toast } from "sonner";
import { saveOrderCosts } from "@/lib/order-costs";

function Info({ label, value }: { label: string; value: any }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div className="font-medium">{value}</div></div>;
}

export function OrderDetail({ order, items, onChanged }: { order: any; items: any[]; onChanged?: () => void }) {
  const [confirm, setConfirm] = useState(order.confirmation_status);
  const [status, setStatus] = useState(order.order_status);
  const [note, setNote] = useState(order.internal_notes ?? "");
  const [shippingCost, setShippingCost] = useState(String(order.shipping_cost ?? 0));
  const [packagingCost, setPackagingCost] = useState(String(order.packaging_cost ?? 0));
  const cancelled = status === "Cancelled";

  const save = async () => {
    const shipping = Number(shippingCost || 0);
    const packaging = Number(packagingCost || 0);
    if (!Number.isFinite(shipping) || shipping < 0) return toast.error("Shipping cost must be zero or more.");
    if (!Number.isFinite(packaging) || packaging < 0) return toast.error("Packaging cost must be zero or more.");
    const statusChanged =
      confirm !== order.confirmation_status ||
      status !== order.order_status ||
      note !== (order.internal_notes ?? "");
    const costsChanged =
      shipping !== Number(order.shipping_cost ?? 0) ||
      packaging !== Number(order.packaging_cost ?? 0);

    try {
      if (statusChanged) {
        const { error } = await supabase.from("orders").update({
          confirmation_status: confirm,
          order_status: status,
          delivered: status === "Delivered",
          internal_notes: note,
        }).eq("id", order.id);
        if (error) throw error;

        await supabase.from("order_activity").insert({
          order_id: order.id,
          action: "updated",
          details: { confirm, status },
        });
      }

      if (costsChanged) {
        await saveOrderCosts({
          orderId: order.id,
          shippingCost: shipping,
          packagingCost: packaging,
          source: "order_details",
        });
      }

      toast.success("Saved");
      onChanged?.();
    } catch (error: any) {
      toast.error(error?.message || "Failed to save order.");
    }
  };

  const selling = order.total_selling_price ?? null;
  const shipping = Number(shippingCost || 0);
  const packaging = Number(packagingCost || 0);
  const money = (v: number | null) => v == null ? <span className="text-muted-foreground">—</span> : egp(v);

  return (
    <div className="space-y-4 mt-4">
      {cancelled && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <Badge variant="destructive">Cancelled</Badge>
          <span className="text-sm text-muted-foreground">
            Cancelled products remain visible below; shipping and packaging costs stay editable.
          </span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Confirmation</Label>
          <Select value={confirm} onValueChange={setConfirm}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CONFIRMATION_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Order status</Label>
          <Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{ORDER_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Info label="Phone" value={order.phone} />
        <Info label="2nd phone" value={order.second_phone ?? "—"} />
        <Info label="City" value={order.city} />
        <Info label="Area" value={order.area} />
        <Info label="Payment" value={order.payment_gateway ?? "—"} />
        <Info label="Shipping" value={order.shipping_company ?? "—"} />
      </div>
      <div><Label>Full address</Label><Input value={order.full_address ?? ""} readOnly /></div>
      <div><Label>Internal notes</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Shipping Cost</Label><Input type="number" min={0} value={shippingCost} onChange={(e) => setShippingCost(e.target.value)} /></div>
        <div><Label>Packaging Cost</Label><Input type="number" min={0} value={packagingCost} onChange={(e) => setPackagingCost(e.target.value)} /></div>
      </div>

      <div>
        <Label className="mb-1 block">Items</Label>
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground text-center">
            No line items found for this order.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Line total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it: any) => {
                  const qty = Number(it.quantity ?? 0);
                  const unitPrice = it.unit_selling_price == null ? null : Number(it.unit_selling_price);
                  const lineTotal = it.total_selling_price == null
                    ? (unitPrice == null ? null : unitPrice * qty)
                    : Number(it.total_selling_price);
                  const variantLabel = it.variant ?? [it.color, it.size].filter(Boolean).join(" · ");
                  return (
                    <TableRow key={it.id}>
                      <TableCell className="font-mono text-xs">{it.sku && String(it.sku).trim() ? it.sku : "—"}</TableCell>
                      <TableCell>{it.product_name ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{variantLabel || "—"}</TableCell>
                      <TableCell className="text-right">{qty}</TableCell>
                      <TableCell className="text-right">{money(unitPrice)}</TableCell>
                      <TableCell className="text-right">{money(lineTotal)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div>
        <Label className="mb-1 block">Order Summary</Label>
        <div className="grid grid-cols-2 gap-3 bg-muted/40 rounded-md p-3 text-sm">
          <Info label="Selling Price" value={money(selling)} />
          <Info label="Shipping Cost" value={money(shipping)} />
          <Info label="Packaging Cost" value={money(packaging)} />
        </div>
      </div>

      <Button onClick={save} className="w-full">Save changes</Button>
    </div>
  );
}
