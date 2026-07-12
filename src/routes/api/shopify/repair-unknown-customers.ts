import { createFileRoute } from "@tanstack/react-router";
import {
  fetchShopifyWithRetry,
  getShopifyAdminConfig,
  requireOpsUser,
  shopifyHeaders,
} from "@/lib/shopify-sync.server";

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

type ShopifyCustomer = {
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  default_address?: ShopifyAddress | null;
};

type ShopifyOrder = {
  id: number | string;
  name?: string | null;
  email?: string | null;
  contact_email?: string | null;
  phone?: string | null;
  customer?: ShopifyCustomer | null;
  shipping_address?: ShopifyAddress | null;
  billing_address?: ShopifyAddress | null;
};

function nonEmpty(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function joinName(parts: (string | null | undefined)[]) {
  return nonEmpty(parts.filter(Boolean).map((p) => String(p).trim()).join(" "));
}

function resolveContact(order: ShopifyOrder) {
  const ship = order.shipping_address ?? null;
  const bill = order.billing_address ?? null;
  const cust = order.customer ?? null;
  const custDefault = cust?.default_address ?? null;
  const email = nonEmpty(order.email) ?? nonEmpty(order.contact_email) ?? nonEmpty(cust?.email);

  const nameCandidates = [
    joinName([cust?.first_name, cust?.last_name]),
    nonEmpty(cust?.name),
    joinName([ship?.first_name, ship?.last_name]),
    nonEmpty(ship?.name),
    joinName([bill?.first_name, bill?.last_name]),
    nonEmpty(bill?.name),
    joinName([custDefault?.first_name, custDefault?.last_name]),
    nonEmpty(custDefault?.name),
    email,
    nonEmpty(ship?.phone) ?? nonEmpty(bill?.phone) ?? nonEmpty(cust?.phone) ?? nonEmpty(order.phone),
  ];
  const name = nameCandidates.find((v) => v !== null) ?? null;

  const phone =
    nonEmpty(ship?.phone) ??
    nonEmpty(bill?.phone) ??
    nonEmpty(cust?.phone) ??
    nonEmpty(custDefault?.phone) ??
    nonEmpty(order.phone) ??
    null;
  const city = nonEmpty(ship?.city) ?? nonEmpty(bill?.city) ?? nonEmpty(custDefault?.city) ?? null;
  const area =
    nonEmpty(ship?.province) ??
    nonEmpty(bill?.province) ??
    nonEmpty(custDefault?.province) ??
    null;
  const address =
    joinName([ship?.address1, ship?.address2]) ??
    joinName([bill?.address1, bill?.address2]) ??
    joinName([custDefault?.address1, custDefault?.address2]) ??
    null;

  return { name, phone, city, area, address };
}

export const Route = createFileRoute("/api/shopify/repair-unknown-customers")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireOpsUser(request);
        if (!auth.ok) return auth.response;
        const { supabaseAdmin } = auth;

        const config = getShopifyAdminConfig();
        if (!config.ok) {
          return Response.json({ ok: false, error: config.error }, { status: config.status });
        }

        // Find orders with a Shopify id and a missing/placeholder customer name.
        const { data: candidates, error: readErr } = await supabaseAdmin
          .from("orders")
          .select("id,shopify_order_id,order_number,customer_full_name,phone,city,area,full_address")
          .not("shopify_order_id", "is", null);
        if (readErr) {
          return Response.json({ ok: false, error: readErr.message }, { status: 500 });
        }

        const needsRepair = (candidates ?? []).filter((row: any) => {
          const name = nonEmpty(row.customer_full_name);
          return !name || name.toLowerCase() === "unknown";
        });

        const headers = shopifyHeaders(config.accessToken);
        let updated = 0;
        let skipped = 0;
        let failed = 0;
        const errors: Array<{ order_number: string; error: string }> = [];

        for (const row of needsRepair) {
          const shopifyOrderId = row.shopify_order_id as string;
          const url = `https://${config.domain}/admin/api/${config.apiVersion}/orders/${shopifyOrderId}.json`;
          try {
            const res = await fetchShopifyWithRetry(url, headers);
            if (!res.ok) {
              failed += 1;
              errors.push({
                order_number: String(row.order_number ?? shopifyOrderId),
                error: `Shopify ${res.status}`,
              });
              continue;
            }
            const json = (await res.json()) as { order?: ShopifyOrder | null };
            const order = json?.order;
            if (!order) {
              skipped += 1;
              continue;
            }
            const resolved = resolveContact(order);
            const patch: Record<string, unknown> = {};
            if (resolved.name) patch.customer_full_name = resolved.name;
            if (resolved.phone && !nonEmpty(row.phone)) patch.phone = resolved.phone;
            if (resolved.city && !nonEmpty(row.city)) patch.city = resolved.city;
            if (resolved.area && !nonEmpty(row.area)) patch.area = resolved.area;
            if (resolved.address && !nonEmpty(row.full_address))
              patch.full_address = resolved.address;

            if (!patch.customer_full_name && Object.keys(patch).length === 0) {
              skipped += 1;
              continue;
            }

            const { error: upErr } = await supabaseAdmin
              .from("orders")
              .update(patch as never)
              .eq("id", row.id);
            if (upErr) {
              failed += 1;
              errors.push({
                order_number: String(row.order_number ?? shopifyOrderId),
                error: upErr.message,
              });
              continue;
            }
            updated += 1;
          } catch (e) {
            failed += 1;
            errors.push({
              order_number: String(row.order_number ?? shopifyOrderId),
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }

        return Response.json({
          ok: true,
          candidates: needsRepair.length,
          updated,
          skipped,
          failed,
          errors: errors.slice(0, 20),
        });
      },
    },
  },
});
