import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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

export function getShopifyApiVersion() {
  return process.env.SHOPIFY_API_VERSION || "2025-10";
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

export function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function createOAuthState() {
  const nonce = randomBytes(24).toString("hex");
  return { state: nonce, stateHash: hashSecret(nonce) };
}

export function verifyShopifyOAuthHmac(url: URL, clientSecret: string) {
  const hmac = url.searchParams.get("hmac");
  if (!hmac) return false;

  const message = Array.from(url.searchParams.entries())
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const digest = createHmac("sha256", clientSecret).update(message).digest("hex");

  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(hmac, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function missingScopes(granted: string[], required = REQUIRED_SHOPIFY_SCOPES) {
  const grantedSet = new Set(granted);
  return required.filter((scope) => !grantedSet.has(scope));
}

export function buildShopifyAuthUrl(params: {
  shop: string;
  clientId: string;
  scopes: string[];
  redirectUri: string;
  state: string;
}) {
  const url = new URL(`https://${params.shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("scope", params.scopes.join(","));
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  return url;
}
