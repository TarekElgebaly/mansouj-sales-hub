import {
  getShopifyAdminAccessToken,
  getShopifyApiVersion,
  getShopifyDomainValidationError,
  normalizeShopDomain,
  validateShopDomain,
} from "@/lib/shopify-auth.server";
import { requireRoles } from "@/lib/route-auth.server";

export type ShopifySyncStatus = "running" | "success" | "partial" | "error";

export class ShopifyApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`Shopify ${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

export async function requireOpsUser(request: Request) {
  return requireRoles(request, ["admin", "operations"]);
}

export function getShopifyAdminConfig() {
  const apiVersion = getShopifyApiVersion();
  const domain = normalizeShopDomain(process.env.SHOPIFY_SHOP_DOMAIN || "");
  if (!domain) {
    return {
      ok: false as const,
      status: 500,
      error: "Missing SHOPIFY_SHOP_DOMAIN in Lovable Secrets.",
      apiVersion,
      domain,
      accessToken: "",
    };
  }
  if (!validateShopDomain(domain)) {
    return {
      ok: false as const,
      status: 400,
      error: getShopifyDomainValidationError(domain),
      apiVersion,
      domain,
      accessToken: "",
    };
  }

  const accessToken = getShopifyAdminAccessToken();
  if (!accessToken) {
    return {
      ok: false as const,
      status: 400,
      error:
        "Missing SHOPIFY_ADMIN_ACCESS_TOKEN in Lovable Secrets. SHOPIFY_ACCESS_TOKEN is supported only as a fallback.",
      apiVersion,
      domain,
      accessToken,
    };
  }

  return { ok: true as const, apiVersion, domain, accessToken };
}

export function shopifyHeaders(accessToken: string) {
  return {
    "X-Shopify-Access-Token": accessToken,
    "Content-Type": "application/json",
  };
}

export async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchShopifyWithRetry(
  url: string,
  headers: Record<string, string>,
  init: RequestInit = {},
) {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    lastResponse = res;
    if (res.ok || (res.status !== 429 && res.status < 500)) return res;

    const retryAfter = Number(res.headers.get("retry-after"));
    const delay =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
    await sleep(delay);
  }
  return lastResponse as Response;
}

export function nextPageUrl(linkHeader: string | null) {
  if (!linkHeader) return null;
  const links = linkHeader.split(",");
  for (const link of links) {
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function toNullableNumber(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toNullableDate(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function updateShopifySyncSettings(
  supabaseAdmin: any,
  patch: Record<string, unknown>,
) {
  await supabaseAdmin.from("shopify_sync_settings").update(patch).eq("id", 1);
}

export async function saveShopifySyncRun(
  supabaseAdmin: any,
  input: {
    syncType: string;
    status: ShopifySyncStatus;
    startedAt: string;
    finishedAt: string | null;
    recordsProcessed: number;
    createdCount?: number;
    updatedCount?: number;
    failedCount: number;
    pagesFetched: number;
    errorMessage?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await supabaseAdmin.from("shopify_sync_runs").insert({
    sync_type: input.syncType,
    status: input.status,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    records_processed: input.recordsProcessed,
    created_count: input.createdCount ?? 0,
    updated_count: input.updatedCount ?? 0,
    failed_count: input.failedCount,
    pages_fetched: input.pagesFetched,
    error_message: input.errorMessage ?? null,
    metadata: input.metadata ?? {},
  });
}

export async function upsertRows(
  supabaseAdmin: any,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  chunkSize = 500,
) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    if (!chunk.length) continue;
    const { error } = await supabaseAdmin.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`Could not upsert ${table}: ${error.message}`);
  }
}
