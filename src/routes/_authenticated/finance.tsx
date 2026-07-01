import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { LockKeyhole, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrdersProfitTab } from "@/components/finance/orders-profit-tab";
import { ExpensesTab } from "@/components/finance/expenses-tab";
import { PayrollTab } from "@/components/finance/payroll-tab";
import { ProfitLossTab } from "@/components/finance/profit-loss-tab";
import { PeriodProvider, PeriodFilter } from "@/components/finance/period-filter";
import { supabase } from "@/integrations/supabase/client";
import { useFinanceLock } from "@/hooks/use-finance-lock";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/finance")({
  head: () => ({ meta: [{ title: "Finance — Mansouj" }] }),
  component: FinancePage,
});

function FinancePage() {
  const [tab, setTab] = useState("orders");
  const qc = useQueryClient();
  const { isFinanceUnlocked, lockFinanceSession } = useFinanceLock();

  const lockFinance = () => {
    lockFinanceSession();
    qc.removeQueries({
      predicate: (query) => {
        const key = String(query.queryKey[0] ?? "");
        return [
          "orders-finance",
          "expenses",
          "employees",
          "pl-orders",
          "pl-expenses",
          "pl-employees",
          "order-items",
        ].includes(key);
      },
    });
    toast.success("Finance locked");
  };

  if (!isFinanceUnlocked) {
    return (
      <AppShell title="Finance">
        <FinanceUnlockScreen />
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Finance"
      actions={<Button variant="outline" size="sm" onClick={lockFinance}>Lock Finance</Button>}
    >
      <PeriodProvider>
        <div className="mb-4"><PeriodFilter /></div>
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
      </PeriodProvider>
    </AppShell>
  );
}

function FinanceUnlockScreen() {
  const { unlockFinanceSession } = useFinanceLock();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error("Please sign in again before unlocking Finance.");
      }

      const res = await fetch("/api/finance/unlock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ password }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Incorrect password");
      }

      unlockFinanceSession();
      setPassword("");
      toast.success("Finance unlocked");
    } catch (err: any) {
      const message = err?.message || "Incorrect password";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-8rem)] grid place-items-center">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 h-10 w-10 rounded-lg bg-primary text-primary-foreground grid place-items-center">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <CardTitle>Finance is locked</CardTitle>
          <CardDescription>Enter the finance password to view Orders Profit, Expenses, Payroll, and Profit & Loss.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label>Finance password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
                autoComplete="current-password"
                autoFocus
                required
              />
            </div>
            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading || !password}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Unlock Finance"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
