import { createFileRoute } from "@tanstack/react-router";
import {
  buildShopifyAuthUrl,
  createOAuthState,
  getShopifyScopes,
  getShopifyDomainValidationError,
  normalizeShopDomain,
  validateShopDomain,
} from "@/lib/shopify-auth.server";

export const Route = createFileRoute("/api/shopify/auth/start" as never)({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const clientId = process.env.SHOPIFY_CLIENT_ID;
        if (!clientId) {
          return Response.json({ ok: false, error: "Missing SHOPIFY_CLIENT_ID." }, { status: 500 });
        }

        const configuredShop = process.env.SHOPIFY_SHOP_DOMAIN;
        if (!configuredShop) {
          return Response.json(
            { ok: false, error: "Missing SHOPIFY_SHOP_DOMAIN." },
            { status: 500 },
          );
        }

        const url = new URL(request.url);
        const shop = normalizeShopDomain(url.searchParams.get("shop") || configuredShop);
        if (!validateShopDomain(shop)) {
          return Response.json(
            {
              ok: false,
              error: getShopifyDomainValidationError(shop),
            },
            { status: 400 },
          );
        }

        const scopes = getShopifyScopes();
        if (!process.env.SHOPIFY_SCOPES || scopes.length === 0) {
          return Response.json({ ok: false, error: "Missing SHOPIFY_SCOPES." }, { status: 500 });
        }

        const { state, stateHash } = createOAuthState();
        await supabaseAdmin.from("shopify_installations").upsert(
          {
            id: 1,
            shop_domain: shop,
            access_token: "pending",
            granted_scopes: [],
            install_status: "pending",
            oauth_state_hash: stateHash,
            oauth_state_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: "id" },
        );

        await supabaseAdmin
          .from("shopify_sync_settings")
          .update({
            store_url: shop,
            shop_domain: shop,
            access_token: "pending",
            install_status: "pending",
            token_stored: false,
            last_sync_status: "idle",
            last_error: null,
            last_connection_test_status: "pending",
            last_connection_test_error: null,
          } as never)
          .eq("id", 1);

        console.info(
          `[Shopify OAuth] Starting install. requested shop domain=${shop}; stored pending shop domain=${shop}.`,
        );

        const redirectUri =
          process.env.SHOPIFY_REDIRECT_URI || `${url.origin}/api/shopify/auth/callback`;
        const authUrl = buildShopifyAuthUrl({ shop, clientId, scopes, redirectUri, state });

        return Response.redirect(authUrl.toString(), 302);
      },
    },
  },
});
