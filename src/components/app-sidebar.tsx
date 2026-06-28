import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, ShoppingBag, Users, Package, MapPin, DollarSign,
  RefreshCw, FileUp, Settings as SettingsIcon, LogOut,
} from "lucide-react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  useSidebar } from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";
import { useUser } from "@/hooks/use-user";

const items = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, permission: "dashboard" },
  { title: "Orders", url: "/orders", icon: ShoppingBag, permission: "orders" },
  { title: "Customers", url: "/customers", icon: Users, permission: "customers" },
  { title: "Inventory", url: "/inventory", icon: Package, permission: "inventory" },
  { title: "Areas", url: "/areas", icon: MapPin, permission: "admin" },
  { title: "Finance", url: "/finance", icon: DollarSign, permission: "finance" },
] as const;

const integrations = [
  { title: "Shopify Sync", url: "/shopify", icon: RefreshCw, permission: "admin" },
  { title: "Airtable Import", url: "/import", icon: FileUp, permission: "admin" },
  { title: "Settings", url: "/settings", icon: SettingsIcon, permission: "settings" },
] as const;

export function AppSidebar() {
  const { state } = useSidebar();
  const permissions = useUser();
  const collapsed = state === "collapsed";
  const path = useRouterState({ select: (r) => r.location.pathname });
  const allowed = (permission: (typeof items[number] | typeof integrations[number])["permission"]) => {
    switch (permission) {
      case "admin": return permissions.canAdmin;
      case "dashboard": return permissions.canAccessDashboard;
      case "orders": return permissions.canAccessOrders;
      case "customers": return permissions.canAccessCustomers;
      case "inventory": return permissions.canAccessInventory;
      case "finance": return permissions.canAccessFinance;
      case "settings": return true;
      default: return false;
    }
  };
  const visibleItems = items.filter((it) => allowed(it.permission));
  const visibleIntegrations = integrations.filter((it) => allowed(it.permission));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground grid place-items-center font-bold">M</div>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="font-semibold text-sm">Mansouj</span>
              <span className="text-[10px] text-muted-foreground">Sales Primary</span>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((it) => (
                <SidebarMenuItem key={it.url}>
                  <SidebarMenuButton asChild isActive={path.startsWith(it.url)}>
                    <Link to={it.url}><it.icon className="h-4 w-4" />{!collapsed && <span>{it.title}</span>}</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>System</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleIntegrations.map((it) => (
                <SidebarMenuItem key={it.url}>
                  <SidebarMenuButton asChild isActive={path.startsWith(it.url)}>
                    <Link to={it.url}><it.icon className="h-4 w-4" />{!collapsed && <span>{it.title}</span>}</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={async () => { await supabase.auth.signOut(); window.location.href = "/auth"; }}>
              <LogOut className="h-4 w-4" />{!collapsed && <span>Sign out</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
