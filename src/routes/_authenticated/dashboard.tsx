import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardShell, type NavItem } from "@/components/DashboardShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  LayoutDashboard, CreditCard, Calendar, User as UserIcon,
  Activity, CheckCircle2, Smartphone, Building2, Wallet, Save,
  AlertTriangle, Lock, Shield, Target, Plus, Trash2, TrendingUp,
  Flame, Award, BarChart2, Check, ChevronLeft, ChevronRight,
  Banknote, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useState, useEffect, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { openRazorpayCheckout } from "@/lib/razorpay";
import { recordPayment, requestCashPayment } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab as string) || "overview",
  }),
  component: MemberDashboard,
});

type DashTab = "overview" | "goals" | "pay" | "workouts" | "attendance" | "fees" | "profile";

const baseNav: NavItem[] = [
  { to: "/dashboard", label: "Dashboard",    icon: LayoutDashboard, tab: "overview"   },
  { to: "/dashboard", label: "My Goals",     icon: Target,          tab: "goals"      },
  { to: "/dashboard", label: "Fees & Plans", icon: CreditCard,      tab: "pay"        },
  { to: "/dashboard", label: "Workouts",     icon: Activity,        tab: "workouts"   },
  { to: "/dashboard", label: "Attendance",   icon: Calendar,        tab: "attendance" },
  { to: "/dashboard", label: "Profile",      icon: UserIcon,        tab: "profile"    },
];

type PaymentMethod = "upi" | "card" | "netbanking" | "wallet" | "cash";

const PAYMENT_METHODS: { id: PaymentMethod; label: string; icon: any }[] = [
  { id: "upi",        label: "UPI / Google Pay / PhonePe", icon: Smartphone },
  { id: "card",       label: "Credit / Debit Card",        icon: CreditCard },
  { id: "netbanking", label: "Net Banking",                icon: Building2  },
  { id: "wallet",     label: "Wallets (Paytm etc.)",       icon: Wallet     },
  { id: "cash",       label: "Cash (Pay at Gym, Needs Admin Approval)", icon: Banknote },
];

type GoalType = "attendance" | "weight" | "custom";
const GOAL_TYPES: { id: GoalType; label: string; icon: any; unit: string }[] = [
  { id: "attendance", label: "Attendance",    icon: Calendar,    unit: "days"  },
  { id: "weight",     label: "Weight / Body", icon: TrendingUp,  unit: "kg"    },
  { id: "custom",     label: "Custom",        icon: Target,      unit: ""      },
];

function MemberDashboard() {
  const { user, role, loading } = useAuth();
  const navigate = Route.useNavigate();
  const { tab: activeTab } = Route.useSearch();
  const qc = useQueryClient();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("upi");
  const [payLoading, setPayLoading] = useState(false);

  // Profile edit state
  const [pName, setPName] = useState("");
  const [pPhone, setPPhone] = useState("");
  const [pNameErr, setPNameErr] = useState("");
  const [pPhoneErr, setPPhoneErr] = useState("");

  // Goal form state
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [gType, setGType] = useState<GoalType>("attendance");
  const [gTitle, setGTitle] = useState("");
  const [gTarget, setGTarget] = useState("");
  const [gUnit, setGUnit] = useState("days");
  const [gDeadline, setGDeadline] = useState("");
  const [gNotes, setGNotes] = useState("");

  useEffect(() => {
    if (!loading && role && role !== "user") navigate({ to: role === "admin" ? "/admin" : "/trainer" });
  }, [role, loading]);

  const { data: profile, isSuccess: profileLoaded } = useQuery({
    enabled: !!user,
    queryKey: ["profile", user?.id],
    queryFn: async () => (await supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle()).data,
  });

  useEffect(() => {
    if (profileLoaded && profile) {
      setPName(profile.full_name ?? "");
      setPPhone(profile.phone ?? "");
    }
  }, [profileLoaded, profile]);

  const { data: plans, isLoading: plansLoading } = useQuery({
    queryKey: ["plans"],
    queryFn: async () => {
      const { data, error } = await supabase.from("plans").select("*").eq("is_active", true).order("price");
      if (error) throw new Error(error.message);
      const seen = new Set<string>();
      return (data ?? []).filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: membership, isLoading: membershipLoading } = useQuery({
    enabled: !!user,
    queryKey: ["membership", user?.id],
    // FIX #18: refetch when the tab regains focus — if an admin changes this
    // member's plan in another session while this dashboard sits open, the
    // workouts tab and has_trainer flag should resync rather than stay stale
    // until the next full navigation.
    refetchOnWindowFocus: true,
    staleTime: 60 * 1000,
    // Poll every 10 s while a cash payment is pending so the member sees the
    // result (approved or declined) without needing to manually reload.
    refetchInterval: (query) => {
      const data = query.state.data as any;
      return data?.status === "pending_approval" ? 10_000 : false;
    },
    queryFn: async () =>
      (await supabase.from("memberships").select("*,plans(name,has_trainer)").eq("user_id", user!.id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle()).data,
  });

  const { data: fees } = useQuery({
    enabled: !!user,
    queryKey: ["my-fees", user?.id],
    // Also poll fees while cash is pending — hasDeclinedCash is derived from
    // fees, so it needs to update at the same time as the membership query.
    refetchInterval: membership?.status === "pending_approval" ? 10_000 : false,
    queryFn: async () => (await supabase.from("fees").select("*,plans(name)").eq("user_id", user!.id).order("created_at", { ascending: false })).data ?? [],
  });

  // FIX #4/#26: only show workouts from the member's assigned trainer, not all trainers
  const { data: myTrainerId } = useQuery({
    enabled: !!user,
    queryKey: ["my-trainer-id", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("trainer_assignments")
        .select("trainer_id")
        .eq("member_id", user!.id)
        .limit(1)
        .maybeSingle();
      return data?.trainer_id ?? null;
    },
  });

  const { data: myTrainerProfile } = useQuery({
    enabled: !!myTrainerId,
    queryKey: ["my-trainer-profile", myTrainerId],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("full_name, phone").eq("id", myTrainerId!).maybeSingle();
      return data ?? null;
    },
  });

  // FIX: hoist isActive and hasTrainerPlan above the workouts query — they were
  // declared after the query that used them, causing a TDZ ReferenceError.
  const isActive = !!(membership?.status === "active" && membership?.valid_till && new Date(membership.valid_till) >= new Date());
  const hasTrainerPlan = !!(membership as any)?.plans?.has_trainer && isActive;
  // A cash payment was requested but not yet approved by the admin — the plan
  // isn't active, but the member shouldn't be able to submit a second request.
  const hasPendingCash = membership?.status === "pending_approval";
  // A cash payment was declined by admin — fee row exists with status='failed'
  // and the membership row was deleted by reject_cash_payment_tx. Show a
  // declined banner and let the member re-apply.
  const hasDeclinedCash = !hasPendingCash && !isActive &&
    !!(fees ?? []).find((f: any) => f.method === "cash" && f.status === "failed" &&
      // Only show if there's no subsequent paid/pending fee (i.e. they haven't
      // already successfully re-applied after the decline)
      !(fees ?? []).find((f2: any) =>
        f2.created_at > f.created_at && (f2.status === "paid" || f2.status === "pending")
      )
    );

  const { data: workouts } = useQuery({
    enabled: hasTrainerPlan,
    queryKey: ["my-trainer-workouts", myTrainerId],
    queryFn: async () => {
      if (!myTrainerId) return [];
      return (await supabase.from("workouts").select("*")
        .eq("trainer_id", myTrainerId)
        .order("created_at", { ascending: false })).data ?? [];
    },
  });

  const { data: attendance } = useQuery({
    enabled: !!user,
    queryKey: ["my-attendance", user?.id],
    queryFn: async () => (await supabase.from("attendance").select("*").eq("user_id", user!.id)
      .order("date", { ascending: false }).limit(60)).data ?? [],
  });

  const { data: goals } = useQuery({
    enabled: !!user,
    queryKey: ["my-goals", user?.id],
    queryFn: async () => (await supabase.from("user_goals").select("*").eq("user_id", user!.id)
      .order("created_at", { ascending: false })).data ?? [],
  });

  const today = new Date().toISOString().slice(0, 10);
  const markedToday = (attendance ?? []).some(a => a.date === today);

  const activePlan = (plans ?? []).find(p => p.id === (selectedPlanId ?? membership?.plan_id)) ?? plans?.[0];
  // isActive and hasTrainerPlan are declared above (hoisted before the workouts query)
  // Use ceil so any part of a day counts as a full day — avoids showing
  // "2 days" when 2 days and 23 hours remain.
  const daysLeft = (() => {
    if (!membership?.valid_till) return 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const target = new Date(membership.valid_till + "T00:00:00");
    return Math.ceil((target.getTime() - today.getTime()) / 86400000);
  })();
  const expiringSoon = isActive && daysLeft <= 5;
  // Block purchase if active plan with > 5 days left
  const blockPurchase = isActive && daysLeft > 5;

  // Attendance stats
  const thisMonth = new Date().toISOString().slice(0, 7);
  const attendanceThisMonth = (attendance ?? []).filter(a => a.date.startsWith(thisMonth)).length;
  // FIX #12: sync attendance-type goals to DB so other devices see the right value
  useEffect(() => {
    if (!user || !goals?.length || !attendance) return;
    const attendanceGoals = goals.filter(g => g.goal_type === "attendance" && !g.completed);
    attendanceGoals.forEach(g => {
      if (g.current_value !== attendanceThisMonth) {
        supabase.from("user_goals")
          .update({ current_value: attendanceThisMonth, updated_at: new Date().toISOString() })
          .eq("id", g.id)
          .then(() => qc.invalidateQueries({ queryKey: ["my-goals", user.id] }));
      }
    });
  }, [attendanceThisMonth, goals, user]);
  // FIX #13: count actual distinct calendar days attended in last 30 days
  const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const attendanceLast30 = (attendance ?? []).filter(a => new Date(a.date) >= thirtyDaysAgo).length;
  // Streak: consecutive days from today backwards
  const streak = (() => {
    const dates = new Set((attendance ?? []).map(a => a.date));
    let s = 0;
    const d = new Date();
    while (dates.has(d.toISOString().slice(0, 10))) {
      s++;
      d.setDate(d.getDate() - 1);
    }
    return s;
  })();

  // ── PAYMENT ──────────────────────────────────────────────────
  async function handlePay() {
    if (!user || !activePlan) return toast.error("Select a plan first");
    setPayLoading(true);

    // ── CASH PAYMENT: no Razorpay involved, just a pending request for admin ──
    if (payMethod === "cash") {
      try {
        await requestCashPayment({ data: { planId: activePlan.id, amount: activePlan.price } });
        toast.success("Cash payment request sent! Pay the admin in person — your plan activates once they confirm.");
        qc.invalidateQueries({ queryKey: ["membership", user.id] });
        qc.invalidateQueries({ queryKey: ["my-fees", user.id] });
        qc.invalidateQueries({ queryKey: ["notifications"] });
        setSelectedPlanId(null);
      } catch (e: any) {
        toast.error(e?.message ?? "Could not submit cash payment request.");
      } finally {
        setPayLoading(false);
      }
      return;
    }

    try {
      // FIX #5: openRazorpayCheckout now returns a Promise<string> (paymentId)
      const paymentId = await openRazorpayCheckout({
        amount: activePlan.price,
        planName: activePlan.name,
        userName: profile?.full_name ?? undefined,
        userEmail: user.email,
        userPhone: profile?.phone ?? undefined,
      });

      // If the member still has days left on their current plan, extend from
      // their existing expiry date instead of today — so no days are lost.
      const baseDate = (isActive && membership?.valid_till)
        ? new Date(membership.valid_till + "T00:00:00")
        : new Date();
      const validTill = new Date(baseDate);
      validTill.setDate(validTill.getDate() + activePlan.duration_days);
      // Use local date parts — toISOString() converts to UTC which can give
      // yesterday's date in IST (UTC+5:30) between midnight and 5:30am.
      const pad = (n: number) => String(n).padStart(2, "0");
      const validTillStr = `${validTill.getFullYear()}-${pad(validTill.getMonth() + 1)}-${pad(validTill.getDate())}`;

      // FIX: fee insert + membership update/insert now happen atomically server-side —
      // either both succeed or both roll back, so a member can never end up "paid"
      // with no active membership (or vice versa).
      await recordPayment({
        data: {
          planId: activePlan.id,
          amount: activePlan.price,
          method: `razorpay_${payMethod}`,
          razorpayPaymentId: paymentId,
          validTill: validTillStr,
        },
      });

      toast.success(`Payment successful! ₹${Number(activePlan.price).toLocaleString("en-IN")} · ${activePlan.name}`);
      qc.invalidateQueries({ queryKey: ["membership", user.id] });
      qc.invalidateQueries({ queryKey: ["my-fees", user.id] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      setSelectedPlanId(null); // FIX #8: reset so display reflects new membership
    } catch (e: any) {
      if (e?.message === "cancelled") {
        // User dismissed the modal — no error toast needed
      } else if (e?.message === "timeout") {
        toast.error("Payment session timed out. If you were charged, contact support with your bank statement.");
      } else {
        toast.error(e?.message ?? "Payment failed");
      }
    } finally {
      setPayLoading(false);
    }
  }

  // ── CHECK-IN ──────────────────────────────────────────────────
  const checkIn = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase.from("attendance").insert({
        user_id: user.id, status: "present", date: today,
        check_in_time: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Checked in!");
      qc.invalidateQueries({ queryKey: ["my-attendance", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message.includes("unique") ? "Already checked in today" : e.message),
  });

  // ── PROFILE ───────────────────────────────────────────────────
  const saveProfile = useMutation({
    mutationFn: async () => {
      let hasErr = false;
      if (!pName.trim() || pName.trim().length < 2) { setPNameErr("Name must be at least 2 characters"); hasErr = true; } else setPNameErr("");
      if (pPhone && !/^[6-9]\d{9}$/.test(pPhone.replace(/\s/g, ""))) { setPPhoneErr("Enter a valid 10-digit Indian mobile number"); hasErr = true; } else setPPhoneErr("");
      if (hasErr) throw new Error("Validation");
      const { error } = await supabase.from("profiles").update({ full_name: pName.trim(), phone: pPhone.trim(), updated_at: new Date().toISOString() }).eq("id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Profile saved!"); qc.invalidateQueries({ queryKey: ["profile", user?.id] }); },
    onError: (e: Error) => { if (e.message !== "Validation") toast.error(e.message); },
  });

  // ── GOALS ─────────────────────────────────────────────────────
  function resetGoalForm() {
    setGType("attendance"); setGTitle(""); setGTarget(""); setGUnit("days"); setGDeadline(""); setGNotes(""); setShowGoalForm(false);
  }

  const createGoal = useMutation({
    mutationFn: async () => {
      if (!gTitle.trim()) throw new Error("Title is required");
      const { error } = await supabase.from("user_goals").insert({
        user_id: user!.id,
        goal_type: gType,
        title: gTitle.trim(),
        target_value: gTarget ? Number(gTarget) : 0,
        current_value: 0,
        unit: gUnit.trim() || null,
        deadline: gDeadline || null,
        notes: gNotes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Goal created!");
      resetGoalForm();
      qc.invalidateQueries({ queryKey: ["my-goals", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateGoalProgress = useMutation({
    mutationFn: async ({ id, current_value }: { id: string; current_value: number }) => {
      const { error } = await supabase.from("user_goals")
        .update({ current_value, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-goals", user?.id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleGoalDone = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const { error } = await supabase.from("user_goals")
        .update({ completed, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-goals", user?.id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteGoal = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("user_goals").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Goal removed"); qc.invalidateQueries({ queryKey: ["my-goals", user?.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading || membershipLoading) return <DashboardSkeleton />;

  const nav = baseNav.filter(n => n.tab !== "workouts" || hasTrainerPlan);
  const activeGoals = (goals ?? []).filter(g => !g.completed);
  const completedGoals = (goals ?? []).filter(g => g.completed);

  return (
    <DashboardShell title="My Dashboard" nav={nav}>
      {!isActive && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 sm:p-4">
          <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
          <div>
            <div className="font-semibold text-amber-800 dark:text-amber-300">No Active Membership</div>
            <div className="text-sm text-amber-700 dark:text-amber-400">Choose a plan below to activate your membership.</div>
          </div>
        </div>
      )}
      {expiringSoon && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-orange-300 bg-orange-50 dark:bg-orange-950/30 p-3 sm:p-4">
          <AlertTriangle className="h-5 w-5 text-orange-500 flex-shrink-0" />
          <div>
            <div className="font-semibold text-orange-800 dark:text-orange-300">Membership Expiring in {daysLeft} day{daysLeft !== 1 ? "s" : ""}!</div>
            <div className="text-sm text-orange-700 dark:text-orange-400">Renew now to stay active without interruption.</div>
          </div>
        </div>
      )}

      <Tabs value={activeTab as DashTab} onValueChange={(v) => navigate({ search: { tab: v } })}>
        <div className="overflow-x-auto"><TabsList className="mb-4 w-max">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="goals">Goals</TabsTrigger>
          <TabsTrigger value="pay">Plans & Pay</TabsTrigger>
          {hasTrainerPlan && <TabsTrigger value="workouts">Workouts</TabsTrigger>}
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="fees">Payment History</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
        </TabsList></div>

        {/* ── OVERVIEW ─────────────────────────────────────── */}
        <TabsContent value="overview">
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-6">
            <div className={`rounded-2xl p-6 ${isActive ? "bg-primary text-primary-foreground shadow-[var(--shadow-glow)]" : hasPendingCash ? "border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700" : hasDeclinedCash ? "border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-700" : "border border-border bg-card"}`}>
              <div className={`text-xs uppercase tracking-wider ${hasPendingCash ? "text-amber-600 dark:text-amber-400" : hasDeclinedCash ? "text-red-600 dark:text-red-400" : "opacity-70"}`}>Membership</div>
              <div className="mt-3 font-display text-2xl">{(membership as any)?.plans?.name ?? "None"}</div>
              <div className="mt-1 text-sm opacity-80">
                {hasPendingCash ? (
                  <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                    <Clock className="h-3.5 w-3.5" /> Awaiting admin approval
                  </span>
                ) : hasDeclinedCash ? (
                  <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                    <X className="h-3.5 w-3.5" /> Cash payment declined
                  </span>
                ) : membership?.valid_till ? `Valid till ${new Date(membership.valid_till).toLocaleDateString("en-IN")}` : "No active plan"}
              </div>
              {isActive && <div className="mt-1 text-xs font-semibold opacity-90">{daysLeft}d remaining</div>}
              {hasPendingCash && <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">Pay the admin in person to activate</div>}
              {hasDeclinedCash && <div className="mt-1 text-xs text-red-600 dark:text-red-400">Go to Plans & Pay to try again</div>}
              {myTrainerProfile && (
                <div className="mt-2 text-xs opacity-80">Trainer: <span className="font-semibold">{myTrainerProfile.full_name}</span></div>
              )}
            </div>
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-3">
                <Flame className="h-3.5 w-3.5 text-orange-500" /> Streak
              </div>
              <div className="font-display text-4xl">{streak}</div>
              <div className="text-xs text-muted-foreground mt-1">consecutive days</div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-3">
                <Calendar className="h-3.5 w-3.5 text-primary" /> This Month
              </div>
              <div className="font-display text-4xl">{attendanceThisMonth}</div>
              <div className="text-xs text-muted-foreground mt-1">days attended</div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-3">
                <Award className="h-3.5 w-3.5 text-amber-500" /> Goals
              </div>
              <div className="font-display text-4xl">{completedGoals.length}</div>
              <div className="text-xs text-muted-foreground mt-1">of {(goals ?? []).length} completed</div>
            </div>
          </div>

          {/* Monthly attendance calendar */}
          <div className="max-w-sm">
            <MonthlyAttendanceCalendar attendance={attendance ?? []} today={today} compact />
          </div>

          {/* Active goals snapshot */}
          {activeGoals.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold flex items-center gap-2"><Target className="h-4 w-4 text-primary" /> Active Goals</h3>
                <button onClick={() => navigate({ search: { tab: "goals" } })} className="text-xs text-primary hover:underline">View all</button>
              </div>
              <div className="space-y-3">
                {activeGoals.slice(0, 3).map(g => <GoalProgressBar key={g.id} goal={g} />)}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── GOALS ────────────────────────────────────────── */}
        <TabsContent value="goals">
          <div className="space-y-6">
            {/* Stats strip */}
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Active Goals"    value={String(activeGoals.length)}    icon={Target}    color="text-primary" />
              <StatCard label="Completed"       value={String(completedGoals.length)} icon={Award}     color="text-green-500" />
              <StatCard label="Attendance Streak" value={`${streak}d`}               icon={Flame}     color="text-orange-500" />
            </div>

            {/* Add goal */}
            {!showGoalForm ? (
              <Button onClick={() => setShowGoalForm(true)} className="gap-2">
                <Plus className="h-4 w-4" /> Add New Goal
              </Button>
            ) : (
              <div className="rounded-2xl border border-border bg-card p-6">
                <h3 className="mb-4 font-display text-xl">New Goal</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Type */}
                  <div className="sm:col-span-2 flex flex-wrap gap-2">
                    {GOAL_TYPES.map(t => (
                      <button key={t.id} onClick={() => { setGType(t.id); setGUnit(t.unit); }}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${gType === t.id ? "border-primary bg-primary/5 font-semibold" : "border-border bg-secondary/30 hover:border-primary/40"}`}>
                        <t.icon className="h-4 w-4" /> {t.label}
                      </button>
                    ))}
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Goal Title *</Label>
                    <Input className="mt-1" placeholder="e.g. Attend 20 days this month" value={gTitle} onChange={e => setGTitle(e.target.value)} />
                  </div>
                  <div>
                    <Label>Target Value</Label>
                    <Input className="mt-1" type="number" min={0} placeholder="e.g. 20" value={gTarget} onChange={e => setGTarget(e.target.value)} />
                  </div>
                  <div>
                    <Label>Unit</Label>
                    <Input className="mt-1" placeholder="days / kg / reps…" value={gUnit} onChange={e => setGUnit(e.target.value)} />
                  </div>
                  <div>
                    <Label>Deadline (optional)</Label>
                    <Input className="mt-1" type="date" value={gDeadline} onChange={e => setGDeadline(e.target.value)} />
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Input className="mt-1" placeholder="Any extra context…" value={gNotes} onChange={e => setGNotes(e.target.value)} />
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button onClick={() => createGoal.mutate()} disabled={createGoal.isPending}>
                    {createGoal.isPending ? "Saving…" : "Save Goal"}
                  </Button>
                  <Button variant="outline" onClick={resetGoalForm}>Cancel</Button>
                </div>
              </div>
            )}

            {/* Active goals */}
            {activeGoals.length > 0 && (
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">In Progress</h3>
                <div className="space-y-3">
                  {activeGoals.map(g => (
                    <GoalCard
                      key={g.id} goal={g}
                      attendanceThisMonth={attendanceThisMonth}
                      onUpdateProgress={(id, v) => updateGoalProgress.mutate({ id, current_value: v })}
                      onToggleDone={(id) => toggleGoalDone.mutate({ id, completed: true })}
                      onDelete={(id) => deleteGoal.mutate(id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Completed goals */}
            {completedGoals.length > 0 && (
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Completed</h3>
                <div className="space-y-2">
                  {completedGoals.map(g => (
                    <div key={g.id} className="flex items-center justify-between rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm opacity-70">
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                        <span className="line-through">{g.title}</span>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => toggleGoalDone.mutate({ id: g.id, completed: false })} className="text-xs text-muted-foreground hover:text-foreground px-2">Reopen</button>
                        <button onClick={() => deleteGoal.mutate(g.id)}><Trash2 className="h-4 w-4 text-destructive" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(goals ?? []).length === 0 && !showGoalForm && (
              <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
                <Target className="mx-auto h-10 w-10 mb-3 opacity-30" />
                <p className="font-medium">No goals yet</p>
                <p className="text-sm mt-1">Set your first fitness goal to track your progress</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── PLANS & PAY ──────────────────────────────────── */}
        <TabsContent value="pay">
          {blockPurchase && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-700 p-4">
              <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-green-800 dark:text-green-300">You have an active plan</div>
                <div className="text-sm text-green-700 dark:text-green-400">
                  Your <strong>{(membership as any)?.plans?.name}</strong> plan is active for {daysLeft} more days (until {new Date(membership!.valid_till!).toLocaleDateString("en-IN")}).
                  You can renew when it has 5 or fewer days remaining.
                </div>
              </div>
            </div>
          )}
          {hasPendingCash && (
            <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-4 flex items-center gap-3 text-sm text-amber-700 dark:text-amber-400">
              <Clock className="h-5 w-5 flex-shrink-0" />
              <span>You have a cash payment request awaiting admin approval. Pay the admin in person — your plan will activate once they confirm. New purchases are disabled until then.</span>
            </div>
          )}
          {hasDeclinedCash && (
            <div className="mb-4 rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-700 p-4 flex items-start gap-3 text-sm">
              <X className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-red-700 dark:text-red-400 mb-0.5">Cash payment not confirmed by admin</div>
                <div className="text-red-600 dark:text-red-500">Your previous cash payment request was declined. You can select a plan and try again — online payment or a new cash request.</div>
              </div>
            </div>
          )}
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <h3 className="font-semibold">Select Plan</h3>
              {(plans ?? []).map(p => (
                <button key={p.id} onClick={() => !blockPurchase && !hasPendingCash && setSelectedPlanId(p.id)}
                  className={`flex w-full items-center justify-between rounded-xl border p-4 text-left transition ${(blockPurchase || hasPendingCash) ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${(selectedPlanId ?? activePlan?.id) === p.id ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{p.name}</span>
                      {/* FIX #27: show trainer badge */}
                      {p.has_trainer && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">Trainer Included</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">{p.duration_days} days · {(p.features ?? []).slice(0, 2).join(", ")}</div>
                  </div>
                  <div className="font-display text-xl text-primary">₹{Number(p.price).toLocaleString("en-IN")}</div>
                </button>
              ))}
              <h3 className="pt-2 font-semibold">Payment Method</h3>
              {PAYMENT_METHODS.map(m => (
                <label key={m.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-2 sm:p-3 transition ${payMethod === m.id ? "border-primary bg-primary/5" : "border-border bg-card"} ${m.id === "cash" ? "border-dashed" : ""}`}>
                  <input type="radio" name="method" checked={payMethod === m.id} onChange={() => setPayMethod(m.id)} className="accent-primary" disabled={hasPendingCash} />
                  <m.icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{m.label}</span>
                </label>
              ))}
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 h-fit lg:sticky lg:top-6">
              <h3 className="mb-3 font-display text-xl sm:text-2xl">Bill Summary</h3>
              <Row k="Plan" v={activePlan?.name ?? "-"} />
              <Row k="Duration" v={
                isActive && membership?.valid_till
                  ? `${activePlan?.duration_days ?? 30} days + ${daysLeft} remaining = ${(activePlan?.duration_days ?? 30) + daysLeft} days total`
                  : `${activePlan?.duration_days ?? 30} days`
              } />
              <Row k="New Expiry" v={
                activePlan
                  ? (() => {
                      const base = (isActive && membership?.valid_till)
                        ? new Date(membership.valid_till + "T00:00:00")
                        : new Date();
                      const d = new Date(base);
                      d.setDate(d.getDate() + (activePlan?.duration_days ?? 30));
                      return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
                    })()
                  : "-"
              } />
              <Row k="Method" v={payMethod === "cash" ? "Cash (in person)" : payMethod.toUpperCase()} />
              <div className="my-3 border-t border-border" />
              <Row k="Total" v={`₹${activePlan?.price ? Number(activePlan.price).toLocaleString("en-IN") : 0}`} strong />
              {payMethod === "cash" ? (
                <div className="mt-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                  <Banknote className="h-4 w-4 flex-shrink-0" /> No online payment — hand the cash to the admin and they'll confirm to activate your plan.
                </div>
              ) : (
                <div className="mt-4 rounded-xl bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 p-3 flex items-center gap-2 text-xs text-orange-700 dark:text-orange-400">
                  <Smartphone className="h-4 w-4 flex-shrink-0" /> Powered by Razorpay · UPI, GPay, Cards & more
                </div>
              )}
              <Button onClick={handlePay} disabled={payLoading || !activePlan || blockPurchase || hasPendingCash} className="mt-4 w-full rounded-xl py-6 text-base shadow-[var(--shadow-glow)]">
                {payMethod === "cash" ? <Banknote className="mr-2 h-4 w-4" /> : <Lock className="mr-2 h-4 w-4" />}
                {hasPendingCash ? "Awaiting admin approval" : blockPurchase ? `Renew opens in ${Math.max(0, daysLeft - 5)} day${daysLeft - 5 !== 1 ? "s" : ""}` : payLoading ? (payMethod === "cash" ? "Submitting request…" : "Processing payment…") : payMethod === "cash" ? `Request Cash Payment · ₹${activePlan?.price ? Number(activePlan.price).toLocaleString("en-IN") : 0}` : `Pay ₹${activePlan?.price ? Number(activePlan.price).toLocaleString("en-IN") : 0}`}
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground flex items-center justify-center gap-1">
                {payMethod === "cash" ? (
                  <>Requires admin confirmation before your plan activates</>
                ) : (
                  <><Shield className="h-3 w-3" /> 256-bit SSL encrypted · PCI DSS compliant</>
                )}
              </p>
            </div>
          </div>
        </TabsContent>

        {/* ── WORKOUTS ─────────────────────────────────────── */}
        <TabsContent value="workouts">
          {myTrainerProfile && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary font-bold text-sm flex-shrink-0">
                {myTrainerProfile.full_name?.charAt(0) ?? "T"}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Your Trainer</p>
                <p className="font-semibold text-sm">{myTrainerProfile.full_name}</p>
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {(workouts ?? []).map(w => (
              <div key={w.id} className="rounded-xl border border-border bg-card p-4">
                <div className="font-semibold">{w.name}</div>
                {w.description && <div className="mt-1 text-sm text-muted-foreground">{w.description}</div>}
              </div>
            ))}
            {(!workouts || !workouts.length) && <p className="text-sm text-muted-foreground">No workouts assigned yet.</p>}
          </div>
        </TabsContent>

        {/* ── ATTENDANCE ───────────────────────────────────── */}
        <TabsContent value="attendance">
          <div className="space-y-4">
            {!isActive && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-4">
                <Lock className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-amber-800 dark:text-amber-300">Plan Required to Mark Attendance</div>
                  <div className="text-sm text-amber-700 dark:text-amber-400">Purchase an active plan to start marking daily attendance.</div>
                </div>
              </div>
            )}
            <div className="rounded-2xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="font-display text-xl">Today · {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</div>
                <div className="text-sm text-muted-foreground">
                  {!isActive ? "No active plan — cannot check in" : markedToday ? "You're checked in" : "Tap to mark yourself present"}
                </div>
              </div>
              <Button onClick={() => checkIn.mutate()} disabled={!isActive || markedToday || checkIn.isPending} className="rounded-xl">
                {markedToday ? <><CheckCircle2 className="mr-2 h-4 w-4" />Checked in</> : !isActive ? <><Lock className="mr-2 h-4 w-4" />No Plan</> : "Check in"}
              </Button>
            </div>

            {/* Stats row */}
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="This Month" value={String(attendanceThisMonth)} icon={Calendar} color="text-primary" />
              <StatCard label="Last 30 Days" value={String(attendanceLast30)} icon={BarChart2} color="text-blue-500" />
              <StatCard label="Current Streak" value={`${streak}d`} icon={Flame} color="text-orange-500" />
            </div>

            {/* Monthly calendar + weekly line chart side by side */}
            <div className="grid gap-4 lg:grid-cols-2">
              <MonthlyAttendanceCalendar attendance={attendance ?? []} today={today} />
              <WeeklyAttendanceChart attendance={attendance ?? []} />
            </div>

            <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <h3 className="mb-3 font-semibold">Recent Records</h3>
              <ul className="divide-y divide-border">
                {(attendance ?? []).slice(0, 20).map(a => (
                  <li key={a.id} className="flex justify-between py-2 text-sm">
                    <span>{new Date(a.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</span>
                    <div className="flex items-center gap-3">
                      {a.check_in_time && <span className="text-xs text-muted-foreground">{new Date(a.check_in_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>}
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary capitalize">{a.status}</span>
                    </div>
                  </li>
                ))}
                {(!attendance || !attendance.length) && <p className="text-sm text-muted-foreground py-2">No attendance yet.</p>}
              </ul>
            </div>
          </div>
        </TabsContent>

        {/* ── FEES ─────────────────────────────────────────── */}
        <TabsContent value="fees">
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Method</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Date</th></tr>
              </thead>
              <tbody>
                {(fees ?? []).map((f: any) => (
                  <tr key={f.id} className="border-t border-border">
                    <td className="px-4 py-3 font-medium">{f.plans?.name ?? "-"}</td>
                    <td className="px-4 py-3">₹{Number(f.amount).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-muted-foreground capitalize">{(f.method ?? "-").replace("razorpay_", "")}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${f.status === "paid" ? "bg-green-500/15 text-green-600" : "bg-amber-500/15 text-amber-600"}`}>{f.status}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(f.paid_at ?? f.created_at).toLocaleDateString("en-IN")}</td>
                  </tr>
                ))}
                {(!fees || !fees.length) && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No payments yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ── PROFILE ──────────────────────────────────────── */}
        <TabsContent value="profile">
          <div className="max-w-md rounded-2xl border border-border bg-card p-6">
            <h3 className="mb-6 font-display text-2xl">Edit Profile</h3>
            <div className="space-y-4">
              <div>
                <Label htmlFor="pname">Full Name *</Label>
                <Input id="pname" value={pName} onChange={e => setPName(e.target.value)}
                  placeholder="Your full name" maxLength={80}
                  className={`mt-1 ${pNameErr ? "border-destructive" : ""}`} />
                {pNameErr && <p className="mt-1 text-xs text-destructive">{pNameErr}</p>}
              </div>
              <div>
                <Label htmlFor="pphone">Phone Number</Label>
                <Input id="pphone" value={pPhone} onChange={e => setPPhone(e.target.value)}
                  placeholder="10-digit mobile number" maxLength={10}
                  className={`mt-1 ${pPhoneErr ? "border-destructive" : ""}`} />
                {pPhoneErr && <p className="mt-1 text-xs text-destructive">{pPhoneErr}</p>}
              </div>
              <div>
                <Label>Email</Label>
                <Input value={user?.email ?? ""} disabled className="mt-1 bg-secondary cursor-not-allowed" />
                <p className="mt-1 text-xs text-muted-foreground">Email cannot be changed</p>
              </div>
              <Button onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending} className="w-full">
                <Save className="mr-2 h-4 w-4" />{saveProfile.isPending ? "Saving..." : "Save Profile"}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </DashboardShell>
  );
}

// ── Sub-components ──────────────────────────────────────────────

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className={strong ? "font-display text-2xl" : "font-medium"}>{v}</span>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className={`flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-2`}>
        <Icon className={`h-3.5 w-3.5 ${color}`} /> {label}
      </div>
      <div className={`font-display text-2xl sm:text-3xl ${color}`}>{value}</div>
    </div>
  );
}

function MonthlyAttendanceCalendar({
  attendance, today, compact = false,
}: {
  attendance: any[];
  today: string;
  compact?: boolean;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const presentDates = new Set(attendance.map(a => a.date));
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const monthName = new Date(year, month).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    const n = new Date();
    if (year === n.getFullYear() && month === n.getMonth()) return;
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();

  type DayStatus = "present" | "absent" | "future" | "today";
  const days: { date: string; day: number; status: DayStatus }[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isFuture = dateStr > today;
    const isToday = dateStr === today;
    days.push({
      date: dateStr, day: d,
      status: isToday ? "today" : isFuture ? "future" : presentDates.has(dateStr) ? "present" : "absent",
    });
  }

  const presentCount = days.filter(d => d.status === "present").length;
  const absentCount = days.filter(d => d.status === "absent").length;
  const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth}
          className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-secondary transition">
          ‹ Prev
        </button>
        <span className="text-sm font-semibold">{monthName}</span>
        <button onClick={nextMonth} disabled={isCurrentMonth}
          className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-secondary transition disabled:opacity-40 disabled:cursor-not-allowed">
          Next ›
        </button>
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map(l => (
          <div key={l} className="text-center text-[10px] font-semibold text-muted-foreground py-1">{l}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
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

      {/* Legend + stats */}
      <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-green-500" /> Present</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-red-400/80" /> Absent</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-secondary" /> Not yet</span>
      </div>
      <div className="mt-3 flex gap-4 text-xs">
        <span className="text-green-600 font-semibold">{presentCount} present</span>
        <span className="text-red-500 font-semibold">{absentCount} absent</span>
        <span className="text-muted-foreground">{days.filter(d => d.status === "future").length} remaining</span>
      </div>
    </div>
  );
}

function WeeklyAttendanceChart({ attendance }: { attendance: any[] }) {
  const data = useMemo(() => {
    const result: { week: string; days: number }[] = [];
    const presentDates = new Set(attendance.map(a => a.date));
    // Build last 8 weeks
    for (let w = 7; w >= 0; w--) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() - w * 7);
      let count = 0;
      for (let d = 0; d < 7; d++) {
        const day = new Date(weekStart);
        day.setDate(weekStart.getDate() + d);
        const ds = day.toISOString().slice(0, 10);
        if (presentDates.has(ds)) count++;
      }
      const label = weekStart.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
      result.push({ week: label, days: count });
    }
    return result;
  }, [attendance]);

  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-4 flex flex-col">
      <div className="text-sm font-semibold mb-3 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" /> Weekly Attendance Trend
      </div>
      <div className="flex-1 min-h-[200px]">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="week"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[0, 7]}
              ticks={[0, 1, 2, 3, 4, 5, 6, 7]}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(v: number) => [`${v} day${v !== 1 ? "s" : ""}`, "Attended"]}
            />
            <Line
              type="linear"
              dataKey="days"
              stroke="#39ff14"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#39ff14", strokeWidth: 0 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">Days present per week — last 8 weeks</p>
    </div>
  );
}

function GoalProgressBar({ goal }: { goal: any }) {
  const pct = goal.target_value && goal.target_value > 0
    ? Math.min(100, Math.round((Number(goal.current_value) / Number(goal.target_value)) * 100))
    : null;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="font-medium">{goal.title}</span>
        <span className="text-muted-foreground text-xs">
          {goal.current_value ?? 0}{goal.unit ? ` ${goal.unit}` : ""}{goal.target_value ? ` / ${goal.target_value}${goal.unit ? ` ${goal.unit}` : ""}` : ""}
        </span>
      </div>
      {pct !== null && (
        <div className="h-2 w-full rounded-full bg-secondary">
          <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function GoalCard({ goal, attendanceThisMonth, onUpdateProgress, onToggleDone, onDelete }: {
  goal: any;
  attendanceThisMonth: number;
  onUpdateProgress: (id: string, v: number) => void;
  onToggleDone: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState(String(goal.current_value ?? 0));

  // Auto-fill attendance goals from real attendance data
  const autoValue = goal.goal_type === "attendance" ? attendanceThisMonth : null;
  const displayCurrent = autoValue !== null ? autoValue : Number(goal.current_value ?? 0);

  const pct = goal.target_value && Number(goal.target_value) > 0
    ? Math.min(100, Math.round((displayCurrent / Number(goal.target_value)) * 100))
    : null;

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{goal.title}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {goal.goal_type === "attendance" ? "Auto-tracked from attendance" : goal.unit || ""}
        {goal.deadline && (() => {
          const isOverdue = new Date(goal.deadline) < new Date();
          return (
            <span className={isOverdue ? "text-red-500 font-semibold" : ""}>
              {` · ${isOverdue ? "Overdue — was due" : "Due"} ${new Date(goal.deadline).toLocaleDateString("en-IN")}`}
            </span>
          );
        })()}
      </div>
          {goal.notes && <div className="text-xs text-muted-foreground mt-1 italic">{goal.notes}</div>}
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button onClick={() => onToggleDone(goal.id)} title="Mark complete"
            className="rounded-lg border border-border p-1.5 hover:border-green-500 hover:text-green-500 transition">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onDelete(goal.id)} title="Delete"
            className="rounded-lg border border-border p-1.5 hover:border-destructive hover:text-destructive transition">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Progress */}
      {goal.target_value && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>{displayCurrent} {goal.unit || ""}</span>
            <span>{goal.target_value} {goal.unit || ""} {pct !== null ? `· ${pct}%` : ""}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-secondary">
            <div className={`h-2 rounded-full transition-all ${pct === 100 ? "bg-green-500" : "bg-primary"}`}
              style={{ width: `${pct ?? 0}%` }} />
          </div>
        </div>
      )}

      {/* Manual progress update (not for attendance goals — those are auto-tracked) */}
      {goal.goal_type !== "attendance" && (
        <div className="mt-3">
          {editing ? (
            <div className="flex gap-2">
              <Input type="number" min={0} value={inputVal} onChange={e => setInputVal(e.target.value)}
                className="h-8 text-xs" />
              <Button size="sm" className="h-8 text-xs px-3" onClick={() => { onUpdateProgress(goal.id, Number(inputVal)); setEditing(false); }}>
                Save
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs px-3" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          ) : (
            <button onClick={() => { setInputVal(String(goal.current_value ?? 0)); setEditing(true); }}
              className="text-xs text-primary hover:underline">
              Update progress
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden w-64 border-r border-border bg-sidebar md:flex flex-col p-4 gap-2">
        <div className="h-12 w-36 animate-pulse rounded-xl bg-white/10 mb-6" />
        {[1,2,3,4,5].map(i => <div key={i} className="h-10 animate-pulse rounded-xl bg-white/10" />)}
      </div>
      <div className="flex-1 p-4 sm:p-6 space-y-4">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-secondary" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1,2,3,4].map(i => <div key={i} className="h-28 animate-pulse rounded-2xl bg-secondary" />)}
        </div>
        <div className="h-64 animate-pulse rounded-2xl bg-secondary" />
      </div>
    </div>
  );
}
