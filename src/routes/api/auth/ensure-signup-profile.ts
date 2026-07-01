import { createFileRoute } from "@tanstack/react-router";

function normalizedEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export const Route = createFileRoute("/api/auth/ensure-signup-profile")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
        }

        const userId = String(body?.user_id ?? "").trim();
        const email = normalizedEmail(body?.email);
        const fullName = String(body?.full_name ?? "").trim();

        if (!userId) {
          return Response.json({ ok: false, error: "Signup did not return a user id." }, { status: 400 });
        }
        if (!email) {
          return Response.json({ ok: false, error: "Signup did not return an email." }, { status: 400 });
        }
        if (!fullName) {
          return Response.json({ ok: false, error: "Name is required." }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);
        if (authError || !authUser?.user) {
          return Response.json(
            {
              ok: false,
              error: authError?.message ?? "Could not verify the created Supabase Auth user.",
            },
            { status: 500 },
          );
        }

        const authEmail = normalizedEmail(authUser.user.email);
        if (authEmail !== email) {
          return Response.json(
            { ok: false, error: "Created Auth user email did not match the signup email." },
            { status: 400 },
          );
        }

        const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
          id: userId,
          full_name: fullName,
          email: authUser.user.email ?? email,
        } as never);
        if (profileError) {
          return Response.json({ ok: false, error: profileError.message }, { status: 500 });
        }

        const { error: roleError } = await supabaseAdmin
          .from("user_roles")
          .upsert({ user_id: userId, role: "viewer" } as never, { onConflict: "user_id,role" });
        if (roleError) {
          return Response.json({ ok: false, error: roleError.message }, { status: 500 });
        }

        return Response.json({ ok: true });
      },
    },
  },
});
