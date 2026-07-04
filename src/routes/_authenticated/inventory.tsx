import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { egp, statusTone } from "@/lib/format";
import { ProductThumb } from "@/components/product-thumb";
import { mediaFromVariant, ShopifyVariantLike } from "@/lib/product-media";

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
};

type InventoryReportRow = {
  id: string;
  imageUrl: string | null;
  sku: string;
  barcode: string | null;
  productName: string;
  productType: string | null;
  variantName: string | null;
  color: string | null;
  size: string | null;
  onHand: number;
  available: number | null;
  cost: number;
  salePrice: number;
  totalCost: number;
  totalSale: number;
  status: "In Stock" | "Low Stock" | "Out of Stock";
  shopifyStatus: string | null;
};

function productRelation(value: ShopifyVariant["shopify_products"]) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function cleanOption(value: string | null | undefined) {
  if (!value || value === "Default Title") return null;
  return value;
}

function stockStatus(quantity: number): InventoryReportRow["status"] {
  if (quantity <= 0) return "Out of Stock";
  if (quantity <= 5) return "Low Stock";
  return "In Stock";
}

function sortRows(rows: InventoryReportRow[], sort: string) {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (sort === "stock") return a.onHand - b.onHand;
    if (sort === "total_cost") return b.totalCost - a.totalCost;
    if (sort === "total_sale") return b.totalSale - a.totalSale;
    return a.productName.localeCompare(b.productName);
  });
  return sorted;
}

function InventoryPage() {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"all" | "low">("all");
  const [status, setStatus] = useState<string>("all");
  const [productType, setProductType] = useState<string>("all");
  const [color, setColor] = useState<string>("all");
  const [size, setSize] = useState<string>("all");
  const [sort, setSort] = useState("product");

  const { data } = useQuery({
    queryKey: ["shopify-inventory-report"],
    queryFn: async () => {
      const [variantsResult, inventoryResult, levelsResult] = await Promise.all([
        (supabase as any)
          .from("shopify_variants")
          .select(
            "id,shopify_variant_id,shopify_product_id,sku,barcode,title,option1,option2,option3,price,inventory_item_id,inventory_quantity,raw,shopify_products(title,product_type,status,image,raw)",
          )
          .order("sku", { ascending: true }),
        (supabase as any)
          .from("shopify_inventory_items")
          .select("inventory_item_id,unit_cost_amount,tracked"),
        (supabase as any)
          .from("shopify_inventory_levels")
          .select("inventory_item_id,available"),
      ]);

      const variants = (variantsResult.data ?? []) as ShopifyVariant[];
      const inventoryItems = (inventoryResult.data ?? []) as InventoryItem[];
      const levels = (levelsResult.data ?? []) as InventoryLevel[];

      const costByInventoryItem = new Map(
        inventoryItems.map((item) => [item.inventory_item_id, Number(item.unit_cost_amount ?? 0)]),
      );
      const availableByInventoryItem = new Map<string, number>();
      for (const level of levels) {
        availableByInventoryItem.set(
          level.inventory_item_id,
          (availableByInventoryItem.get(level.inventory_item_id) ?? 0) + Number(level.available ?? 0),
        );
      }

      return variants.map((variant): InventoryReportRow => {
        const product = productRelation(variant.shopify_products);
        const media = mediaFromVariant(variant);
        const available = variant.inventory_item_id
          ? availableByInventoryItem.get(variant.inventory_item_id) ?? null
          : null;
        const onHand = Number(variant.inventory_quantity ?? available ?? 0);
        const cost = variant.inventory_item_id
          ? Number(costByInventoryItem.get(variant.inventory_item_id) ?? 0)
          : 0;
        const salePrice = Number(variant.price ?? 0);
        const color = cleanOption(variant.option1);
        const size = cleanOption(variant.option2);
        const variantName =
          cleanOption(variant.title) ??
          ([color, size, cleanOption(variant.option3)].filter(Boolean).join(" / ") || null);

        return {
          id: variant.id,
          imageUrl: media.imageUrl,
          sku: variant.sku || `shopify-variant-${variant.shopify_variant_id}`,
          barcode: variant.barcode ?? null,
          productName: product?.title ?? media.productTitle ?? "Untitled product",
          productType: product?.product_type ?? null,
          variantName,
          color,
          size,
          onHand,
          available,
          cost,
          salePrice,
          totalCost: onHand * cost,
          totalSale: onHand * salePrice,
          status: stockStatus(onHand),
          shopifyStatus: product?.status ?? null,
        };
      });
    },
  });

  const rows = data ?? [];
  const productTypes = useMemo(() => Array.from(new Set(rows.map((row) => row.productType).filter(Boolean))) as string[], [rows]);
  const colors = useMemo(() => Array.from(new Set(rows.map((row) => row.color).filter(Boolean))) as string[], [rows]);
  const sizes = useMemo(() => Array.from(new Set(rows.map((row) => row.size).filter(Boolean))) as string[], [rows]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const result = rows.filter((row) => {
      if (
        q &&
        ![row.sku, row.barcode, row.productName, row.variantName, row.productType, row.color, row.size]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q))
      ) {
        return false;
      }
      if (status !== "all" && row.status !== status) return false;
      if (productType !== "all" && row.productType !== productType) return false;
      if (color !== "all" && row.color !== color) return false;
      if (size !== "all" && row.size !== size) return false;
      if (view === "low" && !["Low Stock", "Out of Stock"].includes(row.status)) return false;
      return true;
    });
    return sortRows(result, sort);
  }, [rows, search, status, productType, color, size, view, sort]);

  const summary = useMemo(() => {
    return rows.reduce(
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
  }, [rows]);

  return (
    <AppShell title="Inventory" search={search} onSearch={setSearch}>
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
          <Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40 h-9"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {["In Stock", "Low Stock", "Out of Stock"].map((status) => (
                <SelectItem key={status} value={status}>{status}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Category</Label>
          <Select value={productType} onValueChange={setProductType}>
            <SelectTrigger className="w-44 h-9"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {productTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Color</Label>
          <Select value={color} onValueChange={setColor}>
            <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Color" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All colors</SelectItem>
              {colors.map((color) => <SelectItem key={color} value={color}>{color}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Size</Label>
          <Select value={size} onValueChange={setSize}>
            <SelectTrigger className="w-32 h-9"><SelectValue placeholder="Size" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sizes</SelectItem>
              {sizes.map((size) => <SelectItem key={size} value={size}>{size}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Sort</Label>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-44 h-9"><SelectValue placeholder="Sort" /></SelectTrigger>
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
                <TableHead>SKU</TableHead>
                <TableHead>Product Name</TableHead>
                <TableHead>Variant / Size / Color</TableHead>
                <TableHead className="text-right">On Hand Quantity</TableHead>
                <TableHead className="text-right">Available Quantity</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Sale Price</TableHead>
                <TableHead className="text-right">Total Cost</TableHead>
                <TableHead className="text-right">Total Sale Value</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell><ProductThumb src={row.imageUrl} alt={row.productName} /></TableCell>
                  <TableCell>
                    <div className="font-mono text-xs">{row.sku}</div>
                    {row.barcode && <div className="text-[11px] text-muted-foreground">Barcode: {row.barcode}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{row.productName}</div>
                    <div className="text-xs text-muted-foreground">{row.productType ?? "No category"} · {row.shopifyStatus ?? "No status"}</div>
                  </TableCell>
                  <TableCell>
                    <div>{row.variantName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {[row.color, row.size].filter(Boolean).join(" · ") || "No size/color"}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{row.onHand}</TableCell>
                  <TableCell className="text-right">{row.available ?? "—"}</TableCell>
                  <TableCell className="text-right">{egp(row.cost)}</TableCell>
                  <TableCell className="text-right">{egp(row.salePrice)}</TableCell>
                  <TableCell className="text-right">{egp(row.totalCost)}</TableCell>
                  <TableCell className="text-right">{egp(row.totalSale)}</TableCell>
                  <TableCell><Badge variant={statusTone(row.status)}>{row.status}</Badge></TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
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
