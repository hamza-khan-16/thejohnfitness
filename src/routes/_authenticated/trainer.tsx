import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardShell, type NavItem } from "@/components/DashboardShell";
import { supabase } from "@/integrations/supabase/client";
import {
  LayoutDashboard, Users, Activity, Calendar, Trash2,
  CheckCircle2, User as UserIcon, Save, Plus, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/trainer")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab as string) || "overview",
  }),
  component: TrainerDashboard,
});

const nav: NavItem[] = [
  { to: "/trainer", label: "Overview",   icon: LayoutDashboard, tab: "overview"   },
  { to: "/trainer", label: "My Members", icon: Users,           tab: "members"    },
  { to: "/trainer", label: "Schedule",   icon: Calendar,        tab: "schedule"   },
  { to: "/trainer", label: "Workouts",   icon: Activity,        tab: "workouts"   },
  { to: "/trainer", label: "Attendance", icon: Calendar,        tab: "attendance" },
  { to: "/trainer", label: "My Profile", icon: UserIcon,        tab: "profile"    },
];

function TrainerDashboard() {
  const { role, loading } = useAuth();
  const navigate = Route.useNavigate();

  useEffect(() => {
    if (!loading && role && role !== "trainer") navigate({ to: role === "admin" ? "/admin" : "/dashboard" });
  }, [role, loading]);

  if (loading) return <TrainerSkeleton />;
  if (!role || role !== "trainer") return null;
  return <TrainerDashboardInner />;
}

function TrainerDashboardInner() {
  const { user } = useAuth();
  const navigate = Route.useNavigate();
  const { tab } = Route.useSearch();
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  // Profile state
  const [pName, setPName] = useState(""); const [pPhone, setPPhone] = useState("");
  const [pNameErr, setPNameErr] = useState(""); const [pPhoneErr, setPPhoneErr] = useState("");

  // Workout form
  const [wName, setWName] = useState(""); const [wDesc, setWDesc] = useState("");
  const [wNameErr, setWNameErr] = useState(""); const [wMemberId, setWMemberId] = useState("");

  // Schedule form
  const [schedTitle, setSchedTitle] = useState("");
  const [schedMember, setSchedMember] = useState("");
  const [schedAt, setSchedAt] = useState("");
  const [schedNotes, setSchedNotes] = useState("");

  const { data: profile, isSuccess: profileLoaded } = useQuery({
    enabled: !!user,
    queryKey: ["profile", user?.id],
    queryFn: async () => (await supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle()).data,
  });

  useEffect(() => {
    if (profileLoaded && profile) { setPName(profile.full_name ?? ""); setPPhone(profile.phone ?? ""); }
  }, [profileLoaded, profile]);

  // Only members assigned to this trainer
  const { data: assignedMemberIds, isLoading: assignmentsLoading } = useQuery({
    enabled: !!user,
    queryKey: ["my-assigned-members", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("trainer_assignments").select("member_id").eq("trainer_id", user!.id);
      return (data ?? []).map(r => r.member_id);
    },
  });

  const { data: myMembers } = useQuery({
    enabled: !!assignedMemberIds && assignedMemberIds.length > 0,
    queryKey: ["my-members-data", assignedMemberIds?.join(",")],
    queryFn: async () => {
      if (!assignedMemberIds?.length) return [];
      const { data } = await supabase.from("profiles").select("id,full_name,phone,created_at").in("id", assignedMemberIds!);
      return data ?? [];
    },
  });

  // Memberships for assigned members
  const { data: memberMemberships } = useQuery({
    enabled: !!assignedMemberIds && assignedMemberIds.length > 0,
    queryKey: ["my-members-memberships", assignedMemberIds?.join(",")],
    queryFn: async () => {
      if (!assignedMemberIds?.length) return [];
      const { data } = await supabase.from("memberships").select("*,plans(name,has_trainer)")
        .in("user_id", assignedMemberIds!).eq("status", "active");
      return data ?? [];
    },
  });

  // Workouts created by this trainer
  const { data: workouts } = useQuery({
    enabled: !!user,
    queryKey: ["trainer-workouts", user?.id],
    queryFn: async () => (await supabase.from("workouts").select("*").eq("trainer_id", user!.id).order("created_at", { ascending: false })).data ?? [],
  });

  // Attendance for assigned members only
  const { data: attendance } = useQuery({
    enabled: !!assignedMemberIds && assignedMemberIds.length > 0,
    queryKey: ["my-members-attendance", assignedMemberIds?.join(",")],
    queryFn: async () => {
      if (!assignedMemberIds?.length) return [];
      const { data } = await supabase.from("attendance").select("*").in("user_id", assignedMemberIds!).order("date", { ascending: false }).limit(100);
      return data ?? [];
    },
  });

  // Schedules created by this trainer
  const { data: schedules } = useQuery({
    enabled: !!user,
    queryKey: ["trainer-schedules", user?.id],
    queryFn: async () => (await supabase.from("trainer_schedules").select("*").eq("trainer_id", user!.id).order("scheduled_at")).data ?? [],
  });

  const presentTodayIds = new Set((attendance ?? []).filter(a => a.date === today).map(a => a.user_id));

  const nameById = (id: string) => myMembers?.find(m => m.id === id)?.full_name || id.slice(0, 8);

  // ── MUTATIONS ────────────────────────────────────────────────────
  const createWorkout = useMutation({
    mutationFn: async () => {
      if (!wName.trim() || wName.trim().length < 2) { setWNameErr("Name must be at least 2 characters"); throw new Error("Validation"); }
      setWNameErr("");
      const { error } = await supabase.from("workouts").insert({
        name: wName.trim(), description: wDesc.trim() || null,
        trainer_id: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Workout added"); setWName(""); setWDesc(""); setWMemberId(""); qc.invalidateQueries({ queryKey: ["trainer-workouts", user?.id] }); },
    onError: (e: Error) => { if (e.message !== "Validation") toast.error(e.message); },
  });

  const deleteWorkout = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("workouts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Workout removed"); qc.invalidateQueries({ queryKey: ["trainer-workouts", user?.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const markPresent = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from("attendance").insert({
        user_id: userId, status: "present", date: today,
        check_in_time: new Date().toISOString(),
      });
      if (error && !error.message.includes("unique")) throw error;
    },
    onSuccess: () => { toast.success("Marked present"); qc.invalidateQueries({ queryKey: ["my-members-attendance", assignedMemberIds?.join(",")] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const createSchedule = useMutation({
    mutationFn: async () => {
      if (!schedTitle.trim()) throw new Error("Title is required");
      if (!schedAt) throw new Error("Date & time is required");
      const { error } = await supabase.from("trainer_schedules").insert({
        trainer_id: user!.id,
        member_id: schedMember || null,
        title: schedTitle.trim(),
        notes: schedNotes.trim() || null,
        scheduled_at: new Date(schedAt).toISOString(),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Session scheduled");
      setSchedTitle(""); setSchedMember(""); setSchedAt(""); setSchedNotes("");
      qc.invalidateQueries({ queryKey: ["trainer-schedules", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteSchedule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("trainer_schedules").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Session removed"); qc.invalidateQueries({ queryKey: ["trainer-schedules", user?.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveProfile = useMutation({
    mutationFn: async () => {
      let hasErr = false;
      if (!pName.trim() || pName.trim().length < 2) { setPNameErr("Min 2 characters"); hasErr = true; } else setPNameErr("");
      if (pPhone && !/^[6-9]\d{9}$/.test(pPhone.replace(/\s/g, ""))) { setPPhoneErr("Valid 10-digit number"); hasErr = true; } else setPPhoneErr("");
      if (hasErr) throw new Error("Validation");
      const { error } = await supabase.from("profiles").update({ full_name: pName.trim(), phone: pPhone.trim(), updated_at: new Date().toISOString() }).eq("id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Profile saved!"); qc.invalidateQueries({ queryKey: ["profile", user?.id] }); },
    onError: (e: Error) => { if (e.message !== "Validation") toast.error(e.message); },
  });

  const hasNoMembers = !assignmentsLoading && (!assignedMemberIds || assignedMemberIds.length === 0);

  return (
    <DashboardShell title="Trainer Dashboard" nav={nav}>
      <Tabs value={tab} onValueChange={(v) => navigate({ search: { tab: v } })}>
        <div className="overflow-x-auto"><TabsList className="mb-4 w-max">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">My Members</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="workouts">Workouts</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
        </TabsList></div>

        {/* ── OVERVIEW ───────────────────────────────────── */}
        <TabsContent value="overview">
          <div className="grid gap-4 sm:grid-cols-3 mb-6">
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Assigned Members</div>
              <div className="mt-3 font-display text-4xl">{assignedMemberIds?.length ?? 0}</div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Workouts Created</div>
              <div className="mt-3 font-display text-4xl">{workouts?.length ?? 0}</div>
            </div>
            <div className="rounded-2xl bg-primary p-5 text-primary-foreground">
              <div className="text-xs uppercase tracking-wider opacity-70">Present Today</div>
              <div className="mt-3 font-display text-4xl">{presentTodayIds.size}</div>
            </div>
          </div>

          {/* Today's schedule */}
          {(schedules ?? []).filter(s => s.scheduled_at.startsWith(today)).length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5 mb-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /> Today's Sessions</h3>
              <div className="space-y-2">
                {(schedules ?? []).filter(s => s.scheduled_at.startsWith(today)).map(s => (
                  <div key={s.id} className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
                    <div>
                      <div className="font-semibold">{s.title}</div>
                      {s.member_id && <div className="text-xs text-muted-foreground">with {nameById(s.member_id)}</div>}
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(s.scheduled_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasNoMembers && (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
              <Users className="mx-auto h-10 w-10 mb-3 opacity-30" />
              <p className="font-medium">No members assigned yet</p>
              <p className="text-sm mt-1">Ask the admin to assign members to you.</p>
            </div>
          )}
        </TabsContent>

        {/* ── MY MEMBERS ─────────────────────────────────── */}
        <TabsContent value="members">
          {hasNoMembers ? (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
              <Users className="mx-auto h-10 w-10 mb-3 opacity-30" />
              <p className="font-medium">No members assigned</p>
              <p className="text-sm mt-1">Contact admin to assign members to your account.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3">Valid Till</th>
                    <th className="px-4 py-3 text-right">Today</th>
                  </tr>
                </thead>
                <tbody>
                  {(myMembers ?? []).map(m => {
                    const present = presentTodayIds.has(m.id);
                    const membership = (memberMemberships ?? []).find(mem => mem.user_id === m.id);
                    return (
                      <tr key={m.id} className="border-t border-border">
                        <td className="px-4 py-3 font-medium">{m.full_name || "Unnamed"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{m.phone || "-"}</td>
                        <td className="px-4 py-3 text-xs">{(membership as any)?.plans?.name || "No active plan"}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {membership?.valid_till ? new Date(membership.valid_till).toLocaleDateString("en-IN") : "-"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {present
                            ? <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary"><CheckCircle2 className="h-3 w-3" />Present</span>
                            : <Button size="sm" variant="outline" onClick={() => markPresent.mutate(m.id)} disabled={markPresent.isPending}>Mark Present</Button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ── SCHEDULE ───────────────────────────────────── */}
        <TabsContent value="schedule">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-6">
              <h3 className="mb-4 font-display text-2xl">Add Session</h3>
              <div className="space-y-3">
                <div>
                  <Label>Session Title *</Label>
                  <Input className="mt-1" placeholder="e.g. Chest & Triceps" value={schedTitle} onChange={e => setSchedTitle(e.target.value)} />
                </div>
                <div>
                  <Label>Member (optional)</Label>
                  <select value={schedMember} onChange={e => setSchedMember(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm">
                    <option value="">— Group / No specific member —</option>
                    {(myMembers ?? []).map(m => <option key={m.id} value={m.id}>{m.full_name || m.id.slice(0, 8)}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Date & Time *</Label>
                  <Input type="datetime-local" className="mt-1" value={schedAt} onChange={e => setSchedAt(e.target.value)}
                    min={new Date().toISOString().slice(0, 16)} />
                </div>
                <div>
                  <Label>Notes</Label>
                  <Textarea className="mt-1" placeholder="Any notes for this session..." value={schedNotes} onChange={e => setSchedNotes(e.target.value)} />
                </div>
                <Button onClick={() => createSchedule.mutate()} disabled={createSchedule.isPending} className="w-full rounded-xl">
                  {createSchedule.isPending ? "Scheduling…" : "Add to Schedule"}
                </Button>
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Upcoming Sessions</h3>
              <div className="space-y-2">
                {(schedules ?? []).filter(s => new Date(s.scheduled_at) >= new Date()).map(s => (
                  <div key={s.id} className="flex items-start justify-between rounded-xl border border-border bg-card p-4">
                    <div>
                      <div className="font-semibold">{s.title}</div>
                      {s.member_id && <div className="text-xs text-muted-foreground mt-0.5">with {nameById(s.member_id)}</div>}
                      {s.notes && <div className="text-xs text-muted-foreground mt-0.5 italic">{s.notes}</div>}
                      <div className="text-xs text-primary mt-1">
                        {new Date(s.scheduled_at).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} · {new Date(s.scheduled_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => deleteSchedule.mutate(s.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
                {!(schedules ?? []).filter(s => new Date(s.scheduled_at) >= new Date()).length && (
                  <p className="text-sm text-muted-foreground">No upcoming sessions.</p>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── WORKOUTS ───────────────────────────────────── */}
        <TabsContent value="workouts">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-6">
              <h3 className="mb-4 font-display text-2xl">Add Workout</h3>
              <div className="space-y-3">
                <div>
                  <Label>Name *</Label>
                  <Input className={`mt-1 ${wNameErr ? "border-destructive" : ""}`} placeholder="e.g. Full Body Circuit"
                    value={wName} onChange={e => { setWName(e.target.value); setWNameErr(""); }} maxLength={100} />
                  {wNameErr && <p className="mt-1 text-xs text-destructive">{wNameErr}</p>}
                </div>
                <div>
                  <Label>Description</Label>
                  <Textarea className="mt-1" placeholder="Describe the workout..." value={wDesc} onChange={e => setWDesc(e.target.value)} maxLength={500} />
                </div>
                <Button disabled={createWorkout.isPending} onClick={() => createWorkout.mutate()} className="w-full rounded-xl">
                  {createWorkout.isPending ? "Adding…" : "Add Workout"}
                </Button>
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">My Workouts</h3>
              <div className="space-y-2">
                {(workouts ?? []).map(w => (
                  <div key={w.id} className="flex items-start justify-between rounded-xl border border-border bg-card p-4">
                    <div>
                      <div className="font-semibold">{w.name}</div>
                      {w.description && <div className="text-xs text-muted-foreground mt-0.5">{w.description}</div>}
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => deleteWorkout.mutate(w.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
                {(!workouts || !workouts.length) && <p className="text-sm text-muted-foreground">No workouts yet.</p>}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── ATTENDANCE ─────────────────────────────────── */}
        <TabsContent value="attendance">
          {hasNoMembers ? (
            <p className="text-sm text-muted-foreground">No assigned members to show attendance for.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Member</th>
                    <th className="px-4 py-3">Check-In Time</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(attendance ?? []).map(a => (
                    <tr key={a.id} className="border-t border-border">
                      <td className="px-4 py-3">{new Date(a.date).toLocaleDateString("en-IN")}</td>
                      <td className="px-4 py-3 font-medium">{nameById(a.user_id)}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {a.check_in_time ? new Date(a.check_in_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary capitalize">{a.status}</span>
                      </td>
                    </tr>
                  ))}
                  {(!attendance || !attendance.length) && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No records yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ── PROFILE ────────────────────────────────────── */}
        <TabsContent value="profile">
          <div className="max-w-md rounded-2xl border border-border bg-card p-6">
            <h3 className="mb-6 font-display text-2xl">My Profile</h3>
            <div className="space-y-4">
              <div>
                <Label>Full Name *</Label>
                <Input value={pName} onChange={e => setPName(e.target.value)} placeholder="Full name" maxLength={80}
                  className={`mt-1 ${pNameErr ? "border-destructive" : ""}`} />
                {pNameErr && <p className="mt-1 text-xs text-destructive">{pNameErr}</p>}
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={pPhone} onChange={e => setPPhone(e.target.value)} placeholder="10-digit mobile" maxLength={10}
                  className={`mt-1 ${pPhoneErr ? "border-destructive" : ""}`} />
                {pPhoneErr && <p className="mt-1 text-xs text-destructive">{pPhoneErr}</p>}
              </div>
              <div>
                <Label>Email</Label>
                <Input value={user?.email ?? ""} disabled className="mt-1 bg-secondary cursor-not-allowed" />
              </div>
              <Button onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending} className="w-full">
                <Save className="mr-2 h-4 w-4" />{saveProfile.isPending ? "Saving…" : "Save Profile"}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </DashboardShell>
  );
}

function TrainerSkeleton() {
  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden w-64 border-r border-border bg-sidebar md:flex flex-col p-4 gap-2">
        <div className="h-12 w-36 animate-pulse rounded-xl bg-white/10 mb-6" />
        {[1,2,3,4,5,6].map(i => <div key={i} className="h-10 animate-pulse rounded-xl bg-white/10" />)}
      </div>
      <div className="flex-1 p-6 space-y-4">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-secondary" />
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
          {[1,2,3].map(i => <div key={i} className="h-28 animate-pulse rounded-2xl bg-secondary" />)}
        </div>
        <div className="h-48 animate-pulse rounded-2xl bg-secondary" />
      </div>
    </div>
  );
}
