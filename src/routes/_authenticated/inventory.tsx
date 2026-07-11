import { createFileRoute } from "@tanstack/react-router";
import { type Dispatch, type SetStateAction, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUser } from "@/hooks/use-user";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { egp, statusTone } from "@/lib/format";
import { ProductThumb } from "@/components/product-thumb";
import { mediaFromVariant, ShopifyVariantLike } from "@/lib/product-media";
import { Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/inventory")({
  head: () => ({ meta: [{ title: "Inventory — Mansouj" }] }),
  component: InventoryPage,
});

type ShopifyProduct = {
  title: string | null;
  product_type: string | null;
  status: string | null;
  image: unknown;
  raw: unknown;
};

type ShopifyVariant = ShopifyVariantLike & {
  id: string;
  shopify_variant_id: string | null;
  shopify_product_id: string | null;
  price: number | null;
  inventory_item_id: string | null;
  inventory_quantity: number | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  shopify_products?: ShopifyProduct | ShopifyProduct[] | null;
};

type InventoryItem = {
  inventory_item_id: string;
  unit_cost_amount: number | null;
  tracked: boolean | null;
};

type InventoryLevel = {
  inventory_item_id: string;
  available: number | null;
  available_quantity?: number | null;
  on_hand?: number | null;
  on_hand_quantity?: number | null;
  committed_quantity?: number | null;
  unavailable_quantity?: number | null;
  incoming_quantity?: number | null;
};

type LocalInventoryRow = {
  id: string;
  sku: string | null;
  shopify_product_id?: string | null;
  shopify_variant_id?: string | null;
  inventory_item_id?: string | null;
  current_inventory?: number | null;
  on_hand_quantity?: number | null;
  available_quantity?: number | null;
  committed_quantity?: number | null;
  unavailable_quantity?: number | null;
  incoming_quantity?: number | null;
  cost_price?: number | null;
  sale_price?: number | null;
  is_shopify_stale?: boolean | null;
};

type InventoryReportRow = {
  id: string;
  shopifyVariantId: string | null;
  inventoryItemId: string | null;
  imageUrl: string | null;
  sku: string;
  barcode: string | null;
  productName: string;
  productType: string | null;
  variantName: string | null;
  color: string | null;
  size: string | null;
  onHand: number;
  onHandKnown: boolean;
  available: number | null;
  committed: number | null;
  unavailable: number | null;
  incoming: number | null;
  cost: number;
  salePrice: number;
  totalCost: number;
  totalSale: number;
  status: "In Stock" | "Low Stock" | "Out of Stock";
  shopifyStatus: string | null;
  isShopifyStale: boolean;
  duplicateSkuWarning: boolean;
};

type SortKey =
  | "sku"
  | "productName"
  | "variant"
  | "onHand"
  | "available"
  | "committed"
  | "incoming"
  | "cost"
  | "salePrice"
  | "totalCost"
  | "totalSale"
  | "status";
type TableSort = { key: SortKey; direction: "asc" | "desc" } | null;

function productRelation(value: ShopifyVariant["shopify_products"]) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function cleanOption(value: string | null | undefined) {
  if (!value || value === "Default Title") return null;
  return value;
}

function normalizeProductStatus(value: string | null | undefined) {
  const status = String(value ?? "")
    .trim()
    .toLowerCase();
  return status || null;
}

function stockStatus(quantity: number): InventoryReportRow["status"] {
  if (quantity <= 0) return "Out of Stock";
  if (quantity <= 5) return "Low Stock";
  return "In Stock";
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const n = numberOrNull(value);
    if (n !== null) return n;
  }
  return null;
}

function sortText(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function compareNullableNumbers(a: unknown, b: unknown) {
  const an = numberOrNull(a);
  const bn = numberOrNull(b);
  if (an === null && bn === null) return 0;
  if (an === null) return 1;
  if (bn === null) return -1;
  return an - bn;
}

function compareRowsByKey(a: InventoryReportRow, b: InventoryReportRow, key: SortKey) {
  if (key === "onHand") return compareNullableNumbers(a.onHand, b.onHand);
  if (key === "available") return compareNullableNumbers(a.available, b.available);
  if (key === "committed") return compareNullableNumbers(a.committed, b.committed);
  if (key === "incoming") return compareNullableNumbers(a.incoming, b.incoming);
  if (key === "cost") return compareNullableNumbers(a.cost, b.cost);
  if (key === "salePrice") return compareNullableNumbers(a.salePrice, b.salePrice);
  if (key === "totalCost") return compareNullableNumbers(a.totalCost, b.totalCost);
  if (key === "totalSale") return compareNullableNumbers(a.totalSale, b.totalSale);
  if (key === "variant") {
    return sortText([a.variantName, a.color, a.size].filter(Boolean).join(" ")).localeCompare(
      sortText([b.variantName, b.color, b.size].filter(Boolean).join(" ")),
    );
  }
  if (key === "status") return sortText(a.status).localeCompare(sortText(b.status));
  return sortText(a[key]).localeCompare(sortText(b[key]));
}

function sortRows(rows: InventoryReportRow[], sort: string, tableSort: TableSort) {
  const sorted = [...rows];
  if (tableSort) {
    sorted.sort((a, b) => {
      const result = compareRowsByKey(a, b, tableSort.key);
      return tableSort.direction === "asc" ? result : -result;
    });
    return sorted;
  }

  sorted.sort((a, b) => {
    if (sort === "stock") return a.onHand - b.onHand;
    if (sort === "total_cost") return b.totalCost - a.totalCost;
    if (sort === "total_sale") return b.totalSale - a.totalSale;
    return a.productName.localeCompare(b.productName);
  });
  return sorted;
}

function missingColumn(error: unknown, column: string) {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  return message.toLowerCase().includes("column") && message.includes(column);
}

function missingAnyColumn(error: unknown) {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  return message.toLowerCase().includes("column");
}

function addQuantity(map: Map<string, number>, itemId: string | null | undefined, value: unknown) {
  if (!itemId || value === null || value === undefined) return;
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  map.set(itemId, (map.get(itemId) ?? 0) + n);
}

function normalizedKey(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function normalizedSku(value: string | null | undefined) {
  return normalizedKey(value).toLowerCase();
}

function localInventoryScore(row: LocalInventoryRow) {
  let score = 0;
  if (!row.is_shopify_stale) score += 100;
  if (row.inventory_item_id) score += 30;
  if (row.shopify_variant_id) score += 20;
  if (numberOrNull(row.on_hand_quantity ?? row.current_inventory) !== null) score += 10;
  if (numberOrNull(row.cost_price) && numberOrNull(row.cost_price)! > 0) score += 5;
  return score;
}

function setBestLocalIndex(
  map: Map<string, LocalInventoryRow>,
  key: string | null | undefined,
  row: LocalInventoryRow,
) {
  const normalized = normalizedKey(key);
  if (!normalized) return;
  const existing = map.get(normalized);
  if (!existing || localInventoryScore(row) > localInventoryScore(existing))
    map.set(normalized, row);
}

function buildLocalInventoryIndexes(rows: LocalInventoryRow[]) {
  const byInventoryItem = new Map<string, LocalInventoryRow>();
  const byVariant = new Map<string, LocalInventoryRow>();
  const bySku = new Map<string, LocalInventoryRow>();

  for (const row of rows) {
    setBestLocalIndex(byInventoryItem, row.inventory_item_id, row);
    setBestLocalIndex(byVariant, row.shopify_variant_id, row);
    const sku = normalizedSku(row.sku);
    if (sku) setBestLocalIndex(bySku, sku, row);
  }

  return { byInventoryItem, byVariant, bySku };
}

function localInventoryForVariant(
  variant: ShopifyVariant,
  indexes: ReturnType<typeof buildLocalInventoryIndexes>,
) {
  const inventoryItemId = normalizedKey(variant.inventory_item_id);
  const variantId = normalizedKey(variant.shopify_variant_id);
  const sku = normalizedSku(variant.sku);
  return (
    (inventoryItemId ? indexes.byInventoryItem.get(inventoryItemId) : null) ??
    (variantId ? indexes.byVariant.get(variantId) : null) ??
    (sku ? indexes.bySku.get(sku) : null) ??
    null
  );
}

async function loadLocalInventoryRows() {
  const full = await (supabase as any)
    .from("inventory")
    .select(
      "id,sku,shopify_product_id,shopify_variant_id,inventory_item_id,current_inventory,on_hand_quantity,available_quantity,committed_quantity,unavailable_quantity,incoming_quantity,cost_price,sale_price,is_shopify_stale",
    );
  if (!full.error) return (full.data ?? []) as LocalInventoryRow[];

  if (!missingAnyColumn(full.error)) {
    throw new Error(`Could not load inventory: ${full.error.message}`);
  }

  const legacy = await (supabase as any)
    .from("inventory")
    .select("id,sku,current_inventory,cost_price,sale_price");
  if (legacy.error) throw new Error(`Could not load inventory: ${legacy.error.message}`);
  return (legacy.data ?? []) as LocalInventoryRow[];
}

function inventoryRowScore(row: InventoryReportRow) {
  let score = 0;
  if (row.inventoryItemId) score += 50;
  if (row.shopifyVariantId) score += 40;
  if (!row.isShopifyStale) score += 30;
  if (row.onHandKnown) score += 20;
  if (row.cost > 0) score += 15;
  if (row.onHand >= 0) score += 10;
  if (row.shopifyStatus === "active") score += 5;
  return score;
}

function isLikelyStaleDuplicate(row: InventoryReportRow, best: InventoryReportRow) {
  if (row.isShopifyStale) return true;
  if (!row.onHandKnown && best.onHandKnown) return true;
  if (row.onHand < 0 && best.onHand >= 0) return true;
  if (row.cost <= 0 && best.cost > 0) return true;
  if (row.totalCost < 0 && best.totalCost >= 0) return true;
  return false;
}

function removeStaleDuplicates(rows: InventoryReportRow[]) {
  const byStrongKey = new Map<string, InventoryReportRow>();
  for (const row of rows) {
    const key = row.inventoryItemId
      ? `inventory:${row.inventoryItemId}`
      : row.shopifyVariantId
        ? `variant:${row.shopifyVariantId}`
        : `row:${row.id}`;
    const existing = byStrongKey.get(key);
    if (!existing || inventoryRowScore(row) > inventoryRowScore(existing))
      byStrongKey.set(key, row);
  }

  const bySku = new Map<string, InventoryReportRow[]>();
  for (const row of byStrongKey.values()) {
    const key = normalizedSku(row.sku) || row.id;
    bySku.set(key, [...(bySku.get(key) ?? []), row]);
  }

  const visible: InventoryReportRow[] = [];
  for (const group of bySku.values()) {
    if (group.length === 1) {
      visible.push(group[0]);
      continue;
    }

    const ranked = [...group].sort((a, b) => inventoryRowScore(b) - inventoryRowScore(a));
    const best = ranked[0];
    const kept = ranked.filter((row, index) => index === 0 || !isLikelyStaleDuplicate(row, best));
    const hasTrueDuplicateSku = kept.length > 1;
    visible.push(...kept.map((row) => ({ ...row, duplicateSkuWarning: hasTrueDuplicateSku })));
  }

  return visible;
}

function InventoryPage() {
  const qc = useQueryClient();
  const { canOps } = useUser();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"all" | "low">("all");
  const [status, setStatus] = useState<string>("all");
  const [productStatus, setProductStatus] = useState<string>("active");
  const [productType, setProductType] = useState<string>("all");
  const [color, setColor] = useState<string>("all");
  const [size, setSize] = useState<string>("all");
  const [sort, setSort] = useState("product");
  const [tableSort, setTableSort] = useState<TableSort>(null);
  const [syncing, setSyncing] = useState(false);

  const { data } = useQuery({
    queryKey: ["shopify-inventory-report"],
    queryFn: async () => {
      const [variantsResult, inventoryResult, localInventoryRows] = await Promise.all([
        (supabase as any)
          .from("shopify_variants")
          .select(
            "id,shopify_variant_id,shopify_product_id,sku,barcode,title,option1,option2,option3,price,inventory_item_id,inventory_quantity,raw,shopify_products(title,product_type,status,image,raw)",
          )
          .order("sku", { ascending: true }),
        (supabase as any)
          .from("shopify_inventory_items")
          .select("inventory_item_id,unit_cost_amount,tracked"),
        loadLocalInventoryRows(),
      ]);
      let levelsResult = await (supabase as any)
        .from("shopify_inventory_levels")
        .select(
          "inventory_item_id,available,available_quantity,on_hand,on_hand_quantity,committed_quantity,unavailable_quantity,incoming_quantity",
        );
      if (levelsResult.error && missingAnyColumn(levelsResult.error)) {
        levelsResult = await (supabase as any)
          .from("shopify_inventory_levels")
          .select("inventory_item_id,available,on_hand");
      }
      if (levelsResult.error && missingColumn(levelsResult.error, "on_hand")) {
        levelsResult = await (supabase as any)
          .from("shopify_inventory_levels")
          .select("inventory_item_id,available");
      }
      if (levelsResult.error) {
        throw new Error(`Could not load shopify_inventory_levels: ${levelsResult.error.message}`);
      }

      const variants = (variantsResult.data ?? []) as ShopifyVariant[];
      const inventoryItems = (inventoryResult.data ?? []) as InventoryItem[];
      const levels = (levelsResult.data ?? []) as InventoryLevel[];
      const localInventoryIndexes = buildLocalInventoryIndexes(localInventoryRows);

      const costByInventoryItem = new Map(
        inventoryItems.map((item) => [item.inventory_item_id, Number(item.unit_cost_amount ?? 0)]),
      );
      const availableByInventoryItem = new Map<string, number>();
      const onHandByInventoryItem = new Map<string, number>();
      const committedByInventoryItem = new Map<string, number>();
      const unavailableByInventoryItem = new Map<string, number>();
      const incomingByInventoryItem = new Map<string, number>();
      for (const level of levels) {
        addQuantity(
          availableByInventoryItem,
          level.inventory_item_id,
          level.available_quantity ?? level.available,
        );
        addQuantity(
          onHandByInventoryItem,
          level.inventory_item_id,
          level.on_hand_quantity ?? level.on_hand,
        );
        addQuantity(committedByInventoryItem, level.inventory_item_id, level.committed_quantity);
        addQuantity(
          unavailableByInventoryItem,
          level.inventory_item_id,
          level.unavailable_quantity,
        );
        addQuantity(incomingByInventoryItem, level.inventory_item_id, level.incoming_quantity);
      }

      const reportRows = variants.flatMap((variant): InventoryReportRow[] => {
        const product = productRelation(variant.shopify_products);
        const media = mediaFromVariant(variant);
        const inventoryItemId = variant.inventory_item_id;
        const localInventory = localInventoryForVariant(variant, localInventoryIndexes);
        if (localInventory?.is_shopify_stale) return [];

        const hasLevelOnHand = inventoryItemId ? onHandByInventoryItem.has(inventoryItemId) : false;
        const hasCost = inventoryItemId ? costByInventoryItem.has(inventoryItemId) : false;
        const available = firstNumber(
          inventoryItemId ? availableByInventoryItem.get(inventoryItemId) : null,
          localInventory?.available_quantity,
        );
        const unavailable = firstNumber(
          inventoryItemId ? unavailableByInventoryItem.get(inventoryItemId) : null,
          localInventory?.unavailable_quantity,
        );
        const incoming = firstNumber(
          inventoryItemId ? incomingByInventoryItem.get(inventoryItemId) : null,
          localInventory?.incoming_quantity,
        );
        const onHandKnown =
          hasLevelOnHand ||
          numberOrNull(localInventory?.on_hand_quantity ?? localInventory?.current_inventory) !==
            null;
        const onHand =
          firstNumber(
            inventoryItemId ? onHandByInventoryItem.get(inventoryItemId) : null,
            localInventory?.on_hand_quantity,
            variant.inventory_quantity,
            localInventory?.current_inventory,
          ) ?? 0;
        const committedFromShopify =
          inventoryItemId && committedByInventoryItem.has(inventoryItemId)
            ? committedByInventoryItem.get(inventoryItemId)!
            : null;
        const committedFallback =
          onHandKnown && available !== null ? Number((onHand - available).toFixed(2)) : null;
        const committed = firstNumber(
          committedFromShopify,
          committedFallback,
          localInventory?.committed_quantity,
        );
        const cost =
          firstNumber(
            hasCost && inventoryItemId ? costByInventoryItem.get(inventoryItemId) : null,
            localInventory?.cost_price,
          ) ?? 0;
        const salePrice = firstNumber(variant.price, localInventory?.sale_price) ?? 0;
        const color = cleanOption(variant.option1);
        const size = cleanOption(variant.option2);
        const variantName =
          cleanOption(variant.title) ??
          ([color, size, cleanOption(variant.option3)].filter(Boolean).join(" / ") || null);

        return [
          {
            id: variant.id,
            shopifyVariantId: variant.shopify_variant_id ?? null,
            inventoryItemId: inventoryItemId ?? null,
            imageUrl: media.imageUrl,
            sku: variant.sku || `shopify-variant-${variant.shopify_variant_id}`,
            barcode: variant.barcode ?? null,
            productName: product?.title ?? media.productTitle ?? "Untitled product",
            productType: product?.product_type ?? null,
            variantName,
            color,
            size,
            onHand,
            onHandKnown,
            available,
            committed,
            unavailable,
            incoming,
            cost,
            salePrice,
            totalCost: onHand * cost,
            totalSale: onHand * salePrice,
            status: stockStatus(onHand),
            shopifyStatus: normalizeProductStatus(product?.status),
            isShopifyStale: Boolean(localInventory?.is_shopify_stale),
            duplicateSkuWarning: false,
          },
        ];
      });

      return removeStaleDuplicates(reportRows);
    },
  });

  const rows = data ?? [];
  const productTypes = useMemo(
    () => Array.from(new Set(rows.map((row) => row.productType).filter(Boolean))) as string[],
    [rows],
  );
  const colors = useMemo(
    () => Array.from(new Set(rows.map((row) => row.color).filter(Boolean))) as string[],
    [rows],
  );
  const sizes = useMemo(
    () => Array.from(new Set(rows.map((row) => row.size).filter(Boolean))) as string[],
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const result = rows.filter((row) => {
      if (
        q &&
        ![
          row.sku,
          row.barcode,
          row.productName,
          row.variantName,
          row.productType,
          row.color,
          row.size,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q))
      ) {
        return false;
      }
      if (status !== "all" && row.status !== status) return false;
      if (productStatus !== "all" && row.shopifyStatus !== productStatus) return false;
      if (productType !== "all" && row.productType !== productType) return false;
      if (color !== "all" && row.color !== color) return false;
      if (size !== "all" && row.size !== size) return false;
      if (view === "low" && !["Low Stock", "Out of Stock"].includes(row.status)) return false;
      return true;
    });
    return sortRows(result, sort, tableSort);
  }, [rows, search, status, productStatus, productType, color, size, view, sort, tableSort]);

  const summary = useMemo(() => {
    return filtered.reduce(
      (acc, row) => {
        acc.totalSkus += 1;
        acc.totalOnHand += row.onHand;
        acc.totalCost += row.totalCost;
        acc.totalSale += row.totalSale;
        if (row.status === "Low Stock") acc.lowStock += 1;
        if (row.status === "Out of Stock") acc.outOfStock += 1;
        return acc;
      },
      { totalSkus: 0, totalOnHand: 0, totalCost: 0, totalSale: 0, lowStock: 0, outOfStock: 0 },
    );
  }, [filtered]);

  const hasIncoming = useMemo(() => filtered.some((r) => (r.incoming ?? 0) > 0), [filtered]);

  const syncInventory = async () => {
    setSyncing(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Please sign in again.");
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      toast.info("Syncing inventory & costs from Shopify…");
      const r1 = await fetch("/api/shopify/sync-inventory-cost", { method: "POST", headers });
      const j1 = await r1.json().catch(() => ({}));
      if (!r1.ok) throw new Error(j1.error ?? "Inventory sync failed.");
      toast.info("Refreshing inventory from Shopify source of truth…");
      const r2 = await fetch("/api/shopify/refresh-inventory-source-of-truth", {
        method: "POST",
        headers,
      });
      const j2 = await r2.json().catch(() => ({}));
      if (!r2.ok) throw new Error(j2.error ?? "Inventory refresh failed.");
      toast.success("Inventory synced from Shopify.");
      await qc.invalidateQueries({ queryKey: ["shopify-inventory-report"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  const exportCsv = () => {
    const esc = (v: unknown) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "SKU",
      "Barcode",
      "Product Name",
      "Product Type",
      "Variant",
      "Color",
      "Size",
      "On Hand",
      "Available",
      "Committed",
      "Incoming",
      "Cost",
      "Sale Price",
      "Total Cost",
      "Total Sale",
      "Status",
      "Shopify Status",
    ];
    const lines = [header.join(",")];
    for (const r of filtered) {
      lines.push(
        [
          r.sku,
          r.barcode,
          r.productName,
          r.productType,
          r.variantName,
          r.color,
          r.size,
          r.onHand,
          r.available ?? "",
          r.committed ?? "",
          r.incoming ?? "",
          r.cost,
          r.salePrice,
          r.totalCost,
          r.totalSale,
          r.status,
          r.shopifyStatus,
        ]
          .map(esc)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell title="Inventory" search={search} onSearch={setSearch}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Button onClick={syncInventory} disabled={!canOps || syncing} size="lg">
          <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          Sync Inventory from Shopify
        </Button>
        <Button onClick={exportCsv} variant="outline">
          <Download className="mr-2 h-4 w-4" />
          Export Inventory CSV
        </Button>
        {!canOps && (
          <span className="text-xs text-muted-foreground">
            Admin or operations access required to sync.
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 mb-4">
        <SummaryCard label="Total SKUs" value={summary.totalSkus} />
        <SummaryCard label="On Hand Quantity" value={summary.totalOnHand} />
        <SummaryCard label="Inventory Cost" value={egp(summary.totalCost)} />
        <SummaryCard label="Inventory Sale Value" value={egp(summary.totalSale)} />
        <SummaryCard label="Low Stock Items" value={summary.lowStock} />
        <SummaryCard label="Out of Stock Items" value={summary.outOfStock} />
      </div>

      <div className="flex flex-wrap gap-2 items-end mb-3">
        <Tabs value={view} onValueChange={(v) => setView(v as "all" | "low")}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="low">Low stock</TabsTrigger>
          </TabsList>
        </Tabs>
        <div>
          <Label className="text-xs">Product Status</Label>
          <Select value={productStatus} onValueChange={setProductStatus}>
            <SelectTrigger className="w-40 h-9">
              <SelectValue placeholder="Product status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Stock Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40 h-9">
              <SelectValue placeholder="Stock status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {["In Stock", "Low Stock", "Out of Stock"].map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Category</Label>
          <Select value={productType} onValueChange={setProductType}>
            <SelectTrigger className="w-44 h-9">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {productTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Color</Label>
          <Select value={color} onValueChange={setColor}>
            <SelectTrigger className="w-36 h-9">
              <SelectValue placeholder="Color" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All colors</SelectItem>
              {colors.map((color) => (
                <SelectItem key={color} value={color}>
                  {color}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Size</Label>
          <Select value={size} onValueChange={setSize}>
            <SelectTrigger className="w-32 h-9">
              <SelectValue placeholder="Size" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sizes</SelectItem>
              {sizes.map((size) => (
                <SelectItem key={size} value={size}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Sort</Label>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-44 h-9">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="product">Product name</SelectItem>
              <SelectItem value="stock">Stock quantity</SelectItem>
              <SelectItem value="total_cost">Total cost</SelectItem>
              <SelectItem value="total_sale">Total sale value</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Input
          className="h-9 w-64"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search product, SKU, barcode/ASIN..."
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product Image</TableHead>
                <SortableHead label="SKU" sortKey="sku" sort={tableSort} onSort={setTableSort} />
                <SortableHead
                  label="Product Name"
                  sortKey="productName"
                  sort={tableSort}
                  onSort={setTableSort}
                />
                <SortableHead
                  label="Variant / Size / Color"
                  sortKey="variant"
                  sort={tableSort}
                  onSort={setTableSort}
                />
                <SortableHead
                  label="On Hand Quantity"
                  sortKey="onHand"
                  sort={tableSort}
                  onSort={setTableSort}
                  align="right"
                />
                <SortableHead
                  label="Available Quantity"
                  sortKey="available"
                  sort={tableSort}
                  onSort={setTableSort}
                  align="right"
                />
                <SortableHead
                  label="Committed Quantity"
                  sortKey="committed"
                  sort={tableSort}
                  onSort={setTableSort}
                  align="right"
                />
                {hasIncoming && (
                  <SortableHead
                    label="Incoming"
                    sortKey="incoming"
                    sort={tableSort}
                    onSort={setTableSort}
                    align="right"
                  />
                )}
                <SortableHead
                  label="Cost"
                  sortKey="cost"
                  sort={tableSort}
                  onSort={setTableSort}
                  align="right"
                />
                <SortableHead
                  label="Sale Price"
                  sortKey="salePrice"
                  sort={tableSort}
                  onSort={setTableSort}
                  align="right"
                />
                <SortableHead
                  label="Total Cost"
                  sortKey="totalCost"
                  sort={tableSort}
                  onSort={setTableSort}
                  align="right"
                />
                <SortableHead
                  label="Total Sale Value"
                  sortKey="totalSale"
                  sort={tableSort}
                  onSort={setTableSort}
                  align="right"
                />
                <SortableHead
                  label="Status"
                  sortKey="status"
                  sort={tableSort}
                  onSort={setTableSort}
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <ProductThumb src={row.imageUrl} alt={row.productName} />
                  </TableCell>
                  <TableCell>
                    <div className="font-mono text-xs">{row.sku}</div>
                    {row.barcode && (
                      <div className="text-[11px] text-muted-foreground">
                        Barcode: {row.barcode}
                      </div>
                    )}
                    {row.duplicateSkuWarning && (
                      <Badge variant="secondary" className="mt-1">
                        Duplicate SKU in Shopify
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{row.productName}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.productType ?? "No category"} · {row.shopifyStatus ?? "No status"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>{row.variantName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {[row.color, row.size].filter(Boolean).join(" · ") || "No size/color"}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{row.onHand}</TableCell>
                  <TableCell className="text-right">{row.available ?? "—"}</TableCell>
                  <TableCell className="text-right">{row.committed ?? "—"}</TableCell>
                  {hasIncoming && (
                    <TableCell className="text-right">{row.incoming ?? "—"}</TableCell>
                  )}
                  <TableCell className="text-right">{egp(row.cost)}</TableCell>
                  <TableCell className="text-right">{egp(row.salePrice)}</TableCell>
                  <TableCell className="text-right">{egp(row.totalCost)}</TableCell>
                  <TableCell className="text-right">{egp(row.totalSale)}</TableCell>
                  <TableCell>
                    <Badge variant={statusTone(row.status)}>{row.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={hasIncoming ? 13 : 12}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No synced Shopify inventory matches these filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}

function SummaryCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-lg font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function nextTableSort(current: TableSort, key: SortKey): TableSort {
  if (!current || current.key !== key) return { key, direction: "asc" };
  if (current.direction === "asc") return { key, direction: "desc" };
  return null;
}

function SortableHead({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sort: TableSort;
  onSort: Dispatch<SetStateAction<TableSort>>;
  align?: "left" | "right";
}) {
  const active = sort?.key === sortKey;
  const indicator = active ? (sort.direction === "asc" ? "↑" : "↓") : "";
  const alignClass = align === "right" ? "justify-end text-right" : "justify-start text-left";

  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        className={`inline-flex w-full items-center gap-1 ${alignClass}`}
        onClick={() => onSort((current) => nextTableSort(current, sortKey))}
      >
        <span>{label}</span>
        {indicator && <span aria-hidden="true">{indicator}</span>}
      </button>
    </TableHead>
  );
}
