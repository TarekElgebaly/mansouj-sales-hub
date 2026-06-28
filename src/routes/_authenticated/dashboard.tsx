import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { egp, fmtDate, statusTone } from "@/lib/format";
import { financeNumber, isCancelledOrder } from "@/lib/order-finance";
import { AccessDenied } from "@/components/access-denied";
import { useUser } from "@/hooks/use-user";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import { ShoppingBag, AlertTriangle, Truck, CheckCircle2, XCircle, Undo2, PackageX } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Mansouj" }] }),
  component: Dashboard,
});

function Stat({ label, value, icon: Icon, tone = "default" }: any) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-10 w-10 rounded-md grid place-items-center ${tone === "danger" ? "bg-destructive/10 text-destructive" : tone === "good" ? "bg-emerald-500/10 text-emerald-600" : "bg-primary/10 text-primary"}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function Dashboard() {
  const { loading, canAccessDashboard } = useUser();
  const { data: orders } = useQuery({
    queryKey: ["orders-all"],
    enabled: canAccessDashboard,
    queryFn: async () => (await supabase.from("orders").select("*").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: lowStock } = useQuery({
    queryKey: ["low-stock"],
    enabled: canAccessDashboard,
    queryFn: async () => (await supabase.from("inventory").select("*").in("status", ["Low Stock", "Out of Stock"])).data ?? [],
  });

  const today = new Date().toISOString().slice(0, 10);
  const nonCancelledOrders = orders?.filter((order) => !isCancelledOrder(order)) ?? [];
  const stats = {
    total: orders?.length ?? 0,
    today: orders?.filter((o) => o.order_date === today).length ?? 0,
    needConfirm: orders?.filter((o) => ["Fresh Calls", "No Answer", "Call Back", "Pending"].includes(o.confirmation_status)).length ?? 0,
    ready: orders?.filter((o) => o.order_status === "Ready").length ?? 0,
    delivered: orders?.filter((o) => o.delivered).length ?? 0,
    cancelled: orders?.filter((o) => ["Cancelled", "Cancel with confirmation"].includes(o.order_status)).length ?? 0,
    rto: orders?.filter((o) => o.rto).length ?? 0,
  };

  const byStatus = ORDER_STATUS_KEYS.map((s) => ({
    name: s, count: orders?.filter((o) => o.order_status === s).length ?? 0,
  })).filter((d) => d.count > 0);

  const revenueByDay = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const iso = d.toISOString().slice(0, 10);
    return {
      day: d.toLocaleDateString("en-GB", { weekday: "short" }),
      revenue: nonCancelledOrders
        .filter((o) => o.order_date === iso)
        .reduce((s, o) => s + financeNumber(o, "total_selling_price"), 0),
    };
  });

  const PIE = ["hsl(var(--primary))", "#22c55e", "#f59e0b", "#ef4444", "#6366f1", "#06b6d4", "#a855f7", "#ec4899", "#64748b"];

  if (loading) return <AppShell title="Dashboard"><div className="text-sm text-muted-foreground">Checking access...</div></AppShell>;
  if (!canAccessDashboard) return <AccessDenied title="Dashboard" message="Your role does not include Dashboard access." />;

  return (
    <AppShell title="Dashboard">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total orders" value={stats.total} icon={ShoppingBag} />
        <Stat label="New today" value={stats.today} icon={ShoppingBag} tone="good" />
        <Stat label="Need confirmation" value={stats.needConfirm} icon={AlertTriangle} />
        <Stat label="Ready to ship" value={stats.ready} icon={Truck} />
        <Stat label="Delivered" value={stats.delivered} icon={CheckCircle2} tone="good" />
        <Stat label="Cancelled" value={stats.cancelled} icon={XCircle} tone="danger" />
        <Stat label="RTO" value={stats.rto} icon={Undo2} tone="danger" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Revenue — last 7 days</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueByDay}>
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip cursor={{ fill: "hsl(var(--muted))" }} contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))" }} />
                <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Orders by status</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byStatus} dataKey="count" nameKey="name" outerRadius={80}>
                  {byStatus.map((_, i) => (<Cell key={i} fill={PIE[i % PIE.length]} />))}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent orders</CardTitle>
            <Link to="/orders" className="text-xs text-primary hover:underline">View all →</Link>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Order</TableHead><TableHead>Customer</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {orders?.slice(0, 6).map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.order_number}</TableCell>
                    <TableCell>{o.customer_full_name}</TableCell>
                    <TableCell>{fmtDate(o.order_date)}</TableCell>
                    <TableCell><Badge variant={statusTone(o.order_status)}>{o.order_status}</Badge></TableCell>
                    <TableCell className="text-right">{egp(financeNumber(o, "total_selling_price"))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><PackageX className="h-4 w-4 text-destructive" /> Low stock</CardTitle>
            <Link to="/inventory" className="text-xs text-primary hover:underline">Inventory →</Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {lowStock?.length === 0 && <p className="text-sm text-muted-foreground">All stock healthy.</p>}
            {lowStock?.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm border rounded-md px-3 py-2">
                <div>
                  <div className="font-medium">{p.product_name}</div>
                  <div className="text-xs text-muted-foreground">{p.sku} · {p.color} · {p.size}</div>
                </div>
                <Badge variant={statusTone(p.status)}>{p.current_inventory} left</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

const ORDER_STATUS_KEYS = ["New","Ready","Uploaded to Shipping","Shipped","Delivered","Cancelled","Cancel with confirmation","RTO","On Hold"];
