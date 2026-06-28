import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { egp, fmtDate } from "@/lib/format";
import { AccessDenied } from "@/components/access-denied";
import { useUser } from "@/hooks/use-user";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({ meta: [{ title: "Customers — Mansouj" }] }),
  component: CustomersPage,
});

function CustomersPage() {
  const { loading, canAccessCustomers } = useUser();
  const [search, setSearch] = useState("");
  const { data: customers } = useQuery({
    queryKey: ["customers"],
    enabled: canAccessCustomers,
    queryFn: async () => (await supabase.from("customers").select("*").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: orders } = useQuery({
    queryKey: ["orders-for-customers"],
    enabled: canAccessCustomers,
    queryFn: async () => (await supabase.from("orders").select("customer_id,total_selling_price,order_date")).data ?? [],
  });

  const rows = useMemo(() => {
    return (customers ?? []).map((c) => {
      const co = orders?.filter((o) => o.customer_id === c.id) ?? [];
      return {
        ...c,
        total_orders: co.length,
        total_spent: co.reduce((s, o) => s + Number(o.total_selling_price), 0),
        last_order: co.map((o) => o.order_date).sort().reverse()[0] ?? null,
      };
    }).filter((c) => {
      const q = search.toLowerCase().trim();
      if (!q) return true;
      return [c.full_name, c.phone, c.city, c.area].some((v) => v?.toLowerCase().includes(q));
    });
  }, [customers, orders, search]);

  if (loading) return <AppShell title="Customers"><div className="text-sm text-muted-foreground">Checking access...</div></AppShell>;
  if (!canAccessCustomers) return <AccessDenied title="Customers" message="Your role does not include Customers access." />;

  return (
    <AppShell title="Customers" search={search} onSearch={setSearch}>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead>City / Area</TableHead><TableHead>Address</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Spent</TableHead><TableHead>Last order</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.full_name}</TableCell>
                  <TableCell className="font-mono text-xs">{c.phone}{c.second_phone && <div>{c.second_phone}</div>}</TableCell>
                  <TableCell>{c.city}<div className="text-xs text-muted-foreground">{c.area}</div></TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-muted-foreground">{c.full_address}</TableCell>
                  <TableCell className="text-right">{c.total_orders}</TableCell>
                  <TableCell className="text-right">{egp(c.total_spent)}</TableCell>
                  <TableCell>{fmtDate(c.last_order)}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No customers.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
