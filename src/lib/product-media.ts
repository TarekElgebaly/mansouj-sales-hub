export type ProductMedia = {
  imageUrl: string | null;
  shopifyVariantId?: string | null;
  shopifyProductId?: string | null;
  productTitle?: string | null;
  variantTitle?: string | null;
  sku?: string | null;
  barcode?: string | null;
  productType?: string | null;
};

export type ShopifyProductLike = {
  title?: string | null;
  product_type?: string | null;
  status?: string | null;
  image?: unknown;
  raw?: unknown;
};

export type ShopifyVariantLike = {
  shopify_variant_id?: string | null;
  shopify_product_id?: string | null;
  sku?: string | null;
  barcode?: string | null;
  title?: string | null;
  inventory_item_id?: string | null;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  raw?: unknown;
  shopify_products?: ShopifyProductLike | ShopifyProductLike[] | null;
};

export function normalizeProductKey(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

export function variantIdFromSku(sku: string | null | undefined) {
  const match = String(sku ?? "").trim().match(/^shopify-variant-(\d+)$/i);
  return match?.[1] ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function extractImageUrl(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  const record = asRecord(value);
  if (!record) return null;

  const direct = firstString(
    record.src,
    record.url,
    record.originalSrc,
    record.transformedSrc,
    record.preview_image,
  );
  if (direct) return direct;

  return (
    extractImageUrl(record.image) ??
    extractImageUrl(record.featured_image) ??
    extractImageUrl(record.preview_image) ??
    extractImageUrl(record.node)
  );
}

function productFromRelation(value: ShopifyVariantLike["shopify_products"]) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function imageId(value: unknown) {
  const record = asRecord(value);
  const raw = record?.image_id ?? record?.imageId;
  return raw == null ? null : String(raw);
}

function productImages(productRaw: unknown) {
  const record = asRecord(productRaw);
  const images = record?.images;
  return Array.isArray(images) ? images : [];
}

export function mediaFromVariant(row: ShopifyVariantLike): ProductMedia {
  const product = productFromRelation(row.shopify_products);
  const raw = asRecord(row.raw);
  const productRaw = product?.raw;
  const variantImageId = imageId(raw);
  const matchedVariantImage = variantImageId
    ? productImages(productRaw).find((image) => {
        const record = asRecord(image);
        return record?.id != null && String(record.id) === variantImageId;
      })
    : null;

  return {
    shopifyVariantId: row.shopify_variant_id ?? null,
    shopifyProductId: row.shopify_product_id ?? null,
    imageUrl:
      extractImageUrl(raw?.image) ??
      extractImageUrl(raw?.featured_image) ??
      extractImageUrl(matchedVariantImage) ??
      extractImageUrl(product?.image) ??
      extractImageUrl(asRecord(productRaw)?.image) ??
      extractImageUrl(productImages(productRaw)[0]),
    productTitle: product?.title ?? null,
    variantTitle: row.title ?? [row.option1, row.option2, row.option3].filter(Boolean).join(" / "),
    sku: row.sku ?? null,
    barcode: row.barcode ?? null,
    productType: product?.product_type ?? null,
  };
}

export function indexProductMedia(rows: ShopifyVariantLike[]) {
  const byVariantId = new Map<string, ProductMedia>();
  const bySku = new Map<string, ProductMedia>();
  const bySkuNormalized = new Map<string, ProductMedia>();
  const byBarcode = new Map<string, ProductMedia>();
  const byTitle = new Map<string, ProductMedia>();

  for (const row of rows) {
    const media = mediaFromVariant(row);
    if (row.shopify_variant_id) byVariantId.set(String(row.shopify_variant_id), media);
    if (row.sku) {
      bySku.set(row.sku.trim(), media);
      bySkuNormalized.set(normalizeProductKey(row.sku), media);
    }
    if (row.barcode) {
      byBarcode.set(row.barcode.trim(), media);
      bySkuNormalized.set(normalizeProductKey(row.barcode), media);
    }
    const titleKey = productTitleKey(media.productTitle, media.variantTitle);
    if (titleKey) byTitle.set(titleKey, media);
  }

  return { byVariantId, bySku, bySkuNormalized, byBarcode, byTitle };
}

export function productTitleKey(
  productTitle?: string | null,
  variantTitle?: string | null,
) {
  const product = normalizeProductKey(productTitle);
  const variant = normalizeProductKey(variantTitle);
  return product || variant ? `${product}|${variant}` : "";
}

export function mediaForLineItem(
  item: {
    sku?: string | null;
    product_name?: string | null;
    variant?: string | null;
    shopify_variant_id?: string | null;
  },
  index: ReturnType<typeof indexProductMedia>,
) {
  const sku = String(item.sku ?? "").trim();
  const variantId = variantIdFromSku(sku);
  return (
    (item.shopify_variant_id ? index.byVariantId.get(String(item.shopify_variant_id)) : null) ??
    (variantId ? index.byVariantId.get(variantId) : null) ??
    index.bySku.get(sku) ??
    index.bySkuNormalized.get(normalizeProductKey(sku)) ??
    index.byBarcode.get(sku) ??
    index.byTitle.get(productTitleKey(item.product_name, item.variant)) ??
    null
  );
}
