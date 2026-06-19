import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "trainer" | "user";

const ROLE_CACHE_KEY = "gym_user_role";

function getCachedRole(userId: string): AppRole | null {
  try {
    const raw = sessionStorage.getItem(ROLE_CACHE_KEY);
    if (!raw) return null;
    const { id, role } = JSON.parse(raw);
    return id === userId ? role : null;
  } catch { return null; }
}

function setCachedRole(userId: string, role: AppRole) {
  try { sessionStorage.setItem(ROLE_CACHE_KEY, JSON.stringify({ id: userId, role })); } catch {}
}

function clearCachedRole() {
  try { sessionStorage.removeItem(ROLE_CACHE_KEY); } catch {}
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        // getSession() is local — reads from storage, no network round trip
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setSession(data.session);
        const u = data.session?.user ?? null;
        setUser(u);
        if (u) {
          // Try cache first — instant, no DB call on page reload
          const cached = getCachedRole(u.id);
          if (cached) {
            setRole(cached);
            setLoading(false);
          } else {
            await fetchRole(u.id);
            if (mounted) setLoading(false);
          }
        } else {
          setLoading(false);
        }
      } catch (e) {
        console.error("[useAuth] init error", e);
        if (mounted) setLoading(false);
      }
    }

    init();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      if (!mounted) return;
      setSession(s);
      const u = s?.user ?? null;
      setUser(u);
      if (u) {
        const cached = getCachedRole(u.id);
        if (cached) {
          setRole(cached);
          setLoading(false);
        } else {
          await fetchRole(u.id);
          if (mounted) setLoading(false);
        }
      } else {
        setRole(null);
        clearCachedRole();
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function fetchRole(userId: string) {
    try {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .limit(5);
      const roles = (data ?? []).map(r => r.role as AppRole);
      const resolved: AppRole = roles.includes("admin") ? "admin"
        : roles.includes("trainer") ? "trainer"
        : "user";
      setRole(resolved);
      setCachedRole(userId, resolved);
    } catch {
      setRole("user");
    }
  }

  return { session, user, role, loading };
}
