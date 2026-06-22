import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CONFIRMATION_STATUSES, ORDER_STATUSES, egp } from "@/lib/format";
import { toast } from "sonner";

function Info({ label, value }: { label: string; value: any }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div className="font-medium">{value}</div></div>;
}

export function OrderDetail({ order, items, onChanged }: { order: any; items: any[]; onChanged?: () => void }) {
  const [confirm, setConfirm] = useState(order.confirmation_status);
  const [status, setStatus] = useState(order.order_status);
  const [note, setNote] = useState(order.internal_notes ?? "");

  const save = async () => {
    const { error } = await supabase.from("orders").update({
      confirmation_status: confirm, order_status: status, internal_notes: note,
    }).eq("id", order.id);
    if (error) return toast.error(error.message);
    await supabase.from("order_activity").insert({ order_id: order.id, action: "updated", details: { confirm, status } });
    toast.success("Saved");
    onChanged?.();
  };

  const selling = order.total_selling_price ?? null;
  const cost = order.items_cost ?? null;
  const shipping = order.shipping_cost ?? null;
  const packaging = order.packaging_cost ?? null;
  const gross = selling == null ? null : selling - (cost ?? 0);
  const net = gross == null ? null : gross - (shipping ?? 0) - (packaging ?? 0);
  const money = (v: number | null) => v == null ? <span className="text-muted-foreground">—</span> : egp(v);
  const tone = (v: number | null) => v == null ? "" : v >= 0 ? "text-emerald-600" : "text-red-600";

  return (
    <div className="space-y-4 mt-4">
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

      <div>
        <Label className="mb-1 block">Items</Label>
        <Table>
          <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map((it: any) => (
              <TableRow key={it.id}>
                <TableCell className="font-mono text-xs">{it.sku}</TableCell>
                <TableCell>{it.product_name}<div className="text-xs text-muted-foreground">{it.color} · {it.size}</div></TableCell>
                <TableCell>{it.quantity}</TableCell>
                <TableCell className="text-right">{egp(it.unit_selling_price)}</TableCell>
                <TableCell className="text-right">{egp(it.total_selling_price)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid grid-cols-2 gap-3 bg-muted/40 rounded-md p-3 text-sm">
        <Info label="Selling Price" value={money(selling)} />
        <Info label="Order Cost" value={money(cost)} />
        <Info label="Gross Profit" value={<span className={tone(gross)}>{money(gross)}</span>} />
        <Info label="Shipping Cost" value={money(shipping)} />
        <Info label="Packaging Cost" value={money(packaging)} />
        <Info label="Net Profit" value={<span className={tone(net)}>{money(net)}</span>} />
      </div>

      <Button onClick={save} className="w-full">Save changes</Button>
    </div>
  );
}
