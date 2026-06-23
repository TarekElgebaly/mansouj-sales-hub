import { createFileRoute } from "@tanstack/react-router";
import {
  getShopifyAdminAccessToken,
  getShopifyApiVersion,
  getShopifyDomainValidationError,
  normalizeShopDomain,
  validateShopDomain,
} from "@/lib/shopify-auth.server";

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

        return Response.json({
          api_version: getShopifyApiVersion(),
          shop_domain: activeShopDomain || null,
          configured_shop_domain: configuredShopDomain || null,
          installed_shop_domain: null,
          domain_mismatch: false,
          invalid_shop_domain: invalidStoredDomain,
          install_status: invalidStoredDomain
            ? "invalid_shop_domain"
            : (settings?.install_status ??
              (tokenStored ? "manual_token_configured" : "not_connected")),
          token_stored: tokenStored,
          granted_scopes: settings?.granted_scopes ?? [],
          installed_at: settings?.installed_at ?? null,
          last_sync_at: settings?.last_sync_at ?? null,
          last_sync_status: invalidStoredDomain ? "error" : (settings?.last_sync_status ?? "idle"),
          last_orders_imported: settings?.last_orders_imported ?? 0,
          last_orders_updated: settings?.last_orders_updated ?? 0,
          last_connection_test_at: settings?.last_connection_test_at ?? null,
          last_connection_test_status: invalidStoredDomain
            ? "invalid_shop_domain"
            : (settings?.last_connection_test_status ?? "not_tested"),
          last_error: domainMessage ?? settings?.last_error ?? null,
          last_connection_test_error: invalidStoredDomain
            ? domainMessage
            : (settings?.last_connection_test_error ?? null),
          updated_at: settings?.updated_at ?? null,
        });
      },
    },
  },
});
