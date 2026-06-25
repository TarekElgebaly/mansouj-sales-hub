import { createFileRoute } from "@tanstack/react-router";
import { requireOpsUser } from "@/lib/shopify-sync.server";

type OrderItemRow = {
  sku: string | null;
  product_name: string | null;
  variant: string | null;
  unit_cost: number | null;
  order_id: string;
};

type VariantRow = {
  shopify_variant_id: string;
  shopify_product_id: string | null;
  sku: string | null;
  title: string | null;
  inventory_item_id: string | null;
};

type ProductRow = { shopify_product_id: string; title: string | null };

type RemapRow = { old_sku: string };

type AutoStatus =
  | "exact_match_available"
  | "ambiguous"
  | "no_match"
  | "remap_exists";

type GroupResult = {
  old_sku: string;
  example_item_title: string | null;
  example_variant: string | null;
  count: number;
  status: AutoStatus;
  matched_variant?: {
    shopify_variant_id: string;
    sku: string | null;
    inventory_item_id: string | null;
    product_title: string | null;
    variant_title: string | null;
  } | null;
  candidates_count?: number;
};

function normTitle(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/(\d)\s*[x×✕*]\s*(\d)/g, "$1*$2")
    .replace(/\s+/g, " ")
    .trim();
}

function normSku(s: string | null): string {
  if (!s) return "";
  return s.toLowerCase().replace(/\s+/g, "").trim();
}

export const Route = createFileRoute("/api/shopify/auto-remap-suggest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireOpsUser(request);
        if (!auth.ok) return auth.response;
        const { supabaseAdmin, userId } = auth;

        const url = new URL(request.url);
        const apply =
          url.searchParams.get("apply") === "1" ||
          url.searchParams.get("apply") === "true";

        try {
          // Active remaps (skip set)
          const activeRemapSkus = new Set<string>();
          {
            const { data, error } = await supabaseAdmin
              .from("shopify_sku_remaps")
              .select("old_sku")
              .eq("is_active", true);
            if (error) throw new Error(`shopify_sku_remaps: ${error.message}`);
            for (const r of (data ?? []) as RemapRow[]) {
              if (r.old_sku) activeRemapSkus.add(r.old_sku.trim());
            }
          }

          // Shopify products
          const productTitleById = new Map<string, string>();
          {
            const pageSize = 1000;
            let from = 0;
            while (true) {
              const { data, error } = await supabaseAdmin
                .from("shopify_products")
                .select("shopify_product_id,title")
                .range(from, from + pageSize - 1);
              if (error) throw new Error(`shopify_products: ${error.message}`);
              const rows = (data ?? []) as ProductRow[];
              for (const p of rows) {
                if (p.shopify_product_id) {
                  productTitleById.set(p.shopify_product_id, p.title ?? "");
                }
              }
              if (rows.length < pageSize) break;
              from += pageSize;
            }
          }

          // Shopify variants and indexes
          const variants: VariantRow[] = [];
          const variantSkuExact = new Set<string>();
          const variantSkuNorm = new Set<string>();
          {
            const pageSize = 1000;
            let from = 0;
            while (true) {
              const { data, error } = await supabaseAdmin
                .from("shopify_variants")
                .select(
                  "shopify_variant_id,shopify_product_id,sku,title,inventory_item_id",
                )
                .range(from, from + pageSize - 1);
              if (error) throw new Error(`shopify_variants: ${error.message}`);
              const rows = (data ?? []) as VariantRow[];
              variants.push(...rows);
              for (const v of rows) {
                if (v.sku) {
                  variantSkuExact.add(v.sku.trim());
                  variantSkuNorm.add(normSku(v.sku));
                }
              }
              if (rows.length < pageSize) break;
              from += pageSize;
            }
          }

          // Index: normalized (product_title, variant_title) → variants[]
          const variantsByTitlePair = new Map<string, VariantRow[]>();
          for (const v of variants) {
            const ptitle = v.shopify_product_id
              ? productTitleById.get(v.shopify_product_id) ?? ""
              : "";
            const key = `${normTitle(ptitle)}||${normTitle(v.title)}`;
            const arr = variantsByTitlePair.get(key) ?? [];
            arr.push(v);
            variantsByTitlePair.set(key, arr);
          }

          // Order items needing cost (unit_cost null/0), from shopify-imported orders
          const orderIds: string[] = [];
          {
            const pageSize = 1000;
            let from = 0;
            while (true) {
              const { data, error } = await supabaseAdmin
                .from("orders")
                .select("id")
                .not("shopify_order_id", "is", null)
                .range(from, from + pageSize - 1);
              if (error) throw new Error(`orders: ${error.message}`);
              const rows = (data ?? []) as { id: string }[];
              for (const r of rows) orderIds.push(r.id);
              if (rows.length < pageSize) break;
              from += pageSize;
            }
          }

          const items: OrderItemRow[] = [];
          for (let i = 0; i < orderIds.length; i += 200) {
            const slice = orderIds.slice(i, i + 200);
            const { data, error } = await supabaseAdmin
              .from("order_items")
              .select("sku,product_name,variant,unit_cost,order_id")
              .in("order_id", slice);
            if (error) throw new Error(`order_items: ${error.message}`);
            items.push(...((data ?? []) as OrderItemRow[]));
          }

          // Group unmatched items by old_sku
          type Agg = {
            old_sku: string;
            example_item_title: string | null;
            example_variant: string | null;
            count: number;
          };
          const groups = new Map<string, Agg>();
          for (const it of items) {
            const cost = Number(it.unit_cost ?? 0);
            if (cost > 0) continue;
            const raw = (it.sku ?? "").trim();
            if (!raw) continue;
            // Already matchable via direct SKU? skip
            if (variantSkuExact.has(raw) || variantSkuNorm.has(normSku(raw)))
              continue;
            const g = groups.get(raw);
            if (g) {
              g.count++;
              if (!g.example_item_title && it.product_name)
                g.example_item_title = it.product_name;
              if (!g.example_variant && it.variant) g.example_variant = it.variant;
            } else {
              groups.set(raw, {
                old_sku: raw,
                example_item_title: it.product_name,
                example_variant: it.variant,
                count: 1,
              });
            }
          }

          // Evaluate each group
          const results: GroupResult[] = [];
          let autoMatch = 0;
          let alreadyExists = 0;
          let noMatch = 0;
          let ambiguous = 0;

          for (const g of groups.values()) {
            if (activeRemapSkus.has(g.old_sku)) {
              alreadyExists++;
              results.push({ ...g, status: "remap_exists" });
              continue;
            }
            const key = `${normTitle(g.example_item_title)}||${normTitle(
              g.example_variant,
            )}`;
            if (!normTitle(g.example_item_title) || !normTitle(g.example_variant)) {
              noMatch++;
              results.push({ ...g, status: "no_match", candidates_count: 0 });
              continue;
            }
            const matches = variantsByTitlePair.get(key) ?? [];
            if (matches.length === 1) {
              const v = matches[0];
              autoMatch++;
              const ptitle = v.shopify_product_id
                ? productTitleById.get(v.shopify_product_id) ?? null
                : null;
              results.push({
                ...g,
                status: "exact_match_available",
                candidates_count: 1,
                matched_variant: {
                  shopify_variant_id: v.shopify_variant_id,
                  sku: v.sku,
                  inventory_item_id: v.inventory_item_id,
                  product_title: ptitle,
                  variant_title: v.title,
                },
              });
            } else if (matches.length > 1) {
              ambiguous++;
              results.push({
                ...g,
                status: "ambiguous",
                candidates_count: matches.length,
              });
            } else {
              noMatch++;
              results.push({ ...g, status: "no_match", candidates_count: 0 });
            }
          }

          results.sort((a, b) => b.count - a.count);

          let createdCount = 0;
          let failedCount = 0;
          let lastError: string | null = null;

          if (apply) {
            for (const r of results) {
              if (r.status !== "exact_match_available" || !r.matched_variant)
                continue;
              const { error } = await supabaseAdmin
                .from("shopify_sku_remaps")
                .insert({
                  old_sku: r.old_sku,
                  new_sku: r.matched_variant.sku,
                  shopify_variant_id: r.matched_variant.shopify_variant_id,
                  inventory_item_id: r.matched_variant.inventory_item_id,
                  note: "Auto-created from exact product + variant match",
                  is_active: true,
                  created_by: userId,
                });
              if (error) {
                // Treat unique conflict as already exists
                if (/duplicate key|unique/i.test(error.message)) {
                  alreadyExists++;
                  autoMatch--;
                } else {
                  failedCount++;
                  lastError = error.message;
                }
              } else {
                createdCount++;
              }
            }
          }

          return Response.json({
            apply,
            checked_sku_groups: groups.size,
            auto_match_count: autoMatch,
            already_exists_count: alreadyExists,
            no_match_count: noMatch,
            ambiguous_match_count: ambiguous,
            auto_remaps_created: createdCount,
            failed: failedCount,
            last_error: lastError,
            results,
            shopify_write_calls: false,
            updates_to_order_items: false,
            backfill_triggered: false,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ status: "error", error: message }, { status: 500 });
        }
      },
    },
  },
});
