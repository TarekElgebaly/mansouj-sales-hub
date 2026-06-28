import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/format";
import { AccessDenied } from "@/components/access-denied";
import { useUser } from "@/hooks/use-user";
import Papa from "papaparse";
import { toast } from "sonner";
import { FileUp } from "lucide-react";

export const Route = createFileRoute("/_authenticated/import")({
  head: () => ({ meta: [{ title: "Airtable Import — Mansouj" }] }),
  component: ImportPage,
});

function ImportPage() {
  const qc = useQueryClient();
  const { loading, canAdmin } = useUser();
  const [baseId, setBaseId] = useState("");
  const { data: logs } = useQuery({
    queryKey: ["migration-logs"],
    enabled: canAdmin,
    queryFn: async () => (await supabase.from("migration_logs").select("*").order("created_at", { ascending: false }).limit(50)).data ?? [],
  });

  const log = async (source: string, entity: string, status: string, message: string, rows = 0) => {
    await supabase.from("migration_logs").insert({ source, entity, status, message, rows_processed: rows });
    qc.invalidateQueries({ queryKey: ["migration-logs"] });
  };

  const importCsv = async (entity: "orders" | "inventory" | "areas", file: File) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async (res) => {
        const rows = res.data as any[];
        try {
          // Best-effort: clean keys (lowercase) and forward
          const cleaned = rows.map((r) => {
            const o: any = {};
            Object.entries(r).forEach(([k, v]) => { o[k.trim().toLowerCase().replaceAll(" ", "_")] = v; });
            return o;
          });
          const { error } = await (supabase as any).from(entity).insert(cleaned);
          if (error) throw error;
          await log("csv", entity, "success", `Imported ${cleaned.length} ${entity}`, cleaned.length);
          toast.success(`Imported ${cleaned.length} ${entity}`);
        } catch (e: any) {
          await log("csv", entity, "error", e.message ?? String(e));
          toast.error(`Import failed: ${e.message ?? e}`);
        }
      },
    });
  };

  if (loading) return <AppShell title="Airtable Import"><div className="text-sm text-muted-foreground">Checking access...</div></AppShell>;
  if (!canAdmin) return <AccessDenied title="Airtable Import" message="Only admins can access import tools." />;

  return (
    <AppShell title="Airtable Import">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileUp className="h-5 w-5" />Airtable migration</CardTitle>
          <CardDescription>Paste your Airtable base details, or upload a CSV export from each table.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div><Label>Airtable Base ID</Label><Input placeholder="appXXXXXXXXXXXXXX" value={baseId} onChange={(e) => setBaseId(e.target.value)} /></div>
            <div><Label>Airtable API Key</Label><Input type="password" placeholder="Stored as a server secret" disabled /></div>
          </div>
          <p className="text-xs text-muted-foreground">Live Airtable API import requires storing an API token as a secret on the backend. CSV import works right now.</p>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-3 gap-3 mt-4">
        {(["orders", "inventory", "areas"] as const).map((entity) => (
          <Card key={entity}>
            <CardHeader><CardTitle className="capitalize text-base">Import {entity}</CardTitle><CardDescription>CSV exported from Airtable.</CardDescription></CardHeader>
            <CardContent>
              <Input type="file" accept=".csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(entity, f); }} />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle className="text-base">Migration logs</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Source</TableHead><TableHead>Entity</TableHead><TableHead>Status</TableHead><TableHead>Rows</TableHead><TableHead>Message</TableHead></TableRow></TableHeader>
            <TableBody>
              {logs?.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs">{fmtDateTime(l.created_at)}</TableCell>
                  <TableCell>{l.source}</TableCell><TableCell>{l.entity}</TableCell>
                  <TableCell><Badge variant={l.status === "success" ? "default" : "destructive"}>{l.status}</Badge></TableCell>
                  <TableCell>{l.rows_processed}</TableCell>
                  <TableCell className="text-xs">{l.message}</TableCell>
                </TableRow>
              ))}
              {!logs?.length && <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No imports yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
