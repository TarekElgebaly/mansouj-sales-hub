import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { egp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EXPENSE_CATEGORIES } from "./expenses-tab";

type Range = "today" | "week" | "month" | "custom";

function rangeBounds(r: Range, customFrom: string, customTo: string): { from: string; to: string } {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (r === "today") return { from: iso(today), to: iso(today) };
  if (r === "week") {
    const start = new Date(today); start.setDate(today.getDate() - today.getDay());
    return { from: iso(start), to: iso(today) };
  }
  if (r === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: iso(start), to: iso(today) };
  }
  return { from: customFrom, to: customTo };
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
};

export function ProfitLossTab() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);
  const [range, setRange] = useState<Range>("month");
  const [customFrom, setCustomFrom] = useState(monthAgo.toISOString().slice(0, 10));
  const [customTo, setCustomTo] = useState(today);
  const { from, to } = rangeBounds(range, customFrom, customTo);

  const { data: orders } = useQuery({
    queryKey: ["pl-orders", from, to],
    queryFn: async () => (await supabase.from("orders").select("total_selling_price,items_cost,shipping_cost,packaging_cost,order_date")
      .gte("order_date", from).lte("order_date", to)).data ?? [],
  });
  const { data: expenses } = useQuery({
    queryKey: ["pl-expenses", from, to],
    queryFn: async () => {
      const { data } = await (supabase as any).from("expenses").select("category,amount,expense_date")
        .gte("expense_date", from).lte("expense_date", to);
      return (data ?? []) as { category: string; amount: number; expense_date: string }[];
    },
  });
  const { data: employees } = useQuery({
    queryKey: ["pl-employees"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("employees").select("monthly_salary,active");
      return (data ?? []) as { monthly_salary: number; active: boolean }[];
    },
  });

  const netProfit = useMemo(() => {
    return (orders ?? []).reduce((sum, o) => {
      const selling = num(o.total_selling_price);
      if (selling === null) return sum;
      const cost = num(o.items_cost) ?? 0;
      const shipping = num(o.shipping_cost) ?? 0;
      const packaging = num(o.packaging_cost) ?? 0;
      return sum + (selling - cost - shipping - packaging);
    }, 0);
  }, [orders]);

  // Payroll: months covered by the range × active monthly salaries
  const months = useMemo(() => {
    const f = new Date(from); const t = new Date(to);
    const days = Math.max(1, Math.round((t.getTime() - f.getTime()) / 86400000) + 1);
    return days / 30;
  }, [from, to]);
  const monthlyPayroll = (employees ?? []).filter((e) => e.active).reduce((s, e) => s + Number(e.monthly_salary || 0), 0);
  const payroll = monthlyPayroll * months;

  const byCategory = useMemo(() => {
    const map: Record<string, number> = {};
    EXPENSE_CATEGORIES.forEach((c) => { map[c] = 0; });
    (expenses ?? []).forEach((e) => { map[e.category] = (map[e.category] ?? 0) + Number(e.amount || 0); });
    return map;
  }, [expenses]);
  const expensesTotal = Object.values(byCategory).reduce((s, n) => s + n, 0);
  const operatingExpenses = payroll + expensesTotal;
  const operatingProfit = netProfit - operatingExpenses;

  const breakdown = [
    { label: "Payroll", amount: payroll },
    ...EXPENSE_CATEGORIES.map((c) => ({ label: c, amount: byCategory[c] })),
  ];
  const grandTotal = operatingExpenses;

  return (
    <>
      <Card>
        <CardContent className="p-3 flex flex-wrap items-end gap-2">
          <div className="flex gap-1">
            {(["today", "week", "month", "custom"] as Range[]).map((r) => (
              <Button key={r} size="sm" variant={range === r ? "default" : "outline"} onClick={() => setRange(r)}>
                {r === "today" ? "Today" : r === "week" ? "This Week" : r === "month" ? "This Month" : "Custom"}
              </Button>
            ))}
          </div>
          {range === "custom" && (
            <>
              <div><Label className="text-xs">From</Label><Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-44 h-9" /></div>
              <div><Label className="text-xs">To</Label><Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-44 h-9" /></div>
            </>
          )}
          <div className="ml-auto text-xs text-muted-foreground">{from} → {to}</div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
        <StatCard label="Net Profit (Orders)" value={netProfit} tone />
        <StatCard label="Payroll" value={payroll} />
        <StatCard label="Operating Expenses" value={operatingExpenses} />
        <StatCard label="Operating Profit" value={operatingProfit} tone />
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle className="text-base">Expense Breakdown</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">% of Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {breakdown.map((b) => {
                const pct = grandTotal > 0 ? (b.amount / grandTotal) * 100 : 0;
                return (
                  <TableRow key={b.label}>
                    <TableCell>{b.label}</TableCell>
                    <TableCell className="text-right">{egp(b.amount)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{pct.toFixed(1)}%</TableCell>
                  </TableRow>
                );
              })}
              <TableRow>
                <TableCell className="font-semibold">Total Operating Expenses</TableCell>
                <TableCell className="text-right font-semibold">{egp(grandTotal)}</TableCell>
                <TableCell className="text-right font-semibold">100%</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={cn("text-2xl font-semibold mt-1", tone ? (value >= 0 ? "text-emerald-600" : "text-red-600") : "")}>
          {egp(value)}
        </div>
      </CardContent>
    </Card>
  );
}
