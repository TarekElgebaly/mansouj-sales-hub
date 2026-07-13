import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUser } from "@/hooks/use-user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CreateRemapDialog } from "./create-remap-dialog";

type Remap = {
  id: string;
  old_sku: string;
  new_sku: string | null;
  shopify_variant_id: string | null;
  inventory_item_id: string | null;
  note: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type SortKey = "old_sku" | "new_sku" | "shopify_variant_id";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 25;

export function SkuRemapSection() {
  const qc = useQueryClient();
  const { canOps } = useUser();
  const [expanded, setExpanded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("old_sku");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);

  const { data: remaps, isLoading } = useQuery({
    queryKey: ["shopify-sku-remaps"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shopify_sku_remaps" as never)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Remap[];
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["shopify-sku-remaps"] });

  const toggleActive = async (r: Remap) => {
    const { error } = await supabase
      .from("shopify_sku_remaps" as never)
      .update({ is_active: !r.is_active } as never)
      .eq("id", r.id);
    if (error) toast.error(error.message);
    else refresh();
  };

  const deleteRemap = async (r: Remap) => {
    if (!window.confirm(`Delete remap for "${r.old_sku}"?`)) return;
    const { error } = await supabase
      .from("shopify_sku_remaps" as never)
      .delete()
      .eq("id", r.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Remap deleted.");
      refresh();
    }
  };

  const filteredSorted = useMemo(() => {
    const list = remaps ?? [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (r) =>
            r.old_sku.toLowerCase().includes(q) ||
            (r.new_sku ?? "").toLowerCase().includes(q) ||
            (r.shopify_variant_id ?? "").toLowerCase().includes(q),
        )
      : list;
    const sorted = [...filtered].sort((a, b) => {
      const av = (a[sortKey] ?? "").toString().toLowerCase();
      const bv = (b[sortKey] ?? "").toString().toLowerCase();
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [remaps, search, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredSorted.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
    return sortDir === "asc" ? (
      <ArrowUp className="ml-1 inline h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 inline h-3 w-3" />
    );
  };

  const count = remaps?.length ?? 0;

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-medium"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          SKU Remaps — {isLoading ? "…" : count} mapping{count === 1 ? "" : "s"}
        </button>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setAddOpen(true)} disabled={!canOps}>
            <Plus className="mr-1 h-4 w-4" />
            Add Remap
          </Button>
          <Button size="sm" variant="outline" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Hide Existing Remaps" : "View Existing Remaps"}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-3">
          <Input
            placeholder="Search SKU..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="max-w-sm"
          />
          <div className="overflow-x-auto rounded border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th
                    className="px-3 py-2 text-left cursor-pointer select-none"
                    onClick={() => toggleSort("old_sku")}
                  >
                    Old SKU {sortIcon("old_sku")}
                  </th>
                  <th
                    className="px-3 py-2 text-left cursor-pointer select-none"
                    onClick={() => toggleSort("new_sku")}
                  >
                    New SKU {sortIcon("new_sku")}
                  </th>
                  <th
                    className="px-3 py-2 text-left cursor-pointer select-none"
                    onClick={() => toggleSort("shopify_variant_id")}
                  >
                    Variant ID {sortIcon("shopify_variant_id")}
                  </th>
                  <th className="px-3 py-2 text-left">Note</th>
                  <th className="px-3 py-2 text-left">Active</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                )}
                {!isLoading && pageRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">
                      {count === 0 ? "No remaps yet." : "No matches."}
                    </td>
                  </tr>
                )}
                {pageRows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2 font-mono">{r.old_sku}</td>
                    <td className="px-3 py-2 font-mono">{r.new_sku ?? "—"}</td>
                    <td className="px-3 py-2 font-mono">{r.shopify_variant_id ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.note ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Switch
                        checked={r.is_active}
                        onCheckedChange={() => toggleActive(r)}
                        disabled={!canOps}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteRemap(r)}
                        disabled={!canOps}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredSorted.length > PAGE_SIZE && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div>
                Page {currentPage} of {totalPages} · {filteredSorted.length} result
                {filteredSorted.length === 1 ? "" : "s"}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <CreateRemapDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
