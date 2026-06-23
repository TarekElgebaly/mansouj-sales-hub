export const REQUIRED_SHOPIFY_SCOPES = [
  "read_orders",
  "read_all_orders",
  "read_products",
  "read_inventory",
  "read_locations",
  "read_customers",
] as const;

export const DEFAULT_ALLOWED_SHOPIFY_ADMIN_DOMAINS = [
  "mansouj.myshopify.com",
  "mansoujj.myshopify.com",
] as const;

const SHOPIFY_SCOPE_EQUIVALENTS: Record<string, string[]> = {
  read_products: ["write_products"],
  read_inventory: ["write_inventory"],
  read_locations: ["write_locations"],
  read_customers: ["write_customers"],
};

export function getShopifyApiVersion() {
  return process.env.SHOPIFY_API_VERSION || "2025-10";
}

export function getShopifyAdminAccessToken() {
  return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN || "";
}

export function getShopifyAdminTokenSource() {
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) return "SHOPIFY_ADMIN_ACCESS_TOKEN";
  if (process.env.SHOPIFY_ACCESS_TOKEN) return "SHOPIFY_ACCESS_TOKEN";
  return null;
}

export function getShopifyScopes() {
  const configured = process.env.SHOPIFY_SCOPES;
  const scopes = configured
    ? configured
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean)
    : [...REQUIRED_SHOPIFY_SCOPES];
  return Array.from(new Set(scopes));
}

export function normalizeShopDomain(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function getAllowedShopifyAdminDomains() {
  const configured =
    process.env.SHOPIFY_ALLOWED_ADMIN_DOMAINS || process.env.SHOPIFY_ALLOWED_SHOP_DOMAINS;
  const domains = configured
    ? configured
        .split(",")
        .map((domain) => normalizeShopDomain(domain))
        .filter(Boolean)
    : [...DEFAULT_ALLOWED_SHOPIFY_ADMIN_DOMAINS];
  return Array.from(new Set(domains));
}

export function isAllowedShopifyAdminDomain(shop: string) {
  return getAllowedShopifyAdminDomains().includes(normalizeShopDomain(shop));
}

export function validateShopDomain(shop: string) {
  const normalized = normalizeShopDomain(shop);
  return (
    /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized) &&
    isAllowedShopifyAdminDomain(normalized)
  );
}

export function getShopifyDomainValidationError(shop: string) {
  const normalized = normalizeShopDomain(shop);
  const allowed = getAllowedShopifyAdminDomains().join(", ");
  if (normalized === "mansouj.shop") {
    return `mansouj.shop is the customer storefront domain only. Use one of these Shopify Admin domains: ${allowed}.`;
  }
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) {
    return `Invalid Shopify Admin domain "${normalized || "(empty)"}". Expected one of these myshopify.com domains: ${allowed}.`;
  }
  return `Shopify Admin domain "${normalized}" is not allowed. Allowed domains: ${allowed}.`;
}

export function missingScopes(granted: string[], required = REQUIRED_SHOPIFY_SCOPES) {
  const grantedSet = new Set(granted);
  return required.filter((scope) => {
    if (grantedSet.has(scope)) return false;
    return !(SHOPIFY_SCOPE_EQUIVALENTS[scope]?.some((equivalent) => grantedSet.has(equivalent)));
  });
}
