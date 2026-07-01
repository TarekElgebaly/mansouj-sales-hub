import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AppRole = "admin" | "operations" | "finance" | "shipping" | "viewer";

export type AuthorizedRequest = {
  ok: true;
  supabaseAdmin: SupabaseClient<Database>;
  userId: string;
  email: string | null;
  roles: AppRole[];
};

export type UnauthorizedRequest = {
  ok: false;
  response: Response;
};

export function jsonForbidden() {
  return Response.json({ error: "Forbidden" }, { status: 403 });
}

export async function requireRoles(
  request: Request,
  allowedRoles: AppRole[],
): Promise<AuthorizedRequest | UnauthorizedRequest> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token) {
    return { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: roleRows, error: roleErr } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .in("role", allowedRoles);

  if (roleErr) {
    console.error("[authz] Could not load user roles", {
      user_id: userData.user.id,
      error: roleErr.message,
    });
    return { ok: false, response: jsonForbidden() };
  }

  const roles = (roleRows ?? []).map((row) => row.role as AppRole);
  if (!roles.some((role) => allowedRoles.includes(role))) {
    return { ok: false, response: jsonForbidden() };
  }

  return {
    ok: true,
    supabaseAdmin,
    userId: userData.user.id,
    email: userData.user.email ?? null,
    roles,
  };
}
