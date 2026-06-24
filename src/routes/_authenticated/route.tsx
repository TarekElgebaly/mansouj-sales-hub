import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedRoute,
});

type AuthState = "checking" | "authenticated" | "guest";

function AuthenticatedRoute() {
  const [authState, setAuthState] = useState<AuthState>("checking");

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    const handleUser = (hasUser: boolean) => {
      if (!mounted) return;
      if (!hasUser) {
        setAuthState("guest");
        window.location.replace("/auth");
        return;
      }
      setAuthState("authenticated");
    };

    import("@/integrations/supabase/client")
      .then(({ supabase }) => {
        if (!mounted) return;

        supabase.auth
          .getUser()
          .then(({ data, error }) => {
            handleUser(!error && !!data.user);
          })
          .catch(() => handleUser(false));

        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
          handleUser(!!session?.user);
        });
        unsubscribe = () => sub.subscription.unsubscribe();
      })
      .catch(() => handleUser(false));

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  if (authState !== "authenticated") {
    return (
      <div className="min-h-screen grid place-items-center bg-muted/30 p-4">
        <div className="text-sm text-muted-foreground">Checking access...</div>
      </div>
    );
  }

  return <Outlet />;
}
