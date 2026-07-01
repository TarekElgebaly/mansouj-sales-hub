import { createHash, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";

function secureEquals(received: string, expected: string) {
  const receivedHash = createHash("sha256").update(received).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(receivedHash, expectedHash);
}

function jsonError(error: string, status: number) {
  return Response.json({ ok: false, error }, { status });
}

export const Route = createFileRoute("/api/finance/unlock")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expectedPassword = process.env.FINANCE_ACCESS_PASSWORD;
        if (!expectedPassword) {
          return jsonError("Finance password is not configured.", 500);
        }

        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
        if (!token) {
          return jsonError("Unauthorized", 401);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: authUser, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !authUser.user) {
          return jsonError("Unauthorized", 401);
        }

        let body: { password?: unknown };
        try {
          body = await request.json();
        } catch {
          return jsonError("Invalid JSON body.", 400);
        }

        const password = typeof body.password === "string" ? body.password : "";
        if (!password || !secureEquals(password, expectedPassword)) {
          return jsonError("Incorrect password", 401);
        }

        return Response.json({ ok: true });
      },
    },
  },
});
