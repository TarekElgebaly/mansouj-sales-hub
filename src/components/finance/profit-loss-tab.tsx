import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { egp } from "@/lib/format";
import { financeNumber, isCancelledOrder } from "@/lib/order-finance";
import { calculateKashierFees } from "@/lib/kashier-fees";
import { cn } from "@/lib/utils";
import { EXPENSE_CATEGORIES } from "./expenses-tab";
import { usePeriod } from "./period-filter";

export function ProfitLossTab() {
  const { from, to, label } = usePeriod();

  const { data: orders } = useQuery({
    queryKey: ["pl-orders", from, to],
    queryFn: async () => (await supabase.from("orders").select("total_selling_price,items_cost,shipping_cost,packaging_cost,payment_gateway,order_date,order_status")
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
      if (isCancelledOrder(o)) return sum;
      const selling = financeNumber(o, "total_selling_price");
      if (selling === 0) return sum;
      const cost = financeNumber(o, "items_cost");
      const shipping = financeNumber(o, "shipping_cost");
      const packaging = financeNumber(o, "packaging_cost");
      const kashierFees = calculateKashierFees(o, selling);
      return sum + (selling - cost - shipping - packaging - kashierFees);
    }, 0);
  }, [orders]);

  // Payroll = sum of active monthly salaries (one selected month)
  const payroll = (employees ?? []).filter((e) => e.active).reduce((s, e) => s + Number(e.monthly_salary || 0), 0);

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
      <div className="text-xs text-muted-foreground mb-2">Showing: {label}</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Profit" value={netProfit} tone />
        <StatCard label="Operating Expenses" value={operatingExpenses} />
        <StatCard label="Net Profit" value={operatingProfit} tone />
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
