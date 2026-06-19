import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Logo } from "./Logo";
import { NotificationBell } from "./NotificationBell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut, ShieldCheck, Menu, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

// FIX #15: badge field for pending count in sidebar
export interface NavItem { to: string; label: string; icon: any; tab?: string; badge?: number; }

export function DashboardShell({ title, nav, children }: { title: string; nav: NavItem[]; children: ReactNode }) {
  const router = useRouter();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { user, role } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: profile } = useQuery({
    enabled: !!user,
    queryKey: ["profile", user?.id],
    queryFn: async () =>
      (await supabase.from("profiles").select("full_name,avatar_url").eq("id", user!.id).maybeSingle()).data,
  });

  async function signOut() {
    await supabase.auth.signOut();
    router.navigate({ to: "/" });
  }

  const displayName = profile?.full_name || user?.email?.split("@")[0] || "User";
  const initials = displayName.slice(0, 2).toUpperCase();

  const NavLinks = () => (
    <>
      {nav.map((n) => {
        const onThisRoute = path === n.to;
        const currentTab = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null;
        const active = onThisRoute && (!n.tab || currentTab === n.tab || (!currentTab && n.tab === "overview"));
        const Icon = n.icon;
        return (
          <Link key={n.label} to={n.to} search={n.tab ? { tab: n.tab } : undefined} onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
              active ? "bg-primary text-primary-foreground font-semibold" : "text-white/70 hover:bg-sidebar-accent hover:text-white"
            }`}>
            <Icon className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1">{n.label}</span>
            {n.badge != null && n.badge > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white px-1">
                {n.badge}
              </span>
            )}
          </Link>
        );
      })}
    </>
  );

  return (
    <div className="flex min-h-screen bg-secondary/30">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-shrink-0 flex-col bg-sidebar p-4 text-sidebar-foreground md:flex">
        <div className="px-2 py-4"><Logo light /></div>
        <nav className="mt-6 flex-1 space-y-1"><NavLinks /></nav>
        <div className="mt-4 rounded-xl border border-white/10 p-3">
          <div className="text-xs text-white/50 uppercase tracking-wider mb-1">Logged in as</div>
          <div className="text-sm font-semibold text-white truncate">{displayName}</div>
          <div className="text-xs text-primary capitalize">{role}</div>
        </div>
        <Button variant="ghost" onClick={signOut}
          className="mt-2 justify-start gap-3 text-white/70 hover:bg-sidebar-accent hover:text-white">
          <LogOut className="h-4 w-4" /> Logout
        </Button>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 flex flex-col bg-sidebar p-4 text-sidebar-foreground">
            <div className="flex items-center justify-between px-2 py-4">
              <Logo light />
              <button onClick={() => setMobileOpen(false)} className="text-white/70 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="mt-6 flex-1 space-y-1"><NavLinks /></nav>
            <Button variant="ghost" onClick={signOut}
              className="justify-start gap-3 text-white/70 hover:bg-sidebar-accent hover:text-white">
              <LogOut className="h-4 w-4" /> Logout
            </Button>
          </aside>
        </div>
      )}

      <main className="flex-1 min-w-0 flex flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border bg-background px-4 md:px-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)}
              className="rounded-lg border border-border p-2 md:hidden" aria-label="Menu">
              <Menu className="h-4 w-4" />
            </button>
            <h1 className="font-display text-xl md:text-3xl truncate">{title}</h1>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            {role === "admin" && path !== "/admin" && (
              <Button size="sm" className="hidden gap-2 md:flex"
                onClick={() => router.navigate({ to: "/admin" })}>
                <ShieldCheck className="h-4 w-4" /> Admin
              </Button>
            )}
            <NotificationBell />
            <div className="flex items-center gap-2 rounded-full border border-border bg-card px-2 py-1.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {initials}
              </div>
              <div className="hidden pr-1 text-sm leading-tight md:block">
                <div className="font-medium max-w-[120px] truncate">{displayName}</div>
                <div className="text-[10px] uppercase text-muted-foreground">{role}</div>
              </div>
            </div>
          </div>
        </header>
        <div className="flex-1 p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
