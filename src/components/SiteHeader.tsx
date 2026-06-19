import { Link } from "@tanstack/react-router";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { Menu, X, Sun, Moon } from "lucide-react";
import { useState, useEffect } from "react";

const navLinks = [
  { href: "/#home",     label: "Home"     },
  { href: "/#about",    label: "About"    },
  { href: "/#programs", label: "Programs" },
  { href: "/#trainers", label: "Trainers" },
  { href: "/#pricing",  label: "Pricing"  },
  { href: "/#contact",  label: "Contact"  },
];

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    return document.documentElement.classList.contains("dark");
  });
  function toggle() {
    if (typeof document === "undefined") return;
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch {}
  }
  return { dark, toggle };
}

export function SiteHeader() {
  const { user, role, loading } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { dark, toggle } = useDarkMode();
  // Hydration: show auth buttons only after client mounts to avoid SSR mismatch
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dashboardTo = role === "admin" ? "/admin" : role === "trainer" ? "/trainer" : "/dashboard";

  const AuthButtons = ({ mobile = false }) => {
    if (!mounted) return null;
    if (loading) return (
      <div className={`h-9 w-28 animate-pulse rounded-full bg-secondary ${mobile ? "w-full" : ""}`} />
    );
    return user ? (
      <Link to={dashboardTo} onClick={() => setMobileOpen(false)}>
        <Button className={`rounded-full px-5 ${mobile ? "w-full rounded-xl" : ""}`}>Dashboard</Button>
      </Link>
    ) : (
      <Link to="/auth" onClick={() => setMobileOpen(false)}>
        <Button className={`rounded-full px-6 ${mobile ? "w-full rounded-xl" : ""}`}>Login / Sign Up</Button>
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6">
        <Link to="/" onClick={() => setMobileOpen(false)}><Logo /></Link>

        <nav className="hidden items-center gap-7 md:flex">
          {navLinks.map(n => (
            <a key={n.label} href={n.href}
              className="text-sm font-medium text-foreground/70 transition hover:text-primary">{n.label}</a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {/* Dark mode toggle */}
          <button onClick={toggle} aria-label="Toggle dark mode"
            className="rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground transition">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <div className="hidden md:block"><AuthButtons /></div>
          <button className="rounded-lg border border-border p-2 md:hidden"
            onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle menu">
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-border bg-background px-6 py-4 md:hidden shadow-lg">
          <nav className="flex flex-col gap-1">
            {navLinks.map(n => (
              <a key={n.label} href={n.href} onClick={() => setMobileOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-foreground/80 transition hover:bg-secondary hover:text-primary">{n.label}</a>
            ))}
            <div className="mt-3 border-t border-border pt-3"><AuthButtons mobile /></div>
          </nav>
        </div>
      )}
    </header>
  );
}
