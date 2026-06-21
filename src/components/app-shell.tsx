import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/sonner";

export function AppShell({ children, title, search, onSearch, actions }: {
  children: ReactNode;
  title?: string;
  search?: string;
  onSearch?: (v: string) => void;
  actions?: ReactNode;
}) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-muted/30">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 border-b bg-background flex items-center gap-3 px-3 sticky top-0 z-30">
            <SidebarTrigger />
            {title && <h1 className="font-semibold text-sm hidden md:block">{title}</h1>}
            <div className="flex-1 max-w-md ml-2">
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search ?? ""}
                  onChange={(e) => onSearch?.(e.target.value)}
                  placeholder="Search orders, customers, SKUs…"
                  className="pl-8 h-9"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">{actions}</div>
          </header>
          <main className="flex-1 p-4 md:p-6 overflow-x-hidden">{children}</main>
        </div>
        <Toaster />
      </div>
    </SidebarProvider>
  );
}
