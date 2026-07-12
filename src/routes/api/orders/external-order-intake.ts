import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import {
  computeRepairPatch,
  findOrder,
  nonEmpty,
  parseIntake,
  type IntakePayload,
} from "@/lib/order-intake.server";

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

        const parsed = parseIntake(payload);
        const { source, messageId, orderNumberNorm, orderNumberRaw, shopifyOrderId, payloadHash } =
          parsed;
        const orderNumberStored = orderNumberNorm?.withHash ?? nonEmpty(orderNumberRaw);

        const insertLog = async (
          status: string,
          extra: {
            matched_order_id?: string | null;
            repaired_fields?: string[];
            error_message?: string | null;
          } = {},
        ) => {
          try {
            await supabaseAdmin.from("order_intake_logs").insert({
              source,
              order_number: orderNumberStored,
              shopify_order_id: shopifyOrderId,
              matched_order_id: extra.matched_order_id ?? null,
              status,
              repaired_fields: (extra.repaired_fields ?? []) as never,
              error_message: extra.error_message ?? null,
              message_id: messageId,
              payload_hash: payloadHash,
              raw_payload: payload as unknown as never,
            } as never);
          } catch (e) {
            console.error("[intake] failed to insert log", e);
          }
        };

        const respond = (
          status: string,
          extra: { repaired_fields?: string[]; error_message?: string | null } = {},
          httpStatus = 200,
        ) => {
          const body: Record<string, unknown> = { ok: status !== "error", status };
          if (extra.repaired_fields?.length) body.repaired_fields = extra.repaired_fields;
          if (extra.error_message) body.error = extra.error_message;
          return Response.json(body, { status: httpStatus });
        };

        try {
          // Idempotency for successful prior intake
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
                await insertLog("duplicate");
                return respond("duplicate");
              }
            }
          }

          const orderRow = await findOrder(supabaseAdmin, parsed);

          if (!orderRow) {
            // Not yet synced — hold for retry rather than dropping.
            // First check: exact same message_id already pending → duplicate.
            if (messageId) {
              const { data: dupMsg } = await supabaseAdmin
                .from("order_intake_logs")
                .select("id")
                .eq("message_id", messageId)
                .eq("status", "pending_not_found")
                .limit(1);
              if (dupMsg && dupMsg.length > 0) {
                await insertLog("duplicate");
                return respond("duplicate");
              }
            }

            // Same order_number already pending → update in place with freshest payload.
            if (orderNumberStored) {
              const { data: existing } = await supabaseAdmin
                .from("order_intake_logs")
                .select("id")
                .eq("order_number", orderNumberStored)
                .eq("status", "pending_not_found")
                .order("received_at", { ascending: false })
                .limit(1);
              if (existing && existing.length > 0) {
                await supabaseAdmin
                  .from("order_intake_logs")
                  .update({
                    raw_payload: payload as unknown as never,
                    payload_hash: payloadHash,
                    shopify_order_id: shopifyOrderId,
                    received_at: new Date().toISOString(),
                    source,
                    message_id: messageId,
                    error_message: null,
                  } as never)
                  .eq("id", existing[0].id);
                return respond("pending_not_found");
              }
            }

            await insertLog("pending_not_found");
            return respond("pending_not_found");
          }

          const { patch, repaired } = computeRepairPatch(orderRow, payload);

          if (repaired.length === 0) {
            await insertLog("matched_no_changes", { matched_order_id: orderRow.id });
            return respond("matched_no_changes");
          }

          const { error: upErr } = await supabaseAdmin
            .from("orders")
            .update(patch as never)
            .eq("id", orderRow.id);
          if (upErr) {
            await insertLog("error", {
              matched_order_id: orderRow.id,
              error_message: upErr.message,
            });
            return respond("error", { error_message: upErr.message }, 500);
          }

          await insertLog("repaired", {
            matched_order_id: orderRow.id,
            repaired_fields: repaired,
          });
          return respond("repaired", { repaired_fields: repaired });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await insertLog("error", { error_message: msg });
          return respond("error", { error_message: msg }, 500);
        }
      },
    },
  },
});
