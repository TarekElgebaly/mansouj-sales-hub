import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { egp } from "@/lib/format";
import { Pencil, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { usePeriod } from "./period-filter";

type Employee = {
  id: string;
  name: string;
  role: string;
  monthly_salary: number;
  active: boolean;
};

export function PayrollTab() {
  const { label } = usePeriod();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Employee | null>(null);
  const [open, setOpen] = useState(false);

  const { data: employees } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("employees").select("*").order("created_at", { ascending: true });
      return (data ?? []) as Employee[];
    },
  });

  const rows = employees ?? [];
  const activeTotal = rows.filter((e) => e.active).reduce((s, e) => s + Number(e.monthly_salary || 0), 0);

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await (supabase as any).from("employees").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("employees").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Employee deleted"); qc.invalidateQueries({ queryKey: ["employees"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Card>
        <CardContent className="p-3 flex items-center gap-3">
          <div className="text-xs text-muted-foreground self-center">{label}</div>
          <div className="text-sm text-muted-foreground">{rows.length} employees · Active monthly payroll: <span className="font-semibold text-foreground">{egp(activeTotal)}</span></div>
          <div className="ml-auto">
            <Button onClick={() => { setEditing(null); setOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Add Employee
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Monthly Salary</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.name}</TableCell>
                  <TableCell>{e.role}</TableCell>
                  <TableCell className="text-right">{egp(e.monthly_salary)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch checked={e.active} onCheckedChange={(v) => toggleActive.mutate({ id: e.id, active: v })} />
                      <Badge variant={e.active ? "default" : "secondary"}>{e.active ? "Active" : "Inactive"}</Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => { setEditing(e); setOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm(`Delete ${e.name}?`)) del.mutate(e.id); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No employees yet.</TableCell></TableRow>
              )}
            </TableBody>
            {rows.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2} className="font-semibold">Total Active Payroll</TableCell>
                  <TableCell className="text-right font-semibold">{egp(activeTotal)}</TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>

      <EmployeeDialog open={open} onOpenChange={setOpen} editing={editing} onSaved={() => qc.invalidateQueries({ queryKey: ["employees"] })} />
    </>
  );
}

function EmployeeDialog({ open, onOpenChange, editing, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; editing: Employee | null; onSaved: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [role, setRole] = useState(editing?.role ?? "");
  const [salary, setSalary] = useState<string>(editing ? String(editing.monthly_salary) : "");
  const [active, setActive] = useState(editing?.active ?? true);

  const save = useMutation({
    mutationFn: async () => {
      const payload = { name, role, monthly_salary: Number(salary || 0), active };
      if (editing) {
        const { error } = await (supabase as any).from("employees").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("employees").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success(editing ? "Employee updated" : "Employee added"); onSaved(); onOpenChange(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => {
      onOpenChange(v);
      if (v) {
        setName(editing?.name ?? "");
        setRole(editing?.role ?? "");
        setSalary(editing ? String(editing.monthly_salary) : "");
        setActive(editing?.active ?? true);
      }
    }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? "Edit Employee" : "Add Employee"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Role</Label><Input value={role} onChange={(e) => setRole(e.target.value)} /></div>
          <div><Label>Monthly Salary (EGP)</Label><Input type="number" step="0.01" value={salary} onChange={(e) => setSalary(e.target.value)} /></div>
          <div className="flex items-center gap-2"><Switch checked={active} onCheckedChange={setActive} /><Label>Active</Label></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name || !role}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
