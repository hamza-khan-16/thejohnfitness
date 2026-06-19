import { createFileRoute } from "@tanstack/react-router";
import { claimAdminRole, resetMembershipRequest, hardDeleteUser, getExpiringMemberships, getMembersWithPlanInfo, getPendingCashPayments, approveCashPayment, rejectCashPayment } from "@/lib/admin.functions";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardShell, type NavItem } from "@/components/DashboardShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  LayoutDashboard, Users, Dumbbell, CreditCard,
  BarChart3, ShieldCheck, Trash2, Plus, IndianRupee, Edit2,
  Check, X, Eye, Calendar, UserMinus, Globe2, AlertTriangle,
  UserPlus, MessageCircle, Bell, Banknote, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab as string) || "overview",
  }),
  component: AdminDashboard,
});

const nav: NavItem[] = [
  { to: "/admin", label: "Overview",        icon: LayoutDashboard, tab: "overview"  },
  { to: "/admin", label: "Requests",        icon: UserPlus,        tab: "requests"  },
  { to: "/admin", label: "Cash Payments",   icon: Banknote,        tab: "cash"      },
  { to: "/admin", label: "Members",         icon: Users,           tab: "members"   },
  { to: "/admin", label: "Trainers",        icon: Dumbbell,        tab: "trainers"  },
  { to: "/admin", label: "Plans & Pricing", icon: BarChart3,       tab: "plans"     },
  { to: "/admin", label: "Fees",            icon: CreditCard,      tab: "fees"      },
  { to: "/admin", label: "Reminders",       icon: Bell,            tab: "reminders" },
  { to: "/admin", label: "Audit",           icon: ShieldCheck,     tab: "audit"     },
];

type AppRole = "admin" | "trainer" | "user";

// ── helpers ───────────────────────────────────────────────────
function validate(v: string, field: string, min?: number, max?: number) {
  const t = v.trim();
  if (!t) return `${field} is required`;
  if (min !== undefined && t.length < min) return `${field} must be at least ${min} chars`;
  if (max !== undefined && t.length > max) return `${field} must be under ${max} chars`;
  return null;
}

function AdminDashboard() {
  const { role, loading, user } = useAuth();
  const navigate = Route.useNavigate();

  useEffect(() => {
    if (!loading && role && role !== "admin") navigate({ to: role === "trainer" ? "/trainer" : "/dashboard" });
  }, [role, loading]);

  // Guard: render nothing while auth loads, or if not admin (redirect happens in useEffect)
  if (loading) return <AdminSkeleton />;
  if (!role || role !== "admin") return null;

  return <AdminDashboardInner />;
}

function AdminDashboardInner() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();

  // State
  const [editPlan, setEditPlan] = useState<null | { id: string; name: string; price: string; duration_days: string; features: string; has_trainer: boolean }>(null);
  const [viewUser, setViewUser] = useState<null | string>(null);
  const [np, setNp] = useState({ name: "", price: "", duration_days: "30", features: "", has_trainer: false });
  const [npErr, setNpErr] = useState<Record<string, string>>({});
  const [assignTrainerId, setAssignTrainerId] = useState("");
  const [assignMemberId, setAssignMemberId] = useState("");

  // ── queries ────────────────────────────────────────────────
  const { data: requests, isLoading: requestsLoading } = useQuery({
    queryKey: ["membership-requests"],
    queryFn: async () => {
      const { data, error } = await supabase.from("membership_requests")
        .select("*").order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    refetchInterval: () => document.visibilityState === "visible" ? 30_000 : false,
  });

  const pendingCount = (requests ?? []).filter(r => r.status === "pending").length;

  const resetRequest = useMutation({
    mutationFn: async (requestId: string) => {
      await resetMembershipRequest({ data: { requestId } });
    },
    onSuccess: () => {
      toast.success("Account fully removed — they can now sign up fresh with the same email.");
      qc.invalidateQueries({ queryKey: ["membership-requests"] });
      qc.invalidateQueries({ queryKey: ["admin-members"] });
      qc.invalidateQueries({ queryKey: ["admin-trainers"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});

  const approveRequest = useMutation({
    mutationFn: async ({ requestId, userId, role }: { requestId: string; userId: string; role: string }) => {
      // Update request status
      const { error: reqErr } = await supabase.from("membership_requests")
        .update({ status: "approved", reviewed_at: new Date().toISOString() })
        .eq("id", requestId);
      if (reqErr) throw new Error(reqErr.message);

      // Always set role correctly — trigger no longer inserts user_roles on signup
      // Remove any existing role for this user first, then insert the approved role
      await supabase.from("user_roles").delete().eq("user_id", userId);
      const approvedRole = role === "trainer" ? "trainer" : "user";
      const { error: roleErr } = await supabase.from("user_roles")
        .insert({ user_id: userId, role: approvedRole });
      if (roleErr && !roleErr.message.includes("duplicate")) throw new Error(roleErr.message);

      await supabase.from("notifications").insert({
        user_id: userId,
        title: "Account Approved!",
        message: `Your ${approvedRole} account has been approved. You can now log in to The John Fitness app.`,
        type: "success",
      }).then(() => {});

      await supabase.from("admin_promotions").insert({
        user_id: userId, flow: "admin_approval",
        reason: `approved_as_${approvedRole}`, user_email: null,
      }).then(() => {});
    },
    onSuccess: () => {
      toast.success("Request approved — user can now log in.");
      qc.invalidateQueries({ queryKey: ["membership-requests"] });
      qc.invalidateQueries({ queryKey: ["admin-members"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectRequest = useMutation({
    mutationFn: async ({ requestId, userId, reason }: { requestId: string; userId: string; reason: string }) => {
      const { error } = await supabase.from("membership_requests")
        .update({ status: "rejected", reject_reason: reason || null, reviewed_at: new Date().toISOString() })
        .eq("id", requestId);
      if (error) throw new Error(error.message);

      // Audit log
      await supabase.from("admin_promotions").insert({
        user_id: userId, flow: "admin_approval",
        reason: "rejected", user_email: null,
      }).then(() => {});
    },
    onSuccess: () => {
      toast.success("Request rejected.");
      qc.invalidateQueries({ queryKey: ["membership-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // FIX #19: query lives in parent, not in ExpiringMembersAlert child component
  const { data: expiringMemberships = [], isLoading: remindersLoading, error: remindersError, refetch: refetchReminders } = useQuery({
    enabled: tab === "overview" || tab === "reminders",
    queryKey: ["expiring-memberships"],
    queryFn: () => getExpiringMemberships(),
    retry: 1,
  });

  // ── Cash payments awaiting approval ───────────────────────────────────────
  const { data: pendingCashPayments = [], isLoading: cashLoading, error: cashError, refetch: refetchCash } = useQuery({
    enabled: tab === "overview" || tab === "cash",
    queryKey: ["pending-cash-payments"],
    queryFn: () => getPendingCashPayments(),
    retry: 1,
  });

  const approveCash = useMutation({
    mutationFn: async (feeId: string) => { await approveCashPayment({ data: { feeId } }); },
    onSuccess: () => {
      toast.success("Cash payment approved — plan is now active.");
      qc.invalidateQueries({ queryKey: ["pending-cash-payments"] });
      qc.invalidateQueries({ queryKey: ["all-fees"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      qc.invalidateQueries({ queryKey: ["expiring-memberships"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectCash = useMutation({
    mutationFn: async (feeId: string) => { await rejectCashPayment({ data: { feeId } }); },
    onSuccess: () => {
      toast.success("Cash payment request rejected.");
      qc.invalidateQueries({ queryKey: ["pending-cash-payments"] });
      qc.invalidateQueries({ queryKey: ["all-fees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // FIX #19: lazy load fees only when tab active
  const { data: stats } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const [mem, tr, paid, plans] = await Promise.all([
        supabase.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "user"),
        supabase.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "trainer"),
        supabase.from("fees").select("amount").eq("status", "paid"),
        supabase.from("plans").select("*"),
      ]);
      return {
        members: mem.count ?? 0, trainers: tr.count ?? 0,
        revenue: (paid.data ?? []).reduce((s, f) => s + Number(f.amount), 0),
        plans: plans.data ?? [],
      };
    },
  });

  const { data: members } = useQuery({
    queryKey: ["admin-members"],
    queryFn: async () => {
      const { data: roleRows } = await supabase.from("user_roles").select("user_id").eq("role", "user");
      const userIds = (roleRows ?? []).map(r => r.user_id);
      if (!userIds.length) return [];

      // Exclude users whose membership request is still pending or was rejected —
      // only show approved members (or legacy users with no request at all)
      const { data: rejectedOrPending } = await supabase
        .from("membership_requests")
        .select("user_id")
        .in("user_id", userIds)
        .in("status", ["rejected", "pending"]);
      const excludedIds = new Set((rejectedOrPending ?? []).map(r => r.user_id));
      const approvedIds = userIds.filter(id => !excludedIds.has(id));
      if (!approvedIds.length) return [];

      const { data: profiles } = await supabase.from("profiles").select("id,full_name,phone,created_at").in("id", approvedIds).order("created_at", { ascending: false });
      return (profiles ?? []).map(p => ({ ...p, role: "user" as AppRole }));
    },
  });

  const { data: trainers } = useQuery({
    queryKey: ["admin-trainers"],
    queryFn: async () => {
      const { data: roleRows } = await supabase.from("user_roles").select("user_id").eq("role", "trainer");
      const ids = (roleRows ?? []).map(r => r.user_id);
      if (!ids.length) return [];
      const { data: profiles } = await supabase.from("profiles").select("id,full_name,phone,created_at").in("id", ids).order("created_at", { ascending: false });
      return profiles ?? [];
    },
  });

  // Members enriched with has_trainer_plan flag — used for assignment dropdown
  const { data: membersWithPlan = [] } = useQuery({
    enabled: tab === "trainers",
    queryKey: ["members-with-plan"],
    queryFn: () => getMembersWithPlanInfo(),
  });

  // ── Trainer assignments ───────────────────────────────────────
  // FIX #20: filter trainer_assignments — only fetch, admin sees all
  const { data: assignments } = useQuery({
    queryKey: ["trainer-assignments"],
    queryFn: async () => (await supabase.from("trainer_assignments").select("trainer_id, member_id, id")).data ?? [],
  });

  const assignMember = useMutation({
    mutationFn: async ({ trainerId, memberId }: { trainerId: string; memberId: string }) => {
      // Enforce one-trainer-per-member: check if member is already assigned to any trainer
      const { data: existing } = await supabase
        .from("trainer_assignments")
        .select("trainer_id")
        .eq("member_id", memberId)
        .limit(1)
        .maybeSingle();
      if (existing) {
        throw new Error("This member is already assigned to a trainer. Unassign them first before reassigning.");
      }
      const { error } = await supabase.from("trainer_assignments").insert({ trainer_id: trainerId, member_id: memberId });
      if (error && !error.message.includes("unique")) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Member assigned"); qc.invalidateQueries({ queryKey: ["trainer-assignments"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const unassignMember = useMutation({
    mutationFn: async ({ trainerId, memberId }: { trainerId: string; memberId: string }) => {
      const { error } = await supabase.from("trainer_assignments").delete().eq("trainer_id", trainerId).eq("member_id", memberId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Member unassigned"); qc.invalidateQueries({ queryKey: ["trainer-assignments"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Home-page trainer cards (trainer_profiles table) ──────────
  const { data: trainerCards } = useQuery({
    queryKey: ["trainer-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trainer_profiles").select("*").order("display_order");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  type TrainerCard = { id?: string; name: string; specialisation: string; experience: string; certification: string; bio: string; display_order: number; is_visible: boolean };
  const emptyCard: TrainerCard = { name: "", specialisation: "", experience: "", certification: "", bio: "", display_order: 0, is_visible: true };
  const [editCard, setEditCard] = useState<TrainerCard | null>(null);
  const [showCardForm, setShowCardForm] = useState(false);
  const [newCard, setNewCard] = useState<TrainerCard>(emptyCard);

  const saveCard = useMutation({
    mutationFn: async (card: TrainerCard) => {
      if (!card.name.trim()) throw new Error("Name is required");
      const payload = { name: card.name.trim(), specialisation: card.specialisation.trim(), experience: card.experience.trim(), certification: card.certification.trim(), bio: card.bio.trim(), display_order: card.display_order, is_visible: card.is_visible, updated_at: new Date().toISOString() };
      if (card.id) {
        const { error } = await supabase.from("trainer_profiles").update(payload).eq("id", card.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("trainer_profiles").insert({ ...payload, user_id: user?.id ?? "" });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: (_data, card) => {
      toast.success(card.id ? "Trainer card updated" : "Trainer card added");
      setEditCard(null); setShowCardForm(false); setNewCard(emptyCard);
      qc.invalidateQueries({ queryKey: ["trainer-profiles"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteCard = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("trainer_profiles").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Trainer card removed"); qc.invalidateQueries({ queryKey: ["trainer-profiles"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleCardVisibility = useMutation({
    mutationFn: async ({ id, is_visible }: { id: string; is_visible: boolean }) => {
      const { error } = await supabase.from("trainer_profiles").update({ is_visible }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trainer-profiles"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  // FIX: use "plans-admin" — the dashboard uses queryKey ["plans"] with .eq("is_active", true).
  // Sharing the same key means whichever query runs last overwrites the other's cache, causing
  // inactive plans to appear in the dashboard or active-only plans to appear in the admin list.
  const { data: plans } = useQuery({
    queryKey: ["plans-admin"],
    queryFn: async () => (await supabase.from("plans").select("*").order("price")).data ?? [],
  });

  // FIX #19: lazy load — only fetch when the relevant tab is active
  const { data: fees } = useQuery({
    enabled: tab === "fees" || tab === "overview",
    queryKey: ["all-fees"],
    queryFn: async () => (await supabase.from("fees").select("*,plans(name)").order("created_at", { ascending: false }).limit(200)).data ?? [],
  });
  const { data: feesTotal = 0 } = useQuery({
    enabled: tab === "fees",
    queryKey: ["all-fees-count"],
    queryFn: async () => (await supabase.from("fees").select("*", { count: "exact", head: true })).count ?? 0,
  });

  const { data: allAttendance } = useQuery({
    enabled: tab === "trainers",
    queryKey: ["all-attendance"],
    queryFn: async () => (await supabase.from("attendance").select("*").order("date", { ascending: false }).limit(100)).data ?? [],
  });
  const { data: attendanceTotal = 0 } = useQuery({
    enabled: tab === "trainers",
    queryKey: ["all-attendance-count"],
    queryFn: async () => (await supabase.from("attendance").select("*", { count: "exact", head: true })).count ?? 0,
  });

  // User detail (fees + attendance + membership)
  const { data: userDetail } = useQuery({
    enabled: !!viewUser,
    queryKey: ["user-detail", viewUser],
    queryFn: async () => {
      const [profile, membership, userFees, userAtt] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", viewUser!).maybeSingle(),
        supabase.from("memberships").select("*,plans(name)").eq("user_id", viewUser!).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("fees").select("*,plans(name)").eq("user_id", viewUser!).order("created_at", { ascending: false }),
        supabase.from("attendance").select("*").eq("user_id", viewUser!).order("date", { ascending: false }).limit(366),
      ]);
      return { profile: profile.data, membership: membership.data, fees: userFees.data ?? [], attendance: userAtt.data ?? [] };
    },
  });

  // FIX: query admin_promotions directly — the server fn requires an auth header that the client
  // doesn't send, causing "Unauthorized: No authorization header" on every admin page load.
  // The table's RLS already restricts reads to admins, so a direct client call is both safe and correct.
  const { data: promos } = useQuery({
    queryKey: ["admin-promotions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_promotions")
        .select("id, user_id, user_email, flow, reason, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return { promotions: data ?? [] };
    },
  });

  // ── mutations ──────────────────────────────────────────────
  const createPlan = useMutation({
    mutationFn: async () => {
      const errs: Record<string, string> = {};
      if (!np.name.trim()) errs.name = "Name is required";
      if (!np.price || isNaN(Number(np.price)) || Number(np.price) <= 0) errs.price = "Enter a valid price";
      if (!np.duration_days || isNaN(Number(np.duration_days)) || Number(np.duration_days) < 1) errs.duration_days = "Min 1 day";
      if (Object.keys(errs).length) { setNpErr(errs); throw new Error("Validation failed"); }
      setNpErr({});
      const { error } = await supabase.from("plans").insert({
        name: np.name.trim(),
        price: Number(np.price),
        duration_days: Number(np.duration_days),
        features: np.features.split(",").map(f => f.trim()).filter(Boolean),
        has_trainer: np.has_trainer,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Plan created");
      setNp({ name: "", price: "", duration_days: "30", features: "", has_trainer: false });
      qc.invalidateQueries({ queryKey: ["plans-admin"] });
      qc.invalidateQueries({ queryKey: ["plans"] }); // bust dashboard active-plans cache too
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
    },
    onError: (e: Error) => { if (e.message !== "Validation failed") toast.error(e.message); },
  });

  const savePlan = useMutation({
    mutationFn: async () => {
      if (!editPlan) return;
      if (!editPlan.name.trim()) { toast.error("Name required"); return; }
      if (!editPlan.price || Number(editPlan.price) <= 0) { toast.error("Enter valid price"); return; }
      const { error } = await supabase.from("plans").update({
        name: editPlan.name.trim(),
        price: Number(editPlan.price),
        duration_days: Number(editPlan.duration_days) || 30,
        features: editPlan.features.split(",").map(f => f.trim()).filter(Boolean),
        has_trainer: editPlan.has_trainer ?? false,
        updated_at: new Date().toISOString(),
      }).eq("id", editPlan.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Plan updated");
      setEditPlan(null);
      qc.invalidateQueries({ queryKey: ["plans-admin"] });
      qc.invalidateQueries({ queryKey: ["plans"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const togglePlan = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("plans").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans-admin"] });
      qc.invalidateQueries({ queryKey: ["plans"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deletePlan = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("plans").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Plan deleted");
      qc.invalidateQueries({ queryKey: ["plans-admin"] });
      qc.invalidateQueries({ queryKey: ["plans"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: "user" | "trainer" }) => {
      // FIX #7: only delete the old role we're replacing, never touch admin
      const oldRole = newRole === "trainer" ? "user" : "trainer";
      await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", oldRole);
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: newRole });
      if (error && !error.message.includes("duplicate")) throw error;
      // FIX #22: audit log role changes
      supabase.from("admin_promotions").insert({
        user_id: userId, flow: "admin_panel",
        reason: `role_changed_to_${newRole}`, user_email: null,
      }).then(() => {});
    },
    onSuccess: () => {
      toast.success("Role updated");
      qc.invalidateQueries({ queryKey: ["admin-members"] });
      qc.invalidateQueries({ queryKey: ["admin-trainers"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeUser = useMutation({
    mutationFn: async (userId: string) => {
      await hardDeleteUser({ data: { userId } });
    },
    onSuccess: () => {
      toast.success("User permanently removed");
      qc.invalidateQueries({ queryKey: ["admin-members"] });
      qc.invalidateQueries({ queryKey: ["admin-trainers"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      qc.invalidateQueries({ queryKey: ["members-with-plan"] });
      qc.invalidateQueries({ queryKey: ["trainer-assignments"] });
    },
    onError: (e: Error) => {
      console.error("[hardDeleteUser error]", e);
      toast.error("Delete failed: " + e.message);
    },
  });

  const sendNotif = useMutation({
    mutationFn: async ({ userId, title, message, type }: { userId: string; title: string; message: string; type: string }) => {
      const { error } = await supabase.from("notifications").insert({ user_id: userId, title, message, type });
      if (error) throw error;
    },
    onSuccess: () => toast.success("Notification sent"),
    onError: (e: Error) => toast.error(e.message),
  });

  const nameById = (id: string) => {
    const all = [...(members ?? []), ...(trainers ?? [])];
    return all.find(p => p.id === id)?.full_name || id.slice(0, 8);
  };

  return (
    <DashboardShell title="Admin" nav={nav.map(n => n.tab === "requests" ? { ...n, badge: pendingCount } : n.tab === "cash" ? { ...n, badge: pendingCashPayments.length } : n)}>
      <Tabs value={tab} onValueChange={(v) => navigate({ search: { tab: v } })}>
        <div className="overflow-x-auto">
          <TabsList className="mb-6 w-max">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="requests" className="relative gap-1.5">
              Requests
              {pendingCount > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {pendingCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="cash" className="relative gap-1.5">
              Cash Payments
              {pendingCashPayments.length > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                  {pendingCashPayments.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="members">Members ({members?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="trainers">Trainers ({trainers?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="plans">Plans</TabsTrigger>
            <TabsTrigger value="fees">Fees</TabsTrigger>
            <TabsTrigger value="reminders" className="relative gap-1.5">
              Reminders
              {expiringMemberships.length > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                  {expiringMemberships.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
          </TabsList>
        </div>

        {/* ── OVERVIEW ─────────────────────────────────────── */}
        <TabsContent value="overview">
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-6">
            {[
              { label: "Members", value: stats?.members ?? 0, color: "text-blue-500" },
              { label: "Trainers", value: stats?.trainers ?? 0, color: "text-purple-500" },
              { label: "Active Plans", value: stats?.plans.filter((p: any) => p.is_active).length ?? 0, color: "text-primary" },
              { label: "Total Revenue", value: `₹${(stats?.revenue ?? 0).toLocaleString("en-IN")}`, color: "text-green-500" },
            ].map(c => (
              <div key={c.label} className="rounded-2xl border border-border bg-card p-5">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</div>
                <div className={`mt-3 font-display text-3xl ${c.color}`}>{c.value}</div>
              </div>
            ))}
          </div>

          {/* Expiring memberships — see Reminders tab */}

          {pendingCashPayments.length > 0 && (
            <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Banknote className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    {pendingCashPayments.length} cash payment{pendingCashPayments.length !== 1 ? "s" : ""} awaiting your approval
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-400">Confirm in the Cash Payments tab once you've received the money in person.</p>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => navigate({ search: { tab: "cash" } })}>Review</Button>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="mb-3 font-semibold flex items-center gap-2">
              <IndianRupee className="h-4 w-4 text-primary" /> Recent Payments
            </h3>
            <div className="space-y-2">
              {(fees ?? []).slice(0, 6).map((f: any) => (
                <div key={f.id} className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
                  <div className="font-medium">{nameById(f.user_id)}</div>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground text-xs">{f.plans?.name ?? "-"}</span>
                    <span className="font-semibold">₹{Number(f.amount).toLocaleString("en-IN")}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${f.status === "paid" ? "bg-green-500/15 text-green-600" : "bg-amber-500/15 text-amber-600"}`}>{f.status}</span>
                  </div>
                </div>
              ))}
              {(!fees || fees.length === 0) && <p className="text-sm text-muted-foreground">No payments yet.</p>}
            </div>
          </div>
        </TabsContent>

        {/* ── REQUESTS ──────────────────────────────────────── */}
        <TabsContent value="requests">
          {requestsLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 animate-pulse rounded-2xl bg-secondary" />)}</div>
          ) : (requests ?? []).length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
              <Users className="mx-auto h-10 w-10 mb-3 opacity-30" />
              <p className="font-medium">No requests yet</p>
              <p className="text-sm mt-1">New signup requests will appear here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Pending first, then the rest */}
              {[...(requests ?? [])].sort((a, b) => {
                const order = { pending: 0, approved: 1, rejected: 2 };
                return (order[a.status as keyof typeof order] ?? 3) - (order[b.status as keyof typeof order] ?? 3);
              }).map((req: any) => (
                <div key={req.id} className={`rounded-2xl border bg-card p-5 ${req.status === "pending" ? "border-amber-300 dark:border-amber-700" : req.status === "approved" ? "border-green-300 dark:border-green-800 opacity-70" : "border-red-300 dark:border-red-800 opacity-70"}`}>
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{req.full_name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
                          req.status === "pending" ? "bg-amber-500/15 text-amber-600" :
                          req.status === "approved" ? "bg-green-500/15 text-green-600" :
                          "bg-red-500/15 text-red-600"
                        }`}>{req.status}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${req.role === "trainer" ? "bg-purple-500/15 text-purple-600" : "bg-blue-500/15 text-blue-600"}`}>
                          {req.role === "trainer" ? "Trainer" : "Member"}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">{req.email}</div>
                      <div className="text-xs text-muted-foreground">{req.phone} · Requested {new Date(req.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
                      {req.status === "rejected" && req.reject_reason && (
                        <div className="mt-2 rounded-lg bg-red-50 dark:bg-red-950/30 px-3 py-1.5 text-xs text-red-700 dark:text-red-400">
                          Reason: {req.reject_reason}
                        </div>
                      )}
                    </div>

                    {req.status === "pending" && (
                      <div className="flex flex-col gap-2 w-full sm:w-auto sm:min-w-[220px]">
                        <Button size="sm" onClick={() => approveRequest.mutate({ requestId: req.id, userId: req.user_id, role: req.role })}
                          disabled={approveRequest.isPending} className="bg-green-600 hover:bg-green-700 text-white gap-1.5">
                          <Check className="h-3.5 w-3.5" /> Approve
                        </Button>
                        <div className="flex gap-1.5">
                          <Input
                            placeholder="Reason (optional)"
                            value={rejectReason[req.id] ?? ""}
                            onChange={e => setRejectReason(prev => ({ ...prev, [req.id]: e.target.value }))}
                            className="h-8 text-xs"
                          />
                          <Button size="sm" variant="destructive"
                            onClick={() => rejectRequest.mutate({ requestId: req.id, userId: req.user_id, reason: rejectReason[req.id] ?? "" })}
                            disabled={rejectRequest.isPending} className="gap-1 px-2">
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}

                    {req.status === "approved" && (
                      <div className="flex items-center gap-1 rounded-full bg-green-500/15 px-3 py-1 text-xs font-semibold text-green-600 h-fit">
                        <Check className="h-3 w-3" /> Approved
                      </div>
                    )}

                    {/* FIX #4/#10/#14: fully removes the account (auth + all rows) so the
                        same email can be used to sign up fresh — not just a request delete */}
                    {req.status === "rejected" && (
                      <Button size="sm" variant="outline"
                        onClick={() => { if (confirm("This will permanently delete this user's account (login, profile, and history) so they can sign up again with the same email. This cannot be undone. Continue?")) resetRequest.mutate(req.id); }}
                        disabled={resetRequest.isPending}
                        className="h-fit text-xs">
                        Allow Re-apply (Deletes Account)
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── CASH PAYMENTS ────────────────────────────────── */}
        <TabsContent value="cash">
          <CashPaymentsTab
            payments={pendingCashPayments}
            isLoading={cashLoading}
            error={cashError as Error | null}
            onRefresh={() => refetchCash()}
            onApprove={(feeId) => { if (confirm("Confirm you have received this cash payment in person? This will activate the member's plan.")) approveCash.mutate(feeId); }}
            onReject={(feeId) => { if (confirm("Reject this cash payment request? The member will be notified and their plan will not activate.")) rejectCash.mutate(feeId); }}
            approvePending={approveCash.isPending}
            rejectPending={rejectCash.isPending}
          />
        </TabsContent>

        {/* ── MEMBERS ──────────────────────────────────────── */}
        <TabsContent value="members">
          <PeopleTable
            people={members ?? []}
            label="Member"
            onView={setViewUser}
            onRoleChange={(userId) => setRole.mutate({ userId, newRole: "trainer" })}
            onRemove={(userId) => { if (confirm("Remove this member?")) removeUser.mutate(userId); }}
            roleChangeLabel="Make Trainer"
          />
        </TabsContent>

        {/* ── TRAINERS ─────────────────────────────────────── */}
        <TabsContent value="trainers">
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-sm text-amber-700 dark:text-amber-400">
            Trainer attendance: showing all attendance records for trainer accounts.
          </div>
          <PeopleTable
            people={trainers ?? []}
            label="Trainer"
            onView={setViewUser}
            onRoleChange={(userId) => setRole.mutate({ userId, newRole: "user" })}
            onRemove={(userId) => { if (confirm("Remove this trainer?")) removeUser.mutate(userId); }}
            roleChangeLabel="Make Member"
          />
          <div className="mt-6 rounded-2xl border border-border bg-card p-5">
            <h3 className="mb-3 font-semibold flex items-center gap-2">
              Trainer Attendance Log
              {attendanceTotal > 100 && (
                <span className="text-xs font-normal text-amber-600 dark:text-amber-400">(showing most recent 100 of {attendanceTotal} total)</span>
              )}
            </h3>
            <TableWrap cols={["Date", "Trainer", "Status"]}>
              {(allAttendance ?? [])
                .filter(a => (trainers ?? []).some(t => t.id === a.user_id))
                .map(a => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="px-4 py-3">{new Date(a.date).toLocaleDateString("en-IN")}</td>
                    <td className="px-4 py-3 font-medium">{nameById(a.user_id)}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary capitalize">{a.status}</span>
                    </td>
                  </tr>
                ))}
            </TableWrap>
          </div>

          {/* ── Assign Members to Trainers ─────────────────── */}
          <div className="mt-8">
            <h3 className="font-display text-xl flex items-center gap-2 mb-4">
              <Users className="h-5 w-5 text-primary" /> Assign Members to Trainers
            </h3>
            <div className="rounded-2xl border border-border bg-card p-5 mb-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 items-end">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Select Trainer</label>
                  <select value={assignTrainerId} onChange={e => setAssignTrainerId(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm">
                    <option value="">— Choose trainer —</option>
                    {(trainers ?? []).map(t => <option key={t.id} value={t.id}>{t.full_name || t.id.slice(0,8)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Select Member</label>
                  <select value={assignMemberId} onChange={e => setAssignMemberId(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm">
                    <option value="">— Choose member —</option>
                    {membersWithPlan.filter(m => m.has_trainer_plan).map(m => {
                      const alreadyAssigned = (assignments ?? []).some(a => a.member_id === m.id);
                      return (
                        <option key={m.id} value={m.id} disabled={alreadyAssigned}>
                          {m.full_name || m.id.slice(0,8)}{alreadyAssigned ? " (already has trainer)" : ""}
                        </option>
                      );
                    })}
                  </select>
                  {membersWithPlan.filter(m => m.has_trainer_plan).length === 0 && (
                    <p className="text-xs text-muted-foreground mt-1">No members with a trainer-included plan.</p>
                  )}
                </div>
                <Button disabled={!assignTrainerId || !assignMemberId || assignMember.isPending}
                  onClick={() => { if (assignTrainerId && assignMemberId) assignMember.mutate({ trainerId: assignTrainerId, memberId: assignMemberId }); }}>
                  <Plus className="mr-2 h-4 w-4" /> Assign
                </Button>
              </div>
            </div>
            {/* Show assignment list grouped by trainer */}
            {(trainers ?? []).map(t => {
              const tAssignments = (assignments ?? []).filter(a => a.trainer_id === t.id);
              if (!tAssignments.length) return null;
              return (
                <div key={t.id} className="mb-3 rounded-xl border border-border bg-card p-4">
                  <div className="font-semibold mb-2 text-sm">{t.full_name || t.id.slice(0,8)} — {tAssignments.length} member{tAssignments.length !== 1 ? "s" : ""}</div>
                  <div className="flex flex-wrap gap-2">
                    {tAssignments.map(a => {
                      const member = (members ?? []).find(m => m.id === a.member_id);
                      return (
                        <div key={a.id} className="flex items-center gap-1 rounded-full border border-border bg-secondary/40 px-3 py-1 text-xs">
                          {member?.full_name || a.member_id.slice(0,8)}
                          <button onClick={() => unassignMember.mutate({ trainerId: t.id, memberId: a.member_id })}
                            className="ml-1 text-destructive hover:text-destructive/80"><X className="h-3 w-3" /></button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Home-page trainer cards ─────────────────────── */}
          <div className="mt-8">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display text-xl flex items-center gap-2">
                  <Globe2 className="h-5 w-5 text-primary" /> Home Page — Trainer Cards
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">These cards appear publicly in the "Our Trainers" section on the home page.</p>
              </div>
              {!showCardForm && (
                <Button size="sm" onClick={() => setShowCardForm(true)} className="gap-1">
                  <Plus className="h-4 w-4" /> Add Trainer
                </Button>
              )}
            </div>

            {/* Add new card form */}
            {showCardForm && (
              <TrainerCardForm
                card={newCard}
                onChange={setNewCard}
                onSave={() => saveCard.mutate(newCard)}
                onCancel={() => { setShowCardForm(false); setNewCard(emptyCard); }}
                saving={saveCard.isPending}
              />
            )}

            {/* Existing cards */}
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {(trainerCards ?? []).map((c: any) => (
                <div key={c.id} className={`rounded-2xl border bg-card p-5 ${!c.is_visible ? "opacity-50" : "border-border"}`}>
                  {editCard?.id === c.id ? (
                    <TrainerCardForm
                      card={editCard}
                      onChange={setEditCard as any}
                      onSave={() => saveCard.mutate(editCard!)}
                      onCancel={() => setEditCard(null)}
                      saving={saveCard.isPending}
                    />
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 font-display text-lg text-primary flex-shrink-0">
                            {c.name?.[0] ?? "?"}
                          </div>
                          <div>
                            <div className="font-semibold leading-tight">{c.name}</div>
                            <div className="text-xs text-primary">{c.specialisation}</div>
                          </div>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button onClick={() => toggleCardVisibility.mutate({ id: c.id, is_visible: !c.is_visible })}
                            title={c.is_visible ? "Hide from home page" : "Show on home page"}
                            className="rounded-lg border border-border p-1.5 hover:border-primary transition text-muted-foreground hover:text-primary">
                            {c.is_visible ? <Eye className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                          </button>
                          <button onClick={() => setEditCard({ ...c, bio: c.bio ?? "", display_order: c.display_order ?? 0 })}
                            className="rounded-lg border border-border p-1.5 hover:border-primary transition text-muted-foreground hover:text-primary">
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => { if (confirm("Delete this trainer card?")) deleteCard.mutate(c.id); }}
                            className="rounded-lg border border-border p-1.5 hover:border-destructive transition text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {c.experience && <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{c.experience}</span>}
                        {c.certification && <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{c.certification}</span>}
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium border border-border text-muted-foreground">Order {c.display_order}</span>
                      </div>
                      {c.bio && <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{c.bio}</p>}
                      {!c.is_visible && <p className="mt-2 text-[10px] text-amber-500 font-semibold">Hidden from home page</p>}
                    </>
                  )}
                </div>
              ))}
              {(!trainerCards || !trainerCards.length) && !showCardForm && (
                <div className="col-span-3 rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
                  <Dumbbell className="mx-auto h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">No trainer cards yet. Click "Add Trainer" to create the first one.</p>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── PLANS ────────────────────────────────────────── */}
        <TabsContent value="plans">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Create new */}
            <div className="rounded-2xl border border-border bg-card p-6">
              <h3 className="mb-4 font-display text-2xl flex items-center gap-2"><Plus className="h-5 w-5 text-primary" />New Plan</h3>
              <div className="space-y-3">
                <div>
                  <Input placeholder="Plan name *" value={np.name}
                    onChange={e => setNp({ ...np, name: e.target.value })}
                    className={npErr.name ? "border-destructive" : ""} />
                  {npErr.name && <p className="mt-1 text-xs text-destructive">{npErr.name}</p>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Input type="number" placeholder="Price ₹ *" value={np.price} min={1}
                      onChange={e => setNp({ ...np, price: e.target.value })}
                      className={npErr.price ? "border-destructive" : ""} />
                    {npErr.price && <p className="mt-1 text-xs text-destructive">{npErr.price}</p>}
                  </div>
                  <div>
                    <Input type="number" placeholder="Days *" value={np.duration_days} min={1}
                      onChange={e => setNp({ ...np, duration_days: e.target.value })}
                      className={npErr.duration_days ? "border-destructive" : ""} />
                    {npErr.duration_days && <p className="mt-1 text-xs text-destructive">{npErr.duration_days}</p>}
                  </div>
                </div>
                <Input placeholder="Features (comma separated)" value={np.features}
                  onChange={e => setNp({ ...np, features: e.target.value })} />
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Trainer Included?</label>
                  <select value={np.has_trainer ? "yes" : "no"} onChange={e => setNp({ ...np, has_trainer: e.target.value === "yes" })}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm">
                    <option value="no">No Trainer (Gym access only)</option>
                    <option value="yes">Includes Personal Trainer</option>
                  </select>
                </div>
                <Button disabled={createPlan.isPending} onClick={() => createPlan.mutate()} className="w-full">
                  {createPlan.isPending ? "Creating..." : "Create Plan"}
                </Button>
              </div>
            </div>

            {/* List + inline edit */}
            <div className="space-y-3">
              <h3 className="font-semibold text-muted-foreground uppercase text-xs tracking-wider">Existing Plans</h3>
              {(plans ?? []).map(p => (
                <div key={p.id} className="rounded-2xl border border-border bg-card p-4">
                  {editPlan?.id === p.id ? (
                    <div className="space-y-2">
                      <Input value={editPlan.name} onChange={e => setEditPlan({ ...editPlan, name: e.target.value })} placeholder="Name *" />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Input type="number" value={editPlan.price} onChange={e => setEditPlan({ ...editPlan, price: e.target.value })} placeholder="₹ Price *" min={1} />
                        <Input type="number" value={editPlan.duration_days} onChange={e => setEditPlan({ ...editPlan, duration_days: e.target.value })} placeholder="Days" min={1} />
                      </div>
                      <Input value={editPlan.features} onChange={e => setEditPlan({ ...editPlan, features: e.target.value })} placeholder="Features" />
                      <select value={editPlan.has_trainer ? "yes" : "no"} onChange={e => setEditPlan({ ...editPlan, has_trainer: e.target.value === "yes" })}
                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm">
                        <option value="no">No Trainer</option>
                        <option value="yes">Includes Trainer</option>
                      </select>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => savePlan.mutate()} disabled={savePlan.isPending}>
                          <Check className="mr-1 h-3 w-3" />{savePlan.isPending ? "Saving..." : "Save"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditPlan(null)}>
                          <X className="mr-1 h-3 w-3" />Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-display text-xl">{p.name}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.is_active ? "bg-green-500/15 text-green-600" : "bg-secondary text-muted-foreground"}`}>
                            {p.is_active ? "Active" : "Inactive"}
                          </span>
                          {p.has_trainer && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-primary/15 text-primary">Trainer Included</span>}
                        </div>
                        <div className="text-sm font-semibold text-primary mt-0.5">₹{Number(p.price).toLocaleString("en-IN")} · {p.duration_days}d</div>
                        <div className="mt-1 text-xs text-muted-foreground">{(p.features ?? []).join(" · ")}</div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                        <Button size="icon" variant="ghost" onClick={() => setEditPlan({ id: p.id, name: p.name, price: String(p.price), duration_days: String(p.duration_days), features: (p.features ?? []).join(", "), has_trainer: p.has_trainer ?? false })}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="outline" className="text-xs"
                          onClick={() => togglePlan.mutate({ id: p.id, is_active: !p.is_active })}>
                          {p.is_active ? "Deactivate" : "Activate"}
                        </Button>
                        <Button size="icon" variant="ghost"
                          onClick={() => { if (confirm("Delete this plan?")) deletePlan.mutate(p.id); }}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* ── REMINDERS ────────────────────────────────────── */}
        <TabsContent value="reminders">
          <WhatsAppRemindersTab
            expiringMemberships={expiringMemberships}
            nameById={nameById}
            isLoading={remindersLoading}
            error={remindersError as Error | null}
            onRefresh={() => refetchReminders()}
          />
        </TabsContent>

        {/* ── FEES ─────────────────────────────────────────── */}
        <TabsContent value="fees">
          {feesTotal > 200 && (
            <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400">
              Showing the most recent 200 of {feesTotal} total payments. Older records aren't shown here — export or filter by date for full history.
            </div>
          )}
          <TableWrap cols={["Member","Plan","Amount","Method","Razorpay ID","Status","Date"]}>
            {(fees ?? []).map((f: any) => (
              <tr key={f.id} className="border-t border-border">
                <td className="px-4 py-3 font-medium">{nameById(f.user_id)}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{f.plans?.name ?? "-"}</td>
                <td className="px-4 py-3 font-semibold">₹{Number(f.amount).toLocaleString("en-IN")}</td>
                <td className="px-4 py-3 text-muted-foreground capitalize text-xs">{(f.method ?? "-").replace("razorpay_", "")}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{f.razorpay_payment_id ?? "-"}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${f.status === "paid" ? "bg-green-500/15 text-green-600" : "bg-amber-500/15 text-amber-600"}`}>{f.status}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(f.paid_at ?? f.created_at).toLocaleDateString("en-IN")}</td>
              </tr>
            ))}
            {(!fees || fees.length === 0) && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No fees yet.</td></tr>}
          </TableWrap>
        </TabsContent>

        {/* ── AUDIT ────────────────────────────────────────── */}
        <TabsContent value="audit">
          {/* ── Signup Requests Log ─────────────────────────────────── */}
          <div className="mb-4">
            <h3 className="font-semibold text-base mb-1 flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-primary" /> Signup Requests
            </h3>
            <p className="text-xs text-muted-foreground mb-3">All member and trainer signup requests with full details and timestamps.</p>
            <TableWrap cols={["Name","Email","Phone","Role","Status","Signed Up","Reason"]}>
              {(requests ?? []).map(r => {
                const statusColor =
                  r.status === "approved" ? "bg-green-500/15 text-green-600" :
                  r.status === "rejected" ? "bg-red-500/15 text-red-600" :
                  "bg-amber-500/15 text-amber-600";
                const dt = new Date(r.created_at);
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-4 py-3 text-xs font-medium whitespace-nowrap max-w-[120px] truncate">{r.full_name}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{r.email}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{r.phone}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize
                        ${r.role === "trainer" ? "bg-blue-500/15 text-blue-600" : "bg-secondary text-muted-foreground"}`}>
                        {r.role === "trainer" ? "Trainer" : "Member"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusColor}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      <div>{dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
                      <div className="text-[10px] opacity-70">{dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground italic">
                      {r.reject_reason ?? <span className="text-muted-foreground/40">—</span>}
                    </td>
                  </tr>
                );
              })}
              {(!requests || !requests.length) && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No signup requests yet.</td></tr>
              )}
            </TableWrap>
          </div>

          {/* ── Admin Action Log ─────────────────────────────────────── */}
          <div className="mt-8">
            <h3 className="font-semibold text-base mb-1 flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> Admin Action Log
            </h3>
            <p className="text-xs text-muted-foreground mb-3">Admin promotions, role changes, and member removals. Use this to detect unauthorised access.</p>
            <TableWrap cols={["User / Email","Event","Detail","Date"]}>
              {(promos?.promotions ?? []).map(p => {
                const isRoleChange = p.reason?.startsWith("role_changed");
                const isRemoval = p.reason === "removed";
                const isPromo = p.reason === "bootstrap" || p.reason === "code";
                return (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-4 py-3 font-medium text-xs">{p.user_email ?? p.user_id.slice(0, 12)}</td>
                    <td className="px-4 py-3 text-xs capitalize">{isRoleChange ? "Role Change" : isRemoval ? "User Removed" : "Admin Promoted"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold
                        ${isPromo ? "bg-amber-500/15 text-amber-600" :
                          isRoleChange ? "bg-blue-500/15 text-blue-600" :
                          "bg-red-500/15 text-red-600"}`}>
                        {p.reason === "bootstrap" ? "First Admin" :
                         p.reason === "code" ? "Admin Code" :
                         p.reason?.replace(/_/g, " ") ?? p.flow}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      <div>{new Date(p.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
                      <div className="text-[10px] opacity-70">{new Date(p.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}</div>
                    </td>
                  </tr>
                );
              })}
              {(!promos || !promos.promotions.length) && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No audit events yet.</td></tr>}
            </TableWrap>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── USER DETAIL DIALOG ──────────────────────────── */}
      <Dialog open={!!viewUser} onOpenChange={(o) => !o && setViewUser(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{userDetail?.profile?.full_name ?? "User"} — Full Profile</DialogTitle>
          </DialogHeader>
          {userDetail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Info label="Phone" value={userDetail.profile?.phone ?? "-"} />
                <Info label="Joined" value={new Date(userDetail.profile?.created_at ?? "").toLocaleDateString("en-IN")} />
                <Info label="Membership" value={(userDetail.membership as any)?.plans?.name ?? "None"} />
                <Info label="Valid Till" value={userDetail.membership?.valid_till ? new Date(userDetail.membership.valid_till).toLocaleDateString("en-IN") : "-"} />
                <Info label="Status" value={userDetail.membership?.status ?? "no membership"} />
                <Info label="Days Attended" value={String(userDetail.attendance.length)} />
              </div>
              <div>
                <h4 className="mb-2 font-semibold">Fees History</h4>
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-secondary text-muted-foreground"><tr><th className="px-3 py-2 text-left">Plan</th><th className="px-3 py-2 text-left">Amount</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Date</th></tr></thead>
                    <tbody>
                      {userDetail.fees.map((f: any) => (
                        <tr key={f.id} className="border-t border-border">
                          <td className="px-3 py-2">{f.plans?.name ?? "-"}</td>
                          <td className="px-3 py-2">₹{Number(f.amount).toLocaleString("en-IN")}</td>
                          <td className="px-3 py-2 capitalize">{f.status}</td>
                          <td className="px-3 py-2">{new Date(f.paid_at ?? f.created_at).toLocaleDateString("en-IN")}</td>
                        </tr>
                      ))}
                      {!userDetail.fees.length && <tr><td colSpan={4} className="px-3 py-3 text-center text-muted-foreground">No fees</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <h4 className="mb-3 font-semibold">Attendance Calendar</h4>
                <AdminMonthCalendar attendance={userDetail.attendance} />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setViewUser(null)}>Close</Button>
            {viewUser && (
              <Button variant="destructive"
                onClick={() => { if (confirm("Remove this user?")) { removeUser.mutate(viewUser); setViewUser(null); } }}>
                <UserMinus className="mr-2 h-4 w-4" /> Remove User
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}

function PeopleTable({ people, label, onView, onRoleChange, onRemove, roleChangeLabel }: {
  people: any[]; label: string;
  onView: (id: string) => void;
  onRoleChange: (id: string) => void;
  onRemove: (id: string) => void;
  roleChangeLabel: string;
}) {
  return (
    <TableWrap cols={["Name", "Phone", "Joined", "Actions"]}>
      {people.map(p => (
        <tr key={p.id} className="border-t border-border">
          <td className="px-4 py-3 font-medium">{p.full_name || "Unnamed"}</td>
          <td className="px-4 py-3 text-muted-foreground text-sm">{p.phone || "-"}</td>
          <td className="px-4 py-3 text-muted-foreground text-sm">{new Date(p.created_at).toLocaleDateString("en-IN")}</td>
          <td className="px-4 py-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => onView(p.id)}>
                <Eye className="mr-1 h-3 w-3" /> View
              </Button>
              <Button size="sm" variant="outline" onClick={() => onRoleChange(p.id)} className="text-xs">
                {roleChangeLabel}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onRemove(p.id)}>
                <UserMinus className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </td>
        </tr>
      ))}
      {!people.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No {label.toLowerCase()}s yet.</td></tr>}
    </TableWrap>
  );
}

function TableWrap({ cols, children }: { cols: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-secondary text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>{cols.map(c => <th key={c} className="px-4 py-3">{c}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium capitalize">{value}</div>
    </div>
  );
}

function TrainerCardForm({ card, onChange, onSave, onCancel, saving }: {
  card: any; onChange: (c: any) => void; onSave: () => void; onCancel: () => void; saving: boolean;
}) {
  return (
    <div className="mb-4 rounded-2xl border border-primary/30 bg-primary/5 p-5 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Name *</Label>
          <Input className="mt-1" placeholder="e.g. Arjun Patel" value={card.name} onChange={e => onChange({ ...card, name: e.target.value })} maxLength={80} />
        </div>
        <div>
          <Label>Specialisation</Label>
          <Input className="mt-1" placeholder="e.g. Strength & Conditioning" value={card.specialisation} onChange={e => onChange({ ...card, specialisation: e.target.value })} maxLength={80} />
        </div>
        <div>
          <Label>Experience</Label>
          <Input className="mt-1" placeholder="e.g. 8 years" value={card.experience} onChange={e => onChange({ ...card, experience: e.target.value })} maxLength={40} />
        </div>
        <div>
          <Label>Certification</Label>
          <Input className="mt-1" placeholder="e.g. NSCA-CSCS" value={card.certification} onChange={e => onChange({ ...card, certification: e.target.value })} maxLength={60} />
        </div>
        <div>
          <Label>Display Order</Label>
          <Input className="mt-1" type="number" min={0} value={card.display_order} onChange={e => onChange({ ...card, display_order: Number(e.target.value) })} />
        </div>
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={card.is_visible} onChange={e => onChange({ ...card, is_visible: e.target.checked })} className="accent-primary h-4 w-4" />
            <span className="text-sm font-medium">Visible on home page</span>
          </label>
        </div>
        <div className="sm:col-span-2">
          <Label>Bio (optional)</Label>
          <Input className="mt-1" placeholder="Short bio shown on home page..." value={card.bio} onChange={e => onChange({ ...card, bio: e.target.value })} maxLength={200} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave} disabled={saving}>{saving ? "Saving…" : card.id ? "Save Changes" : "Add Trainer"}</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// ── CashPaymentsTab ───────────────────────────────────────────────
function CashPaymentsTab({ payments, isLoading, error, onRefresh, onApprove, onReject, approvePending, rejectPending }: {
  payments: any[];
  isLoading?: boolean;
  error?: Error | null;
  onRefresh?: () => void;
  onApprove: (feeId: string) => void;
  onReject: (feeId: string) => void;
  approvePending?: boolean;
  rejectPending?: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-2xl bg-muted animate-pulse" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-8 text-center">
        <p className="text-destructive font-medium mb-2">Failed to load cash payments</p>
        <p className="text-xs text-muted-foreground mb-4">{error.message}</p>
        <Button size="sm" variant="outline" onClick={onRefresh}>Retry</Button>
      </div>
    );
  }

  if (payments.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-16 text-center text-muted-foreground">
        <Banknote className="mx-auto h-10 w-10 mb-3 opacity-30" />
        <p className="font-medium">No cash payments awaiting approval</p>
        <p className="text-sm mt-1">When a member opts to pay in cash, their request will appear here.</p>
        <Button size="sm" variant="outline" className="mt-4" onClick={onRefresh}>Refresh</Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Banknote className="h-5 w-5 text-amber-500" />
          <h3 className="font-semibold">
            {payments.length} Cash Payment{payments.length !== 1 ? "s" : ""} Awaiting Approval
          </h3>
        </div>
        <Button size="sm" variant="outline" onClick={onRefresh}>Refresh</Button>
      </div>
      <div className="space-y-3">
        {payments.map((f: any) => (
          <div key={f.id} className="flex items-center justify-between rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 px-5 py-4">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{f.profiles?.full_name || "Unknown"}</span>
                <span className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                  <Clock className="h-2.5 w-2.5" /> Pending
                </span>
              </div>
              <span className="text-xs text-muted-foreground">{f.plans?.name ?? "Plan"} · {f.plans?.duration_days ?? "-"} days</span>
              {f.profiles?.phone && <span className="text-xs text-muted-foreground">{f.profiles.phone}</span>}
              <span className="text-xs text-muted-foreground">Requested {new Date(f.created_at).toLocaleString("en-IN")}</span>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="font-display text-lg text-amber-600 dark:text-amber-400">₹{Number(f.amount).toLocaleString("en-IN")}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={() => onReject(f.id)} disabled={approvePending || rejectPending}>
                  <X className="h-3.5 w-3.5 mr-1" /> Reject
                </Button>
                <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => onApprove(f.id)} disabled={approvePending || rejectPending}>
                  <Check className="h-3.5 w-3.5 mr-1" /> Confirm Received
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        "Confirm Received" activates the member's plan immediately. Only confirm after you've actually collected the cash in person.
      </p>
    </div>
  );
}

// ── WhatsAppRemindersTab ─────────────────────────────────────────
function WhatsAppRemindersTab({ expiringMemberships, nameById, isLoading, error, onRefresh }: {
  expiringMemberships: any[];
  nameById: (id: string) => string;
  isLoading?: boolean;
  error?: Error | null;
  onRefresh?: () => void;
}) {
  const openWhatsApp = (phone: string, name: string, planName: string, daysLeft: number, validTill: string) => {
    const expiryDate = new Date(validTill).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
    const message = `Hi ${name}! 👋\n\nThis is a reminder from *The John Fitness* 🏋️\n\nYour *${planName}* membership is expiring in *${daysLeft} day${daysLeft !== 1 ? "s" : ""}* on ${expiryDate}.\n\nRenew now to continue your fitness journey without any interruption! 💪\n\nTo renew, open the app and head to *My Plan* → Renew.\n\nStay strong! 🔥\n— The John Fitness Team`;
    const encodedMsg = encodeURIComponent(message);
    const normalized = phone.replace(/\D/g, "").replace(/^0/, "");
    const withCountry = normalized.startsWith("91") ? normalized : `91${normalized}`;
    window.open(`https://wa.me/${withCountry}?text=${encodedMsg}`, "_blank");
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1,2,3].map(i => (
          <div key={i} className="h-16 rounded-2xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-8 text-center">
        <p className="text-destructive font-medium mb-2">Failed to load reminders</p>
        <p className="text-xs text-muted-foreground mb-4">{error.message}</p>
        <Button size="sm" variant="outline" onClick={onRefresh}>Retry</Button>
      </div>
    );
  }

  if (expiringMemberships.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-16 text-center text-muted-foreground">
        <MessageCircle className="mx-auto h-10 w-10 mb-3 opacity-30" />
        <p className="font-medium">No expiring memberships</p>
        <p className="text-sm mt-1">Members whose plans expire within 5 days will appear here.</p>
        <Button size="sm" variant="outline" className="mt-4" onClick={onRefresh}>Refresh</Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-green-500" />
          <h3 className="font-semibold">
            {expiringMemberships.length} Membership{expiringMemberships.length !== 1 ? "s" : ""} Expiring Within 5 Days
          </h3>
          <span className="text-xs text-muted-foreground ml-1">— click Send to open WhatsApp</span>
        </div>
        <Button size="sm" variant="outline" onClick={onRefresh}>Refresh</Button>
      </div>
      <div className="space-y-3">
        {expiringMemberships.map((m: any) => {
          const daysLeft = Math.ceil((new Date(m.valid_till).getTime() - Date.now()) / 86400000);
          const phone = m.profiles?.phone;
          const name = m.profiles?.full_name || nameById(m.user_id);
          const planName = m.plans?.name ?? "membership";
          return (
            <div key={m.id} className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-4">
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold">{name}</span>
                <span className="text-xs text-muted-foreground">{planName}</span>
                {phone && <span className="text-xs text-muted-foreground">{phone}</span>}
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${daysLeft <= 1 ? "bg-red-500/20 text-red-600" : "bg-amber-500/20 text-amber-700 dark:text-amber-400"}`}>
                  {daysLeft === 0 ? "Expires today" : `${daysLeft}d left`}
                </span>
                {phone ? (
                  <Button
                    size="sm"
                    onClick={() => openWhatsApp(phone, name, planName, daysLeft, m.valid_till)}
                    className="gap-2 bg-green-600 hover:bg-green-700 text-white"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    Send
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground italic">No phone</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Clicking <strong>Send</strong> opens WhatsApp with a pre-filled renewal reminder. The admin just needs to press Send in WhatsApp.
      </p>
    </div>
  );
}

// ── AdminSkeleton ────────────────────────────────────────────────
function AdminSkeleton() {
  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden w-64 border-r border-border bg-sidebar md:flex flex-col p-4 gap-2">
        <div className="h-12 w-36 animate-pulse rounded-xl bg-white/10 mb-6" />
        {[1,2,3,4,5,6].map(i => <div key={i} className="h-10 animate-pulse rounded-xl bg-white/10" />)}
      </div>
      <div className="flex-1 p-6 space-y-4">
        <div className="h-8 w-36 animate-pulse rounded-lg bg-secondary" />
        <div className="grid gap-4 sm:grid-cols-4">
          {[1,2,3,4].map(i => <div key={i} className="h-28 animate-pulse rounded-2xl bg-secondary" />)}
        </div>
        <div className="h-64 animate-pulse rounded-2xl bg-secondary" />
        <div className="h-40 animate-pulse rounded-2xl bg-secondary" />
      </div>
    </div>
  );
}

// ── AdminMonthCalendar ───────────────────────────────────────────
function AdminMonthCalendar({ attendance }: { attendance: any[] }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed

  const presentDates = new Set(attendance.map(a => a.date));
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0=Sun
  const today = new Date().toISOString().slice(0, 10);

  const monthName = new Date(year, month).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    // Don't go beyond current month
    const nowDate = new Date();
    if (year === nowDate.getFullYear() && month === nowDate.getMonth()) return;
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();

  const days: Array<{ date: string; day: number; status: "present" | "absent" | "future" | "today" }> = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isFuture = dateStr > today;
    const isToday = dateStr === today;
    const present = presentDates.has(dateStr);
    days.push({
      date: dateStr, day: d,
      status: isToday ? "today" : isFuture ? "future" : present ? "present" : "absent",
    });
  }

  const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-secondary transition">‹ Prev</button>
        <span className="text-sm font-semibold">{monthName}</span>
        <button onClick={nextMonth} disabled={isCurrentMonth}
          className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-secondary transition disabled:opacity-40 disabled:cursor-not-allowed">Next ›</button>
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map(l => (
          <div key={l} className="text-center text-[10px] font-semibold text-muted-foreground py-1">{l}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {/* Empty cells before first day */}
        {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`e-${i}`} />)}

        {days.map(({ date, day, status }) => (
          <div key={date} title={date}
            className={`aspect-square flex items-center justify-center rounded-lg text-xs font-medium transition
              ${status === "present" ? "bg-green-500 text-white shadow-sm" :
                status === "absent"  ? "bg-red-400/80 text-white" :
                status === "today"   ? "ring-2 ring-primary bg-primary/10 text-primary font-bold" :
                "bg-secondary/50 text-muted-foreground"}`}>
            {day}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-green-500" /> Present</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-red-400/80" /> Absent</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-secondary" /> Not yet</span>
      </div>

      {/* Month stats */}
      <div className="mt-3 flex gap-4 text-xs">
        <span className="text-green-600 font-semibold">{days.filter(d => d.status === "present").length} present</span>
        <span className="text-red-500 font-semibold">{days.filter(d => d.status === "absent").length} absent</span>
        <span className="text-muted-foreground">{days.filter(d => d.status === "future").length} remaining</span>
      </div>
    </div>
  );
}
