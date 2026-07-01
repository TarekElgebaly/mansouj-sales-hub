import { createFileRoute } from "@tanstack/react-router";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

type ResetCounts = {
  deleted_orders_count: number;
  deleted_order_items_count: number;
  deleted_order_notes_count: number;
  deleted_order_activity_count: number;
  cursor_reset: boolean;
};

async function requireAdminUser(request: Request) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return { ok: false as const, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false as const, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: roleRow } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!roleRow) {
    return { ok: false as const, response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { ok: true as const, supabaseAdmin, userId: userData.user.id };
}

async function countRows(supabaseAdmin: any, table: string) {
  const { count, error } = await supabaseAdmin
    .from(table)
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`Could not count ${table}: ${error.message}`);
  return count ?? 0;
}

async function deleteAllRows(supabaseAdmin: any, table: string) {
  const { error } = await supabaseAdmin.from(table).delete().neq("id", ZERO_UUID);
  if (error) throw new Error(`Could not delete ${table}: ${error.message}`);
}

export const Route = createFileRoute("/api/orders/reset-all")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireAdminUser(request);
        if (!auth.ok) return auth.response;

        const { supabaseAdmin, userId } = auth;
        const startedAt = new Date().toISOString();
        let finishedAt = startedAt;
        const counts: ResetCounts = {
          deleted_orders_count: 0,
          deleted_order_items_count: 0,
          deleted_order_notes_count: 0,
          deleted_order_activity_count: 0,
          cursor_reset: false,
        };

        const saveRun = async (status: "success" | "failed", errorMessage: string | null) => {
          await (supabaseAdmin as any).from("shopify_sync_runs").insert({
            sync_type: "orders_reset_all",
            status,
            started_at: startedAt,
            finished_at: finishedAt,
            records_processed: counts.deleted_orders_count,
            created_count: 0,
            updated_count: 0,
            failed_count: status === "failed" ? 1 : 0,
            pages_fetched: 0,
            error_message: errorMessage,
            metadata: {
              deleted_orders_count: counts.deleted_orders_count,
              deleted_order_items_count: counts.deleted_order_items_count,
              deleted_order_notes_count: counts.deleted_order_notes_count,
              deleted_order_activity_count: counts.deleted_order_activity_count,
              cursor_reset: counts.cursor_reset,
              started_by: userId,
              shopify_touched: false,
            },
          });
        };

        try {
          counts.deleted_order_items_count = await countRows(supabaseAdmin, "order_items");
          counts.deleted_order_notes_count = await countRows(supabaseAdmin, "order_notes");
          counts.deleted_order_activity_count = await countRows(supabaseAdmin, "order_activity");
          counts.deleted_orders_count = await countRows(supabaseAdmin, "orders");

          await deleteAllRows(supabaseAdmin, "order_items");
          await deleteAllRows(supabaseAdmin, "order_notes");
          await deleteAllRows(supabaseAdmin, "order_activity");
          await deleteAllRows(supabaseAdmin, "orders");

          finishedAt = new Date().toISOString();
          const { error: cursorErr } = await (supabaseAdmin as any)
            .from("shopify_sync_settings")
            .update({
              last_sync_at: finishedAt,
              last_sync_mode: "orders_reset_all",
              last_sync_status: "success",
              last_orders_imported: 0,
              last_orders_updated: 0,
              last_successful_orders_sync_at: null,
              last_orders_sync_cursor: null,
              last_error: null,
              updated_at: finishedAt,
            })
            .eq("id", 1);
          if (cursorErr) throw new Error(`Could not reset order sync cursor: ${cursorErr.message}`);
          counts.cursor_reset = true;

          await saveRun("success", null);

          return Response.json({
            ok: true,
            ...counts,
          });
        } catch (error) {
          finishedAt = new Date().toISOString();
          const message = error instanceof Error ? error.message : String(error);
          await saveRun("failed", message).catch(() => undefined);
          return Response.json(
            {
              ok: false,
              error: message,
              ...counts,
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
