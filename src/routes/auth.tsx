import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { claimAdminRole, insertOtpAndRequest, verifyOtpServerFn, forgotPasswordSendOtp, forgotPasswordReset, verifyForgotOtp, checkApprovalStatus, findUnverifiedSignup } from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/Logo";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Mail, Lock, User, Phone, Eye, EyeOff,
  Dumbbell, Activity, ShieldCheck, Check, KeyRound, CheckCircle2,
  Clock, XCircle,
} from "lucide-react";
import { toast } from "sonner";

// Keep role cache in sync with _authenticated/route.tsx so beforeLoad hits cache
const ROLE_CACHE_KEY = "gym_user_role";
function setCachedRole(userId: string, role: string) {
  try { sessionStorage.setItem(ROLE_CACHE_KEY, JSON.stringify({ id: userId, role })); } catch {}
}

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Login / Sign Up — The John Fitness" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    blocked: (search.blocked as string) || "",
  }),
  component: AuthPage,
});

type AuthMode = "member" | "trainer";

function validateEmail(v: string) {
  if (!v.trim()) return "Email is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return "Enter a valid email";
  return null;
}
function validatePassword(v: string, isLogin = false) {
  if (!v) return "Password is required";
  if (!isLogin && v.length < 6) return "Min 6 characters";
  return null;
}
function validatePhone(v: string) {
  if (!v.trim()) return "Phone number is required";
  if (!/^[6-9]\d{9}$/.test(v.replace(/\s/g, ""))) return "Enter valid 10-digit Indian mobile number";
  return null;
}

function AuthPage() {
  const navigate = useNavigate();
  const { blocked } = Route.useSearch();
  const [loading, setLoading] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("member");
  const [showAdminLogin, setShowAdminLogin] = useState(false);

  // OTP step
  const [otpStep, setOtpStep] = useState(false);
  const [pendingUser, setPendingUser] = useState<{
    id: string; name: string; phone: string; email: string; role: "user" | "trainer";
  } | null>(null);
  const [otpInput, setOtpInput] = useState("");
  const [otpError, setOtpError] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null); // shown in UI when email isn't configured
  const [pendingEmail, setPendingEmail] = useState(""); // email used to check approval status

  // FIX #1/#16: pre-set from route redirect param so the right screen shows immediately
  const [requestStatus, setRequestStatus] = useState<{
    status: "pending" | "rejected"; reason?: string;
  } | null>(
    blocked === "pending" ? { status: "pending" } :
    blocked === "rejected" ? { status: "rejected" } :
    null
  );

  // Login
  const [email, setEmail] = useState(""); const [emailErr, setEmailErr] = useState("");
  const [pwd, setPwd] = useState(""); const [pwdErr, setPwdErr] = useState("");
  const [showPwd, setShowPwd] = useState(false);

  // Signup
  const [name, setName] = useState(""); const [nameErr, setNameErr] = useState("");
  const [phone, setPhone] = useState(""); const [phoneErr, setPhoneErr] = useState("");
  const [sEmail, setSEmail] = useState(""); const [sEmailErr, setSEmailErr] = useState("");
  const [sPwd, setSPwd] = useState(""); const [sPwdErr, setSPwdErr] = useState("");
  const [showSPwd, setShowSPwd] = useState(false);

  // Forgot password
  const [forgotStep, setForgotStep] = useState<"idle" | "email" | "otp" | "newpwd">("idle");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotUserId, setForgotUserId] = useState("");
  const [forgotOtp, setForgotOtp] = useState("");
  const [forgotOtpErr, setForgotOtpErr] = useState("");
  const [forgotNewPwd, setForgotNewPwd] = useState("");
  const [forgotNewPwdErr, setForgotNewPwdErr] = useState("");
  const [showForgotPwd, setShowForgotPwd] = useState(false);
  const [forgotDevOtp, setForgotDevOtp] = useState<string | null>(null);

  // Admin
  const [adminEmail, setAdminEmail] = useState(""); const [adminEmailErr, setAdminEmailErr] = useState("");
  const [adminPwd, setAdminPwd] = useState(""); const [adminPwdErr, setAdminPwdErr] = useState("");
  const [adminCode, setAdminCode] = useState("");
  const [showAdminPwd, setShowAdminPwd] = useState(false);

  // ── FORGOT PASSWORD ──────────────────────────────────────────────
  async function handleForgotSendOtp(e: React.FormEvent) {
    e.preventDefault();
    const err = validateEmail(forgotEmail);
    if (err) { toast.error(err); return; }
    setLoading(true);
    try {
      const res = await forgotPasswordSendOtp({ data: { email: forgotEmail.trim() } });
      setForgotUserId(res.userId);
      if (res.devOtp) setForgotDevOtp(res.devOtp);
      setForgotStep("otp");
      toast.success(`OTP sent to ${forgotEmail.trim()} — check your inbox.`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send OTP.");
    } finally { setLoading(false); }
  }

  async function handleForgotVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (forgotOtp.length !== 6) { setForgotOtpErr("Enter the 6-digit OTP"); return; }
    setLoading(true);
    try {
      await verifyForgotOtp({ data: { userId: forgotUserId, otp: forgotOtp } });
      setForgotOtpErr("");
      setForgotStep("newpwd");
    } catch (e: any) {
      setForgotOtpErr(e?.message ?? "Invalid OTP.");
      // FIX #11: clear the stale dev-mode OTP banner — that code is now dead
      setForgotDevOtp(null);
    } finally { setLoading(false); }
  }

  async function handleForgotReset(e: React.FormEvent) {
    e.preventDefault();
    if (forgotNewPwd.length < 6) { setForgotNewPwdErr("Min 6 characters"); return; }
    setLoading(true);
    try {
      await forgotPasswordReset({ data: { userId: forgotUserId, newPassword: forgotNewPwd } });
      toast.success("Password reset! You can now log in with your new password.");
      setForgotStep("idle");
      setForgotEmail(""); setForgotOtp(""); setForgotNewPwd("");
    } catch (e: any) {
      setForgotNewPwdErr(e?.message ?? "Failed to reset password.");
    } finally { setLoading(false); }
  }

  async function routeByRole(role: string) {
    // Role already resolved — just navigate directly, no extra DB call
    navigate({ to: role === "admin" ? "/admin" : role === "trainer" ? "/trainer" : "/dashboard" });
  }

  // ── LOGIN ────────────────────────────────────────────────────────
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const eErr = validateEmail(email);
    const pErr = validatePassword(pwd, true);
    setEmailErr(eErr ?? ""); setPwdErr(pErr ?? "");
    if (eErr || pErr) return;
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pwd });
    if (error) { setLoading(false); toast.error(error.message); return; }

    if (data.user) {
      // Single parallel fetch — role + request status in one round trip
      const [roleRes, reqRes] = await Promise.all([
        supabase.from("user_roles").select("role")
          .eq("user_id", data.user.id)
          .order("role") // admin < trainer < user alphabetically — predictable
          .limit(5),     // get all roles so we pick the highest privilege
        supabase.from("membership_requests")
          .select("status, reject_reason")
          .eq("user_id", data.user.id)
          .maybeSingle(),
      ]);

      const roles = (roleRes.data ?? []).map(r => r.role as string);
      const role = roles.includes("admin") ? "admin"
        : roles.includes("trainer") ? "trainer"
        : "user";
      const req = reqRes.data;

      // ── UNVERIFIED SIGNUP ───────────────────────────────────────
      // No role row AND no membership_request row means this account was
      // created by signUp() but the user never completed OTP verification
      // (they clicked "Go back" or closed the tab). verifyOtpServerFn is what
      // inserts the membership_request — without it, there's no record this
      // account should be allowed in at all. Block and send them back to verify.
      if (roles.length === 0 && !req) {
        await supabase.auth.signOut();
        setLoading(false);
        toast.error("Please verify your email with the OTP sent during signup before logging in.");
        return;
      }

      // ── REQUEST STATUS FIRST ───────────────────────────────────
      // A pending/rejected user's actual status is more informative than a
      // generic portal-mismatch error, and takes priority over it.
      if (req?.status === "pending") {
        await supabase.auth.signOut();
        setLoading(false);
        setPendingEmail(email.trim());
        setRequestStatus({ status: "pending" });
        return;
      }

      if (req?.status === "rejected") {
        await supabase.auth.signOut();
        setLoading(false);
        setPendingEmail(email.trim());
        setRequestStatus({ status: "rejected", reason: req.reject_reason ?? undefined });
        return;
      }

      // ── PORTAL ENFORCEMENT ───────────────────────────────────────
      // Each role must use its own login portal — block cross-portal logins.

      if (role === "admin") {
        // Admin tried to log in through the member/trainer form
        await supabase.auth.signOut();
        setLoading(false);
        toast.error("Admins must use the Admin Login portal.");
        return;
      }

      if (role === "trainer" && authMode !== "trainer") {
        // Trainer tried to log in through the Member tab
        await supabase.auth.signOut();
        setLoading(false);
        toast.error("Trainers must log in using the Trainer portal.");
        return;
      }

      if (role === "user" && authMode !== "member") {
        // Member tried to log in through the Trainer tab
        await supabase.auth.signOut();
        setLoading(false);
        toast.error("Members must log in using the Member portal.");
        return;
      }

      // Cache the resolved role so _authenticated/route.tsx beforeLoad skips DB calls
      setCachedRole(data.user.id, role);

      // Approved or no request (legacy user) — navigate directly with resolved role
      setLoading(false);
      routeByRole(role);
    }
  }

  // ── SIGNUP ───────────────────────────────────────────────────────
  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim().length < 2) { setNameErr("Min 2 characters"); return; } setNameErr("");
    const phErr = validatePhone(phone);
    if (phErr) { setPhoneErr(phErr); return; } setPhoneErr("");
    const eErr = validateEmail(sEmail);
    if (eErr) { setSEmailErr(eErr); return; } setSEmailErr("");
    const pErr = validatePassword(sPwd);
    if (pErr) { setSPwdErr(pErr); return; } setSPwdErr("");
    setLoading(true);

    const role = authMode;
    const { data, error } = await supabase.auth.signUp({
      email: sEmail.trim(),
      password: sPwd,
      options: {
        data: { full_name: name.trim(), phone: phone.trim(), role: role === "trainer" ? "trainer" : "user" },
      },
    });
    setLoading(false);

    if (error) {
      if (error.message.toLowerCase().includes("already registered") ||
          error.message.toLowerCase().includes("already exists")) {
        // FIX #20: this could be a genuinely existing account, OR an abandoned
        // signup that never finished OTP verification (e.g. they hit "Go back"
        // or closed the tab on the OTP screen). Check before dead-ending them
        // with "please log in" — login would just reject them again.
        setLoading(true);
        try {
          const resume = await findUnverifiedSignup({ data: { email: sEmail.trim() } });
          if (resume.resumable && resume.userId) {
            const result = await insertOtpAndRequest({
              data: {
                userId: resume.userId,
                fullName: name.trim(),
                email: sEmail.trim(),
                phone: phone.trim(),
                role: role === "trainer" ? "trainer" : "user",
              },
            });
            setLoading(false);
            if (result?.devOtp) setDevOtp(result.devOtp);
            setPendingUser({ id: resume.userId, name: name.trim(), phone: phone.trim(), email: sEmail.trim(), role: role === "trainer" ? "trainer" : "user" });
            setOtpStep(true);
            toast.success(`Resuming your previous signup — OTP sent to ${sEmail.trim()}.`);
            return;
          }
        } catch (resumeErr: any) {
          setLoading(false);
          // Likely the OTP cooldown — surface it directly instead of the generic message.
          toast.error(resumeErr?.message ?? "Could not resend OTP. Please try again shortly.");
          return;
        }
        setLoading(false);
        setSEmailErr("An account with this email already exists. Please log in.");
      } else {
        toast.error(error.message);
      }
      return;
    }
    if (!data.user) { toast.error("Signup failed. Please try again."); return; }

    // CRITICAL: Sign out immediately — if Supabase has email confirmation disabled,
    // signUp() auto-confirms the user and creates a live session. We must destroy it
    // NOW before the OTP screen shows, otherwise the auth state change listener will
    // route the user into the app without OTP verification.
    await supabase.auth.signOut();

    // OTP is generated server-side inside insertOtpAndRequest
    try {
      const result = await insertOtpAndRequest({
        data: {
          userId: data.user.id,
          fullName: name.trim(),
          email: sEmail.trim(),
          phone: phone.trim(),
          role: role === "trainer" ? "trainer" : "user",
        },
      });
      if (result?.devOtp) setDevOtp(result.devOtp);
    } catch (err: any) {
      toast.error("Signup error: " + err?.message);
      return;
    }

    setPendingUser({ id: data.user.id, name: name.trim(), phone: phone.trim(), email: sEmail.trim(), role: role === "trainer" ? "trainer" : "user" });
    setOtpStep(true);
    toast.success(`OTP sent to ${sEmail.trim()} — check your inbox.`);
  }

  // ── OTP VERIFY ───────────────────────────────────────────────────
  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingUser) return;
    if (!otpInput.trim() || otpInput.length !== 6) { setOtpError("Enter the 6-digit OTP"); return; }
    setLoading(true);

    // FIX #2: Use server fn for OTP verify — works regardless of email confirm status
    try {
      await verifyOtpServerFn({ data: { userId: pendingUser.id, otp: otpInput.trim(), fullName: pendingUser.name, email: pendingUser.email, phone: pendingUser.phone } });
    } catch (err: any) {
      setLoading(false);
      setOtpError(err?.message ?? "Invalid or expired OTP.");
      // FIX #11: a wrong/used OTP means the dev-mode banner (if shown) is now
      // stale — clear it so the user isn't tempted to retry an already-dead code.
      setDevOtp(null);
      return;
    }

    // Sign out — they can't use the app until approved
    await supabase.auth.signOut();
    setLoading(false);
    setOtpStep(false);
    setPendingEmail(pendingUser.email);
    setRequestStatus({ status: "pending" });
    toast.success("OTP verified! Your account is pending admin approval.");
  }

  // ── ADMIN LOGIN ──────────────────────────────────────────────────
  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault();
    const eErr = validateEmail(adminEmail);
    const pErr = validatePassword(adminPwd, true);
    setAdminEmailErr(eErr ?? ""); setAdminPwdErr(pErr ?? "");
    if (eErr || pErr) return;
    if (!adminCode.trim()) { toast.error("Admin code is required."); return; }

    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: adminEmail.trim(), password: adminPwd,
    });
    if (error) { setLoading(false); toast.error(error.message); return; }

    if (data.user) {
      // FIX #13: if this account is already a confirmed admin, skip the
      // claimAdminRole round-trip (count query + role lookup) entirely —
      // just verify the role directly. The admin code is still required as
      // a UI gate so a stolen password alone can't get past this screen,
      // but it no longer touches the one-time-claim logic for existing admins.
      const { data: existingAdminRole } = await supabase
        .from("user_roles").select("user_id").eq("user_id", data.user.id).eq("role", "admin").maybeSingle();

      if (existingAdminRole) {
        setLoading(false);
        toast.success("Welcome, Admin!");
        setCachedRole(data.user.id, "admin");
        navigate({ to: "/admin" });
        return;
      }

      // Not yet an admin — attempt the one-time claim
      try {
        const result = await claimAdminRole({ data: { code: adminCode.trim(), flow: "dashboard" } });
        setLoading(false);
        toast.success(result.alreadyAdmin ? "Welcome, Admin!" : "Admin access granted!");
        setCachedRole(data.user.id, "admin");
        navigate({ to: "/admin" });
      } catch (err: any) {
        await supabase.auth.signOut();
        setLoading(false);
        toast.error(err?.message ?? "Invalid admin code.");
      }
    }
  }

  // ── PENDING/REJECTED SCREEN ──────────────────────────────────────
  if (requestStatus) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm text-center">
          <Link to="/"><Logo /></Link>
          <div className="mt-8 rounded-2xl border border-border bg-card p-8">
            {requestStatus.status === "pending" ? (
              <>
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15">
                  <Clock className="h-8 w-8 text-amber-500" />
                </div>
                <h2 className="font-display text-2xl mb-2">Awaiting Approval</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Your account is waiting for admin approval. You'll be able to log in once approved.
                </p>
                {/* Actually check approval status from DB */}
                <Button
                  className="w-full rounded-xl"
                  disabled={loading}
                  onClick={async () => {
                    if (!pendingEmail) { setRequestStatus(null); return; }
                    setLoading(true);
                    try {
                      const res = await checkApprovalStatus({ data: { email: pendingEmail } });
                      if (res.status === "approved") {
                        toast.success("You've been approved! Please log in.");
                        setRequestStatus(null);
                      } else if (res.status === "rejected") {
                        setRequestStatus({ status: "rejected", reason: res.reason });
                      } else {
                        toast.info("Still pending — check back soon.");
                      }
                    } catch {
                      toast.error("Could not check status. Try logging in.");
                      setRequestStatus(null);
                    } finally { setLoading(false); }
                  }}
                >
                  {loading ? "Checking…" : "Check Approval Status"}
                </Button>
              </>
            ) : (
              <>
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/15">
                  <XCircle className="h-8 w-8 text-red-500" />
                </div>
                <h2 className="font-display text-2xl mb-2">Request Rejected</h2>
                {requestStatus.reason && (
                  <div className="mb-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-400">
                    <strong>Reason:</strong> {requestStatus.reason}
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  Your request was not approved. Contact the gym for more information.
                </p>
              </>
            )}
            <button onClick={() => setRequestStatus(null)}
              className="mt-6 text-xs text-primary hover:underline">
              Back to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── OTP SCREEN ───────────────────────────────────────────────────
  if (otpStep) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm">
          <Link to="/"><Logo /></Link>
          <div className="mt-8 rounded-2xl border border-border bg-card p-8">
            <div className="mb-6 flex items-center gap-3">
              <div className="rounded-full bg-primary/15 p-3"><KeyRound className="h-6 w-6 text-primary" /></div>
              <div>
                <h2 className="font-display text-2xl">Verify OTP</h2>
                <p className="text-xs text-muted-foreground">Check your email for the 6-digit code</p>
              </div>
            </div>
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              {devOtp && (
                <div className="rounded-xl border border-amber-400/50 bg-amber-500/10 px-4 py-3 text-center">
                  <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mb-1">⚠️ Email not configured — dev mode OTP:</p>
                  <p className="text-2xl font-bold tracking-[0.4em] text-amber-500">{devOtp}</p>
                  <p className="text-[10px] text-amber-600/70 mt-1">Add RESEND_API_KEY to .env to send real emails</p>
                </div>
              )}
              <Input
                type="text" inputMode="numeric" maxLength={6}
                placeholder="6-digit OTP"
                value={otpInput}
                onChange={e => { setOtpInput(e.target.value.replace(/\D/g, "")); setOtpError(""); }}
                className={`text-center text-2xl tracking-[0.5em] ${otpError ? "border-destructive" : ""}`}
                autoFocus
              />
              {otpError && <p className="text-xs text-destructive">{otpError}</p>}
              <Button disabled={loading} className="w-full rounded-xl py-6">
                {loading ? "Verifying…" : "Verify & Submit Request"}
              </Button>
              <button type="button" disabled={loading}
                onClick={async () => {
                  if (!pendingUser) return;
                  setLoading(true);
                  setOtpInput(""); setOtpError(""); setDevOtp(null);
                  try {
                    const result = await insertOtpAndRequest({
                      data: { userId: pendingUser.id, fullName: pendingUser.name, email: pendingUser.email, phone: pendingUser.phone, role: pendingUser.role },
                    });
                    if (result?.devOtp) setDevOtp(result.devOtp);
                    toast.success("New OTP sent — check your inbox.");
                  } catch (err: any) {
                    toast.error("Could not resend OTP: " + err?.message);
                  } finally { setLoading(false); }
                }}
                className="w-full text-center text-xs text-muted-foreground hover:text-primary transition-colors disabled:opacity-50">
                Resend OTP
              </button>
            </form>
            <button onClick={() => setOtpStep(false)}
              className="mt-4 text-xs text-muted-foreground hover:text-foreground">
              Go back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── ADMIN LOGIN SCREEN ───────────────────────────────────────────
  // ── FORGOT PASSWORD SCREENS ───────────────────────────────────────────────
  if (forgotStep !== "idle") {
    const steps = { email: 1, otp: 2, newpwd: 3 } as Record<string, number>;
    const currentStep = steps[forgotStep] ?? 1;
    return (
      <div className="grid min-h-screen md:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col bg-background px-6 py-8 md:px-16 md:py-12">
          <Link to="/"><Logo /></Link>
          <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
            {/* Step indicator */}
            <div className="flex items-center gap-2 mb-8">
              {["Email", "Verify OTP", "New Password"].map((label, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${i + 1 <= currentStep ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {i + 1 < currentStep ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                  </div>
                  <span className={`text-xs hidden sm:block ${i + 1 === currentStep ? "text-foreground font-medium" : "text-muted-foreground"}`}>{label}</span>
                  {i < 2 && <div className="h-px w-6 bg-border" />}
                </div>
              ))}
            </div>

            <div className="mb-8 flex items-center gap-3">
              <div className="rounded-full bg-primary/10 p-3 text-primary">
                <KeyRound className="h-6 w-6" />
              </div>
              <div>
                <h1 className="font-display text-3xl">Reset Password</h1>
                <p className="text-sm text-muted-foreground">
                  {forgotStep === "email" && "Enter your registered email"}
                  {forgotStep === "otp" && `OTP sent to ${forgotEmail}`}
                  {forgotStep === "newpwd" && "Choose a new password"}
                </p>
              </div>
            </div>

            {/* Step 1 — Email */}
            {forgotStep === "email" && (
              <form onSubmit={handleForgotSendOtp} className="space-y-4" noValidate>
                <Field icon={Mail}>
                  <Input type="email" placeholder="Registered email address" autoComplete="email"
                    value={forgotEmail} onChange={e => setForgotEmail(e.target.value)}
                    className="border-0 bg-transparent pl-10 focus-visible:ring-0" />
                </Field>
                <Button disabled={loading} className="w-full rounded-xl py-6 text-base shadow-[var(--shadow-glow)]">
                  {loading ? "Sending OTP…" : "Send OTP"}
                </Button>
              </form>
            )}

            {/* Step 2 — OTP */}
            {forgotStep === "otp" && (
              <form onSubmit={handleForgotVerifyOtp} className="space-y-4" noValidate>
                {forgotDevOtp && (
                  <div className="rounded-xl border border-amber-400/50 bg-amber-500/10 px-4 py-3 text-center">
                    <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mb-1">⚠️ Email not configured — dev mode OTP:</p>
                    <p className="text-2xl font-bold tracking-[0.4em] text-amber-500">{forgotDevOtp}</p>
                    <p className="text-[10px] text-amber-600/70 mt-1">Add RESEND_API_KEY to .env to send real emails</p>
                  </div>
                )}
                <div className="flex justify-center gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Input key={i} id={`fotp-${i}`} type="text" inputMode="numeric"
                      maxLength={1} value={forgotOtp[i] ?? ""}
                      onChange={e => {
                        const v = e.target.value.replace(/\D/g, "").slice(0, 1);
                        const next = forgotOtp.split(""); next[i] = v;
                        setForgotOtp(next.join("").slice(0, 6));
                        setForgotOtpErr("");
                        if (v && i < 5) (document.getElementById(`fotp-${i + 1}`) as HTMLInputElement)?.focus();
                      }}
                      onKeyDown={e => { if (e.key === "Backspace" && !forgotOtp[i] && i > 0) (document.getElementById(`fotp-${i - 1}`) as HTMLInputElement)?.focus(); }}
                      className="w-11 h-12 text-center text-lg font-bold rounded-xl border-border focus-visible:ring-primary" />
                  ))}
                </div>
                {forgotOtpErr && <p className="text-xs text-destructive text-center">{forgotOtpErr}</p>}
                <p className="text-xs text-muted-foreground text-center">Check your inbox for the 6-digit code</p>
                <Button disabled={loading || forgotOtp.length !== 6} className="w-full rounded-xl py-6 text-base shadow-[var(--shadow-glow)]">
                  {loading ? "Verifying…" : "Verify OTP"}
                </Button>
                <button type="button" onClick={() => handleForgotSendOtp({ preventDefault: () => {} } as any)}
                  className="w-full text-center text-xs text-muted-foreground hover:text-primary transition-colors">
                  Resend OTP
                </button>
              </form>
            )}

            {/* Step 3 — New password */}
            {forgotStep === "newpwd" && (
              <form onSubmit={handleForgotReset} className="space-y-4" noValidate>
                <Field icon={Lock} action={
                  <button type="button" onClick={() => setShowForgotPwd(!showForgotPwd)}>
                    {showForgotPwd ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                  </button>
                }>
                  <Input type={showForgotPwd ? "text" : "password"} placeholder="New password (min 6 chars)"
                    value={forgotNewPwd} onChange={e => { setForgotNewPwd(e.target.value); setForgotNewPwdErr(""); }}
                    className="border-0 bg-transparent pl-10 focus-visible:ring-0" />
                </Field>
                {forgotNewPwdErr && <p className="text-xs text-destructive -mt-2">{forgotNewPwdErr}</p>}
                <Button disabled={loading} className="w-full rounded-xl py-6 text-base shadow-[var(--shadow-glow)]">
                  {loading ? "Resetting…" : "Reset Password"}
                </Button>
              </form>
            )}

            <button onClick={() => { setForgotStep("idle"); setForgotOtp(""); setForgotEmail(""); setForgotNewPwd(""); }}
              className="mt-6 text-center text-xs text-muted-foreground hover:text-foreground transition-colors">
              ← Back to login
            </button>
          </div>
        </div>
        <div className="hidden md:flex flex-col items-start justify-center bg-sidebar px-16 py-12">
          <div className="mb-6 rounded-full bg-primary/20 p-4">
            <KeyRound className="h-10 w-10 text-primary" />
          </div>
          <h2 className="font-display text-4xl text-white">Secure Reset</h2>
          <p className="mt-4 text-sm text-white/50 leading-relaxed">
            We'll send a one-time code to your registered email. Use it to set a new password in seconds.
          </p>
          <div className="mt-6 space-y-3 text-sm text-white/50">
            {["OTP expires in 10 minutes", "Code sent to your registered email", "Your data stays safe"].map(t => (
              <div key={t} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary/60" />{t}</div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (showAdminLogin) {
    return (
      <div className="grid min-h-screen md:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col bg-background px-6 py-8 md:px-16 md:py-12">
          <Link to="/"><Logo /></Link>
          <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
            <div className="mb-8 flex items-center gap-3">
              <div className="rounded-full bg-amber-500/20 p-3 text-amber-500">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <h1 className="font-display text-3xl">Admin Access</h1>
                <p className="text-sm text-muted-foreground">Admin code always required.</p>
              </div>
            </div>
            <form onSubmit={handleAdminLogin} className="space-y-4" noValidate>
              <Field icon={Mail}>
                <Input type="email" placeholder="Admin email" autoComplete="email"
                  value={adminEmail} onChange={e => { setAdminEmail(e.target.value); setAdminEmailErr(""); }}
                  className="border-0 bg-transparent pl-10 focus-visible:ring-0" />
              </Field>
              {adminEmailErr && <p className="text-xs text-destructive -mt-2">{adminEmailErr}</p>}
              <Field icon={Lock} action={
                <button type="button" onClick={() => setShowAdminPwd(!showAdminPwd)}>
                  {showAdminPwd ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                </button>
              }>
                <Input type={showAdminPwd ? "text" : "password"} placeholder="Password"
                  value={adminPwd} onChange={e => { setAdminPwd(e.target.value); setAdminPwdErr(""); }}
                  className="border-0 bg-transparent pl-10 focus-visible:ring-0" />
              </Field>
              {adminPwdErr && <p className="text-xs text-destructive -mt-2">{adminPwdErr}</p>}
              <Field icon={ShieldCheck}>
                <Input type="password" placeholder="Admin Code" autoComplete="off"
                  value={adminCode} onChange={e => setAdminCode(e.target.value)}
                  className="border-0 bg-transparent pl-10 focus-visible:ring-0" />
              </Field>
              <Button disabled={loading} className="w-full rounded-xl py-6 text-base">
                {loading ? "Verifying…" : "Login as Admin"}
              </Button>
            </form>
            <button onClick={() => setShowAdminLogin(false)}
              className="mt-4 text-center text-xs text-muted-foreground hover:text-foreground">
              Back to member login
            </button>
          </div>
        </div>
        <div className="hidden md:flex flex-col items-start justify-center bg-sidebar px-16 py-12">
          <div className="mb-6 rounded-full bg-amber-500/20 p-4">
            <ShieldCheck className="h-10 w-10 text-amber-400" />
          </div>
          <h2 className="font-display text-4xl text-white">Admin Panel</h2>
          <p className="mt-4 text-sm text-white/50 leading-relaxed">Full control. All data. One admin.</p>
          <div className="mt-6 space-y-2 text-sm text-white/50">
            {["Manage members & trainers","Approve / reject signups","Set & edit plans","Assign members to trainers","One admin only"].map(t => (
              <div key={t} className="flex items-center gap-2">
                <Check className="h-3 w-3 text-primary flex-shrink-0" /> {t}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── MEMBER / TRAINER ─────────────────────────────────────────────
  return (
    <div className="grid min-h-screen md:grid-cols-[1.1fr_1fr]">
      <div className="flex flex-col bg-background px-6 py-8 md:px-16 md:py-12">
        <Link to="/"><Logo /></Link>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
          <div className="mb-8">
            <div className="mb-4 flex gap-2">
              {(["member","trainer"] as AuthMode[]).map(m => (
                <button key={m} onClick={() => setAuthMode(m)}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium border transition ${authMode === m ? "bg-primary text-primary-foreground border-primary" : "border-border bg-secondary/30 text-muted-foreground hover:border-primary/40"}`}>
                  {m === "member" ? <Activity className="h-4 w-4" /> : <Dumbbell className="h-4 w-4" />}
                  {m === "member" ? "Member" : "Trainer"}
                </button>
              ))}
            </div>
            <h1 className="font-display text-4xl">{authMode === "trainer" ? "Trainer Portal" : "Welcome Back"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sign in or request access below.</p>
          </div>
          <Tabs defaultValue="login">
            <TabsList className="mb-6 w-full">
              <TabsTrigger value="login" className="flex-1">Login</TabsTrigger>
              <TabsTrigger value="signup" className="flex-1">Request Access</TabsTrigger>
            </TabsList>

            {/* LOGIN */}
            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4" noValidate>
                <Field icon={Mail}>
                  <Input type="email" placeholder="Email address" autoComplete="email"
                    value={email} onChange={e => { setEmail(e.target.value); setEmailErr(""); }}
                    className="border-0 bg-transparent pl-10 focus-visible:ring-0" />
                </Field>
                {emailErr && <p className="text-xs text-destructive -mt-2">{emailErr}</p>}
                <Field icon={Lock} action={
                  <button type="button" onClick={() => setShowPwd(!showPwd)}>
                    {showPwd ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                  </button>
                }>
                  <Input type={showPwd ? "text" : "password"} placeholder="Password"
                    value={pwd} onChange={e => { setPwd(e.target.value); setPwdErr(""); }}
                    className="border-0 bg-transparent pl-10 focus-visible:ring-0" />
                </Field>
                {pwdErr && <p className="text-xs text-destructive -mt-2">{pwdErr}</p>}
                <Button disabled={loading} className="w-full rounded-xl py-6 text-base shadow-[var(--shadow-glow)]">
                  {loading ? "Signing in…" : `Login as ${authMode === "trainer" ? "Trainer" : "Member"}`}
                </Button>
              </form>
              <div className="mt-4 text-center space-y-2">
                <button
                  onClick={() => { setForgotStep("email"); setForgotEmail(email); }}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors underline-offset-2 hover:underline"
                >
                  Forgot password?
                </button>
                <div>
                <button onClick={() => setShowAdminLogin(true)}
                  className="flex items-center justify-center gap-1.5 mx-auto text-xs text-muted-foreground hover:text-amber-500 transition-colors">
                  <ShieldCheck className="h-3.5 w-3.5" /> Admin Login
                </button>
                </div>
              </div>
            </TabsContent>

            {/* SIGNUP / REQUEST ACCESS */}
            <TabsContent value="signup">
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                <Clock className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>Access requires admin approval. After signing up, your request will be reviewed and you'll be notified.</span>
              </div>
              <form onSubmit={handleSignup} className="space-y-3" noValidate>
                <Field icon={User}>
                  <Input placeholder="Full name *" value={name}
                    onChange={e => { setName(e.target.value); setNameErr(""); }}
                    className={`border-0 bg-transparent pl-10 focus-visible:ring-0 ${nameErr ? "placeholder:text-destructive/70" : ""}`} />
                </Field>
                {nameErr && <p className="text-xs text-destructive -mt-2">{nameErr}</p>}
                <Field icon={Phone}>
                  <Input type="tel" placeholder="Mobile number * (10 digits)" maxLength={10}
                    value={phone} onChange={e => { setPhone(e.target.value.replace(/\D/g, "")); setPhoneErr(""); }}
                    className={`border-0 bg-transparent pl-10 focus-visible:ring-0 ${phoneErr ? "placeholder:text-destructive/70" : ""}`} />
                </Field>
                {phoneErr && <p className="text-xs text-destructive -mt-2">{phoneErr}</p>}
                <Field icon={Mail}>
                  <Input type="email" placeholder="Email address *"
                    value={sEmail} onChange={e => { setSEmail(e.target.value); setSEmailErr(""); }}
                    className={`border-0 bg-transparent pl-10 focus-visible:ring-0 ${sEmailErr ? "placeholder:text-destructive/70" : ""}`} />
                </Field>
                {sEmailErr && <p className="text-xs text-destructive -mt-2">{sEmailErr}</p>}
                <Field icon={Lock} action={
                  <button type="button" onClick={() => setShowSPwd(!showSPwd)}>
                    {showSPwd ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                  </button>
                }>
                  <Input type={showSPwd ? "text" : "password"} placeholder="Password * (min 6 chars)"
                    value={sPwd} onChange={e => { setSPwd(e.target.value); setSPwdErr(""); }}
                    className="border-0 bg-transparent pl-10 focus-visible:ring-0" />
                </Field>
                {sPwdErr && <p className="text-xs text-destructive -mt-2">{sPwdErr}</p>}
                <Button disabled={loading} className="w-full rounded-xl py-6 text-base shadow-[var(--shadow-glow)]">
                  {loading ? "Submitting…" : `Request ${authMode === "trainer" ? "Trainer" : "Member"} Access`}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Right visual */}
      <div className="hidden md:flex flex-col items-start justify-center bg-sidebar px-16 py-12">
        <div className="mb-6 h-20 w-20 rounded-2xl bg-primary flex items-center justify-center">
          {authMode === "trainer" ? <Dumbbell className="h-10 w-10 text-primary-foreground" /> : <Activity className="h-10 w-10 text-primary-foreground" />}
        </div>
        <h2 className="font-display text-4xl text-white">
          {authMode === "trainer" ? "Train. Inspire. Lead." : "Stronger Every Day."}
        </h2>
        <p className="mt-4 text-sm text-white/50 max-w-xs leading-relaxed">
          {authMode === "trainer"
            ? "Manage schedules, track member progress, and deliver results."
            : "Track workouts, manage memberships, and stay on top of your fitness journey."}
        </p>
        <div className="mt-6 rounded-xl bg-white/5 border border-white/10 p-4 text-xs text-white/50 leading-relaxed">
          New members require admin approval before accessing the app.
        </div>
      </div>
    </div>
  );
}

function Field({ icon: Icon, action, children }: { icon: any; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative flex items-center rounded-xl border border-border bg-secondary/30 focus-within:border-primary/50 transition">
      <Icon className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
      {children}
      {action && <div className="absolute right-3">{action}</div>}
    </div>
  );
}
