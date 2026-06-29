import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { INVENTORY_STATUSES, egp, statusTone } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/inventory")({
  head: () => ({ meta: [{ title: "Inventory — Mansouj" }] }),
  component: InventoryPage,
});

function InventoryPage() {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"all" | "low">("all");
  const [status, setStatus] = useState<string>("all");
  const [color, setColor] = useState<string>("all");

  const { data } = useQuery({
    queryKey: ["inventory"],
    queryFn: async () => (await supabase.from("inventory").select("*").order("product_name")).data ?? [],
  });

  const colors = useMemo(() => Array.from(new Set((data ?? []).map((d) => d.color).filter(Boolean))), [data]);

  const rows = useMemo(() => {
    return (data ?? []).filter((p) => {
      const q = search.toLowerCase().trim();
      if (q && ![p.sku, p.product_name, p.color, p.size].some((v) => v?.toLowerCase().includes(q))) return false;
      if (status !== "all" && p.status !== status) return false;
      if (color !== "all" && p.color !== color) return false;
      if (view === "low" && !["Low Stock", "Out of Stock"].includes(p.status)) return false;
      return true;
    });
  }, [data, search, status, color, view]);

  return (
    <AppShell title="Inventory" search={search} onSearch={setSearch}>
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <Tabs value={view} onValueChange={(v) => setView(v as any)}>
          <TabsList><TabsTrigger value="all">All</TabsTrigger><TabsTrigger value="low">Low stock</TabsTrigger></TabsList>
        </Tabs>
        <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-40 h-9"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All statuses</SelectItem>{INVENTORY_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={color} onValueChange={setColor}><SelectTrigger className="w-36 h-9"><SelectValue placeholder="Color" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All colors</SelectItem>{colors.map((c) => <SelectItem key={c!} value={c!}>{c}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>SKU</TableHead><TableHead>Product</TableHead><TableHead>Color</TableHead><TableHead>Size</TableHead><TableHead className="text-right">On hand</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Sale</TableHead><TableHead className="text-right">Total cost</TableHead><TableHead className="text-right">Total sale</TableHead><TableHead>Status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                  <TableCell>{p.product_name}<div className="text-xs text-muted-foreground">{p.variant_name}</div></TableCell>
                  <TableCell>{p.color}</TableCell>
                  <TableCell>{p.size}</TableCell>
                  <TableCell className="text-right">{p.current_inventory}</TableCell>
                  <TableCell className="text-right">{egp(p.cost_price)}</TableCell>
                  <TableCell className="text-right">{egp(p.sale_price)}</TableCell>
                  <TableCell className="text-right">{egp(p.current_inventory * Number(p.cost_price))}</TableCell>
                  <TableCell className="text-right">{egp(p.current_inventory * Number(p.sale_price))}</TableCell>
                  <TableCell><Badge variant={statusTone(p.status)}>{p.status}</Badge></TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No products.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
