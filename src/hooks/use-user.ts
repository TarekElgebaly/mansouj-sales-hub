import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export type AppRole = "admin" | "operations" | "finance" | "shipping" | "viewer";
const ROLE_REFRESH_EVENT = "mansouj:roles-changed";

export function notifyRolesChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ROLE_REFRESH_EVENT));
  }
}

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRoles = useCallback(async (u: User | null) => {
    if (!u) {
      setRoles([]);
      return;
    }
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", u.id);
    setRoles((data ?? []).map((r) => r.role as AppRole));
  }, []);

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

  useEffect(() => {
    if (!user?.id) return;
    const refresh = () => loadRoles(user);
    window.addEventListener(ROLE_REFRESH_EVENT, refresh);
    const channel = supabase
      .channel(`user_roles:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles", filter: `user_id=eq.${user.id}` }, refresh)
      .subscribe();
    return () => {
      window.removeEventListener(ROLE_REFRESH_EVENT, refresh);
      supabase.removeChannel(channel);
    };
  }, [loadRoles, user]);

  const hasRole = (r: AppRole) => roles.includes(r);
  const canAdmin = hasRole("admin");
  const canOps = hasRole("admin") || hasRole("operations");
  const canFinance = hasRole("admin") || hasRole("finance");
  const canShipping = hasRole("admin") || hasRole("shipping");
  const canAccessOrders = canAdmin || hasRole("operations") || hasRole("finance") || hasRole("shipping") || hasRole("viewer");
  const canManageOrders = canAdmin || hasRole("operations");
  const canAccessCustomers = canAdmin || hasRole("operations") || hasRole("viewer");
  const canAccessInventory = canAdmin || hasRole("shipping") || hasRole("viewer");
  const canAccessFinance = canFinance;
  const canAccessDashboard = canAdmin || hasRole("operations") || hasRole("shipping") || hasRole("viewer");
  const canManageTeam = canAdmin;
  const canWrite = canManageOrders;

  return {
    user,
    roles,
    loading,
    hasRole,
    canAdmin,
    canOps,
    canFinance,
    canShipping,
    canWrite,
    canAccessOrders,
    canManageOrders,
    canAccessCustomers,
    canAccessInventory,
    canAccessFinance,
    canAccessDashboard,
    canManageTeam,
    refreshRoles: () => loadRoles(user),
  };
}
