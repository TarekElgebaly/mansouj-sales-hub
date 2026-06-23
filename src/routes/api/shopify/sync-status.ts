import { createFileRoute } from "@tanstack/react-router";
import {
  getShopifyAdminAccessToken,
  getShopifyApiVersion,
  getShopifyDomainValidationError,
  missingScopes,
  normalizeShopDomain,
  validateShopDomain,
} from "@/lib/shopify-auth.server";

const MISSING_SCOPE_INSTALL_STATUSES = new Set([
  "connected_missing_scopes",
  "manual_token_missing_scopes",
]);

function isMissingScopeError(message?: string | null) {
  return Boolean(message?.toLowerCase().includes("missing required scopes"));
}

export const Route = createFileRoute("/api/shopify/sync-status")({
  server: {
    handlers: {
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const configuredShopDomain = normalizeShopDomain(process.env.SHOPIFY_SHOP_DOMAIN || "");

        const { data: settings } = await supabaseAdmin
          .from("shopify_sync_settings")
          .select("*")
          .eq("id", 1)
          .maybeSingle();
        const settingsRow = settings as any;
        const { data: syncRuns } = await (supabaseAdmin as any)
          .from("shopify_sync_runs")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(5);

        const settingsShopDomain = normalizeShopDomain(
          settingsRow?.shop_domain || settingsRow?.store_url || "",
        );
        const activeShopDomain = configuredShopDomain || settingsShopDomain || "";
        const invalidStoredDomain = Boolean(
          activeShopDomain && !validateShopDomain(activeShopDomain),
        );
        const tokenStored = Boolean(getShopifyAdminAccessToken());
        const domainMessage = invalidStoredDomain
          ? getShopifyDomainValidationError(activeShopDomain)
          : null;
        const grantedScopes = settingsRow?.granted_scopes ?? [];
        const missingRequiredScopes = missingScopes(grantedScopes);
        const scopesSatisfied = grantedScopes.length > 0 && missingRequiredScopes.length === 0;
        const latestTestSucceeded =
          settingsRow?.last_connection_test_status === "success" && scopesSatisfied;
        const staleMissingScopeTest =
          settingsRow?.last_connection_test_status === "missing_scopes" && scopesSatisfied;
        const shouldNormalizeConnected =
          latestTestSucceeded ||
          (staleMissingScopeTest &&
            MISSING_SCOPE_INSTALL_STATUSES.has(settingsRow?.install_status ?? ""));
        const connectionTestStatus =
          staleMissingScopeTest
            ? "success"
            : (settingsRow?.last_connection_test_status ?? "not_tested");
        const connectionTestError =
          latestTestSucceeded || staleMissingScopeTest
            ? null
            : (settingsRow?.last_connection_test_error ?? null);
        const installStatus =
          shouldNormalizeConnected
            ? "connected"
            : (settingsRow?.install_status ??
              (tokenStored ? "manual_token_configured" : "not_connected"));
        const lastError =
          shouldNormalizeConnected && isMissingScopeError(settingsRow?.last_error)
            ? null
            : (settingsRow?.last_error ?? null);

        if (!invalidStoredDomain && shouldNormalizeConnected) {
          const statusUpdate: Record<string, unknown> = {};
          if (settingsRow?.install_status !== "connected") statusUpdate.install_status = "connected";
          if (settingsRow?.last_connection_test_status !== "success") {
            statusUpdate.last_connection_test_status = "success";
          }
          if (settingsRow?.last_connection_test_error) statusUpdate.last_connection_test_error = null;
          if (isMissingScopeError(settingsRow?.last_error)) statusUpdate.last_error = null;

          if (Object.keys(statusUpdate).length > 0) {
            await supabaseAdmin
              .from("shopify_sync_settings")
              .update(statusUpdate as never)
              .eq("id", 1);
          }
        }

        return Response.json({
          api_version: getShopifyApiVersion(),
          shop_domain: activeShopDomain || null,
          configured_shop_domain: configuredShopDomain || null,
          installed_shop_domain: null,
          domain_mismatch: false,
          invalid_shop_domain: invalidStoredDomain,
          install_status: invalidStoredDomain ? "invalid_shop_domain" : installStatus,
          token_stored: tokenStored,
          granted_scopes: grantedScopes,
          installed_at: settingsRow?.installed_at ?? null,
          last_sync_at: settingsRow?.last_sync_at ?? null,
          last_sync_mode: settingsRow?.last_sync_mode ?? null,
          last_sync_status: invalidStoredDomain ? "error" : (settingsRow?.last_sync_status ?? "idle"),
          last_successful_orders_sync_at: settingsRow?.last_successful_orders_sync_at ?? null,
          last_orders_sync_cursor: settingsRow?.last_orders_sync_cursor ?? null,
          last_orders_imported: settingsRow?.last_orders_imported ?? 0,
          last_orders_updated: settingsRow?.last_orders_updated ?? 0,
          last_connection_test_at: settingsRow?.last_connection_test_at ?? null,
          last_connection_test_status: invalidStoredDomain
            ? "invalid_shop_domain"
            : connectionTestStatus,
          last_error: domainMessage ?? lastError,
          last_connection_test_error: invalidStoredDomain
            ? domainMessage
            : connectionTestError,
          last_run: syncRuns?.[0] ?? null,
          recent_runs: syncRuns ?? [],
          updated_at: settingsRow?.updated_at ?? null,
        });
      },
    },
  },
});
