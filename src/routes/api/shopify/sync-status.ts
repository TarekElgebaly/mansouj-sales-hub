import { createFileRoute } from "@tanstack/react-router";
import { getShopifyApiVersion, normalizeShopDomain } from "@/lib/shopify-auth.server";

export const Route = createFileRoute("/api/shopify/sync-status")({
  server: {
    handlers: {
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const configuredShopDomain = normalizeShopDomain(
          process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_STORE_DOMAIN || "",
        );

        const { data: settings } = await supabaseAdmin
          .from("shopify_sync_settings")
          .select("*")
          .eq("id", 1)
          .maybeSingle();

        const installedShopDomain = normalizeShopDomain(settings?.shop_domain || "");
        const configuredShopDomain = normalizeShopDomain(
          process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_STORE_DOMAIN || "",
        );
        const activeShopDomain =
          configuredShopDomain || installedShopDomain || normalizeShopDomain(settings?.store_url || "") || "";
        const domainMismatch = Boolean(
          configuredShopDomain && installedShopDomain && configuredShopDomain !== installedShopDomain,
        );
        const accessToken = typeof settings?.access_token === "string" ? settings.access_token : "";
        const tokenStored = Boolean(
          (accessToken && accessToken !== "pending") || settings?.token_stored,
        );
        const mismatchMessage = domainMismatch
          ? `Configured Shopify store is ${configuredShopDomain}, but the saved OAuth install is for ${installedShopDomain}. Reinstall the Shopify app for ${configuredShopDomain}.`
          : null;

        return Response.json({
          api_version: getShopifyApiVersion(),
          shop_domain: activeShopDomain || null,
          configured_shop_domain: configuredShopDomain || null,
          installed_shop_domain: installedShopDomain || null,
          domain_mismatch: domainMismatch,
          install_status: domainMismatch
            ? "wrong_store_reinstall_required"
            : (settings?.install_status ?? "not_connected"),
          token_stored: tokenStored,
          granted_scopes: settings?.granted_scopes ?? [],
          installed_at: settings?.installed_at ?? null,
          last_sync_at: settings?.last_sync_at ?? null,
          last_sync_status: domainMismatch ? "error" : (settings?.last_sync_status ?? "idle"),
          last_orders_imported: settings?.last_orders_imported ?? 0,
          last_orders_updated: settings?.last_orders_updated ?? 0,
          last_connection_test_at: settings?.last_connection_test_at ?? null,
          last_connection_test_status: domainMismatch
            ? "wrong_store"
            : (settings?.last_connection_test_status ?? "not_tested"),
          last_error: mismatchMessage ?? settings?.last_error ?? null,
          last_connection_test_error: domainMismatch
            ? mismatchMessage
            : (settings?.last_connection_test_error ?? null),
          updated_at: settings?.updated_at ?? null,
        });
      },
    },
  },
});
