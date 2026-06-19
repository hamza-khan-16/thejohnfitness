import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

const ROLE_CACHE_KEY = "gym_user_role";

function getCachedRole(userId: string): string | null {
  try {
    const raw = sessionStorage.getItem(ROLE_CACHE_KEY);
    if (!raw) return null;
    const { id, role } = JSON.parse(raw);
    return id === userId ? role : null;
  } catch { return null; }
}

function setCachedRole(userId: string, role: string) {
  try {
    sessionStorage.setItem(ROLE_CACHE_KEY, JSON.stringify({ id: userId, role }));
  } catch {}
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // FIX: use getSession() not getUser() — getSession is local (reads from storage),
    // getUser() makes a network round-trip to verify the JWT. Much faster.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) throw redirect({ to: "/auth" });

    const userId = session.user.id;

    // FIX: Check sessionStorage cache first — avoids 2 DB round-trips on every page load
    const cached = getCachedRole(userId);
    if (cached) {
      // Still need to check request status for non-admins, but only if not cached as admin/trainer
      if (cached === "admin") return { user: session.user, role: "admin" };

      // For members/trainers: fetch approval status only (1 call instead of 2)
      const reqRes = await supabase
        .from("membership_requests")
        .select("status")
        .eq("user_id", userId)
        .maybeSingle();

      const requestStatus = reqRes.data?.status;
      if (requestStatus === "pending" || requestStatus === "rejected") {
        throw redirect({ to: "/auth", search: { blocked: requestStatus } });
      }

      return { user: session.user, role: cached };
    }

    // No cache — fetch role + request status in parallel (only on first load after login)
    const [roleRes, reqRes] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId).limit(5),
      supabase.from("membership_requests").select("status").eq("user_id", userId).maybeSingle(),
    ]);

    const roles = (roleRes.data ?? []).map(r => r.role as string);
    const role = roles.includes("admin") ? "admin"
      : roles.includes("trainer") ? "trainer"
      : roles.length > 0 ? "user"
      : null; // no role row at all = unverified signup slipped through
    const requestStatus = reqRes.data?.status;

    // Cache the resolved role for subsequent navigations
    if (role) setCachedRole(userId, role);

    // Admins always bypass approval
    if (role === "admin") return { user: session.user, role };

    // No role row = user signed up but hasn't verified OTP yet — block them
    if (!role) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth" });
    }

    // Pending or rejected — redirect without signing out (login page handles the UX)
    if (requestStatus === "pending" || requestStatus === "rejected") {
      throw redirect({ to: "/auth", search: { blocked: requestStatus } });
    }

    return { user: session.user, role };
  },
  component: () => <Outlet />,
});
