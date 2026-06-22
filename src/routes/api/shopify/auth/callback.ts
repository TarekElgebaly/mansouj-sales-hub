import { createFileRoute } from "@tanstack/react-router";
import {
  getShopifyApiVersion,
  hashSecret,
  missingScopes,
  normalizeShopDomain,
  validateShopDomain,
  verifyShopifyOAuthHmac,
} from "@/lib/shopify-auth.server";

type TokenResponse = {
  access_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

export const Route = createFileRoute("/api/shopify/auth/callback" as never)({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const clientId = process.env.SHOPIFY_CLIENT_ID;
        const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
        if (!clientId) {
          return Response.json({ ok: false, error: "Missing SHOPIFY_CLIENT_ID." }, { status: 500 });
        }
        if (!clientSecret) {
          return Response.json(
            { ok: false, error: "Missing SHOPIFY_CLIENT_SECRET." },
            { status: 500 },
          );
        }

        const url = new URL(request.url);
        if (!verifyShopifyOAuthHmac(url, clientSecret)) {
          return Response.json({ ok: false, error: "Invalid hmac." }, { status: 401 });
        }

        const shop = normalizeShopDomain(url.searchParams.get("shop") || "");
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!validateShopDomain(shop)) {
          return Response.json({ ok: false, error: "Invalid shop domain." }, { status: 400 });
        }
        if (!code) {
          return Response.json(
            { ok: false, error: "Missing authorization code." },
            { status: 400 },
          );
        }
        if (!state) {
          return Response.json({ ok: false, error: "Invalid state/nonce." }, { status: 400 });
        }

        const { data: install } = await supabaseAdmin
          .from("shopify_installations")
          .select("oauth_state_hash,oauth_state_expires_at,shop_domain")
          .eq("id", 1)
          .maybeSingle();

        const stateExpired =
          !install?.oauth_state_expires_at ||
          new Date(install.oauth_state_expires_at).getTime() < Date.now();
        if (
          !install ||
          install.shop_domain !== shop ||
          stateExpired ||
          install.oauth_state_hash !== hashSecret(state)
        ) {
          return Response.json({ ok: false, error: "Invalid state/nonce." }, { status: 401 });
        }

        const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
          }),
        });
        const tokenJson = (await tokenRes.json().catch(() => ({}))) as TokenResponse;
        if (!tokenRes.ok || !tokenJson.access_token) {
          return Response.json(
            {
              ok: false,
              error: "Token exchange failed.",
              details:
                tokenJson.error_description || tokenJson.error || `Shopify ${tokenRes.status}`,
            },
            { status: 502 },
          );
        }

        const grantedScopes = (tokenJson.scope || "")
          .split(",")
          .map((scope) => scope.trim())
          .filter(Boolean);
        const missing = missingScopes(grantedScopes);
        const installedAt = new Date().toISOString();
        const status = missing.length ? "connected_missing_scopes" : "connected";

        await supabaseAdmin.from("shopify_installations").upsert(
          {
            id: 1,
            shop_domain: shop,
            access_token: tokenJson.access_token,
            granted_scopes: grantedScopes,
            install_status: status,
            installed_at: installedAt,
            oauth_state_hash: null,
            oauth_state_expires_at: null,
            updated_at: installedAt,
          } as never,
          { onConflict: "id" },
        );

        await supabaseAdmin
          .from("shopify_sync_settings")
          .update({
            store_url: shop,
            shop_domain: shop,
            granted_scopes: grantedScopes,
            install_status: status,
            installed_at: installedAt,
            token_stored: true,
            last_sync_status: "idle",
            last_error: null,
            last_connection_test_status: missing.length ? "missing_scopes" : "success",
            last_connection_test_error: missing.length
              ? `Missing required scopes: ${missing.join(", ")}`
              : null,
          } as never)
          .eq("id", 1);

        const apiVersion = getShopifyApiVersion();
        const redirect = new URL("/shopify", url.origin);
        redirect.searchParams.set("shopify_connected", missing.length ? "missing_scopes" : "1");
        redirect.searchParams.set("shop", shop);
        redirect.searchParams.set("api_version", apiVersion);
        return Response.redirect(redirect.toString(), 302);
      },
    },
  },
});
