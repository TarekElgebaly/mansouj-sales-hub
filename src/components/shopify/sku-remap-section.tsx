import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUser } from "@/hooks/use-user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Trash2, Plus, Tags } from "lucide-react";
import { toast } from "sonner";

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

export function SkuRemapSection() {
  const qc = useQueryClient();
  const { canOps } = useUser();
  const [oldSku, setOldSku] = useState("");
  const [newSku, setNewSku] = useState("");
  const [variantId, setVariantId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

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

  const addRemap = async () => {
    if (!oldSku.trim()) {
      toast.error("Old SKU is required.");
      return;
    }
    if (!newSku.trim() && !variantId.trim()) {
      toast.error("Provide a new SKU or a Shopify variant ID.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("shopify_sku_remaps" as never).insert({
        old_sku: oldSku.trim(),
        new_sku: newSku.trim() || null,
        shopify_variant_id: variantId.trim() || null,
        note: note.trim() || null,
        is_active: true,
      } as never);
      if (error) throw new Error(error.message);
      toast.success("Remap added.");
      setOldSku("");
      setNewSku("");
      setVariantId("");
      setNote("");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Tags className="h-5 w-5" />
          SKU Remaps
        </CardTitle>
        <CardDescription>
          Map old order item SKUs to current Shopify variants so cost backfill can find
          them. Local only — Shopify is not modified.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input
            placeholder="Old SKU (required)"
            value={oldSku}
            onChange={(e) => setOldSku(e.target.value)}
            disabled={!canOps || saving}
          />
          <Input
            placeholder="New SKU"
            value={newSku}
            onChange={(e) => setNewSku(e.target.value)}
            disabled={!canOps || saving}
          />
          <Input
            placeholder="Shopify variant ID (optional)"
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
            disabled={!canOps || saving}
          />
          <Input
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={!canOps || saving}
          />
          <Button onClick={addRemap} disabled={!canOps || saving}>
            <Plus className="mr-2 h-4 w-4" />
            Add remap
          </Button>
        </div>

        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2 text-left">Old SKU</th>
                <th className="px-3 py-2 text-left">New SKU</th>
                <th className="px-3 py-2 text-left">Variant ID</th>
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
              {!isLoading && (!remaps || remaps.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">
                    No remaps yet.
                  </td>
                </tr>
              )}
              {remaps?.map((r) => (
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
      </CardContent>
    </Card>
  );
}
