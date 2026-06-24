import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedRoute,
});

type AuthState = "checking" | "authenticated" | "guest";

function AuthenticatedRoute() {
  const navigate = useNavigate();
  const [authState, setAuthState] = useState<AuthState>("checking");

  useEffect(() => {
    let mounted = true;

    const handleUser = (hasUser: boolean) => {
      if (!mounted) return;
      if (!hasUser) {
        setAuthState("guest");
        navigate({ to: "/auth", replace: true });
        return;
      }
      setAuthState("authenticated");
    };

    supabase.auth.getUser().then(({ data, error }) => {
      handleUser(!error && !!data.user);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      handleUser(!!session?.user);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  if (authState !== "authenticated") {
    return (
      <div className="min-h-screen grid place-items-center bg-muted/30 p-4">
        <div className="text-sm text-muted-foreground">Checking access...</div>
      </div>
    );
  }

  return <Outlet />;
}
