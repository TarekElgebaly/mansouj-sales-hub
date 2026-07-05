export const DEFAULT_PACKAGING_COST_PER_ELIGIBLE_UNIT = 140;

type PackagingCostLine = {
  productName?: string | null;
  product_name?: string | null;
  title?: string | null;
  name?: string | null;
  variant?: string | null;
  variantName?: string | null;
  variant_title?: string | null;
  sku?: string | null;
  productType?: string | null;
  product_type?: string | null;
  category?: string | null;
  tags?: string[] | string | null;
  quantity?: number | string | null;
};

const EXCLUDED_PACKAGING_TERMS = [
  /(?:^|[^a-z0-9])pillows?(?:[^a-z0-9]|$)/,
  /(?:^|[^a-z0-9])pillow\s*cases?(?:[^a-z0-9]|$)/,
  /(?:^|[^a-z0-9])pillowcases?(?:[^a-z0-9]|$)/,
  /(?:^|[^a-z0-9])duvets?(?:[^a-z0-9]|$)/,
  /لحاف/,
  /مخده/,
  /مخدات/,
  /كيس مخده/,
  /اكياس مخدات/,
];

function normalizePackagingText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function lineSearchTexts(line: PackagingCostLine) {
  const tags = Array.isArray(line.tags) ? line.tags.join(" ") : line.tags;
  return [
    line.productName,
    line.product_name,
    line.title,
    line.name,
    line.productType,
    line.product_type,
    line.category,
    tags,
    line.sku,
  ]
    .filter(Boolean)
    .map(normalizePackagingText);
}

export function isPackagingExcludedProduct(line: PackagingCostLine) {
  const texts = lineSearchTexts(line);
  if (!texts.length) return false;
  return texts.some((text) => EXCLUDED_PACKAGING_TERMS.some((term) => term.test(text)));
}

export function packagingEligibleQuantity(line: PackagingCostLine) {
  if (isPackagingExcludedProduct(line)) return 0;
  const quantity = Number(line.quantity ?? 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.trunc(quantity);
}

export function calculatePackagingCost(
  lines: PackagingCostLine[],
  costPerEligibleUnit = DEFAULT_PACKAGING_COST_PER_ELIGIBLE_UNIT,
) {
  const eligibleQuantity = lines.reduce(
    (sum, line) => sum + packagingEligibleQuantity(line),
    0,
  );
  return eligibleQuantity * costPerEligibleUnit;
}
