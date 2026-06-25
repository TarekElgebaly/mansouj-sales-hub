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

type ImportedOrderSummary = {
  label: string | null;
  number: number | null;
  createdAt: string | null;
};

class ShopifyFetchError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`Shopify ${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

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

function extractPageInfo(value?: string | null) {
  if (!value) return null;
  try {
    return new URL(value).searchParams.get("page_info");
  } catch {
    return null;
  }
}

function safePageInfo(value?: string | null) {
  if (!value) return null;
  if (value.length <= 24) return value;
  return `${value.slice(0, 12)}...${value.slice(-12)}`;
}

function parseOrderNumber(order?: ShopifyOrderPayload | null) {
  if (!order) return null;
  if (typeof order.order_number === "number") return order.order_number;
  const raw = order.name ? String(order.name) : "";
  const match = raw.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function summarizeOrder(order?: ShopifyOrderPayload | null): ImportedOrderSummary {
  const number = parseOrderNumber(order);
  return {
    label: order?.name ?? (number ? `#${number}` : null),
    number,
    createdAt: order?.created_at ?? order?.processed_at ?? null,
  };
}

function laterOrderNumber(current: number | null, candidate: number | null) {
  if (candidate == null) return current;
  return current == null || candidate > current ? candidate : current;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchShopifyWithRetry(url: string, headers: Record<string, string>) {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers });
    lastResponse = res;
    if (res.ok || (res.status !== 429 && res.status < 500)) return res;

    const retryAfter = Number(res.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 500 * 2 ** attempt;
    await sleep(delay);
  }
  return lastResponse as Response;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
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
        let requestedMode: unknown = null;
        let apiVersion = "";
        let domain = "";
        let perPage = 250;
        let incrementalStart: string | null = null;
        let cursorBefore: string | null = null;
        let recordsProcessed = 0;
        let createdCount = 0;
        let updatedCount = 0;
        let failedCount = 0;
        let pagesFetched = 0;
        let orderItemsProcessed = 0;
        let orderItemsWithCost = 0;
        let orderItemsMissingCost = 0;
        let affectedOrdersRecalculated = 0;
        let totalItemsCostAfterRecalc = 0;
        let cursorAfter: string | null = null;
        let firstOrderNumberImported: string | null = null;
        let lastOrderNumberImported: string | null = null;
        let latestImportedOrderNumber: number | null = null;
        let latestImportedOrderLabel: string | null = null;
        let latestShopifyOrderNumber: number | null = null;
        let latestShopifyOrderLabel: string | null = null;
        let minCreatedAtImported: string | null = null;
        let maxCreatedAtImported: string | null = null;
        let stoppedReason = "not_started";
        let nextPageMissing = false;
        let lastShopifyPageInfo: string | null = null;
        let completionWarning: string | null = null;
        let completionCheckError: string | null = null;
        const errors: string[] = [];

        const runMetadata = (extra: Record<string, unknown> = {}) => ({
          requested_mode: requestedMode ?? null,
          effective_mode: mode,
          used_updated_at_min: Boolean(incrementalStart),
          used_date_filter: Boolean(incrementalStart),
          date_filter_value: incrementalStart,
          pages_fetched: pagesFetched,
          first_order_number_imported: firstOrderNumberImported,
          last_order_number_imported: lastOrderNumberImported,
          min_created_at_imported: minCreatedAtImported,
          max_created_at_imported: maxCreatedAtImported,
          records_processed: recordsProcessed,
          created_count: createdCount,
          updated_count: updatedCount,
          failed_count: failedCount,
          stopped_reason: stoppedReason,
          next_page_missing: nextPageMissing,
          last_shopify_page_info: lastShopifyPageInfo,
          latest_shopify_order_number: latestShopifyOrderLabel,
          latest_shopify_order_number_numeric: latestShopifyOrderNumber,
          latest_imported_order_number: latestImportedOrderLabel,
          latest_imported_order_number_numeric: latestImportedOrderNumber,
          completion_warning: completionWarning,
          completion_check_error: completionCheckError,
          shop_domain: domain || null,
          api_version: apiVersion || null,
          per_page: perPage,
          order_items_processed: orderItemsProcessed,
          order_items_with_cost: orderItemsWithCost,
          order_items_missing_cost: orderItemsMissingCost,
          affected_orders_recalculated: affectedOrdersRecalculated,
          total_items_cost_after_recalc: totalItemsCostAfterRecalc,
          ...extra,
        });

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
            metadata: runMetadata(metadata as Record<string, unknown>),
          });
        };

        try {
          const body = (await request.json().catch(() => ({}))) as {
            mode?: unknown;
            limit?: unknown;
            since?: string;
          };
          requestedMode = body.mode ?? "incremental";
          const parsedMode = parseSyncMode(body.mode);
          if (!parsedMode) {
            return Response.json(
              { ok: false, error: "Invalid Shopify orders sync mode." },
              { status: 400 },
            );
          }
          mode = parsedMode;
          syncType = mode === "full_backfill" ? "orders_full_backfill" : "orders_incremental";

          apiVersion = getShopifyApiVersion();
          domain = normalizeShopDomain(process.env.SHOPIFY_SHOP_DOMAIN || "");
          if (!domain) {
            const msg = "Missing SHOPIFY_SHOP_DOMAIN in Lovable Secrets.";
            finishedAt = new Date().toISOString();
            stoppedReason = "missing_shop_domain";
            await saveRun("error", msg);
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

          if (!validateShopDomain(domain)) {
            const msg = getShopifyDomainValidationError(domain);
            finishedAt = new Date().toISOString();
            stoppedReason = "invalid_shop_domain";
            await saveRun("error", msg);
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
            return Response.json({ ok: false, error: msg }, { status: 400 });
          }

          const accessToken = getShopifyAdminAccessToken();
          if (!accessToken) {
            const msg =
              "Missing SHOPIFY_ADMIN_ACCESS_TOKEN in Lovable Secrets. SHOPIFY_ACCESS_TOKEN is supported only as a fallback.";
            finishedAt = new Date().toISOString();
            stoppedReason = "missing_shopify_token";
            await saveRun("error", msg);
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

          perPage = Math.min(Math.max(Number(body.limit) || 250, 1), 250);
          incrementalStart =
            mode === "incremental" ? firstIncrementalWindow(settings, body.since) : null;
          cursorBefore =
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

          if (mode === "full_backfill") {
            const latestUrl = new URL(`https://${domain}/admin/api/${apiVersion}/orders.json`);
            latestUrl.searchParams.set("status", "any");
            latestUrl.searchParams.set("limit", "1");
            latestUrl.searchParams.set("order", "created_at desc");

            const latestRes = await fetchShopifyWithRetry(latestUrl.toString(), headers);
            if (latestRes.ok) {
              const latestJson = (await latestRes.json()) as ShopifyOrdersResponse;
              const latestSummary = summarizeOrder(latestJson.orders?.[0] ?? null);
              latestShopifyOrderNumber = latestSummary.number;
              latestShopifyOrderLabel = latestSummary.label;
            } else {
              const text = await latestRes.text();
              completionCheckError = `Could not fetch latest Shopify order for completion check: Shopify ${latestRes.status}: ${text.slice(0, 160)}`;
            }
          }

          let pageUrl: string | null = url.toString();
          while (pageUrl) {
            stoppedReason = "fetching_shopify_page";
            lastShopifyPageInfo = safePageInfo(extractPageInfo(pageUrl)) ?? lastShopifyPageInfo;
            const res = await fetchShopifyWithRetry(pageUrl, headers);
            if (!res.ok) {
              const text = await res.text();
              if (res.status === 401) {
                const msg = `SHOPIFY_ADMIN_ACCESS_TOKEN was rejected by Shopify for ${domain}. Confirm the token belongs to this store and has Admin API access.`;
                finishedAt = new Date().toISOString();
                stoppedReason = "shopify_401";
                await saveRun("error", msg);
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
                stoppedReason = "shopify_403";
                await saveRun("error", msg);
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

              stoppedReason = `shopify_${res.status}`;
              throw new ShopifyFetchError(res.status, text);
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

            const orderResults = await mapWithConcurrency(
              orders,
              mode === "full_backfill" ? 8 : 4,
              async (order) => {
                const shopifyOrderId = String(order.id);
                try {
                  const result = await processShopifyOrder(order);
                  return {
                    ok: true as const,
                    order,
                    shopifyOrderId,
                    existed: result.existed,
                    itemsProcessed: result.itemsProcessed,
                    itemsWithCost: result.itemsWithCost,
                    itemsMissingCost: result.itemsMissingCost,
                    itemsCostTotal: result.itemsCostTotal,
                  };
                } catch (e) {
                  return {
                    ok: false as const,
                    order,
                    shopifyOrderId,
                    error: e instanceof Error ? e.message : String(e),
                  };
                }
              },
            );

            for (const result of orderResults) {
              recordsProcessed++;
              cursorAfter = laterIso(cursorAfter, result.order.updated_at ?? result.order.created_at);

              if (result.ok) {
                if (result.existed) updatedCount++;
                else createdCount++;
                orderItemsProcessed += result.itemsProcessed;
                orderItemsWithCost += result.itemsWithCost;
                orderItemsMissingCost += result.itemsMissingCost;
                affectedOrdersRecalculated++;
                totalItemsCostAfterRecalc += result.itemsCostTotal;

                const summary = summarizeOrder(result.order);
                if (!firstOrderNumberImported) firstOrderNumberImported = summary.label;
                lastOrderNumberImported = summary.label ?? lastOrderNumberImported;
                const previousLatest: number | null = latestImportedOrderNumber;
                latestImportedOrderNumber = laterOrderNumber(
                  latestImportedOrderNumber,
                  summary.number,
                );
                if (latestImportedOrderNumber !== previousLatest && summary.label) {
                  latestImportedOrderLabel = summary.label;
                }
                minCreatedAtImported =
                  validDate(summary.createdAt) && (!validDate(minCreatedAtImported) ||
                    validDate(summary.createdAt)!.getTime() <
                      validDate(minCreatedAtImported)!.getTime())
                    ? validDate(summary.createdAt)!.toISOString()
                    : minCreatedAtImported;
                maxCreatedAtImported =
                  validDate(summary.createdAt) && (!validDate(maxCreatedAtImported) ||
                    validDate(summary.createdAt)!.getTime() >
                      validDate(maxCreatedAtImported)!.getTime())
                    ? validDate(summary.createdAt)!.toISOString()
                    : maxCreatedAtImported;
              } else {
                failedCount++;
                errors.push(`order ${result.shopifyOrderId}: ${result.error}`);
              }
            }

            const nextUrl = nextPageUrl(res.headers.get("link"));
            lastShopifyPageInfo =
              safePageInfo(extractPageInfo(nextUrl)) ??
              safePageInfo(extractPageInfo(pageUrl)) ??
              lastShopifyPageInfo;
            nextPageMissing = !nextUrl;
            stoppedReason = nextUrl ? "next_page_found" : "shopify_no_next_page";
            pageUrl = nextUrl;
          }

          finishedAt = new Date().toISOString();
          if (
            mode === "full_backfill" &&
            latestShopifyOrderNumber != null &&
            (latestImportedOrderNumber == null || latestImportedOrderNumber < latestShopifyOrderNumber)
          ) {
            completionWarning = `Full backfill may be incomplete. Latest imported order is ${latestImportedOrderLabel ?? "none"} but latest Shopify order is ${latestShopifyOrderLabel ?? `#${latestShopifyOrderNumber}`}.`;
            errors.push(completionWarning);
            stoppedReason =
              stoppedReason === "shopify_no_next_page"
                ? "shopify_no_next_page_incomplete_latest_check"
                : stoppedReason;
          }

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
            cursor_before: cursorBefore,
            cursor_after: nextCursor,
            incremental_window_start: incrementalStart,
            overlap_minutes: mode === "incremental" && cursorBefore ? 5 : 0,
            first_run_recent_days: mode === "incremental" && !cursorBefore ? 30 : null,
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
            completion_warning: completionWarning,
            latest_imported_order_number: latestImportedOrderLabel,
            latest_shopify_order_number: latestShopifyOrderLabel,
            stopped_reason: stoppedReason,
            errors,
          });
        } catch (outer) {
          finishedAt = new Date().toISOString();
          const msg = outer instanceof Error ? outer.message : String(outer);
          if (stoppedReason === "not_started" || stoppedReason === "next_page_found") {
            stoppedReason = outer instanceof ShopifyFetchError ? `shopify_${outer.status}` : "handler_exception";
          }
          await saveRun("error", msg);
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
