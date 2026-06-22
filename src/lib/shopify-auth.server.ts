import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const REQUIRED_SHOPIFY_SCOPES = [
  "read_orders",
  "read_all_orders",
  "read_products",
  "read_inventory",
  "read_locations",
  "read_customers",
] as const;

export function getShopifyApiVersion() {
  return process.env.SHOPIFY_API_VERSION || "2025-10";
}

export function getShopifyScopes() {
  const configured = process.env.SHOPIFY_SCOPES;
  const scopes = configured
    ? configured.split(",").map((scope) => scope.trim()).filter(Boolean)
    : [...REQUIRED_SHOPIFY_SCOPES];
  return Array.from(new Set(scopes));
}

export function normalizeShopDomain(value: string) {
  return value.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
}

export function validateShopDomain(shop: string) {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop);
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
