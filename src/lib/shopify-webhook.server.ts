import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyShopifyHmac(rawBody: string, hmacHeader: string | null): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret || !hmacHeader) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

type ShopifyAddress = {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  phone?: string | null;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

type ShopifyLineItem = {
  sku?: string | null;
  title?: string | null;
  name?: string | null;
  variant_title?: string | null;
  quantity?: number | null;
  price?: string | null;
  variant_id?: number | string | null;
  properties?: Array<{ name: string; value: string }> | null;
};

type ShopifyCustomer = {
  id?: number | string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type ShopifyOrderPayload = {
  id: number | string;
  name?: string | null;
  order_number?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  processed_at?: string | null;
  total_price?: string | null;
  subtotal_price?: string | null;
  total_shipping_price_set?: { shop_money?: { amount?: string } } | null;
  shipping_lines?: Array<{ price?: string | null }> | null;
  gateway?: string | null;
  payment_gateway_names?: string[] | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  cancelled_at?: string | null;
  note?: string | null;
  tags?: string | null;
  customer?: ShopifyCustomer | null;
  shipping_address?: ShopifyAddress | null;
  billing_address?: ShopifyAddress | null;
  line_items?: ShopifyLineItem[] | null;
};

function fullName(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ").trim();
}

function shippingCost(p: ShopifyOrderPayload): number {
  const set = p.total_shipping_price_set?.shop_money?.amount;
  if (set) return Number(set) || 0;
  return (p.shipping_lines ?? []).reduce((s, l) => s + (Number(l.price) || 0), 0);
}

function normalizeSku(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[×x]/g, "*");
}

export type ProcessOrderResult = {
  orderId: string;
  shopifyOrderId: string;
  existed: boolean;
  itemsProcessed: number;
  itemsWithCost: number;
  itemsMissingCost: number;
  itemsCostTotal: number;
};

export async function processShopifyOrder(payload: ShopifyOrderPayload): Promise<ProcessOrderResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const shopifyOrderId = String(payload.id);
  const ship = payload.shipping_address ?? payload.billing_address ?? null;
  const cust = payload.customer ?? null;

  const customerName =
    fullName([ship?.first_name, ship?.last_name]) ||
    ship?.name ||
    fullName([cust?.first_name, cust?.last_name]) ||
    "Unknown";
  const phone = ship?.phone ?? cust?.phone ?? null;
  const city = ship?.city ?? null;
  const area = ship?.province ?? null;
  const address = fullName([ship?.address1, ship?.address2]) || null;

  // Upsert customer by phone (best-effort dedupe)
  let customerId: string | null = null;
  if (phone) {
    const { data: existing } = await supabaseAdmin
      .from("customers")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();
    if (existing?.id) {
      customerId = existing.id;
      await supabaseAdmin
        .from("customers")
        .update({
          full_name: customerName,
          city,
          area,
          full_address: address,
        })
        .eq("id", customerId);
    } else {
      const { data: created } = await supabaseAdmin
        .from("customers")
        .insert({
          full_name: customerName,
          phone,
          city,
          area,
          full_address: address,
        })
        .select("id")
        .single();
      customerId = created?.id ?? null;
    }
  }

  const items = payload.line_items ?? [];
  const totalSelling =
    Number(payload.total_price) ||
    items.reduce((s, l) => s + (Number(l.price) || 0) * (l.quantity ?? 0), 0);
  const shipCost = shippingCost(payload);
  const packagingCost = 0;

  // Detect whether this order already exists (for created/updated counters)
  const { data: existingOrder } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("shopify_order_id", shopifyOrderId)
    .maybeSingle();
  const existed = Boolean(existingOrder?.id);

  // Base order row; items_cost is overwritten below after items are resolved
  const orderBaseRow = {
    shopify_order_id: shopifyOrderId,
    order_number: payload.name ?? (payload.order_number ? `#${payload.order_number}` : shopifyOrderId),
    shopify_created_at: payload.created_at ?? payload.processed_at ?? null,
    order_date: (payload.created_at ?? payload.processed_at ?? new Date().toISOString()).slice(0, 10),
    customer_id: customerId,
    customer_full_name: customerName,
    phone: phone ?? "",
    second_phone: null,
    city,
    area,
    full_address: address,
    payment_gateway: payload.gateway ?? payload.payment_gateway_names?.[0] ?? null,
    confirmation_status: "Fresh Calls",
    order_status: payload.cancelled_at
      ? "Cancelled"
      : payload.fulfillment_status === "fulfilled"
        ? "Delivered"
        : "New",
    internal_notes: payload.note ?? null,
    total_selling_price: totalSelling,
    items_cost: 0,
    shipping_cost: shipCost,
    packaging_cost: packagingCost,
    tags: payload.tags
      ? payload.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : [],
  };

  const { data: upserted, error: upsertErr } = await supabaseAdmin
    .from("orders")
    .upsert(orderBaseRow as never, { onConflict: "shopify_order_id" })
    .select("id")
    .single();

  if (upsertErr || !upserted) {
    throw new Error(`order upsert failed: ${upsertErr?.message ?? "unknown"}`);
  }
  const orderId = upserted.id;

  // ---- Resolve unit_cost from local Shopify variant/inventory data ----
  const variantIds = Array.from(
    new Set(
      items
        .map((l) => (l.variant_id != null ? String(l.variant_id) : null))
        .filter((v): v is string => Boolean(v)),
    ),
  );
  const skusRaw = Array.from(
    new Set(
      items
        .map((l) => (l.sku && l.sku.trim().length > 0 ? l.sku.trim() : null))
        .filter((v): v is string => Boolean(v)),
    ),
  );

  const variantByVariantId = new Map<string, { sku: string | null; inventory_item_id: string | null }>();
  const variantBySku = new Map<string, { inventory_item_id: string | null; shopify_variant_id: string }>();
  const variantByNormSku = new Map<string, { inventory_item_id: string | null; shopify_variant_id: string }>();

  if (variantIds.length) {
    const { data: rows } = await supabaseAdmin
      .from("shopify_variants")
      .select("shopify_variant_id, sku, inventory_item_id")
      .in("shopify_variant_id", variantIds);
    for (const v of rows ?? []) {
      if (v.shopify_variant_id) {
        variantByVariantId.set(String(v.shopify_variant_id), {
          sku: v.sku ?? null,
          inventory_item_id: v.inventory_item_id ?? null,
        });
      }
    }
  }
  if (skusRaw.length) {
    const { data: rows } = await supabaseAdmin
      .from("shopify_variants")
      .select("shopify_variant_id, sku, inventory_item_id")
      .in("sku", skusRaw);
    for (const v of rows ?? []) {
      if (v.sku) {
        variantBySku.set(v.sku, {
          inventory_item_id: v.inventory_item_id ?? null,
          shopify_variant_id: String(v.shopify_variant_id),
        });
        const n = normalizeSku(v.sku);
        if (n) variantByNormSku.set(n, {
          inventory_item_id: v.inventory_item_id ?? null,
          shopify_variant_id: String(v.shopify_variant_id),
        });
      }
      if (v.shopify_variant_id && !variantByVariantId.has(String(v.shopify_variant_id))) {
        variantByVariantId.set(String(v.shopify_variant_id), {
          sku: v.sku ?? null,
          inventory_item_id: v.inventory_item_id ?? null,
        });
      }
    }
  }

  // SKU remaps (final priority)
  const remapBySku = new Map<string, { new_sku: string | null; shopify_variant_id: string | null; inventory_item_id: string | null }>();
  if (skusRaw.length) {
    const { data: remapRows } = await supabaseAdmin
      .from("shopify_sku_remaps")
      .select("old_sku, new_sku, shopify_variant_id, inventory_item_id, is_active")
      .eq("is_active", true)
      .in("old_sku", skusRaw);
    for (const r of remapRows ?? []) {
      if (r.old_sku) {
        remapBySku.set(r.old_sku, {
          new_sku: r.new_sku ?? null,
          shopify_variant_id: r.shopify_variant_id ?? null,
          inventory_item_id: r.inventory_item_id ?? null,
        });
      }
    }
  }

  // Pull any variants referenced only through remap
  const remapVariantIds = Array.from(new Set([...remapBySku.values()].map((r) => r.shopify_variant_id).filter((v): v is string => Boolean(v))));
  const remapNewSkus = Array.from(new Set([...remapBySku.values()].map((r) => r.new_sku).filter((v): v is string => Boolean(v))));
  if (remapVariantIds.length) {
    const { data: rows } = await supabaseAdmin
      .from("shopify_variants")
      .select("shopify_variant_id, sku, inventory_item_id")
      .in("shopify_variant_id", remapVariantIds);
    for (const v of rows ?? []) {
      if (v.shopify_variant_id) {
        variantByVariantId.set(String(v.shopify_variant_id), {
          sku: v.sku ?? null,
          inventory_item_id: v.inventory_item_id ?? null,
        });
      }
    }
  }
  if (remapNewSkus.length) {
    const { data: rows } = await supabaseAdmin
      .from("shopify_variants")
      .select("shopify_variant_id, sku, inventory_item_id")
      .in("sku", remapNewSkus);
    for (const v of rows ?? []) {
      if (v.sku && !variantBySku.has(v.sku)) {
        variantBySku.set(v.sku, {
          inventory_item_id: v.inventory_item_id ?? null,
          shopify_variant_id: String(v.shopify_variant_id),
        });
      }
    }
  }

  // Inventory item costs
  const inventoryItemIds = new Set<string>();
  for (const v of variantByVariantId.values()) if (v.inventory_item_id) inventoryItemIds.add(v.inventory_item_id);
  for (const v of variantBySku.values()) if (v.inventory_item_id) inventoryItemIds.add(v.inventory_item_id);
  for (const r of remapBySku.values()) if (r.inventory_item_id) inventoryItemIds.add(r.inventory_item_id);

  const costByInventoryItem = new Map<string, number>();
  if (inventoryItemIds.size) {
    const { data: invRows } = await supabaseAdmin
      .from("shopify_inventory_items")
      .select("inventory_item_id, unit_cost_amount")
      .in("inventory_item_id", Array.from(inventoryItemIds));
    for (const r of invRows ?? []) {
      const amt = r.unit_cost_amount == null ? 0 : Number(r.unit_cost_amount);
      if (r.inventory_item_id != null && Number.isFinite(amt)) {
        costByInventoryItem.set(String(r.inventory_item_id), amt);
      }
    }
  }

  // Preserve previously-stored non-zero costs on existing items (by sku)
  const existingCostBySku = new Map<string, number>();
  if (existed) {
    const { data: existingItems } = await supabaseAdmin
      .from("order_items")
      .select("sku, unit_cost")
      .eq("order_id", orderId);
    for (const it of existingItems ?? []) {
      const c = Number(it.unit_cost) || 0;
      if (it.sku && c > 0) existingCostBySku.set(it.sku, c);
    }
  }

  const resolveUnitCost = (l: ShopifyLineItem, finalSku: string): number => {
    // A) Variant ID -> inventory item -> cost
    if (l.variant_id != null) {
      const v = variantByVariantId.get(String(l.variant_id));
      if (v?.inventory_item_id) {
        const c = costByInventoryItem.get(v.inventory_item_id);
        if (c && c > 0) return c;
      }
    }
    // B) Exact SKU / normalized SKU -> variant -> inventory item -> cost
    if (l.sku) {
      const v = variantBySku.get(l.sku);
      if (v?.inventory_item_id) {
        const c = costByInventoryItem.get(v.inventory_item_id);
        if (c && c > 0) return c;
      }
      const nv = variantByNormSku.get(normalizeSku(l.sku));
      if (nv?.inventory_item_id) {
        const c = costByInventoryItem.get(nv.inventory_item_id);
        if (c && c > 0) return c;
      }
    }
    // C) Active SKU remap -> inventory item / variant -> cost
    if (l.sku) {
      const r = remapBySku.get(l.sku);
      if (r) {
        if (r.inventory_item_id) {
          const c = costByInventoryItem.get(r.inventory_item_id);
          if (c && c > 0) return c;
        }
        if (r.shopify_variant_id) {
          const v = variantByVariantId.get(r.shopify_variant_id);
          if (v?.inventory_item_id) {
            const c = costByInventoryItem.get(v.inventory_item_id);
            if (c && c > 0) return c;
          }
        }
        if (r.new_sku) {
          const v = variantBySku.get(r.new_sku);
          if (v?.inventory_item_id) {
            const c = costByInventoryItem.get(v.inventory_item_id);
            if (c && c > 0) return c;
          }
        }
      }
    }
    // D) Preserve previously-stored non-zero cost
    const prior = existingCostBySku.get(finalSku);
    if (prior && prior > 0) return prior;
    return 0;
  };

  // Replace order items with resolved costs
  await supabaseAdmin.from("order_items").delete().eq("order_id", orderId);

  let itemsWithCost = 0;
  let itemsMissingCost = 0;
  let itemsCostTotal = 0;

  if (items.length) {
    const rows = items.map((l) => {
      const qty = l.quantity ?? 0;
      const unit = Number(l.price) || 0;
      const color = l.properties?.find((p) => p.name?.toLowerCase() === "color")?.value ?? null;
      const size = l.properties?.find((p) => p.name?.toLowerCase() === "size")?.value ?? null;
      const sku =
        l.sku && l.sku.trim().length > 0
          ? l.sku
          : `shopify-variant-${l.variant_id ?? "unknown"}`;
      const unitCost = resolveUnitCost(l, sku);
      if (unitCost > 0) {
        itemsWithCost++;
        itemsCostTotal += unitCost * qty;
      } else {
        itemsMissingCost++;
      }
      return {
        order_id: orderId,
        sku,
        product_name: l.title ?? l.name ?? "Unknown",
        variant: l.variant_title ?? null,
        color,
        size,
        quantity: qty,
        unit_selling_price: unit,
        unit_cost: unitCost,
      };
    });
    const { error: itemsErr } = await supabaseAdmin.from("order_items").insert(rows as never);
    if (itemsErr) throw new Error(`order_items insert failed: ${itemsErr.message}`);
  }

  // Recalculate items_cost from inserted items so generated profit columns refresh
  await supabaseAdmin
    .from("orders")
    .update({ items_cost: itemsCostTotal } as never)
    .eq("id", orderId);

  return {
    orderId,
    shopifyOrderId,
    existed,
    itemsProcessed: items.length,
    itemsWithCost,
    itemsMissingCost,
    itemsCostTotal,
  };
}
