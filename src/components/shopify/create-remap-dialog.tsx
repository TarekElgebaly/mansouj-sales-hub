import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { VariantPicker, type VariantOption } from "./variant-picker";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialOldSku?: string;
  initialNote?: string;
  onSaved?: () => void;
};

export function CreateRemapDialog({
  open,
  onOpenChange,
  initialOldSku = "",
  initialNote = "",
  onSaved,
}: Props) {
  const qc = useQueryClient();
  const [oldSku, setOldSku] = useState(initialOldSku);
  const [note, setNote] = useState(initialNote);
  const [newSku, setNewSku] = useState("");
  const [variant, setVariant] = useState<VariantOption | null>(null);
  const [autoNewSku, setAutoNewSku] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setOldSku(initialOldSku);
      setNote(initialNote);
      setNewSku("");
      setVariant(null);
      setAutoNewSku(true);
    }
  }, [open, initialOldSku, initialNote]);

  useEffect(() => {
    if (autoNewSku && variant?.sku) setNewSku(variant.sku);
  }, [variant, autoNewSku]);

  const canSave = oldSku.trim().length > 0 && !!variant && !saving;

  const save = async () => {
    if (!canSave || !variant) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("shopify_sku_remaps" as never).insert({
        old_sku: oldSku.trim(),
        new_sku: newSku.trim() || variant.sku || null,
        shopify_variant_id: variant.shopify_variant_id,
        inventory_item_id: variant.inventory_item_id,
        note: note.trim() || null,
        is_active: true,
      } as never);
      if (error) throw new Error(error.message);
      toast.success("Remap saved. Run Backfill manually when ready.");
      qc.invalidateQueries({ queryKey: ["shopify-sku-remaps"] });
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create SKU Remap</DialogTitle>
          <DialogDescription>
            Map an old order item SKU to a synced Shopify variant. Nothing is
            sent to Shopify and no backfill runs automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Old SKU</Label>
            <Input
              value={oldSku}
              onChange={(e) => setOldSku(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label>New SKU (auto from variant)</Label>
            <Input
              value={newSku}
              onChange={(e) => {
                setAutoNewSku(false);
                setNewSku(e.target.value);
              }}
              placeholder={variant?.sku ?? "Select a variant"}
              className="font-mono"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label>Note</Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
        </div>

        <div className="space-y-1">
          <Label>Shopify variant</Label>
          <VariantPicker value={variant} onChange={setVariant} />
        </div>

        <div className="rounded border bg-muted/40 p-2 text-sm">
          {variant ? (
            <>
              This will map old SKU{" "}
              <span className="font-mono font-medium">{oldSku || "—"}</span> to
              Shopify variant{" "}
              <span className="font-mono font-medium">
                {variant.product_title ?? "—"} / {variant.variant_title ?? "—"}
              </span>{" "}
              · SKU{" "}
              <span className="font-mono font-medium">
                {newSku || variant.sku || "—"}
              </span>{" "}
              (ID {variant.shopify_variant_id}).
            </>
          ) : (
            <span className="text-muted-foreground">
              Select a Shopify variant to preview the remap.
            </span>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {saving ? "Saving…" : "Save remap"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
