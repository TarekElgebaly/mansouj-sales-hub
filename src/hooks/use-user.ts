import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export type AppRole = "admin" | "operations" | "finance" | "shipping" | "viewer";

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const load = async (u: User | null) => {
      if (!u) {
        if (mounted) {
          setUser(null);
          setRoles([]);
          setLoading(false);
        }
        return;
      }
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", u.id);
      if (!mounted) return;
      setUser(u);
      setRoles((data ?? []).map((r) => r.role as AppRole));
      setLoading(false);
    };

    supabase.auth.getUser().then(({ data }) => load(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      load(session?.user ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const hasRole = (r: AppRole) => roles.includes(r);
  const canOps = hasRole("admin") || hasRole("operations");
  const canFinance = hasRole("admin") || hasRole("finance");
  const canShipping = hasRole("admin") || hasRole("shipping") || hasRole("operations");
  const canWrite = canOps || canFinance || canShipping;

  return { user, roles, loading, hasRole, canOps, canFinance, canShipping, canWrite };
}
