import { createFileRoute } from "@tanstack/react-router";
import { processShopifyOrder, type ShopifyOrderPayload } from "@/lib/shopify-webhook.server";
import {
  getShopifyAdminAccessToken,
  getShopifyApiVersion,
  getShopifyDomainValidationError,
  normalizeShopDomain,
  validateShopDomain,
} from "@/lib/shopify-auth.server";

type SyncMode = "incremental" | "full_backfill";
type SyncStatus = "success" | "partial" | "error";
type SyncSettings = {
  last_successful_orders_sync_at?: string | null;
  last_orders_sync_cursor?: string | null;
};

type ShopifyOrdersResponse = {
  orders?: ShopifyOrderPayload[];
};

function parseSyncMode(value: unknown): SyncMode | null {
  if (value == null || value === "") return "incremental";
  if (value === "incremental" || value === "full_backfill") return value;
  return null;
}

function validDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function minutesBefore(date: Date, minutes: number) {
  return new Date(date.getTime() - minutes * 60 * 1000);
}

function firstIncrementalWindow(settings?: SyncSettings | null, overrideSince?: string | null) {
  const override = validDate(overrideSince);
  if (override) return override.toISOString();

  const cursor =
    validDate(settings?.last_successful_orders_sync_at) ??
    validDate(settings?.last_orders_sync_cursor);
  if (cursor) return minutesBefore(cursor, 5).toISOString();

  const recent = new Date();
  recent.setDate(recent.getDate() - 30);
  return recent.toISOString();
}

function laterIso(current: string | null, candidate?: string | null) {
  const next = validDate(candidate);
  if (!next) return current;
  const existing = validDate(current);
  if (!existing || next.getTime() > existing.getTime()) return next.toISOString();
  return current;
}

function nextPageUrl(linkHeader: string | null) {
  if (!linkHeader) return null;
  const links = linkHeader.split(",");
  for (const link of links) {
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function requireOpsUser(request: Request) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token)
    return { ok: false as const, response: new Response("Unauthorized", { status: 401 }) };

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false as const, response: new Response("Unauthorized", { status: 401 }) };
  }

  const { data: roleRow } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .in("role", ["admin", "operations"])
    .maybeSingle();
  if (!roleRow) return { ok: false as const, response: new Response("Forbidden", { status: 403 }) };

  return { ok: true as const, supabaseAdmin, userId: userData.user.id };
}

export const Route = createFileRoute("/api/shopify/sync-orders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireOpsUser(request);
        if (!auth.ok) return auth.response;
        const { supabaseAdmin, userId } = auth;

        const startedAt = new Date().toISOString();
        let finishedAt = startedAt;
        let syncType = "orders_incremental";
        let mode: SyncMode = "incremental";
        let recordsProcessed = 0;
        let createdCount = 0;
        let updatedCount = 0;
        let failedCount = 0;
        let pagesFetched = 0;
        let cursorAfter: string | null = null;
        const errors: string[] = [];

        const saveRun = async (status: SyncStatus, errorMessage: string | null, metadata = {}) => {
          await (supabaseAdmin as any).from("shopify_sync_runs").insert({
            sync_type: syncType,
            status,
            started_at: startedAt,
            finished_at: finishedAt,
            records_processed: recordsProcessed,
            created_count: createdCount,
            updated_count: updatedCount,
            failed_count: failedCount,
            pages_fetched: pagesFetched,
            error_message: errorMessage,
            metadata,
          });
        };

        try {
          const body = (await request.json().catch(() => ({}))) as {
            mode?: unknown;
            limit?: unknown;
            since?: string;
          };
          const parsedMode = parseSyncMode(body.mode);
          if (!parsedMode) {
            return Response.json(
              { ok: false, error: "Invalid Shopify orders sync mode." },
              { status: 400 },
            );
          }
          mode = parsedMode;
          syncType = mode === "full_backfill" ? "orders_full_backfill" : "orders_incremental";

          const apiVersion = getShopifyApiVersion();
          const domain = normalizeShopDomain(process.env.SHOPIFY_SHOP_DOMAIN || "");
          if (!domain) {
            const msg = "Missing SHOPIFY_SHOP_DOMAIN in Lovable Secrets.";
            finishedAt = new Date().toISOString();
            await saveRun("error", msg, { mode });
            await supabaseAdmin
              .from("shopify_sync_settings")
              .update({
                last_sync_at: finishedAt,
                last_sync_mode: syncType,
                last_sync_status: "error",
                last_error: msg,
                updated_at: finishedAt,
              })
              .eq("id", 1);
            return Response.json({ ok: false, error: msg }, { status: 500 });
          }

          if (!validateShopDomain(domain)) {
            const msg = getShopifyDomainValidationError(domain);
            finishedAt = new Date().toISOString();
            await saveRun("error", msg, { mode, shop_domain: domain });
            await supabaseAdmin
              .from("shopify_sync_settings")
              .update({
                last_sync_at: finishedAt,
                last_sync_mode: syncType,
                last_sync_status: "error",
                last_error: msg,
                updated_at: finishedAt,
              })
              .eq("id", 1);
            return Response.json({ ok: false, error: msg }, { status: 400 });
          }

          const accessToken = getShopifyAdminAccessToken();
          if (!accessToken) {
            const msg =
              "Missing SHOPIFY_ADMIN_ACCESS_TOKEN in Lovable Secrets. SHOPIFY_ACCESS_TOKEN is supported only as a fallback.";
            finishedAt = new Date().toISOString();
            await saveRun("error", msg, { mode, shop_domain: domain });
            await supabaseAdmin
              .from("shopify_sync_settings")
              .update({
                install_status: "missing_manual_token",
                token_stored: false,
                last_sync_at: finishedAt,
                last_sync_mode: syncType,
                last_sync_status: "error",
                last_error: msg,
                updated_at: finishedAt,
              } as never)
              .eq("id", 1);
            return Response.json({ ok: false, error: msg }, { status: 400 });
          }

          const { data: settings } = await (supabaseAdmin as any)
            .from("shopify_sync_settings")
            .select("last_successful_orders_sync_at,last_orders_sync_cursor")
            .eq("id", 1)
            .maybeSingle();

          const perPage = Math.min(Math.max(Number(body.limit) || 250, 1), 250);
          const incrementalStart =
            mode === "incremental" ? firstIncrementalWindow(settings, body.since) : null;
          const cursorBefore =
            settings?.last_successful_orders_sync_at ?? settings?.last_orders_sync_cursor ?? null;

          await supabaseAdmin
            .from("shopify_sync_settings")
            .update({
              shop_domain: domain,
              store_url: domain,
              token_stored: true,
              last_sync_mode: syncType,
              last_sync_status: "running",
              last_error: null,
              updated_at: startedAt,
            } as never)
            .eq("id", 1);

          const url = new URL(`https://${domain}/admin/api/${apiVersion}/orders.json`);
          url.searchParams.set("status", "any");
          url.searchParams.set("limit", String(perPage));
          url.searchParams.set("order", "updated_at asc");
          if (incrementalStart) url.searchParams.set("updated_at_min", incrementalStart);

          const headers = {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          };

          let pageUrl: string | null = url.toString();
          while (pageUrl) {
            const res = await fetch(pageUrl, { headers });
            if (!res.ok) {
              const text = await res.text();
              if (res.status === 401) {
                const msg = `SHOPIFY_ADMIN_ACCESS_TOKEN was rejected by Shopify for ${domain}. Confirm the token belongs to this store and has Admin API access.`;
                finishedAt = new Date().toISOString();
                await saveRun("error", msg, { mode, shop_domain: domain, api_version: apiVersion });
                await supabaseAdmin
                  .from("shopify_sync_settings")
                  .update({
                    install_status: "invalid_manual_token",
                    token_stored: false,
                    last_connection_test_status: "invalid_token",
                    last_connection_test_error: msg,
                    last_sync_at: finishedAt,
                    last_sync_mode: syncType,
                    last_sync_status: "error",
                    last_error: msg,
                    updated_at: finishedAt,
                  } as never)
                  .eq("id", 1);
                return Response.json({ ok: false, error: msg }, { status: 401 });
              }

              if (res.status === 403) {
                const msg = `SHOPIFY_ADMIN_ACCESS_TOKEN is valid but Shopify denied order access for ${domain}. Check read_orders/read_all_orders permissions.`;
                finishedAt = new Date().toISOString();
                await saveRun("error", msg, { mode, shop_domain: domain, api_version: apiVersion });
                await supabaseAdmin
                  .from("shopify_sync_settings")
                  .update({
                    install_status: "connected_missing_scopes",
                    token_stored: true,
                    last_connection_test_status: "permission_denied",
                    last_connection_test_error: msg,
                    last_sync_at: finishedAt,
                    last_sync_mode: syncType,
                    last_sync_status: "error",
                    last_error: msg,
                    updated_at: finishedAt,
                  } as never)
                  .eq("id", 1);
                return Response.json({ ok: false, error: msg }, { status: 403 });
              }

              throw new Error(`Shopify ${res.status}: ${text.slice(0, 300)}`);
            }

            pagesFetched++;
            const json = (await res.json()) as ShopifyOrdersResponse;
            const orders = json.orders ?? [];
            const shopifyIds = orders.map((order) => String(order.id));
            const existingSet = new Set<string>();

            if (shopifyIds.length) {
              const { data: existingRows } = await supabaseAdmin
                .from("orders")
                .select("shopify_order_id")
                .in("shopify_order_id", shopifyIds);
              for (const row of existingRows ?? []) {
                if (row.shopify_order_id) existingSet.add(row.shopify_order_id);
              }
            }

            for (const order of orders) {
              recordsProcessed++;
              const shopifyOrderId = String(order.id);
              cursorAfter = laterIso(cursorAfter, order.updated_at ?? order.created_at);
              try {
                await processShopifyOrder(order);
                if (existingSet.has(shopifyOrderId)) updatedCount++;
                else createdCount++;
              } catch (e) {
                failedCount++;
                errors.push(`order ${shopifyOrderId}: ${(e as Error).message}`);
              }
            }

            pageUrl = nextPageUrl(res.headers.get("link"));
          }

          finishedAt = new Date().toISOString();
          const status: SyncStatus = errors.length ? "partial" : "success";
          const nextCursor = status === "success" ? (cursorAfter ?? finishedAt) : cursorBefore;
          const errorMessage = errors.length ? errors.slice(0, 5).join(" | ") : null;

          await supabaseAdmin.from("migration_logs").insert({
            source: "shopify",
            entity: "orders",
            status,
            message: `${syncType}: created=${createdCount} updated=${updatedCount} failed=${failedCount} pages=${pagesFetched}${errorMessage ? " | " + errorMessage : ""}`,
            rows_processed: recordsProcessed,
          } as never);

          await saveRun(status, errorMessage, {
            mode,
            shop_domain: domain,
            api_version: apiVersion,
            cursor_before: cursorBefore,
            cursor_after: nextCursor,
            incremental_window_start: incrementalStart,
            overlap_minutes: mode === "incremental" && cursorBefore ? 5 : 0,
            first_run_recent_days: mode === "incremental" && !cursorBefore ? 30 : null,
            per_page: perPage,
            started_by: userId,
          });

          await supabaseAdmin
            .from("shopify_sync_settings")
            .update({
              last_sync_at: finishedAt,
              last_sync_mode: syncType,
              last_sync_status: status,
              last_orders_imported: createdCount,
              last_orders_updated: updatedCount,
              last_error: errorMessage,
              ...(status === "success"
                ? {
                    last_successful_orders_sync_at: finishedAt,
                    last_orders_sync_cursor: nextCursor,
                  }
                : {}),
              updated_at: finishedAt,
            } as never)
            .eq("id", 1);

          return Response.json({
            ok: true,
            mode,
            sync_type: syncType,
            status,
            created: createdCount,
            updated: updatedCount,
            failed: failedCount,
            records_processed: recordsProcessed,
            pages_fetched: pagesFetched,
            cursor_before: cursorBefore,
            cursor_after: nextCursor,
            incremental_window_start: incrementalStart,
            errors,
          });
        } catch (outer) {
          finishedAt = new Date().toISOString();
          const msg = outer instanceof Error ? outer.message : String(outer);
          await saveRun("error", msg, { mode });
          await supabaseAdmin
            .from("shopify_sync_settings")
            .update({
              last_sync_at: finishedAt,
              last_sync_mode: syncType,
              last_sync_status: "error",
              last_error: msg,
              updated_at: finishedAt,
            } as never)
            .eq("id", 1);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },
    },
  },
});
