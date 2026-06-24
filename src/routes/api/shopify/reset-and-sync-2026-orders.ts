import { createFileRoute } from "@tanstack/react-router";
import { processShopifyOrder, type ShopifyOrderPayload } from "@/lib/shopify-webhook.server";
import {
  getShopifyAdminAccessToken,
  getShopifyApiVersion,
  getShopifyDomainValidationError,
  normalizeShopDomain,
  validateShopDomain,
} from "@/lib/shopify-auth.server";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const CREATED_AT_MIN_2026 = "2026-01-01T00:00:00Z";

type ShopifyOrdersResponse = {
  orders?: ShopifyOrderPayload[];
};

type ImportedOrderSummary = {
  label: string | null;
  number: number | null;
  createdAt: string | null;
};

type RunStatus = "running" | "success" | "partial" | "failed";

class ShopifyFetchError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`Shopify ${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

async function requireAdminUser(request: Request) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return { ok: false as const, response: new Response("Unauthorized", { status: 401 }) };
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false as const, response: new Response("Unauthorized", { status: 401 }) };
  }

  const { data: roleRow } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!roleRow) {
    return { ok: false as const, response: new Response("Forbidden", { status: 403 }) };
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

function validDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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
    const delay =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
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

export const Route = createFileRoute("/api/shopify/reset-and-sync-2026-orders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireAdminUser(request);
        if (!auth.ok) return auth.response;

        const { supabaseAdmin, userId } = auth;
        const startedAt = new Date().toISOString();
        const createdAtMax = startedAt;
        const syncType = "reset_and_sync_2026_orders";
        let finishedAt = startedAt;
        let runId: string | null = null;
        let domain = "";
        let apiVersion = "";
        let currentLocalOrdersCount = 0;
        let currentLocalOrderItemsCount = 0;
        let currentLocalOrderNotesCount = 0;
        let currentLocalOrderActivityCount = 0;
        let deletedOrdersCount = 0;
        let deletedOrderItemsCount = 0;
        let deletedOrderNotesCount = 0;
        let deletedOrderActivityCount = 0;
        let recordsProcessed = 0;
        let createdCount = 0;
        let updatedCount = 0;
        let failedCount = 0;
        let pagesFetched = 0;
        let firstOrderNumberImported: string | null = null;
        let lastOrderNumberImported: string | null = null;
        let minCreatedAtImported: string | null = null;
        let maxCreatedAtImported: string | null = null;
        let cursorReset = false;
        let stoppedReason = "not_started";
        const errors: string[] = [];

        const metadata = (extra: Record<string, unknown> = {}) => ({
          current_local_orders_count: currentLocalOrdersCount,
          current_local_order_items_count: currentLocalOrderItemsCount,
          current_local_order_notes_count: currentLocalOrderNotesCount,
          current_local_order_activity_count: currentLocalOrderActivityCount,
          deleted_orders_count: deletedOrdersCount,
          deleted_order_items_count: deletedOrderItemsCount,
          deleted_order_notes_count: deletedOrderNotesCount,
          deleted_order_activity_count: deletedOrderActivityCount,
          records_processed: recordsProcessed,
          created_count: createdCount,
          updated_count: updatedCount,
          failed_count: failedCount,
          pages_fetched: pagesFetched,
          first_order_number_imported: firstOrderNumberImported,
          last_order_number_imported: lastOrderNumberImported,
          min_created_at_imported: minCreatedAtImported,
          max_created_at_imported: maxCreatedAtImported,
          created_at_min: CREATED_AT_MIN_2026,
          created_at_max: createdAtMax,
          cursor_reset: cursorReset,
          stopped_reason: stoppedReason,
          shop_domain: domain || null,
          api_version: apiVersion || null,
          started_by: userId,
          shopify_touched: false,
          ...extra,
        });

        const updateRun = async (status: RunStatus, errorMessage: string | null) => {
          if (!runId) return;
          await (supabaseAdmin as any)
            .from("shopify_sync_runs")
            .update({
              status,
              finished_at: status === "running" ? null : finishedAt,
              records_processed: recordsProcessed,
              created_count: createdCount,
              updated_count: updatedCount,
              failed_count: failedCount,
              pages_fetched: pagesFetched,
              error_message: errorMessage,
              metadata: metadata(),
            })
            .eq("id", runId);
        };

        try {
          const inserted = await (supabaseAdmin as any)
            .from("shopify_sync_runs")
            .insert({
              sync_type: syncType,
              status: "running",
              started_at: startedAt,
              finished_at: null,
              records_processed: 0,
              created_count: 0,
              updated_count: 0,
              failed_count: 0,
              pages_fetched: 0,
              error_message: null,
              metadata: metadata(),
            })
            .select("id")
            .single();
          runId = inserted.data?.id ?? null;

          apiVersion = getShopifyApiVersion();
          domain = normalizeShopDomain(process.env.SHOPIFY_SHOP_DOMAIN || "");
          if (!domain) throw new Error("Missing SHOPIFY_SHOP_DOMAIN in Lovable Secrets.");
          if (!validateShopDomain(domain)) throw new Error(getShopifyDomainValidationError(domain));

          const accessToken = getShopifyAdminAccessToken();
          if (!accessToken) {
            throw new Error(
              "Missing SHOPIFY_ADMIN_ACCESS_TOKEN in Lovable Secrets. SHOPIFY_ACCESS_TOKEN is supported only as a fallback.",
            );
          }

          await (supabaseAdmin as any)
            .from("shopify_sync_settings")
            .update({
              shop_domain: domain,
              store_url: domain,
              token_stored: true,
              last_sync_mode: syncType,
              last_sync_status: "running",
              last_error: null,
              updated_at: startedAt,
            })
            .eq("id", 1);

          currentLocalOrderItemsCount = await countRows(supabaseAdmin, "order_items");
          currentLocalOrderNotesCount = await countRows(supabaseAdmin, "order_notes");
          currentLocalOrderActivityCount = await countRows(supabaseAdmin, "order_activity");
          currentLocalOrdersCount = await countRows(supabaseAdmin, "orders");
          await updateRun("running", null);

          await deleteAllRows(supabaseAdmin, "order_items");
          await deleteAllRows(supabaseAdmin, "order_notes");
          await deleteAllRows(supabaseAdmin, "order_activity");
          await deleteAllRows(supabaseAdmin, "orders");

          deletedOrderItemsCount =
            currentLocalOrderItemsCount - (await countRows(supabaseAdmin, "order_items"));
          deletedOrderNotesCount =
            currentLocalOrderNotesCount - (await countRows(supabaseAdmin, "order_notes"));
          deletedOrderActivityCount =
            currentLocalOrderActivityCount - (await countRows(supabaseAdmin, "order_activity"));
          deletedOrdersCount = currentLocalOrdersCount - (await countRows(supabaseAdmin, "orders"));
          stoppedReason = "local_reset_complete";
          await updateRun("running", null);

          const headers = {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          };
          const url = new URL(`https://${domain}/admin/api/${apiVersion}/orders.json`);
          url.searchParams.set("status", "any");
          url.searchParams.set("limit", "250");
          url.searchParams.set("order", "created_at asc");
          url.searchParams.set("created_at_min", CREATED_AT_MIN_2026);
          url.searchParams.set("created_at_max", createdAtMax);

          let pageUrl: string | null = url.toString();
          while (pageUrl) {
            stoppedReason = "fetching_shopify_2026_page";
            const res = await fetchShopifyWithRetry(pageUrl, headers);
            if (!res.ok) {
              const text = await res.text();
              if (res.status === 401) {
                throw new Error(
                  `SHOPIFY_ADMIN_ACCESS_TOKEN was rejected by Shopify for ${domain}. Confirm the token belongs to this store and has Admin API access.`,
                );
              }
              if (res.status === 403) {
                throw new Error(
                  `SHOPIFY_ADMIN_ACCESS_TOKEN is valid but Shopify denied order access for ${domain}. Check read_orders/read_all_orders permissions.`,
                );
              }
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

            const orderResults = await mapWithConcurrency(orders, 8, async (order) => {
              const shopifyOrderId = String(order.id);
              try {
                await processShopifyOrder(order);
                return {
                  ok: true as const,
                  order,
                  shopifyOrderId,
                  existed: existingSet.has(shopifyOrderId),
                };
              } catch (e) {
                return {
                  ok: false as const,
                  order,
                  shopifyOrderId,
                  error: e instanceof Error ? e.message : String(e),
                };
              }
            });

            for (const result of orderResults) {
              recordsProcessed++;
              if (result.ok) {
                if (result.existed) updatedCount++;
                else createdCount++;

                const summary = summarizeOrder(result.order);
                if (!firstOrderNumberImported) firstOrderNumberImported = summary.label;
                lastOrderNumberImported = summary.label ?? lastOrderNumberImported;

                const createdAt = validDate(summary.createdAt);
                const minCreatedAt = validDate(minCreatedAtImported);
                const maxCreatedAt = validDate(maxCreatedAtImported);
                if (createdAt && (!minCreatedAt || createdAt.getTime() < minCreatedAt.getTime())) {
                  minCreatedAtImported = createdAt.toISOString();
                }
                if (createdAt && (!maxCreatedAt || createdAt.getTime() > maxCreatedAt.getTime())) {
                  maxCreatedAtImported = createdAt.toISOString();
                }
              } else {
                failedCount++;
                errors.push(`order ${result.shopifyOrderId}: ${result.error}`);
              }
            }

            const nextUrl = nextPageUrl(res.headers.get("link"));
            stoppedReason = nextUrl ? "next_page_found" : "shopify_no_next_page";
            pageUrl = nextUrl;
          }

          finishedAt = new Date().toISOString();
          const status: Exclude<RunStatus, "running"> = errors.length ? "partial" : "success";
          const errorMessage = errors.length ? errors.slice(0, 5).join(" | ") : null;
          if (status === "success") cursorReset = true;

          await (supabaseAdmin as any).from("migration_logs").insert({
            source: "shopify",
            entity: "orders",
            status,
            message: `${syncType}: deleted=${deletedOrdersCount} created=${createdCount} updated=${updatedCount} failed=${failedCount} pages=${pagesFetched}${errorMessage ? " | " + errorMessage : ""}`,
            rows_processed: recordsProcessed,
          });

          await (supabaseAdmin as any)
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
                    last_successful_orders_sync_at: createdAtMax,
                    last_orders_sync_cursor: createdAtMax,
                  }
                : {}),
              updated_at: finishedAt,
            })
            .eq("id", 1);

          await updateRun(status, errorMessage);

          return Response.json({
            ok: true,
            status,
            current_local_orders_count: currentLocalOrdersCount,
            current_local_order_items_count: currentLocalOrderItemsCount,
            deleted_orders_count: deletedOrdersCount,
            deleted_order_items_count: deletedOrderItemsCount,
            deleted_order_notes_count: deletedOrderNotesCount,
            deleted_order_activity_count: deletedOrderActivityCount,
            records_processed: recordsProcessed,
            created_count: createdCount,
            updated_count: updatedCount,
            failed_count: failedCount,
            pages_fetched: pagesFetched,
            first_order_number_imported: firstOrderNumberImported,
            last_order_number_imported: lastOrderNumberImported,
            created_at_min: CREATED_AT_MIN_2026,
            created_at_max: createdAtMax,
            errors,
          });
        } catch (error) {
          finishedAt = new Date().toISOString();
          const message = error instanceof Error ? error.message : String(error);
          failedCount = Math.max(failedCount, 1);
          stoppedReason =
            error instanceof ShopifyFetchError ? `shopify_${error.status}` : "handler_exception";

          try {
            await (supabaseAdmin as any)
              .from("shopify_sync_settings")
              .update({
                last_sync_at: finishedAt,
                last_sync_mode: syncType,
                last_sync_status: "failed",
                last_error: message,
                updated_at: finishedAt,
              })
              .eq("id", 1);
          } catch {
            // Keep the original Shopify/reset error as the API response.
          }
          await updateRun("failed", message).catch(() => undefined);

          return Response.json(
            {
              ok: false,
              status: "failed",
              error: message,
              current_local_orders_count: currentLocalOrdersCount,
              current_local_order_items_count: currentLocalOrderItemsCount,
              deleted_orders_count: deletedOrdersCount,
              deleted_order_items_count: deletedOrderItemsCount,
              deleted_order_notes_count: deletedOrderNotesCount,
              deleted_order_activity_count: deletedOrderActivityCount,
              records_processed: recordsProcessed,
              created_count: createdCount,
              updated_count: updatedCount,
              failed_count: failedCount,
              pages_fetched: pagesFetched,
              first_order_number_imported: firstOrderNumberImported,
              last_order_number_imported: lastOrderNumberImported,
              created_at_min: CREATED_AT_MIN_2026,
              created_at_max: createdAtMax,
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
