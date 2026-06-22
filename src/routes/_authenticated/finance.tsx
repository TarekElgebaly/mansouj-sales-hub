import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrdersProfitTab } from "@/components/finance/orders-profit-tab";
import { ExpensesTab } from "@/components/finance/expenses-tab";
import { PayrollTab } from "@/components/finance/payroll-tab";
import { ProfitLossTab } from "@/components/finance/profit-loss-tab";

export const Route = createFileRoute("/_authenticated/finance")({
  head: () => ({ meta: [{ title: "Finance — Mansouj" }] }),
  component: FinancePage,
});

function FinancePage() {
  const [tab, setTab] = useState("orders");
  return (
    <AppShell title="Finance">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="orders">Orders Profit</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="payroll">Payroll</TabsTrigger>
          <TabsTrigger value="pl">Profit &amp; Loss</TabsTrigger>
        </TabsList>
        <TabsContent value="orders" className="mt-4"><OrdersProfitTab /></TabsContent>
        <TabsContent value="expenses" className="mt-4"><ExpensesTab /></TabsContent>
        <TabsContent value="payroll" className="mt-4"><PayrollTab /></TabsContent>
        <TabsContent value="pl" className="mt-4"><ProfitLossTab /></TabsContent>
      </Tabs>
    </AppShell>
  );
}
