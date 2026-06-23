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

        const settingsShopDomain = normalizeShopDomain(
          settings?.shop_domain || settings?.store_url || "",
        );
        const activeShopDomain = configuredShopDomain || settingsShopDomain || "";
        const invalidStoredDomain = Boolean(
          activeShopDomain && !validateShopDomain(activeShopDomain),
        );
        const tokenStored = Boolean(getShopifyAdminAccessToken());
        const domainMessage = invalidStoredDomain
          ? getShopifyDomainValidationError(activeShopDomain)
          : null;
        const grantedScopes = settings?.granted_scopes ?? [];
        const missingRequiredScopes = missingScopes(grantedScopes);
        const scopesSatisfied = grantedScopes.length > 0 && missingRequiredScopes.length === 0;
        const latestTestSucceeded =
          settings?.last_connection_test_status === "success" && scopesSatisfied;
        const staleMissingScopeTest =
          settings?.last_connection_test_status === "missing_scopes" && scopesSatisfied;
        const shouldNormalizeConnected =
          latestTestSucceeded ||
          (staleMissingScopeTest &&
            MISSING_SCOPE_INSTALL_STATUSES.has(settings?.install_status ?? ""));
        const connectionTestStatus =
          staleMissingScopeTest
            ? "success"
            : (settings?.last_connection_test_status ?? "not_tested");
        const connectionTestError =
          latestTestSucceeded || staleMissingScopeTest
            ? null
            : (settings?.last_connection_test_error ?? null);
        const installStatus =
          shouldNormalizeConnected
            ? "connected"
            : (settings?.install_status ??
              (tokenStored ? "manual_token_configured" : "not_connected"));
        const lastError =
          shouldNormalizeConnected && isMissingScopeError(settings?.last_error)
            ? null
            : (settings?.last_error ?? null);

        if (!invalidStoredDomain && shouldNormalizeConnected) {
          const statusUpdate: Record<string, unknown> = {};
          if (settings?.install_status !== "connected") statusUpdate.install_status = "connected";
          if (settings?.last_connection_test_status !== "success") {
            statusUpdate.last_connection_test_status = "success";
          }
          if (settings?.last_connection_test_error) statusUpdate.last_connection_test_error = null;
          if (isMissingScopeError(settings?.last_error)) statusUpdate.last_error = null;

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
          installed_at: settings?.installed_at ?? null,
          last_sync_at: settings?.last_sync_at ?? null,
          last_sync_status: invalidStoredDomain ? "error" : (settings?.last_sync_status ?? "idle"),
          last_orders_imported: settings?.last_orders_imported ?? 0,
          last_orders_updated: settings?.last_orders_updated ?? 0,
          last_connection_test_at: settings?.last_connection_test_at ?? null,
          last_connection_test_status: invalidStoredDomain
            ? "invalid_shop_domain"
            : connectionTestStatus,
          last_error: domainMessage ?? lastError,
          last_connection_test_error: invalidStoredDomain
            ? domainMessage
            : connectionTestError,
          updated_at: settings?.updated_at ?? null,
        });
      },
    },
  },
});
