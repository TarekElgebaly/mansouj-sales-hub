// Inventory refresh queue — read-only toward Shopify.
// Never issues Shopify write/update calls.
import {
  fetchShopifyWithRetry,
  getShopifyAdminConfig,
  shopifyHeaders,
  upsertRows,
} from "@/lib/shopify-sync.server";
import { runRefreshInventoryFromSourceOfTruth } from "@/routes/api/shopify/refresh-inventory-source-of-truth";

const SHOPIFY_INVENTORY_LEVELS_CHUNK = 50;
const OPPORTUNISTIC_FLUSH_AGE_MS = 10_000;
const MAX_QUEUE_ITEMS_PER_FLUSH = 500;

export type EnqueueInput = {
  variantIds?: (string | number | null | undefined)[] | null;
  inventoryItemIds?: (string | number | null | undefined)[] | null;
  sourceEventType: string;
  sourceOrderId?: string | number | null;
  sourceOrderNumber?: string | number | null;
};

function toStringArray(values: EnqueueInput["variantIds"]): string[] {
  if (!values) return [];
  const out: string[] = [];
  for (const v of values) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s.length > 0) out.push(s);
  }
  return Array.from(new Set(out));
}

/**
 * Resolve variant IDs to inventory_item_ids via shopify_variants.
 * Returns the merged, deduplicated inventory_item_ids we should refresh.
 */
async function resolveInventoryItemIds(
  supabaseAdmin: any,
  variantIds: string[],
  inventoryItemIds: string[],
): Promise<string[]> {
  const merged = new Set<string>(inventoryItemIds);
  if (variantIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("shopify_variants")
      .select("shopify_variant_id,inventory_item_id")
      .in("shopify_variant_id", variantIds);
    if (error) {
      console.warn("[inventory-refresh-queue] variant lookup failed:", error.message);
    } else {
      for (const row of (data ?? []) as { inventory_item_id: string | null }[]) {
        if (row.inventory_item_id) merged.add(String(row.inventory_item_id));
      }
    }
  }
  return Array.from(merged);
}

export async function enqueueInventoryRefresh(
  supabaseAdmin: any,
  input: EnqueueInput,
): Promise<{ enqueued: number; skipped_duplicates: number; inventory_item_ids: string[] }> {
  const variantIds = toStringArray(input.variantIds);
  const inventoryItemIds = toStringArray(input.inventoryItemIds);
  const targetItemIds = await resolveInventoryItemIds(supabaseAdmin, variantIds, inventoryItemIds);
  if (targetItemIds.length === 0) {
    return { enqueued: 0, skipped_duplicates: 0, inventory_item_ids: [] };
  }

  // Skip inserting for any item that already has an unprocessed row.
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from("inventory_refresh_queue")
    .select("inventory_item_id")
    .in("inventory_item_id", targetItemIds)
    .in("status", ["pending", "processing"]);
  if (existingErr) {
    console.warn("[inventory-refresh-queue] existing check failed:", existingErr.message);
  }
  const existingSet = new Set(
    (existing ?? []).map((r: { inventory_item_id: string }) => String(r.inventory_item_id)),
  );

  const rows = targetItemIds
    .filter((id) => !existingSet.has(id))
    .map((id) => ({
      inventory_item_id: id,
      source_event_type: input.sourceEventType,
      source_order_id: input.sourceOrderId != null ? String(input.sourceOrderId) : null,
      source_order_number: input.sourceOrderNumber != null ? String(input.sourceOrderNumber) : null,
      status: "pending" as const,
    }));

  let enqueued = 0;
  if (rows.length > 0) {
    const { error } = await supabaseAdmin.from("inventory_refresh_queue").insert(rows);
    if (error) {
      // Likely unique-index race; count 0 rather than failing the webhook.
      console.warn("[inventory-refresh-queue] insert failed:", error.message);
    } else {
      enqueued = rows.length;
    }
  }

  return {
    enqueued,
    skipped_duplicates: targetItemIds.length - enqueued,
    inventory_item_ids: targetItemIds,
  };
}

export async function oldestPendingAgeMs(supabaseAdmin: any): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from("inventory_refresh_queue")
    .select("enqueued_at")
    .eq("status", "pending")
    .order("enqueued_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const enqueuedAt = new Date(String((data as { enqueued_at: string }).enqueued_at));
  if (Number.isNaN(enqueuedAt.getTime())) return null;
  return Date.now() - enqueuedAt.getTime();
}

/**
 * Fire-and-forget opportunistic flush. If the oldest pending item is older than
 * ~10s, kick off queue processing without blocking the caller.
 */
export function scheduleOpportunisticFlush(supabaseAdmin: any) {
  void (async () => {
    try {
      const age = await oldestPendingAgeMs(supabaseAdmin);
      if (age != null && age >= OPPORTUNISTIC_FLUSH_AGE_MS) {
        await processInventoryRefreshQueue(supabaseAdmin, { maxItems: MAX_QUEUE_ITEMS_PER_FLUSH });
      }
    } catch (e) {
      console.error("[inventory-refresh-queue] opportunistic flush failed:", e);
    }
  })();
}

type QueueRow = {
  id: string;
  inventory_item_id: string;
  source_event_type: string | null;
  source_order_id: string | null;
  source_order_number: string | null;
  attempt_count: number;
};

type ShopifyInventoryLevel = {
  inventory_item_id: number | string;
  location_id: number | string;
  available?: number | null;
  updated_at?: string | null;
};

async function fetchShopifyInventoryLevels(
  ids: string[],
): Promise<{ levels: ShopifyInventoryLevel[]; failedIds: string[]; error?: string }> {
  const config = getShopifyAdminConfig();
  if (!config.ok) {
    return { levels: [], failedIds: ids, error: config.error };
  }
  const headers = shopifyHeaders(config.accessToken);
  const levels: ShopifyInventoryLevel[] = [];
  const failedIds: string[] = [];

  for (let i = 0; i < ids.length; i += SHOPIFY_INVENTORY_LEVELS_CHUNK) {
    const chunk = ids.slice(i, i + SHOPIFY_INVENTORY_LEVELS_CHUNK);
    const url = new URL(
      `https://${config.domain}/admin/api/${config.apiVersion}/inventory_levels.json`,
    );
    url.searchParams.set("inventory_item_ids", chunk.join(","));
    url.searchParams.set("limit", "250");
    try {
      const res = await fetchShopifyWithRetry(url.toString(), headers);
      if (!res.ok) {
        failedIds.push(...chunk);
        continue;
      }
      const json = (await res.json()) as { inventory_levels?: ShopifyInventoryLevel[] };
      levels.push(...(json.inventory_levels ?? []));
    } catch (e) {
      failedIds.push(...chunk);
      console.error("[inventory-refresh-queue] shopify fetch failed:", e);
    }
  }
  return { levels, failedIds };
}

async function upsertLevelsToLocal(supabaseAdmin: any, levels: ShopifyInventoryLevel[]) {
  if (levels.length === 0) return;
  const rows = levels.map((lvl) => ({
    inventory_item_id: String(lvl.inventory_item_id),
    location_id: String(lvl.location_id),
    available: lvl.available ?? null,
    available_quantity: lvl.available ?? null,
    updated_at: lvl.updated_at ?? new Date().toISOString(),
  }));
  try {
    await upsertRows(
      supabaseAdmin,
      "shopify_inventory_levels",
      rows,
      "inventory_item_id,location_id",
    );
  } catch (e) {
    console.error("[inventory-refresh-queue] local levels upsert failed:", e);
  }
}

export async function processInventoryRefreshQueue(
  supabaseAdmin: any,
  opts: { maxItems?: number } = {},
): Promise<{
  processed_count: number;
  claimed_count: number;
  inventory_items_refreshed: number;
  failures: number;
  duration_ms: number;
}> {
  const startedAt = Date.now();
  const maxItems = Math.max(1, Math.min(opts.maxItems ?? 200, MAX_QUEUE_ITEMS_PER_FLUSH));

  // Claim pending rows: SELECT ids, then UPDATE their status to 'processing'.
  const { data: pending, error: pendingErr } = await supabaseAdmin
    .from("inventory_refresh_queue")
    .select("id,inventory_item_id,source_event_type,source_order_id,source_order_number,attempt_count")
    .eq("status", "pending")
    .order("enqueued_at", { ascending: true })
    .limit(maxItems);
  if (pendingErr) {
    console.error("[inventory-refresh-queue] pending query failed:", pendingErr.message);
    return {
      processed_count: 0,
      claimed_count: 0,
      inventory_items_refreshed: 0,
      failures: 0,
      duration_ms: Date.now() - startedAt,
    };
  }
  const pendingRows = (pending ?? []) as QueueRow[];
  if (pendingRows.length === 0) {
    return {
      processed_count: 0,
      claimed_count: 0,
      inventory_items_refreshed: 0,
      failures: 0,
      duration_ms: Date.now() - startedAt,
    };
  }

  const rowIds = pendingRows.map((r) => r.id);
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from("inventory_refresh_queue")
    .update({ status: "processing" } as never)
    .in("id", rowIds)
    .eq("status", "pending")
    .select("id,inventory_item_id,source_event_type,source_order_id,source_order_number,attempt_count");
  if (claimErr) {
    console.error("[inventory-refresh-queue] claim failed:", claimErr.message);
    return {
      processed_count: 0,
      claimed_count: 0,
      inventory_items_refreshed: 0,
      failures: 0,
      duration_ms: Date.now() - startedAt,
    };
  }
  const claimedRows = (claimed ?? []) as QueueRow[];
  if (claimedRows.length === 0) {
    return {
      processed_count: 0,
      claimed_count: 0,
      inventory_items_refreshed: 0,
      failures: 0,
      duration_ms: Date.now() - startedAt,
    };
  }

  // Deduplicate inventory_item_ids across claimed rows.
  const uniqueItemIds = Array.from(new Set(claimedRows.map((r) => r.inventory_item_id)));

  // Fetch fresh levels from Shopify Admin API (batched, READ-ONLY).
  const { levels, failedIds, error: fetchErr } = await fetchShopifyInventoryLevels(uniqueItemIds);
  const failedSet = new Set(failedIds);

  // Persist fresh levels to the local shopify_inventory_levels table so the
  // source-of-truth refresh sees up-to-date data. We only upsert successfully
  // fetched items — failed ones are left untouched so their existing local
  // quantities are preserved.
  await upsertLevelsToLocal(supabaseAdmin, levels);

  // Delegate to the shared source-of-truth refresh (identical matching logic).
  const succeededIds = uniqueItemIds.filter((id) => !failedSet.has(id));
  let refreshFailures = 0;
  let itemsRefreshed = 0;
  let refreshError: string | null = null;
  if (succeededIds.length > 0) {
    try {
      const response = await runRefreshInventoryFromSourceOfTruth(supabaseAdmin, {
        filterInventoryItemIds: succeededIds,
        skipStaleMarking: true,
        skipRunLog: true,
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        variants_processed?: number;
        error?: string;
      };
      if (body.ok) {
        itemsRefreshed = Number(body.variants_processed ?? 0);
      } else {
        refreshError = String(body.error ?? "refresh_failed");
        refreshFailures = succeededIds.length;
      }
    } catch (e) {
      refreshError = e instanceof Error ? e.message : String(e);
      refreshFailures = succeededIds.length;
    }
  }

  // Update queue rows: mark 'done' for succeeded, 'failed' for failed.
  const finishedAt = new Date().toISOString();
  const succeededRowIds: string[] = [];
  const failedRowUpdates: { id: string; attempt_count: number; error: string }[] = [];
  for (const row of claimedRows) {
    if (failedSet.has(row.inventory_item_id) || refreshError) {
      failedRowUpdates.push({
        id: row.id,
        attempt_count: (row.attempt_count ?? 0) + 1,
        error: fetchErr ?? refreshError ?? "shopify_fetch_failed",
      });
    } else {
      succeededRowIds.push(row.id);
    }
  }

  if (succeededRowIds.length > 0) {
    await supabaseAdmin
      .from("inventory_refresh_queue")
      .update({ status: "done", processed_at: finishedAt } as never)
      .in("id", succeededRowIds);
  }
  for (const upd of failedRowUpdates) {
    await supabaseAdmin
      .from("inventory_refresh_queue")
      .update({
        status: "failed",
        processed_at: finishedAt,
        attempt_count: upd.attempt_count,
        last_error: upd.error,
      } as never)
      .eq("id", upd.id);
  }

  // Write a single event-log row summarizing the batch.
  const durationMs = Date.now() - startedAt;
  await supabaseAdmin.from("inventory_event_log").insert({
    event_type: "queue_flush",
    inventory_item_ids: uniqueItemIds,
    success: failedRowUpdates.length === 0 && !refreshError,
    retry_count: 0,
    last_error: refreshError ?? (failedIds.length > 0 ? "some_ids_failed_shopify_fetch" : null),
    processing_duration_ms: durationMs,
  } as never);

  return {
    processed_count: claimedRows.length,
    claimed_count: claimedRows.length,
    inventory_items_refreshed: itemsRefreshed,
    failures: failedRowUpdates.length,
    duration_ms: durationMs,
  };
}

/**
 * Idempotency helper for webhook deliveries. Returns true when this delivery
 * has already been seen (and processing should be skipped).
 */
export async function isDuplicateWebhookDelivery(
  supabaseAdmin: any,
  webhookId: string | null,
  topic: string,
  shopifyOrderId: string | null,
): Promise<boolean> {
  if (!webhookId) return false;
  const { data, error } = await supabaseAdmin
    .from("shopify_webhook_deliveries")
    .select("webhook_id")
    .eq("webhook_id", webhookId)
    .maybeSingle();
  if (error) {
    console.warn("[inventory-refresh-queue] dedup lookup failed:", error.message);
    return false;
  }
  if (data) return true;
  await supabaseAdmin
    .from("shopify_webhook_deliveries")
    .insert({
      webhook_id: webhookId,
      topic,
      shopify_order_id: shopifyOrderId,
    } as never)
    .then(
      () => null,
      () => null,
    );
  return false;
}
