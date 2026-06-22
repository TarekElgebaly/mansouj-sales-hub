import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { Download, LayoutGrid, Plus, RefreshCw, Table as TableIcon } from "lucide-react";
import Papa from "papaparse";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/orders")({
  head: () => ({ meta: [{ title: "Orders — Mansouj" }] }),
  component: OrdersPage,
});

function OrdersPage() {
  const qc = useQueryClient();
  const { canOps } = useUser();
  const [search, setSearch] = useState("");
  const [city, setCity] = useState<string>("all");
  const [confStatus, setConfStatus] = useState<string>("all");
  const [orderStatus, setOrderStatus] = useState<string>("all");
  const [shipping, setShipping] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const pullShopify = async () => {
    setSyncing(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) { toast.error("Please sign in again."); return; }
      const res = await fetch("/api/shopify/sync-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ limit: 100 }),
      });
      const json = await res.json() as { ok: boolean; imported?: number; updated?: number; error?: string; errors?: string[] };
      if (json.ok) {
        toast.success(`Pulled from Shopify — ${json.imported ?? 0} new, ${json.updated ?? 0} updated${json.errors?.length ? `, ${json.errors.length} errors` : ""}`);
        qc.invalidateQueries({ queryKey: ["orders"] });
        qc.invalidateQueries({ queryKey: ["order-items"] });
      } else {
        toast.error(json.error ?? "Shopify sync failed");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
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
      if (city !== "all" && o.city !== city) return false;
      if (confStatus !== "all" && o.confirmation_status !== confStatus) return false;
      if (orderStatus !== "all" && o.order_status !== orderStatus) return false;
      if (shipping !== "all" && o.shipping_company !== shipping) return false;
      return true;
    });
  }, [orders, items, search, city, confStatus, orderStatus, shipping]);

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((o) => o.id)));
  };
  const toggle = (id: string) => {
    const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n);
  };

  const bulkStatus = async (status: string) => {
    if (!selected.size) return;
    const { error } = await supabase.from("orders").update({ order_status: status as any }).in("id", [...selected]);
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
  const openItems = items?.filter((i) => i.order_id === openId) ?? [];

  return (
    <AppShell title="Orders" search={search} onSearch={setSearch}
      actions={
        <div className="flex items-center gap-2">
          {canOps && <Button size="sm" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4 mr-1" />New Order</Button>}
          {canOps && (
            <Button size="sm" variant="outline" onClick={pullShopify} disabled={syncing}>
              <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Pulling…" : "Pull from Shopify"}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-1" />Export CSV</Button>
        </div>
      }>
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
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
                    <TableHead>Shipping</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Net</TableHead>
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
                      <TableCell className="text-xs">{o.shipping_company ?? "—"}</TableCell>
                      <TableCell className="text-right">{egp(o.total_selling_price)}</TableCell>
                      <TableCell className="text-right text-emerald-600">{egp(o.net_profit)}</TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">No orders match.</TableCell></TableRow>
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
                          <div className="text-xs text-muted-foreground">{o.city} · {egp(o.total_selling_price)}</div>
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
              <OrderDetail order={openOrder} items={openItems} onChanged={() => qc.invalidateQueries({ queryKey: ["orders"] })} />
            </>
          )}
        </SheetContent>
      </Sheet>
      <NewOrderDialog open={openNew} onOpenChange={setOpenNew} onCreated={() => qc.invalidateQueries({ queryKey: ["orders"] })} />
    </AppShell>
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
  const [cost, setCost] = useState("");

  const reset = () => {
    setOrderNumber(""); setName(""); setPhone(""); setCity(""); setArea(""); setAddress("");
    setSku(""); setProductName(""); setQty(1); setPrice(""); setCost("");
  };

  const submit = async () => {
    if (!orderNumber.trim() || !name.trim() || !phone.trim() || !sku.trim() || !productName.trim()) {
      toast.error("Please fill in order number, customer name, phone, SKU and product name.");
      return;
    }
    const unitPrice = Number(price);
    const unitCost = Number(cost);
    if (!unitPrice || unitPrice <= 0) { toast.error("Please enter a valid unit selling price."); return; }
    if (unitCost < 0) { toast.error("Unit cost cannot be negative."); return; }

    setSaving(true);
    const totalSelling = unitPrice * qty;
    const totalCost = unitCost * qty;

    const { data: orderData, error: orderErr } = await supabase.from("orders").insert({
      order_number: orderNumber.trim(),
      customer_full_name: name.trim(),
      phone: phone.trim(),
      city: city.trim() || null,
      area: area.trim() || null,
      full_address: address.trim() || null,
      total_selling_price: totalSelling,
      items_cost: totalCost,
      confirmation_status: "Fresh Calls",
      order_status: "New",
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
      unit_cost: unitCost,
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
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Qty</Label><Input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} /></div>
              <div><Label>Unit price (EGP)</Label><Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
              <div><Label>Unit cost (EGP)</Label><Input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} /></div>
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

