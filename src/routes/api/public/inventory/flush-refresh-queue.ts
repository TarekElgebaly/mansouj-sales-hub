import { createFileRoute } from "@tanstack/react-router";
import { processInventoryRefreshQueue } from "@/lib/inventory-refresh-queue.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization",
};

// Called by pg_cron every 1 minute as a safety-net flush. Auth = Supabase anon
// key via `apikey` header (matches the documented cron pattern).
export const Route = createFileRoute("/api/public/inventory/flush-refresh-queue")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const supplied =
          request.headers.get("apikey") ||
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
          "";
        const expected =
          process.env.SUPABASE_PUBLISHABLE_KEY ||
          process.env.SUPABASE_ANON_KEY ||
          "";
        if (!expected || supplied !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const res = await processInventoryRefreshQueue(supabaseAdmin, { maxItems: 200 });
        return new Response(JSON.stringify({ ok: true, ...res }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS },
        });
      },
    },
  },
});
