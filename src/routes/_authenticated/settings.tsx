import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUser, type AppRole } from "@/hooks/use-user";
import { OrderIntakeSection } from "@/components/settings/order-intake-section";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — Mansouj" }] }),
  component: SettingsPage,
});

const ROLES: AppRole[] = ["admin", "operations", "finance", "shipping", "viewer"];

function SettingsPage() {
  const { user, hasRole, roles } = useUser();
  const qc = useQueryClient();
  const [grantEmail, setGrantEmail] = useState("");
  const [grantRole, setGrantRole] = useState<AppRole>("operations");

  const isAdmin = hasRole("admin");
  const canSeeIntake = isAdmin || hasRole("operations");

  const { data: members } = useQuery({
    queryKey: ["members"],
    queryFn: async () => {
      const { data: profiles } = await supabase.from("profiles").select("id,full_name,email,created_at");
      const { data: ur } = await supabase.from("user_roles").select("user_id,role");
      return (profiles ?? []).map((p) => ({ ...p, roles: (ur ?? []).filter((r) => r.user_id === p.id).map((r) => r.role) }));
    },
  });

  const claimAdmin = async () => {
    if (!user) return;
    const { error } = await supabase.from("user_roles").insert({ user_id: user.id, role: "admin" });
    if (error) return toast.error(error.message);
    toast.success("You are now admin");
    qc.invalidateQueries();
    window.location.reload();
  };

  const grantRoleTo = async () => {
    const email = grantEmail.trim().toLowerCase();
    const target = members?.find((m) => String(m.email ?? "").trim().toLowerCase() === email);
    if (!target) return toast.error("This user has not signed up yet. Ask them to create an account first.");
    const { error } = await supabase.from("user_roles").insert({ user_id: target.id, role: grantRole });
    if (error) return toast.error(error.message);
    toast.success(`Granted ${grantRole} to ${grantEmail}`);
    qc.invalidateQueries({ queryKey: ["members"] });
  };

  const revokeRole = async (uid: string, role: AppRole) => {
    const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", role);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["members"] });
  };

  const noAdminYet = members && !members.some((m) => m.roles.includes("admin"));

  return (
    <AppShell title="Settings">
      <Card>
        <CardHeader>
          <CardTitle>Your account</CardTitle>
          <CardDescription>{user?.email}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Roles:</span>
          {roles.length === 0 && <Badge variant="outline">none</Badge>}
          {roles.map((r) => <Badge key={r} variant="secondary">{r}</Badge>)}
        </CardContent>
      </Card>

      {noAdminYet && (
        <Card className="mt-4 border-primary">
          <CardHeader>
            <CardTitle className="text-base">Bootstrap admin</CardTitle>
            <CardDescription>No admin exists yet. The first team member to claim becomes admin.</CardDescription>
          </CardHeader>
          <CardContent><Button onClick={claimAdmin}>Make me admin</Button></CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card className="mt-4">
          <CardHeader><CardTitle>Grant role</CardTitle><CardDescription>Team members must have signed up first.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-48"><label className="text-xs">Email</label><Input value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)} placeholder="user@mansouj.com" /></div>
            <div><label className="text-xs">Role</label>
              <Select value={grantRole} onValueChange={(v) => setGrantRole(v as AppRole)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={grantRoleTo}>Grant</Button>
          </CardContent>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader><CardTitle className="text-base">Team members</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Roles</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {members?.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.full_name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{m.email}</TableCell>
                  <TableCell className="flex flex-wrap gap-1">
                    {m.roles.length === 0 ? <Badge variant="outline">none</Badge> :
                      m.roles.map((r) => (
                        <Badge key={r as string} variant="secondary" className="cursor-pointer" onClick={() => isAdmin && revokeRole(m.id, r as AppRole)} title={isAdmin ? "Click to revoke" : ""}>
                          {r as string}{isAdmin && " ×"}
                        </Badge>
                      ))}
                  </TableCell>
                  <TableCell />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
