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

type ShopifyVariant = {
  id: number | string;
  product_id: number | string;
  title?: string | null;
  sku?: string | null;
  barcode?: string | null;
  price?: string | number | null;
  compare_at_price?: string | number | null;
  inventory_item_id?: number | string | null;
  inventory_quantity?: number | null;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ShopifyProduct = {
  id: number | string;
  title?: string | null;
  handle?: string | null;
  vendor?: string | null;
  product_type?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  image?: unknown;
  images?: unknown[];
  options?: unknown[];
  variants?: ShopifyVariant[];
};

type ShopifyProductsResponse = {
  products?: ShopifyProduct[];
};

function productRow(product: ShopifyProduct) {
  return {
    shopify_product_id: String(product.id),
    title: product.title || "Untitled product",
    handle: product.handle ?? null,
    vendor: product.vendor ?? null,
    product_type: product.product_type ?? null,
    status: product.status ?? null,
    shopify_created_at: toNullableDate(product.created_at),
    shopify_updated_at: toNullableDate(product.updated_at),
    image: product.image ?? product.images?.[0] ?? null,
    raw: product,
  };
}

function variantRow(product: ShopifyProduct, variant: ShopifyVariant) {
  return {
    shopify_variant_id: String(variant.id),
    shopify_product_id: String(product.id),
    title: variant.title ?? null,
    sku: variant.sku || null,
    barcode: variant.barcode || null,
    price: toNullableNumber(variant.price),
    compare_at_price: toNullableNumber(variant.compare_at_price),
    inventory_item_id:
      variant.inventory_item_id == null ? null : String(variant.inventory_item_id),
    inventory_quantity: variant.inventory_quantity ?? null,
    option1: variant.option1 ?? null,
    option2: variant.option2 ?? null,
    option3: variant.option3 ?? null,
    options: {
      option1: variant.option1 ?? null,
      option2: variant.option2 ?? null,
      option3: variant.option3 ?? null,
      product_options: product.options ?? [],
    },
    shopify_created_at: toNullableDate(variant.created_at),
    shopify_updated_at: toNullableDate(variant.updated_at),
    raw: variant,
  };
}

async function existingIds(supabaseAdmin: any, table: string, column: string, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const { data, error } = await supabaseAdmin.from(table).select(column).in(column, ids);
  if (error) throw new Error(`Could not inspect ${table}: ${error.message}`);
  return new Set((data ?? []).map((row: Record<string, string>) => row[column]).filter(Boolean));
}

export const Route = createFileRoute("/api/shopify/sync-products")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireOpsUser(request);
        if (!auth.ok) return auth.response;
        const { supabaseAdmin } = auth;

        const startedAt = new Date().toISOString();
        const syncType = "products_sync";
        let finishedAt: string | null = null;
        let domain = "";
        let apiVersion = "";
        let productsProcessed = 0;
        let productsCreated = 0;
        let productsUpdated = 0;
        let variantsProcessed = 0;
        let variantsCreated = 0;
        let variantsUpdated = 0;
        let failedCount = 0;
        let pagesFetched = 0;
        let stoppedReason = "not_started";

        const metadata = (extra: Record<string, unknown> = {}) => ({
          products_processed: productsProcessed,
          products_created: productsCreated,
          products_updated: productsUpdated,
          variants_processed: variantsProcessed,
          variants_created: variantsCreated,
          variants_updated: variantsUpdated,
          failed_count: failedCount,
          pages_fetched: pagesFetched,
          stopped_reason: stoppedReason,
          shop_domain: domain || null,
          api_version: apiVersion || null,
          shopify_write_calls: false,
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

          const headers = shopifyHeaders(config.accessToken);
          const url = new URL(`https://${domain}/admin/api/${apiVersion}/products.json`);
          url.searchParams.set("limit", "250");
          url.searchParams.set("status", "any");

          let pageUrl: string | null = url.toString();
          while (pageUrl) {
            stoppedReason = "fetching_products_page";
            const res = await fetchShopifyWithRetry(pageUrl, headers);
            if (!res.ok) {
              const text = await res.text();
              failedCount++;
              stoppedReason = `shopify_${res.status}`;
              if (res.status === 401) {
                throw new ShopifyApiError(
                  401,
                  "SHOPIFY_ADMIN_ACCESS_TOKEN was rejected by Shopify for product sync.",
                );
              }
              if (res.status === 403) {
                throw new ShopifyApiError(
                  403,
                  "SHOPIFY_ADMIN_ACCESS_TOKEN is valid but Shopify denied product access. Check read_products permission.",
                );
              }
              throw new ShopifyApiError(res.status, text);
            }

            pagesFetched++;
            const json = (await res.json()) as ShopifyProductsResponse;
            const products = json.products ?? [];
            const productRows = products.map(productRow);
            const variantRows = products.flatMap((product) =>
              (product.variants ?? []).map((variant) => variantRow(product, variant)),
            );

            const existingProducts = await existingIds(
              supabaseAdmin,
              "shopify_products",
              "shopify_product_id",
              productRows.map((row) => row.shopify_product_id),
            );
            const existingVariants = await existingIds(
              supabaseAdmin,
              "shopify_variants",
              "shopify_variant_id",
              variantRows.map((row) => row.shopify_variant_id),
            );

            await upsertRows(
              supabaseAdmin,
              "shopify_products",
              productRows,
              "shopify_product_id",
            );
            await upsertRows(
              supabaseAdmin,
              "shopify_variants",
              variantRows,
              "shopify_variant_id",
            );

            productsProcessed += productRows.length;
            productsCreated += productRows.filter(
              (row) => !existingProducts.has(row.shopify_product_id),
            ).length;
            productsUpdated += productRows.filter((row) =>
              existingProducts.has(row.shopify_product_id),
            ).length;
            variantsProcessed += variantRows.length;
            variantsCreated += variantRows.filter(
              (row) => !existingVariants.has(row.shopify_variant_id),
            ).length;
            variantsUpdated += variantRows.filter((row) =>
              existingVariants.has(row.shopify_variant_id),
            ).length;

            pageUrl = nextPageUrl(res.headers.get("link"));
            stoppedReason = pageUrl ? "next_page_found" : "shopify_no_next_page";
          }

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
            recordsProcessed: productsProcessed + variantsProcessed,
            createdCount: productsCreated + variantsCreated,
            updatedCount: productsUpdated + variantsUpdated,
            failedCount,
            pagesFetched,
            metadata: metadata(),
          });

          return Response.json({
            ok: true,
            status: "success",
            products_processed: productsProcessed,
            products_created: productsCreated,
            products_updated: productsUpdated,
            variants_processed: variantsProcessed,
            variants_created: variantsCreated,
            variants_updated: variantsUpdated,
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
            recordsProcessed: productsProcessed + variantsProcessed,
            createdCount: productsCreated + variantsCreated,
            updatedCount: productsUpdated + variantsUpdated,
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
