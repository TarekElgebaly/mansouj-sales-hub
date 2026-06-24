import { createFileRoute } from "@tanstack/react-router";
import {
  fetchShopifyWithRetry,
  getShopifyAdminConfig,
  nextPageUrl,
  requireOpsUser,
  saveShopifySyncRun,
  shopifyHeaders,
  ShopifyApiError,
  toNullableDate,
  toNullableNumber,
  updateShopifySyncSettings,
  upsertRows,
} from "@/lib/shopify-sync.server";

type InventoryItemNode = {
  id: string;
  legacyResourceId?: string | number | null;
  sku?: string | null;
  tracked?: boolean | null;
  unitCost?: {
    amount?: string | number | null;
    currencyCode?: string | null;
  } | null;
};

type InventoryItemsGraphqlResponse = {
  data?: {
    inventoryItems?: {
      edges?: Array<{ cursor: string; node: InventoryItemNode }>;
      pageInfo?: { hasNextPage: boolean; endCursor?: string | null };
    };
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyLocation = {
  id: number | string;
  name?: string | null;
  active?: boolean | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  zip?: string | null;
  phone?: string | null;
};

type ShopifyLocationsResponse = {
  locations?: ShopifyLocation[];
};

type ShopifyInventoryLevel = {
  inventory_item_id: number | string;
  location_id: number | string;
  available?: number | null;
  updated_at?: string | null;
};

type ShopifyInventoryLevelsResponse = {
  inventory_levels?: ShopifyInventoryLevel[];
};

const INVENTORY_ITEMS_QUERY = `
  query InventoryItems($first: Int!, $after: String) {
    inventoryItems(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          legacyResourceId
          sku
          tracked
          unitCost {
            amount
            currencyCode
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

function inventoryItemId(node: InventoryItemNode) {
  if (node.legacyResourceId != null) return String(node.legacyResourceId);
  const match = node.id.match(/InventoryItem\/(\d+)/);
  return match?.[1] ?? node.id;
}

function inventoryItemRow(node: InventoryItemNode, syncedAt: string) {
  return {
    inventory_item_id: inventoryItemId(node),
    sku: node.sku || null,
    tracked: node.tracked ?? null,
    unit_cost_amount: toNullableNumber(node.unitCost?.amount),
    unit_cost_currency_code: node.unitCost?.currencyCode ?? null,
    raw: node,
    synced_at: syncedAt,
  };
}

function locationRow(location: ShopifyLocation) {
  return {
    shopify_location_id: String(location.id),
    name: location.name || `Location ${location.id}`,
    active: location.active ?? null,
    address: {
      address1: location.address1 ?? null,
      address2: location.address2 ?? null,
      city: location.city ?? null,
      province: location.province ?? null,
      country: location.country ?? null,
      zip: location.zip ?? null,
      phone: location.phone ?? null,
    },
    raw: location,
  };
}

function inventoryLevelRow(level: ShopifyInventoryLevel) {
  return {
    inventory_item_id: String(level.inventory_item_id),
    shopify_location_id: String(level.location_id),
    available: level.available ?? null,
    shopify_updated_at: toNullableDate(level.updated_at),
    raw: level,
  };
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function existingIds(supabaseAdmin: any, table: string, column: string, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const { data, error } = await supabaseAdmin.from(table).select(column).in(column, ids);
  if (error) throw new Error(`Could not inspect ${table}: ${error.message}`);
  return new Set((data ?? []).map((row: Record<string, string>) => row[column]).filter(Boolean));
}

async function existingLevelKeys(supabaseAdmin: any, itemIds: string[]) {
  if (!itemIds.length) return new Set<string>();
  const { data, error } = await supabaseAdmin
    .from("shopify_inventory_levels")
    .select("inventory_item_id,shopify_location_id")
    .in("inventory_item_id", itemIds);
  if (error) throw new Error(`Could not inspect shopify_inventory_levels: ${error.message}`);
  return new Set(
    (data ?? []).map(
      (row: { inventory_item_id: string; shopify_location_id: string }) =>
        `${row.inventory_item_id}:${row.shopify_location_id}`,
    ),
  );
}

async function fetchInventoryItemsGraphql(
  domain: string,
  apiVersion: string,
  accessToken: string,
) {
  const headers = shopifyHeaders(accessToken);
  const endpoint = `https://${domain}/admin/api/${apiVersion}/graphql.json`;
  const rows: Record<string, unknown>[] = [];
  let pagesFetched = 0;
  let after: string | null = null;
  const syncedAt = new Date().toISOString();

  do {
    const res = await fetchShopifyWithRetry(endpoint, headers, {
      method: "POST",
      body: JSON.stringify({
        query: INVENTORY_ITEMS_QUERY,
        variables: { first: 250, after },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) {
        throw new ShopifyApiError(
          401,
          "SHOPIFY_ADMIN_ACCESS_TOKEN was rejected by Shopify for inventory item cost sync.",
        );
      }
      if (res.status === 403) {
        throw new ShopifyApiError(
          403,
          "SHOPIFY_ADMIN_ACCESS_TOKEN is valid but Shopify denied inventory item cost access. Check read_inventory permission.",
        );
      }
      throw new ShopifyApiError(res.status, text);
    }

    pagesFetched++;
    const json = (await res.json()) as InventoryItemsGraphqlResponse;
    if (json.errors?.length) {
      throw new Error(
        `Shopify GraphQL inventoryItems query failed: ${json.errors
          .map((error) => error.message)
          .filter(Boolean)
          .join(" | ")}`,
      );
    }

    const connection = json.data?.inventoryItems;
    for (const edge of connection?.edges ?? []) rows.push(inventoryItemRow(edge.node, syncedAt));
    after = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor ?? null : null;
  } while (after);

  return { rows, pagesFetched };
}

async function fetchLocations(domain: string, apiVersion: string, accessToken: string) {
  const headers = shopifyHeaders(accessToken);
  const url = `https://${domain}/admin/api/${apiVersion}/locations.json`;
  const res = await fetchShopifyWithRetry(url, headers);
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) {
      throw new ShopifyApiError(
        401,
        "SHOPIFY_ADMIN_ACCESS_TOKEN was rejected by Shopify for location sync.",
      );
    }
    if (res.status === 403) {
      throw new ShopifyApiError(
        403,
        "SHOPIFY_ADMIN_ACCESS_TOKEN is valid but Shopify denied location access. Check read_locations permission.",
      );
    }
    throw new ShopifyApiError(res.status, text);
  }
  const json = (await res.json()) as ShopifyLocationsResponse;
  return { rows: (json.locations ?? []).map(locationRow), pagesFetched: 1 };
}

async function ensureLevelLocations(
  supabaseAdmin: any,
  levelRows: Record<string, unknown>[],
) {
  const locationIds = Array.from(
    new Set(levelRows.map((row) => String(row.shopify_location_id)).filter(Boolean)),
  );
  const existing = await existingIds(
    supabaseAdmin,
    "shopify_locations",
    "shopify_location_id",
    locationIds,
  );
  const missing = locationIds
    .filter((id) => !existing.has(id))
    .map((id) => ({
      shopify_location_id: id,
      name: `Location ${id}`,
      active: null,
      address: {},
      raw: { placeholder: true },
    }));
  await upsertRows(supabaseAdmin, "shopify_locations", missing, "shopify_location_id");
}

export const Route = createFileRoute("/api/shopify/sync-inventory-cost")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireOpsUser(request);
        if (!auth.ok) return auth.response;
        const { supabaseAdmin } = auth;

        const startedAt = new Date().toISOString();
        const syncType = "inventory_cost_sync";
        let finishedAt: string | null = null;
        let domain = "";
        let apiVersion = "";
        let inventoryItemsProcessed = 0;
        let inventoryItemsCreated = 0;
        let inventoryItemsUpdated = 0;
        let inventoryItemsWithCost = 0;
        let inventoryItemsMissingCost = 0;
        let locationsProcessed = 0;
        let locationsCreated = 0;
        let locationsUpdated = 0;
        let inventoryLevelsProcessed = 0;
        let inventoryLevelsCreated = 0;
        let inventoryLevelsUpdated = 0;
        let failedCount = 0;
        let pagesFetched = 0;
        let stoppedReason = "not_started";

        const metadata = (extra: Record<string, unknown> = {}) => ({
          inventory_items_processed: inventoryItemsProcessed,
          inventory_items_created: inventoryItemsCreated,
          inventory_items_updated: inventoryItemsUpdated,
          inventory_items_with_cost: inventoryItemsWithCost,
          inventory_items_missing_cost: inventoryItemsMissingCost,
          locations_processed: locationsProcessed,
          locations_created: locationsCreated,
          locations_updated: locationsUpdated,
          inventory_levels_processed: inventoryLevelsProcessed,
          inventory_levels_created: inventoryLevelsCreated,
          inventory_levels_updated: inventoryLevelsUpdated,
          failed_count: failedCount,
          pages_fetched: pagesFetched,
          stopped_reason: stoppedReason,
          shop_domain: domain || null,
          api_version: apiVersion || null,
          shopify_write_calls: false,
          cost_source: "Shopify Admin GraphQL inventoryItems.unitCost",
          ...extra,
        });

        try {
          const config = getShopifyAdminConfig();
          apiVersion = config.apiVersion;
          domain = config.domain;
          if (!config.ok) {
            finishedAt = new Date().toISOString();
            stoppedReason = "invalid_config";
            await saveShopifySyncRun(supabaseAdmin, {
              syncType,
              status: "error",
              startedAt,
              finishedAt,
              recordsProcessed: 0,
              failedCount: 1,
              pagesFetched,
              errorMessage: config.error,
              metadata: metadata(),
            });
            return Response.json({ ok: false, error: config.error }, { status: config.status });
          }

          await updateShopifySyncSettings(supabaseAdmin, {
            shop_domain: domain,
            store_url: domain,
            token_stored: true,
            last_sync_mode: syncType,
            last_sync_status: "running",
            last_error: null,
            updated_at: startedAt,
          });

          stoppedReason = "fetching_inventory_items_graphql";
          const inventoryItems = await fetchInventoryItemsGraphql(
            domain,
            apiVersion,
            config.accessToken,
          );
          pagesFetched += inventoryItems.pagesFetched;
          const inventoryItemRows = inventoryItems.rows;
          const inventoryItemIds = inventoryItemRows.map((row) => String(row.inventory_item_id));
          const existingInventoryItems = await existingIds(
            supabaseAdmin,
            "shopify_inventory_items",
            "inventory_item_id",
            inventoryItemIds,
          );
          await upsertRows(
            supabaseAdmin,
            "shopify_inventory_items",
            inventoryItemRows,
            "inventory_item_id",
          );
          inventoryItemsProcessed = inventoryItemRows.length;
          inventoryItemsCreated = inventoryItemRows.filter(
            (row) => !existingInventoryItems.has(String(row.inventory_item_id)),
          ).length;
          inventoryItemsUpdated = inventoryItemRows.length - inventoryItemsCreated;
          inventoryItemsWithCost = inventoryItemRows.filter(
            (row) => row.unit_cost_amount != null,
          ).length;
          inventoryItemsMissingCost = inventoryItemsProcessed - inventoryItemsWithCost;

          stoppedReason = "fetching_locations";
          const locations = await fetchLocations(domain, apiVersion, config.accessToken);
          pagesFetched += locations.pagesFetched;
          const locationRows = locations.rows;
          const existingLocations = await existingIds(
            supabaseAdmin,
            "shopify_locations",
            "shopify_location_id",
            locationRows.map((row) => String(row.shopify_location_id)),
          );
          await upsertRows(supabaseAdmin, "shopify_locations", locationRows, "shopify_location_id");
          locationsProcessed = locationRows.length;
          locationsCreated = locationRows.filter(
            (row) => !existingLocations.has(String(row.shopify_location_id)),
          ).length;
          locationsUpdated = locationRows.length - locationsCreated;

          stoppedReason = "fetching_inventory_levels";
          const headers = shopifyHeaders(config.accessToken);
          for (const itemIdChunk of chunk(inventoryItemIds, 50)) {
            let pageUrl: string | null = (() => {
              const url = new URL(
                `https://${domain}/admin/api/${apiVersion}/inventory_levels.json`,
              );
              url.searchParams.set("limit", "250");
              url.searchParams.set("inventory_item_ids", itemIdChunk.join(","));
              return url.toString();
            })();

            while (pageUrl) {
              const res = await fetchShopifyWithRetry(pageUrl, headers);
              if (!res.ok) {
                const text = await res.text();
                failedCount++;
                stoppedReason = `shopify_${res.status}`;
                if (res.status === 401) {
                  throw new ShopifyApiError(
                    401,
                    "SHOPIFY_ADMIN_ACCESS_TOKEN was rejected by Shopify for inventory levels sync.",
                  );
                }
                if (res.status === 403) {
                  throw new ShopifyApiError(
                    403,
                    "SHOPIFY_ADMIN_ACCESS_TOKEN is valid but Shopify denied inventory levels access. Check read_inventory permission.",
                  );
                }
                throw new ShopifyApiError(res.status, text);
              }

              pagesFetched++;
              const json = (await res.json()) as ShopifyInventoryLevelsResponse;
              const levelRows = (json.inventory_levels ?? []).map(inventoryLevelRow);
              await ensureLevelLocations(supabaseAdmin, levelRows);
              const existingLevels = await existingLevelKeys(
                supabaseAdmin,
                Array.from(
                  new Set(levelRows.map((row) => String(row.inventory_item_id)).filter(Boolean)),
                ),
              );
              await upsertRows(
                supabaseAdmin,
                "shopify_inventory_levels",
                levelRows,
                "inventory_item_id,shopify_location_id",
              );

              inventoryLevelsProcessed += levelRows.length;
              inventoryLevelsCreated += levelRows.filter(
                (row) =>
                  !existingLevels.has(`${row.inventory_item_id}:${row.shopify_location_id}`),
              ).length;
              inventoryLevelsUpdated = inventoryLevelsProcessed - inventoryLevelsCreated;

              pageUrl = nextPageUrl(res.headers.get("link"));
            }
          }
          stoppedReason = "shopify_no_next_page";

          finishedAt = new Date().toISOString();
          await updateShopifySyncSettings(supabaseAdmin, {
            last_sync_at: finishedAt,
            last_sync_mode: syncType,
            last_sync_status: "success",
            last_error: null,
            updated_at: finishedAt,
          });
          await saveShopifySyncRun(supabaseAdmin, {
            syncType,
            status: "success",
            startedAt,
            finishedAt,
            recordsProcessed:
              inventoryItemsProcessed + locationsProcessed + inventoryLevelsProcessed,
            createdCount: inventoryItemsCreated + locationsCreated + inventoryLevelsCreated,
            updatedCount: inventoryItemsUpdated + locationsUpdated + inventoryLevelsUpdated,
            failedCount,
            pagesFetched,
            metadata: metadata(),
          });

          return Response.json({
            ok: true,
            status: "success",
            inventory_items_processed: inventoryItemsProcessed,
            inventory_items_with_cost: inventoryItemsWithCost,
            inventory_items_missing_cost: inventoryItemsMissingCost,
            locations_processed: locationsProcessed,
            inventory_levels_processed: inventoryLevelsProcessed,
            failed_count: failedCount,
            pages_fetched: pagesFetched,
          });
        } catch (error) {
          finishedAt = new Date().toISOString();
          const message = error instanceof Error ? error.message : String(error);
          failedCount = Math.max(failedCount, 1);
          await updateShopifySyncSettings(supabaseAdmin, {
            last_sync_at: finishedAt,
            last_sync_mode: syncType,
            last_sync_status: "error",
            last_error: message,
            updated_at: finishedAt,
          }).catch(() => undefined);
          await saveShopifySyncRun(supabaseAdmin, {
            syncType,
            status: "error",
            startedAt,
            finishedAt,
            recordsProcessed:
              inventoryItemsProcessed + locationsProcessed + inventoryLevelsProcessed,
            createdCount: inventoryItemsCreated + locationsCreated + inventoryLevelsCreated,
            updatedCount: inventoryItemsUpdated + locationsUpdated + inventoryLevelsUpdated,
            failedCount,
            pagesFetched,
            errorMessage: message,
            metadata: metadata(),
          }).catch(() => undefined);

          const status = error instanceof ShopifyApiError ? error.status : 500;
          return Response.json({ ok: false, error: message }, { status });
        }
      },
    },
  },
});
