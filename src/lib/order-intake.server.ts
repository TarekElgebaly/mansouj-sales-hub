import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type IntakePayload = {
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

type OrderRow = {
  id: string;
  customer_full_name: string | null;
  phone: string | null;
  city: string | null;
  area: string | null;
  full_address: string | null;
};

const SELECT_COLS = "id,customer_full_name,phone,city,area,full_address";

export function nonEmpty(v: unknown): string | null {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

export function isPlaceholder(v: string | null): boolean {
  if (!v) return true;
  return v.trim().toLowerCase() === "unknown";
}

export function firstNonEmpty(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    const s = nonEmpty(v);
    if (s) return s;
  }
  return null;
}

export function normalizeOrderNumber(
  v: unknown,
): { withHash: string; noHash: string } | null {
  const s = nonEmpty(v);
  if (!s) return null;
  const noHash = s.replace(/^#+/, "");
  return { withHash: `#${noHash}`, noHash };
}

export function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`;
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return `{${keys
    .map(
      (k) =>
        `${JSON.stringify(k)}:${stableStringify((obj as Record<string, unknown>)[k])}`,
    )
    .join(",")}}`;
}

export function computePayloadHash(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export type ParsedIntake = {
  payload: IntakePayload;
  source: string | null;
  messageId: string | null;
  orderNumberNorm: { withHash: string; noHash: string } | null;
  orderNumberRaw: string | number | null;
  shopifyOrderId: string | null;
  payloadHash: string;
};

export function parseIntake(payload: IntakePayload): ParsedIntake {
  const orderNumberRaw = payload.order_number ?? payload.name ?? null;
  return {
    payload,
    source: nonEmpty(payload.source),
    messageId: nonEmpty(payload.message_id),
    orderNumberNorm: normalizeOrderNumber(orderNumberRaw),
    orderNumberRaw,
    shopifyOrderId: nonEmpty(payload.shopify_order_id),
    payloadHash: computePayloadHash(payload),
  };
}

export async function findOrder(
  supabaseAdmin: SupabaseClient<Database>,
  parsed: Pick<ParsedIntake, "orderNumberNorm" | "shopifyOrderId">,
): Promise<OrderRow | null> {
  const { orderNumberNorm, shopifyOrderId } = parsed;
  if (orderNumberNorm) {
    const { data } = await supabaseAdmin
      .from("orders")
      .select(SELECT_COLS)
      .eq("order_number", orderNumberNorm.withHash)
      .maybeSingle();
    if (data) return data as unknown as OrderRow;
    const { data: d2 } = await supabaseAdmin
      .from("orders")
      .select(SELECT_COLS)
      .eq("order_number", orderNumberNorm.noHash)
      .maybeSingle();
    if (d2) return d2 as unknown as OrderRow;
  }
  if (shopifyOrderId) {
    const { data } = await supabaseAdmin
      .from("orders")
      .select(SELECT_COLS)
      .eq("shopify_order_id", shopifyOrderId)
      .maybeSingle();
    if (data) return data as unknown as OrderRow;
  }
  return null;
}

export function computeRepairPatch(
  orderRow: OrderRow,
  payload: IntakePayload,
): { patch: Record<string, unknown>; repaired: string[] } {
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
  const addressJoined =
    [nonEmpty(payload.shipping_address_1), nonEmpty(payload.shipping_address_2)]
      .filter(Boolean)
      .join(", ") || null;

  const patch: Record<string, unknown> = {};
  const repaired: string[] = [];

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

  return { patch, repaired };
}

export type PendingIntakeSummary = {
  attempted: number;
  repaired: number;
  matched_no_changes: number;
  still_pending: number;
  errors: number;
};

type PendingRow = {
  id: string;
  raw_payload: IntakePayload | null;
  order_number: string | null;
  shopify_order_id: string | null;
  message_id: string | null;
};

export async function applyPendingIntake(
  supabaseAdmin: SupabaseClient<Database>,
  opts: { limit?: number } = {},
): Promise<PendingIntakeSummary> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const summary: PendingIntakeSummary = {
    attempted: 0,
    repaired: 0,
    matched_no_changes: 0,
    still_pending: 0,
    errors: 0,
  };

  const { data: rows, error } = await supabaseAdmin
    .from("order_intake_logs")
    .select("id,raw_payload,order_number,shopify_order_id,message_id")
    .eq("status", "pending_not_found")
    .order("received_at", { ascending: true })
    .limit(limit);

  if (error || !rows) return summary;

  for (const row of rows as unknown as PendingRow[]) {
    summary.attempted++;
    const now = new Date().toISOString();
    try {
      const payload = (row.raw_payload ?? {}) as IntakePayload;
      const parsed = parseIntake(payload);
      const orderRow = await findOrder(supabaseAdmin, parsed);

      if (!orderRow) {
        await supabaseAdmin
          .from("order_intake_logs")
          .update({ last_retry_at: now } as never)
          .eq("id", row.id);
        summary.still_pending++;
        continue;
      }

      const { patch, repaired } = computeRepairPatch(orderRow, payload);
      if (repaired.length === 0) {
        await supabaseAdmin
          .from("order_intake_logs")
          .update({
            status: "matched_no_changes",
            matched_order_id: orderRow.id,
            last_retry_at: now,
          } as never)
          .eq("id", row.id);
        summary.matched_no_changes++;
        continue;
      }

      const { error: upErr } = await supabaseAdmin
        .from("orders")
        .update(patch as never)
        .eq("id", orderRow.id);
      if (upErr) throw new Error(upErr.message);

      await supabaseAdmin
        .from("order_intake_logs")
        .update({
          status: "repaired",
          matched_order_id: orderRow.id,
          repaired_fields: repaired as never,
          last_retry_at: now,
        } as never)
        .eq("id", row.id);
      summary.repaired++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      try {
        await supabaseAdmin
          .from("order_intake_logs")
          .update({
            status: "error",
            error_message: msg,
            last_retry_at: now,
          } as never)
          .eq("id", row.id);
      } catch {
        // swallow — don't let a single row abort the batch
      }
      summary.errors++;
    }
  }

  return summary;
}
