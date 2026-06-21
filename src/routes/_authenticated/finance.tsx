import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { egp } from "@/lib/format";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export const Route = createFileRoute("/_authenticated/finance")({
  head: () => ({ meta: [{ title: "Finance — Mansouj" }] }),
  component: FinancePage,
});

function FinancePage() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);
  const [from, setFrom] = useState(monthAgo.toISOString().slice(0, 10));
  const [to, setTo] = useState(today);

  const { data: orders } = useQuery({
    queryKey: ["orders-finance", from, to],
    queryFn: async () => (await supabase.from("orders").select("*").gte("order_date", from).lte("order_date", to)).data ?? [],
  });

  const totals = useMemo(() => {
    const t = { selling: 0, items: 0, shipping: 0, packaging: 0, profit: 0, net: 0 };
    (orders ?? []).forEach((o) => {
      t.selling += Number(o.total_selling_price);
      t.items += Number(o.items_cost);
      t.shipping += Number(o.shipping_cost);
      t.packaging += Number(o.packaging_cost);
      t.profit += Number(o.profit);
      t.net += Number(o.net_profit);
    });
    return t;
  }, [orders]);
  const margin = totals.selling > 0 ? (totals.net / totals.selling) * 100 : 0;

  const byDay = useMemo(() => {
    const map = new Map<string, number>();
    (orders ?? []).forEach((o) => map.set(o.order_date, (map.get(o.order_date) ?? 0) + Number(o.net_profit)));
    return Array.from(map.entries()).sort().map(([day, net]) => ({ day: day.slice(5), net }));
  }, [orders]);

  return (
    <AppShell title="Finance">
      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap gap-3 items-end">
          <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" /></div>
          <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" /></div>
          <div className="ml-auto text-sm text-muted-foreground">{orders?.length ?? 0} orders</div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          ["Selling", totals.selling], ["Items cost", totals.items], ["Shipping", totals.shipping],
          ["Packaging", totals.packaging], ["Profit", totals.profit], ["Net profit", totals.net],
        ].map(([l, v]) => (
          <Card key={l as string}><CardContent className="p-4"><div className="text-xs text-muted-foreground">{l}</div><div className="text-lg font-semibold">{egp(v as number)}</div></CardContent></Card>
        ))}
      </div>
      <Card className="mt-4"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Margin</div><div className="text-2xl font-bold">{margin.toFixed(1)}%</div></CardContent></Card>
      <Card className="mt-4">
        <CardHeader><CardTitle className="text-base">Net profit by day</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byDay}>
              <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))" }} />
              <Bar dataKey="net" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </AppShell>
  );
}
