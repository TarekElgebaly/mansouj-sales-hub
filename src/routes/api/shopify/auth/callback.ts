import { createFileRoute } from "@tanstack/react-router";

const OAUTH_DISABLED_MESSAGE =
  "Shopify OAuth install flow is disabled. This app uses server-side Admin API token integration.";

function oauthGoneResponse() {
  return Response.json(
    {
      ok: false,
      error: OAUTH_DISABLED_MESSAGE,
    },
    { status: 410 },
  );
}

export const Route = createFileRoute("/api/shopify/auth/callback")({
  server: {
    handlers: {
      GET: async () => oauthGoneResponse(),
      POST: async () => oauthGoneResponse(),
    },
  },
});
