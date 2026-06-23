import { createFileRoute } from "@tanstack/react-router";
import {
  getShopifyApiVersion,
  getShopifyDomainValidationError,
  missingScopes,
  normalizeShopDomain,
  validateShopDomain,
} from "@/lib/shopify-auth.server";

type AccessScopeResponse = {
  access_scopes?: Array<{ handle: string }>;
};

async function requireOpsUser(request: Request) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token)
    return { ok: false as const, response: new Response("Unauthorized", { status: 401 }) };

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false as const, response: new Response("Unauthorized", { status: 401 }) };
  }

  const { data: roleRow } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .in("role", ["admin", "operations"])
    .maybeSingle();
  if (!roleRow) return { ok: false as const, response: new Response("Forbidden", { status: 403 }) };

  return { ok: true as const, supabaseAdmin };
}

export const Route = createFileRoute("/api/shopify/test-connection" as never)({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireOpsUser(request);
        if (!auth.ok) return auth.response;
        const { supabaseAdmin } = auth;

        const { data: installRow } = await supabaseAdmin
          .from("shopify_sync_settings")
          .select("*")
          .eq("id", 1)
          .maybeSingle();
        const install = installRow as {
          shop_domain?: string | null;
          access_token?: string | null;
          granted_scopes?: string[] | null;
          install_status?: string | null;
        } | null;

        if (!install?.shop_domain || !install?.access_token || install.access_token === "pending") {
          return Response.json(
            { success: false, error: "Invalid or expired token. Reinstall the Shopify app first." },
            { status: 400 },
          );
        }

        const installedDomain = normalizeShopDomain(install.shop_domain);
        if (!validateShopDomain(installedDomain)) {
          const message = getShopifyDomainValidationError(installedDomain);
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
              shop_domain: installedDomain,
              error: message,
            },
            { status: 400 },
          );
        }

        const apiVersion = getShopifyApiVersion();
        const headers = { "X-Shopify-Access-Token": install.access_token };

        try {
          const shopRes = await fetch(
            `https://${installedDomain}/admin/api/${apiVersion}/shop.json`,
            { headers },
          );
          if (!shopRes.ok) {
            const text = await shopRes.text();
            const message =
              shopRes.status === 401
                ? `Stored Shopify OAuth token was rejected for ${installedDomain}. Reinstall the Shopify app for this store so a fresh Admin API token can be saved.`
                : `Shopify shop test failed: ${shopRes.status} ${text.slice(0, 160)}`;
            await supabaseAdmin
              .from("shopify_sync_settings")
              .update({
                install_status:
                  shopRes.status === 401 ? "invalid_token_reinstall_required" : "error",
                token_stored: shopRes.status === 401 ? false : true,
                last_connection_test_at: new Date().toISOString(),
                last_connection_test_status: shopRes.status === 401 ? "invalid_token" : "error",
                last_connection_test_error: message,
              } as never)
              .eq("id", 1);
            return Response.json(
              { success: false, error: message },
              { status: shopRes.status === 401 ? 401 : 502 },
            );
          }

          const scopesRes = await fetch(
            `https://${installedDomain}/admin/oauth/access_scopes.json`,
            { headers },
          );
          if (!scopesRes.ok) {
            const text = await scopesRes.text();
            const message =
              scopesRes.status === 401
                ? `Stored Shopify OAuth token was rejected for ${installedDomain}. Reinstall the Shopify app for this store so a fresh Admin API token can be saved.`
                : `Could not read granted scopes: ${scopesRes.status} ${text.slice(0, 160)}`;
            await supabaseAdmin
              .from("shopify_sync_settings")
              .update({
                install_status:
                  scopesRes.status === 401 ? "invalid_token_reinstall_required" : "error",
                token_stored: scopesRes.status === 401 ? false : true,
                last_connection_test_at: new Date().toISOString(),
                last_connection_test_status: scopesRes.status === 401 ? "invalid_token" : "error",
                last_connection_test_error: message,
              } as never)
              .eq("id", 1);
            return Response.json(
              { success: false, error: message },
              { status: scopesRes.status === 401 ? 401 : 502 },
            );
          }

          const scopesJson = (await scopesRes.json()) as AccessScopeResponse;
          const grantedScopes =
            scopesJson.access_scopes?.map((scope) => scope.handle).filter(Boolean) ??
            install.granted_scopes ??
            [];
          const missing = missingScopes(grantedScopes);
          const success = missing.length === 0;
          const error = success ? null : `Missing required scopes: ${missing.join(", ")}`;

          await supabaseAdmin
            .from("shopify_sync_settings")
            .update({
              granted_scopes: grantedScopes,
              install_status: success ? "connected" : "connected_missing_scopes",
              last_connection_test_at: new Date().toISOString(),
              last_connection_test_status: success ? "success" : "missing_scopes",
              last_connection_test_error: error,
            } as never)
            .eq("id", 1);

          return Response.json({
            success,
            shop_domain: installedDomain,
            api_version: apiVersion,
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
