import { createFileRoute } from "@tanstack/react-router";
import {
  getShopifyAdminAccessToken,
  getShopifyAdminTokenSource,
  getShopifyApiVersion,
  getShopifyDomainValidationError,
  missingScopes,
  normalizeShopDomain,
  validateShopDomain,
} from "@/lib/shopify-auth.server";
import { requireRoles } from "@/lib/route-auth.server";

type AccessScopeResponse = {
  access_scopes?: Array<{ handle: string }>;
};

type ShopResponse = {
  shop?: {
    domain?: string;
    myshopify_domain?: string;
  };
};

export const Route = createFileRoute("/api/shopify/test-connection")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRoles(request, ["admin", "operations"]);
        if (!auth.ok) return auth.response;
        const { supabaseAdmin } = auth;

        const configuredDomain = normalizeShopDomain(process.env.SHOPIFY_SHOP_DOMAIN || "");
        if (!configuredDomain) {
          return Response.json(
            {
              success: false,
              error: "Missing SHOPIFY_SHOP_DOMAIN in Lovable Secrets.",
            },
            { status: 500 },
          );
        }

        if (!validateShopDomain(configuredDomain)) {
          const message = getShopifyDomainValidationError(configuredDomain);
          await supabaseAdmin
            .from("shopify_sync_settings")
            .update({
              install_status: "invalid_shop_domain",
              last_connection_test_at: new Date().toISOString(),
              last_connection_test_status: "invalid_shop_domain",
              last_connection_test_error: message,
            } as never)
            .eq("id", 1);
          return Response.json(
            {
              success: false,
              shop_domain: configuredDomain,
              error: message,
            },
            { status: 400 },
          );
        }

        const accessToken = getShopifyAdminAccessToken();
        if (!accessToken) {
          const message =
            "Missing SHOPIFY_ADMIN_ACCESS_TOKEN in Lovable Secrets. SHOPIFY_ACCESS_TOKEN is supported only as a fallback.";
          await supabaseAdmin
            .from("shopify_sync_settings")
            .update({
              shop_domain: configuredDomain,
              store_url: configuredDomain,
              install_status: "missing_manual_token",
              token_stored: false,
              last_connection_test_at: new Date().toISOString(),
              last_connection_test_status: "missing_token",
              last_connection_test_error: message,
            } as never)
            .eq("id", 1);
          return Response.json(
            { success: false, shop_domain: configuredDomain, error: message },
            { status: 500 },
          );
        }

        const apiVersion = getShopifyApiVersion();
        const headers = { "X-Shopify-Access-Token": accessToken };

        try {
          const shopRes = await fetch(
            `https://${configuredDomain}/admin/api/${apiVersion}/shop.json`,
            { headers },
          );
          if (!shopRes.ok) {
            const text = await shopRes.text();
            const message =
              shopRes.status === 401
                ? "SHOPIFY_ADMIN_ACCESS_TOKEN was rejected by Shopify. Confirm the token belongs to this store and has Admin API access."
                : shopRes.status === 403
                  ? "SHOPIFY_ADMIN_ACCESS_TOKEN is valid but Shopify denied access to the shop endpoint. Check the custom app Admin API permissions."
                : shopRes.status === 404
                  ? `Shopify Admin API version or shop endpoint failed for ${configuredDomain} using API ${apiVersion}.`
                  : `Shopify shop test failed: ${shopRes.status} ${text.slice(0, 160)}`;
            await supabaseAdmin
              .from("shopify_sync_settings")
              .update({
                shop_domain: configuredDomain,
                store_url: configuredDomain,
                install_status: shopRes.status === 401 ? "invalid_manual_token" : "error",
                token_stored: shopRes.status === 401 ? false : true,
                last_connection_test_at: new Date().toISOString(),
                last_connection_test_status:
                  shopRes.status === 401
                    ? "invalid_token"
                    : shopRes.status === 403
                      ? "permission_denied"
                      : "error",
                last_connection_test_error: message,
              } as never)
              .eq("id", 1);
            return Response.json(
              { success: false, error: message },
              { status: shopRes.status === 401 ? 401 : shopRes.status === 403 ? 403 : 502 },
            );
          }

          const shopJson = (await shopRes.json()) as ShopResponse;
          const responseDomain = normalizeShopDomain(
            shopJson.shop?.myshopify_domain || shopJson.shop?.domain || "",
          );
          if (responseDomain && !validateShopDomain(responseDomain)) {
            const message = `Shopify responded from an unexpected Admin domain: ${responseDomain}.`;
            await supabaseAdmin
              .from("shopify_sync_settings")
              .update({
                shop_domain: configuredDomain,
                store_url: configuredDomain,
                install_status: "unexpected_shop_domain",
                last_connection_test_at: new Date().toISOString(),
                last_connection_test_status: "unexpected_shop_domain",
                last_connection_test_error: message,
              } as never)
              .eq("id", 1);
            return Response.json(
              {
                success: false,
                shop_domain: configuredDomain,
                shop_response_domain: responseDomain,
                error: message,
              },
              { status: 400 },
            );
          }

          const scopesRes = await fetch(
            `https://${configuredDomain}/admin/oauth/access_scopes.json`,
            { headers },
          );
          if (!scopesRes.ok) {
            const text = await scopesRes.text();
            const message =
              scopesRes.status === 401
                ? "SHOPIFY_ADMIN_ACCESS_TOKEN was rejected while reading scopes."
                : scopesRes.status === 403
                  ? "SHOPIFY_ADMIN_ACCESS_TOKEN is valid but cannot read granted scopes. Check the custom app Admin API permissions."
                : `Could not read granted scopes: ${scopesRes.status} ${text.slice(0, 160)}`;
            await supabaseAdmin
              .from("shopify_sync_settings")
              .update({
                shop_domain: configuredDomain,
                store_url: configuredDomain,
                install_status: scopesRes.status === 401 ? "invalid_manual_token" : "error",
                token_stored: scopesRes.status === 401 ? false : true,
                last_connection_test_at: new Date().toISOString(),
                last_connection_test_status:
                  scopesRes.status === 401
                    ? "invalid_token"
                    : scopesRes.status === 403
                      ? "permission_denied"
                      : "error",
                last_connection_test_error: message,
              } as never)
              .eq("id", 1);
            return Response.json(
              { success: false, error: message },
              { status: scopesRes.status === 401 ? 401 : scopesRes.status === 403 ? 403 : 502 },
            );
          }

          const scopesJson = (await scopesRes.json()) as AccessScopeResponse;
          const grantedScopes =
            scopesJson.access_scopes?.map((scope) => scope.handle).filter(Boolean) ?? [];
          const missing = missingScopes(grantedScopes);
          const success = missing.length === 0;
          const error = success ? null : `Missing required scopes: ${missing.join(", ")}`;

          await supabaseAdmin
            .from("shopify_sync_settings")
            .update({
              shop_domain: configuredDomain,
              store_url: configuredDomain,
              granted_scopes: grantedScopes,
              install_status: success ? "connected" : "connected_missing_scopes",
              token_stored: true,
              last_connection_test_at: new Date().toISOString(),
              last_connection_test_status: success ? "success" : "missing_scopes",
              last_connection_test_error: error,
            } as never)
            .eq("id", 1);

          return Response.json({
            success,
            shop_domain: configuredDomain,
            shop_response_domain: responseDomain || null,
            api_version: apiVersion,
            token_source: getShopifyAdminTokenSource(),
            granted_scopes: grantedScopes,
            missing_required_scopes: missing,
            error,
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await supabaseAdmin
            .from("shopify_sync_settings")
            .update({
              last_connection_test_at: new Date().toISOString(),
              last_connection_test_status: "error",
              last_connection_test_error: message,
            } as never)
            .eq("id", 1);
          return Response.json({ success: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
