import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search } from "lucide-react";

export type VariantOption = {
  shopify_variant_id: string;
  shopify_product_id: string | null;
  sku: string | null;
  barcode: string | null;
  variant_title: string | null;
  product_title: string | null;
  inventory_item_id: string | null;
  unit_cost_amount: number | null;
};

type Props = {
  value: VariantOption | null;
  onChange: (v: VariantOption | null) => void;
};

function norm(v: string | null | undefined) {
  return (v ?? "").toLowerCase();
}

export function VariantPicker({ value, onChange }: Props) {
  const [query, setQuery] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["shopify-variant-picker"],
    queryFn: async (): Promise<VariantOption[]> => {
      const { data: variants, error } = await supabase
        .from("shopify_variants" as never)
        .select(
          "shopify_variant_id, shopify_product_id, sku, barcode, title, inventory_item_id",
        )
        .limit(5000);
      if (error) throw new Error(error.message);
      const v = (variants ?? []) as unknown as Array<{
        shopify_variant_id: string;
        shopify_product_id: string | null;
        sku: string | null;
        barcode: string | null;
        title: string | null;
        inventory_item_id: string | null;
      }>;

      const productIds = Array.from(
        new Set(v.map((r) => r.shopify_product_id).filter(Boolean) as string[]),
      );
      const invIds = Array.from(
        new Set(v.map((r) => r.inventory_item_id).filter(Boolean) as string[]),
      );

      const [{ data: prods }, { data: invs }] = await Promise.all([
        productIds.length
          ? supabase
              .from("shopify_products" as never)
              .select("shopify_product_id, title")
              .in("shopify_product_id", productIds)
          : Promise.resolve({ data: [] as unknown[] } as never),
        invIds.length
          ? supabase
              .from("shopify_inventory_items" as never)
              .select("inventory_item_id, unit_cost_amount")
              .in("inventory_item_id", invIds)
          : Promise.resolve({ data: [] as unknown[] } as never),
      ]);

      const productTitle = new Map<string, string>();
      for (const p of (prods ?? []) as Array<{
        shopify_product_id: string;
        title: string | null;
      }>) {
        productTitle.set(p.shopify_product_id, p.title ?? "");
      }
      const cost = new Map<string, number | null>();
      for (const i of (invs ?? []) as Array<{
        inventory_item_id: string;
        unit_cost_amount: number | null;
      }>) {
        cost.set(i.inventory_item_id, i.unit_cost_amount);
      }

      return v.map((r) => ({
        shopify_variant_id: r.shopify_variant_id,
        shopify_product_id: r.shopify_product_id,
        sku: r.sku,
        barcode: r.barcode,
        variant_title: r.title,
        product_title: r.shopify_product_id
          ? productTitle.get(r.shopify_product_id) ?? null
          : null,
        inventory_item_id: r.inventory_item_id,
        unit_cost_amount: r.inventory_item_id
          ? cost.get(r.inventory_item_id) ?? null
          : null,
      }));
    },
  });

  const filtered = useMemo(() => {
    const q = norm(query).trim();
    if (!q) return (data ?? []).slice(0, 50);
    const tokens = q.split(/\s+/);
    return (data ?? [])
      .filter((o) => {
        const hay = [
          o.product_title,
          o.variant_title,
          o.sku,
          o.barcode,
          o.shopify_variant_id,
        ]
          .map(norm)
          .join(" ");
        return tokens.every((t) => hay.includes(t));
      })
      .slice(0, 100);
  }, [data, query]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Search product, variant, SKU, barcode, or variant ID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {value && (
        <div className="rounded border bg-muted/40 p-2 text-xs">
          <div className="font-medium">Selected:</div>
          <div className="font-mono">
            {value.product_title ?? "—"} / {value.variant_title ?? "—"} ·{" "}
            SKU {value.sku ?? "—"} · ID {value.shopify_variant_id}
            {value.unit_cost_amount != null && (
              <> · cost {value.unit_cost_amount}</>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="mt-1 h-7"
            onClick={() => onChange(null)}
          >
            Clear selection
          </Button>
        </div>
      )}
      <div className="max-h-64 overflow-auto rounded border">
        {isLoading ? (
          <div className="flex items-center justify-center p-4 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading variants…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-3 text-center text-sm text-muted-foreground">
            No matching variants.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background">
              <tr className="text-left">
                <th className="px-2 py-1">Product</th>
                <th className="px-2 py-1">Variant</th>
                <th className="px-2 py-1">SKU</th>
                <th className="px-2 py-1">Variant ID</th>
                <th className="px-2 py-1">Inv item</th>
                <th className="px-2 py-1 text-right">Cost</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const selected = value?.shopify_variant_id === o.shopify_variant_id;
                return (
                  <tr
                    key={o.shopify_variant_id}
                    className={`border-t ${selected ? "bg-primary/10" : ""}`}
                  >
                    <td className="px-2 py-1">{o.product_title ?? "—"}</td>
                    <td className="px-2 py-1">{o.variant_title ?? "—"}</td>
                    <td className="px-2 py-1 font-mono">{o.sku ?? "—"}</td>
                    <td className="px-2 py-1 font-mono">{o.shopify_variant_id}</td>
                    <td className="px-2 py-1 font-mono">
                      {o.inventory_item_id ?? "—"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {o.unit_cost_amount ?? "—"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Button
                        size="sm"
                        variant={selected ? "secondary" : "outline"}
                        className="h-7"
                        onClick={() => onChange(o)}
                      >
                        {selected ? "Selected" : "Select"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
