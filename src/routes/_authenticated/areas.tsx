import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { egp } from "@/lib/format";
import { AccessDenied } from "@/components/access-denied";
import { useUser } from "@/hooks/use-user";

export const Route = createFileRoute("/_authenticated/areas")({
  head: () => ({ meta: [{ title: "Areas — Mansouj" }] }),
  component: AreasPage,
});

function AreasPage() {
  const { loading, canAdmin } = useUser();
  const { data } = useQuery({
    queryKey: ["areas"],
    enabled: canAdmin,
    queryFn: async () => (await supabase.from("areas").select("*").order("city")).data ?? [],
  });
  if (loading) return <AppShell title="Areas & shipping zones"><div className="text-sm text-muted-foreground">Checking access...</div></AppShell>;
  if (!canAdmin) return <AccessDenied title="Areas & shipping zones" message="Only admins can access shipping zone settings." />;
  return (
    <AppShell title="Areas & shipping zones">
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>City</TableHead><TableHead>Area</TableHead><TableHead>Shipping company</TableHead><TableHead className="text-right">Cost</TableHead><TableHead>Delivery notes</TableHead><TableHead>Status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.city}</TableCell>
                  <TableCell>{a.area}</TableCell>
                  <TableCell>{a.shipping_company}</TableCell>
                  <TableCell className="text-right">{egp(a.shipping_cost)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{a.delivery_notes ?? "—"}</TableCell>
                  <TableCell><Badge variant={a.active ? "default" : "outline"}>{a.active ? "Active" : "Inactive"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
