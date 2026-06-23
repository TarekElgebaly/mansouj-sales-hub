import { createFileRoute } from "@tanstack/react-router";
import {
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

        const configuredShopDomain = normalizeShopDomain(
          process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_STORE_DOMAIN || "",
        );

        const { data: installation } = await supabaseAdmin
          .from("shopify_installations")
          .select("shop_domain,access_token,granted_scopes,install_status,installed_at,updated_at")
          .eq("id", 1)
          .maybeSingle();

        const { data: settings } = await supabaseAdmin
          .from("shopify_sync_settings")
          .select("*")
          .eq("id", 1)
          .maybeSingle();

        const settingsAccessToken =
          typeof (settings as { access_token?: unknown } | null)?.access_token === "string"
            ? ((settings as { access_token?: string } | null)?.access_token ?? "")
            : "";
        const installedShopDomain = normalizeShopDomain(
          settings?.shop_domain || installation?.shop_domain || "",
        );
        const settingsShopDomain = normalizeShopDomain(
          settings?.shop_domain || settings?.store_url || "",
        );
        const activeShopDomain =
          installedShopDomain || settingsShopDomain || configuredShopDomain || "";
        const invalidStoredDomain = Boolean(
          installedShopDomain && !validateShopDomain(installedShopDomain),
        );
        const tokenStored = Boolean(
          (settingsAccessToken && settingsAccessToken !== "pending") ||
          (installation?.access_token && installation.access_token !== "pending"),
        );
        const domainMessage = invalidStoredDomain
          ? getShopifyDomainValidationError(installedShopDomain)
          : null;

        return Response.json({
          api_version: getShopifyApiVersion(),
          shop_domain: activeShopDomain || null,
          configured_shop_domain: configuredShopDomain || null,
          installed_shop_domain: installedShopDomain || null,
          domain_mismatch: false,
          invalid_shop_domain: invalidStoredDomain,
          install_status: invalidStoredDomain
            ? "invalid_shop_domain"
            : (installation?.install_status ?? settings?.install_status ?? "not_connected"),
          token_stored: tokenStored || Boolean(settings?.token_stored),
          granted_scopes: installation?.granted_scopes ?? settings?.granted_scopes ?? [],
          installed_at: installation?.installed_at ?? settings?.installed_at ?? null,
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
          updated_at: settings?.updated_at ?? installation?.updated_at ?? null,
        });
      },
    },
  },
});
