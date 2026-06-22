import { createFileRoute } from "@tanstack/react-router";
import { randomBytes } from "node:crypto";

function isValidShopDomain(d: string): boolean {
  // Accept only "<store>.myshopify.com" with safe chars.
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(d);
}

export const Route = createFileRoute("/api/shopify/auth/start")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const clientId = process.env.SHOPIFY_CLIENT_ID;
        const scopes = process.env.SHOPIFY_SCOPES;
        const defaultShop = process.env.SHOPIFY_SHOP_DOMAIN;

        if (!clientId) return new Response("Missing SHOPIFY_CLIENT_ID", { status: 500 });
        if (!scopes) return new Response("Missing SHOPIFY_SCOPES", { status: 500 });

        const url = new URL(request.url);
        let shop = (url.searchParams.get("shop") || defaultShop || "").trim().toLowerCase();
        shop = shop.replace(/^https?:\/\//, "").replace(/\/+$/, "");
        if (!shop) return new Response("Missing shop. Provide ?shop=<store>.myshopify.com or set SHOPIFY_SHOP_DOMAIN.", { status: 400 });
        if (!isValidShopDomain(shop)) {
          return new Response(`Invalid shop domain "${shop}". Must end with .myshopify.com`, { status: 400 });
        }

        const state = randomBytes(32).toString("hex");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Clean any old/expired states for tidiness (best-effort).
        await supabaseAdmin.from("shopify_oauth_states").delete().lt("expires_at", new Date().toISOString());
        const { error: insErr } = await supabaseAdmin
          .from("shopify_oauth_states")
          .insert({ state, shop_domain: shop });
        if (insErr) return new Response(`Failed to store OAuth state: ${insErr.message}`, { status: 500 });

        const redirectUri = `${url.origin}/api/shopify/auth/callback`;
        const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
        authorize.searchParams.set("client_id", clientId);
        authorize.searchParams.set("scope", scopes);
        authorize.searchParams.set("redirect_uri", redirectUri);
        authorize.searchParams.set("state", state);
        authorize.searchParams.set("grant_options[]", "");

        return Response.redirect(authorize.toString(), 302);
      },
    },
  },
});
