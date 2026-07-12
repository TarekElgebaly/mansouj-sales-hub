import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "node:crypto";

type IntakePayload = {
  order_number?: string | number | null;
  name?: string | null;
  shopify_order_id?: string | number | null;
  customer_name?: string | null;
  email?: string | null;
  phone?: string | null;
  shipping_name?: string | null;
  billing_name?: string | null;
  shipping_phone?: string | null;
  shipping_address_1?: string | null;
  shipping_address_2?: string | null;
  shipping_city?: string | null;
  shipping_province?: string | null;
  shipping_zip?: string | null;
  shipping_country?: string | null;
  source?: string | null;
  message_id?: string | null;
};

function nonEmpty(v: unknown): string | null {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function isPlaceholder(v: string | null): boolean {
  if (!v) return true;
  return v.trim().toLowerCase() === "unknown";
}

function firstNonEmpty(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    const s = nonEmpty(v);
    if (s) return s;
  }
  return null;
}

function normalizeOrderNumber(v: unknown): { withHash: string; noHash: string } | null {
  const s = nonEmpty(v);
  if (!s) return null;
  const noHash = s.replace(/^#+/, "");
  return { withHash: `#${noHash}`, noHash };
}

function safeCompare(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  try {
    return timingSafeEqual(A, B);
  } catch {
    return false;
  }
}

function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`;
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((obj as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

export const Route = createFileRoute("/api/orders/external-order-intake")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const configuredSecret = process.env.ORDER_INTAKE_SECRET;
        if (!configuredSecret) {
          return Response.json(
            { ok: false, error: "ORDER_INTAKE_SECRET is not configured on the server" },
            { status: 500 },
          );
        }

        const headerSecret = request.headers.get("x-order-intake-secret") ?? "";
        if (!safeCompare(headerSecret, configuredSecret)) {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }

        let rawText = "";
        let payload: IntakePayload = {};
        try {
          rawText = await request.text();
          payload = rawText ? (JSON.parse(rawText) as IntakePayload) : {};
        } catch (e) {
          return Response.json(
            { ok: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` },
            { status: 400 },
          );
        }

        const source = nonEmpty(payload.source);
        const messageId = nonEmpty(payload.message_id);
        const orderNumberRaw = payload.order_number ?? payload.name ?? null;
        const orderNumberNorm = normalizeOrderNumber(orderNumberRaw);
        const shopifyOrderId = nonEmpty(payload.shopify_order_id);
        const payloadHash = createHash("sha256").update(stableStringify(payload)).digest("hex");

        const logAndReturn = async (
          status: string,
          extra: {
            matched_order_id?: string | null;
            repaired_fields?: string[];
            error_message?: string | null;
            httpStatus?: number;
          } = {},
        ) => {
          try {
            await supabaseAdmin.from("order_intake_logs").insert({
              source,
              order_number: orderNumberNorm?.withHash ?? nonEmpty(orderNumberRaw),
              matched_order_id: extra.matched_order_id ?? null,
              status,
              repaired_fields: (extra.repaired_fields ?? []) as never,
              error_message: extra.error_message ?? null,
              message_id: messageId,
              payload_hash: payloadHash,
              raw_payload: (payload as unknown) as never,
            } as never);
          } catch (e) {
            console.error("[intake] failed to insert log", e);
          }
          const body: Record<string, unknown> = { ok: status !== "error", status };
          if (extra.repaired_fields?.length) body.repaired_fields = extra.repaired_fields;
          if (extra.error_message) body.error = extra.error_message;
          return Response.json(body, { status: extra.httpStatus ?? 200 });
        };

        try {
          // Idempotency check
          if (messageId || orderNumberNorm) {
            const orFilters: string[] = [];
            if (messageId) orFilters.push(`message_id.eq.${messageId}`);
            if (orderNumberNorm)
              orFilters.push(
                `and(order_number.eq.${orderNumberNorm.withHash},payload_hash.eq.${payloadHash})`,
              );
            if (orFilters.length) {
              const { data: prior } = await supabaseAdmin
                .from("order_intake_logs")
                .select("id,status")
                .or(orFilters.join(","))
                .in("status", ["repaired", "matched_no_changes", "duplicate"])
                .limit(1);
              if (prior && prior.length > 0) {
                return await logAndReturn("duplicate");
              }
            }
          }

          // Find the order
          type OrderRow = {
            id: string;
            customer_full_name: string | null;
            phone: string | null;
            city: string | null;
            area: string | null;
            full_address: string | null;
          };
          let orderRow: OrderRow | null = null;

          const selectCols = "id,customer_full_name,phone,city,area,full_address";

          if (orderNumberNorm) {
            const { data } = await supabaseAdmin
              .from("orders")
              .select(selectCols)
              .eq("order_number", orderNumberNorm.withHash)
              .maybeSingle();
            if (data) orderRow = data as unknown as OrderRow;
            if (!orderRow) {
              const { data: d2 } = await supabaseAdmin
                .from("orders")
                .select(selectCols)
                .eq("order_number", orderNumberNorm.noHash)
                .maybeSingle();
              if (d2) orderRow = d2 as unknown as OrderRow;
            }
          }
          if (!orderRow && shopifyOrderId) {
            const { data } = await supabaseAdmin
              .from("orders")
              .select(selectCols)
              .eq("shopify_order_id", shopifyOrderId)
              .maybeSingle();
            if (data) orderRow = data as unknown as OrderRow;
          }

          if (!orderRow) {
            return await logAndReturn("not_found");
          }

          // Resolve incoming values
          const incomingName = firstNonEmpty(
            payload.customer_name,
            payload.shipping_name,
            payload.billing_name,
            payload.email,
            payload.phone,
            payload.shipping_phone,
          );
          const incomingPhone = firstNonEmpty(payload.shipping_phone, payload.phone);
          const incomingCity = nonEmpty(payload.shipping_city);
          const incomingArea = nonEmpty(payload.shipping_province);
          const addressJoined = firstNonEmpty(
            [nonEmpty(payload.shipping_address_1), nonEmpty(payload.shipping_address_2)]
              .filter(Boolean)
              .join(", ") || null,
          );

          const patch: Record<string, unknown> = {};
          const repaired: string[] = [];

          // Name — overwrite if current is empty OR "unknown"
          if (incomingName && isPlaceholder(orderRow.customer_full_name)) {
            patch.customer_full_name = incomingName;
            repaired.push("customer_full_name");
          }
          if (incomingPhone && !nonEmpty(orderRow.phone)) {
            patch.phone = incomingPhone;
            repaired.push("phone");
          }
          if (incomingCity && !nonEmpty(orderRow.city)) {
            patch.city = incomingCity;
            repaired.push("city");
          }
          if (incomingArea && !nonEmpty(orderRow.area)) {
            patch.area = incomingArea;
            repaired.push("area");
          }
          if (addressJoined && !nonEmpty(orderRow.full_address)) {
            patch.full_address = addressJoined;
            repaired.push("full_address");
          }

          if (repaired.length === 0) {
            return await logAndReturn("matched_no_changes", { matched_order_id: orderRow.id });
          }

          const { error: upErr } = await supabaseAdmin
            .from("orders")
            .update(patch as never)
            .eq("id", orderRow.id);
          if (upErr) {
            return await logAndReturn("error", {
              matched_order_id: orderRow.id,
              error_message: upErr.message,
              httpStatus: 500,
            });
          }

          return await logAndReturn("repaired", {
            matched_order_id: orderRow.id,
            repaired_fields: repaired,
          });
        } catch (e) {
          return await logAndReturn("error", {
            error_message: e instanceof Error ? e.message : String(e),
            httpStatus: 500,
          });
        }
      },
    },
  },
});
