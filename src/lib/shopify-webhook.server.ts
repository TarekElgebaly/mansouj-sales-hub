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

export async function processShopifyOrder(payload: ShopifyOrderPayload) {
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
  const itemsCost = 0; // unit_cost unknown from Shopify; finance fills later
  const totalSelling =
    Number(payload.total_price) ||
    items.reduce((s, l) => s + (Number(l.price) || 0) * (l.quantity ?? 0), 0);
  const shipCost = shippingCost(payload);
  const packagingCost = 0;

  const orderRow = {
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
    items_cost: itemsCost,
    shipping_cost: shipCost,
    packaging_cost: packagingCost,
    tags: payload.tags
      ? payload.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : [],
  };

  const { data: upserted, error: upsertErr } = await supabaseAdmin
    .from("orders")
    .upsert(orderRow as never, { onConflict: "shopify_order_id" })
    .select("id")
    .single();

  if (upsertErr || !upserted) {
    throw new Error(`order upsert failed: ${upsertErr?.message ?? "unknown"}`);
  }
  const orderId = upserted.id;

  // Replace order items
  await supabaseAdmin.from("order_items").delete().eq("order_id", orderId);
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
      return {
        order_id: orderId,
        sku,
        product_name: l.title ?? l.name ?? "Unknown",
        variant: l.variant_title ?? null,
        color,
        size,
        quantity: qty,
        unit_selling_price: unit,
        unit_cost: 0,
      };
    });
    const { error: itemsErr } = await supabaseAdmin.from("order_items").insert(rows as never);
    if (itemsErr) throw new Error(`order_items insert failed: ${itemsErr.message}`);
  }

  return { orderId, shopifyOrderId };
}
