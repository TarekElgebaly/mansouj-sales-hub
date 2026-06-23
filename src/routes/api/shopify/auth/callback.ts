import { createFileRoute } from "@tanstack/react-router";
import {
  getShopifyApiVersion,
  getShopifyDomainValidationError,
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

function restartInstallResponse(origin: string, shop: string, message: string, status = 401) {
  const restartUrl = new URL("/api/shopify/auth/start", origin);
  restartUrl.searchParams.set("shop", shop);
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Restart Shopify install</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
      main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      section { max-width: 520px; width: 100%; background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
      h1 { font-size: 22px; margin: 0 0 12px; }
      p { color: #475569; line-height: 1.5; margin: 0 0 20px; }
      a { display: inline-block; background: #111827; color: white; text-decoration: none; padding: 10px 14px; border-radius: 8px; font-weight: 600; }
      code { background: #f1f5f9; padding: 2px 6px; border-radius: 5px; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>Restart Shopify install</h1>
        <p>${message}</p>
        <p>Store: <code>${shop}</code></p>
        <a href="${restartUrl.toString()}">Start Shopify install again</a>
      </section>
    </main>
  </body>
</html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

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
          return Response.json(
            { ok: false, error: getShopifyDomainValidationError(shop) },
            { status: 400 },
          );
        }
        if (!code) {
          return Response.json(
            { ok: false, error: "Missing authorization code." },
            { status: 400 },
          );
        }
        if (!state) {
          return restartInstallResponse(
            url.origin,
            shop,
            "The Shopify install session is missing its security state. Start the install again from a fresh link.",
            400,
          );
        }

        const { data: install } = await supabaseAdmin
          .from("shopify_installations")
          .select("oauth_state_hash,oauth_state_expires_at,shop_domain")
          .eq("id", 1)
          .maybeSingle();

        const stateExpired =
          !install?.oauth_state_expires_at ||
          new Date(install.oauth_state_expires_at).getTime() < Date.now();
        if (!install || stateExpired || install.oauth_state_hash !== hashSecret(state)) {
          return restartInstallResponse(
            url.origin,
            shop,
            "The Shopify install session expired or an older install tab was used. Start the install again and complete it from the newest tab.",
          );
        }

        const pendingShop = normalizeShopDomain(install.shop_domain || "");
        console.info(
          `[Shopify OAuth] Callback received shop domain=${shop}; pending shop domain=${pendingShop || "none"}; storing shop domain=${shop}.`,
        );

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
            access_token: tokenJson.access_token,
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
