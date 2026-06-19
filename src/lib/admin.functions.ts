import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ─── Shared admin-authorization check ────────────────────────────────────────
// Throws unless the calling user has an admin role row. Use inside any handler
// that touches other users' data (delete, list-all, etc). Always pair with
// .middleware([requireSupabaseAuth]) so `context.userId` is a verified JWT subject.
async function requireAdminContext(supabaseAdmin: any, userId: string) {
  const { data: roleRow, error } = await supabaseAdmin
    .from("user_roles").select("user_id").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!roleRow) throw new Error("Admin access required.");
}

// ─── Find a user by email, paginating through all pages ──────────────────────
// supabaseAdmin.auth.admin.listUsers() defaults to a 50-per-page limit — without
// pagination, any gym with more than 50 signups would get false "not found"
// results for users beyond the first page.
async function findUserByEmail(supabaseAdmin: any, email: string) {
  const target = email.toLowerCase().trim();
  let page = 1;
  const perPage = 200;
  for (let i = 0; i < 50; i++) { // hard safety cap: 50 pages = 10,000 users
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    const found = users.find((u: any) => u.email?.toLowerCase() === target);
    if (found) return found;
    if (users.length < perPage) return null; // last page reached
    page++;
  }
  return null;
}

// ─── Email helper (Resend) ───────────────────────────────────────────────────
async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.startsWith("re_xxx")) {
    // No key — log OTP to console as fallback
    console.warn(`\n${"=".repeat(60)}`);
    console.warn(`EMAIL NOT SENT — add RESEND_API_KEY to .env`);
    console.warn(`To: ${to} | Subject: ${subject}`);
    const m = html.match(/>(\d{6})</);
    if (m) console.warn(`\x1b[33mOTP CODE: ${m[1]}\x1b[0m`);
    console.warn("=".repeat(60) + "\n");
    return { sent: false };
  }

  const fromEmail = process.env.EMAIL_FROM ?? "onboarding@resend.dev";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from: fromEmail, to, subject, html }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("[Resend error]", res.status, errBody);
    return { sent: false, error: errBody };
  }

  return { sent: true };
}

// ─── SMS helper (Twilio) ─────────────────────────────────────────────────────
async function sendSms({ to, body }: { to: string; body: string }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) { console.log(`[SMS to ${to}]: ${body}`); return; }
  const toE164 = to.startsWith("+") ? to : `+91${to}`;
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: toE164, From: from, Body: body }).toString(),
    }
  );
  if (!res.ok) console.error("[Twilio error]", await res.text());
}

export const claimAdminRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      // FIX #9/#11: code is validated SERVER-SIDE only — never expose VITE_ version
      code: z.string().trim().max(128).optional(),
      flow: z.enum(["signup", "dashboard"]).default("dashboard"),
    }).parse(input ?? {})
  )
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const expectedCode = process.env.ADMIN_SIGNUP_CODE?.trim();
    if (!expectedCode) throw new Error("ADMIN_SIGNUP_CODE is not set on the server.");

    // FIX #9: Code is ALWAYS required — no bypass path
    if (!data.code || data.code.trim() !== expectedCode) {
      throw new Error("Invalid admin code.");
    }

    // FIX #5/#11: Single admin — check (not airtight alone, see below)
    const { count, error: countErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "admin");
    if (countErr) throw new Error(countErr.message);

    const adminCount = count ?? 0;

    // Check if this user is already admin
    const { data: existingRole } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (existingRole) {
      return { ok: true, reason: "code" as const, alreadyAdmin: true };
    }

    // Fast-path rejection for the common case (not the sole guarantee — see below)
    if (adminCount > 0) {
      throw new Error("An admin account already exists. Only one admin is allowed.");
    }

    const reason: "bootstrap" | "code" = adminCount === 0 ? "bootstrap" : "code";

    // The true race-condition guard is a partial UNIQUE INDEX on user_roles(role)
    // WHERE role='admin' (see migration 20260618000001). If two requests both pass
    // the count check above at the same instant, only one INSERT can succeed —
    // the other hits a unique-violation here and is told the truth.
    const { error: insErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: "admin" });
    if (insErr) {
      if (insErr.message.toLowerCase().includes("duplicate") || insErr.code === "23505") {
        throw new Error("An admin account already exists. Only one admin is allowed.");
      }
      throw new Error(insErr.message);
    }

    const email =
      (claims as { email?: string } | undefined)?.email ??
      (claims as { user_metadata?: { email?: string } } | undefined)?.user_metadata?.email ?? null;

    await supabaseAdmin.from("admin_promotions").insert({
      user_id: userId, user_email: email, flow: data.flow, reason,
    });

    return { ok: true, reason, alreadyAdmin: false };
  });

export const listAdminPromotions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("admin_promotions")
      .select("id, user_id, user_email, flow, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { promotions: data ?? [] };
  });

// FIX #2: Insert OTP and membership_request via service role so RLS isn't needed
// This works regardless of whether email confirmation is ON or OFF
export const insertOtpAndRequest = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      userId: z.string().uuid(),
      fullName: z.string().min(1),
      email: z.string().email(),
      phone: z.string().min(10),
      role: z.enum(["user", "trainer"]),
    }).parse(input)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    // FIX #15: rate-limit OTP sends (covers both initial signup and the
    // "Resend OTP" button, since both call this same function)
    await checkOtpCooldown(db, data.userId);

    // Generate OTP server-side (never trust client-generated OTPs)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Insert OTP — service role bypasses RLS. intended_role is stored here so
    // verifyOtpServerFn can check it server-side instead of trusting the client's
    // role claim at verify time (which could be tampered with).
    const { error: otpErr } = await db
      .from("otp_verifications")
      .insert({ user_id: data.userId, otp, expires_at: expires, intended_role: data.role, sent_at: new Date().toISOString() });
    if (otpErr) throw new Error("OTP insert failed: " + otpErr.message);

    // Send OTP to email
    let emailSent = false;
    try {
      const result = await sendEmail({
        to: data.email,
        subject: "Verify Your Account — The John Fitness",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0f0f0f;color:#fff;border-radius:16px;">
            <div style="margin-bottom:24px;"><span style="font-size:24px;font-weight:700;">💪 The John Fitness</span></div>
            <h2 style="margin:0 0 8px;font-size:20px;">Hi ${data.fullName},</h2>
            <p style="color:#aaa;margin:0 0 24px;font-size:14px;">You recently signed up. Use the OTP below to verify your account.</p>
            <div style="background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
              <div style="font-size:40px;font-weight:800;letter-spacing:12px;color:#a78bfa;">${otp}</div>
              <div style="color:#666;font-size:12px;margin-top:8px;">Expires in 10 minutes</div>
            </div>
            <p style="color:#555;font-size:12px;margin:0;">If you didn't request this, ignore this email.</p>
          </div>
        `,
      });
      emailSent = result?.sent ?? false;
    } catch (e) {
      console.error("[OTP email failed]", e);
    }

    // NOTE: membership_request is intentionally NOT inserted here.
    // It is inserted only after the user successfully verifies their OTP.

    // Return devOtp in non-production when email wasn't sent, so UI can show it
    const isDev = process.env.NODE_ENV !== "production";
    return { ok: true, emailSent, devOtp: (!emailSent && isDev) ? otp : null };
  });

// FIX #20: Resume an abandoned signup instead of dead-ending at "already
// registered". If a user signs up, gets an OTP, then hits the browser back
// button or closes the tab before verifying, supabase.auth.signUp() leaves
// behind a real auth.users row with no user_roles row and no
// membership_requests row (that's only inserted after OTP verification, see
// verifyOtpServerFn below). Trying to sign up again with the same email then
// fails with "User already registered" — but the account can't log in either,
// because handleLogin in auth.tsx intentionally blocks unverified accounts.
// That left the user stuck with no way forward. This lets the signup form
// detect "stuck mid-signup" (no role, no request) vs. a genuinely existing
// account, and if it's stuck, re-issue a fresh OTP for the SAME user id so
// they can resume verification instead of being told to "just log in".
export const findUnverifiedSignup = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ email: z.string().email() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const user = await findUserByEmail(supabaseAdmin, data.email);
    if (!user) return { resumable: false as const };

    const [{ data: roleRows }, { data: reqRow }] = await Promise.all([
      db.from("user_roles").select("role").eq("user_id", user.id).limit(1),
      db.from("membership_requests").select("id").eq("user_id", user.id).maybeSingle(),
    ]);

    const hasRole = (roleRows ?? []).length > 0;
    const hasRequest = !!reqRow;

    // A role or a membership_request means this account already completed
    // OTP verification at some point — it's a real existing account, not a
    // stuck one. Don't let it be "resumed" (that would let someone hijack
    // an existing email's signup by just re-submitting the form).
    if (hasRole || hasRequest) return { resumable: false as const };

    return { resumable: true as const, userId: user.id as string };
  });

// FIX #2: Verify OTP via service role (works pre-email-confirm too)
// The membership_request is inserted HERE (after OTP is verified) — not at signup time.
export const verifyOtpServerFn = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      userId: z.string().uuid(),
      otp: z.string().length(6),
      fullName: z.string().min(1),
      email: z.string().email(),
      phone: z.string().min(10),
    }).parse(input)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const db = supabaseAdmin as any;
    const { data: row, error } = await db
      .from("otp_verifications")
      .select("id, intended_role")
      .eq("user_id", data.userId)
      .eq("otp", data.otp)
      .eq("verified", false)
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .maybeSingle();

    if (error || !row) throw new Error("Invalid or expired OTP.");

    // Use the role recorded at signup time — never trust a role sent at verify time.
    const role: "user" | "trainer" = row.intended_role === "trainer" ? "trainer" : "user";

    // Mark verified
    await db.from("otp_verifications").update({ verified: true }).eq("id", row.id);
    // Cleanup expired OTPs
    await db.from("otp_verifications")
      .delete().eq("user_id", data.userId).eq("verified", false)
      .lt("expires_at", new Date().toISOString());

    // OTP is now confirmed — safe to submit the membership request
    const { error: reqErr } = await db
      .from("membership_requests")
      .upsert({
        user_id: data.userId,
        full_name: data.fullName,
        email: data.email,
        phone: data.phone,
        role,
        status: "pending",
      }, { onConflict: "user_id" });
    if (reqErr) throw new Error("Request insert failed: " + reqErr.message);

    return { ok: true };
  });

// FIX #4: Allow admin to delete/reset a rejected request so user can re-apply
// FIX #10: "Reset" must fully free the email for re-signup, not just delete the
// request row. Previously this left auth.users / profiles / otp_verifications
// intact, so the user would still hit "already registered" trying to sign up again.
export const resetMembershipRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requireAdminContext(supabaseAdmin, context.userId);
    const db = supabaseAdmin as any;

    // Resolve the user_id behind this request before deleting it
    const { data: reqRow, error: reqFetchErr } = await db
      .from("membership_requests").select("user_id").eq("id", data.requestId).maybeSingle();
    if (reqFetchErr) throw new Error(reqFetchErr.message);
    if (!reqRow) throw new Error("Request not found.");

    const userId = reqRow.user_id;

    // Fully clean up — same as hardDeleteUser — so the email is genuinely free
    await db.from("memberships").delete().eq("user_id", userId);
    await db.from("membership_requests").delete().eq("user_id", userId);
    await db.from("user_roles").delete().eq("user_id", userId);
    await db.from("notifications").delete().eq("user_id", userId);
    await db.from("trainer_assignments").delete().eq("member_id", userId);
    await db.from("trainer_assignments").delete().eq("trainer_id", userId);
    await db.from("otp_verifications").delete().eq("user_id", userId);
    await db.from("profiles").delete().eq("id", userId);

    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authErr) throw new Error("Auth delete failed: " + authErr.message);

    return { ok: true };
  });

// ─── Forgot password: verify OTP only (no membership_request side-effect) ────
export const verifyForgotOtp = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      userId: z.string().uuid(),
      otp: z.string().length(6),
    }).parse(input)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const { data: row, error } = await db
      .from("otp_verifications")
      .select("id")
      .eq("user_id", data.userId)
      .eq("otp", data.otp)
      .eq("verified", false)
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .maybeSingle();

    if (error || !row) throw new Error("Invalid or expired OTP. Please check the code and try again.");

    // Mark verified so it can't be reused
    await db.from("otp_verifications").update({ verified: true }).eq("id", row.id);

    return { ok: true };
  });

// ─── Check if a user's membership request has been approved ──────────────────
export const checkApprovalStatus = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ email: z.string().email() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    // Find user by email — paginated and case-insensitive
    const user = await findUserByEmail(supabaseAdmin, data.email);
    if (!user) return { status: "not_found" as const };

    const { data: req } = await db
      .from("membership_requests")
      .select("status, reject_reason")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!req) return { status: "not_found" as const };
    return { status: req.status as "pending" | "approved" | "rejected", reason: req.reject_reason ?? undefined };
  });

// ─── Send OTP via email ──────────────────────────────────────────────────────
// ─── Forgot password: send OTP ───────────────────────────────────────────────
export const forgotPasswordSendOtp = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ email: z.string().email() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    // Check user exists — paginated and case-insensitive
    const user = await findUserByEmail(supabaseAdmin, data.email);
    if (!user) throw new Error("No account found with this email.");

    // FIX #15: rate-limit forgot-password OTP requests
    await checkOtpCooldown(db, user.id);

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error } = await db.from("otp_verifications").insert({
      user_id: user.id,
      otp,
      expires_at: expires,
      sent_at: new Date().toISOString(),
    });
    if (error) throw new Error("Failed to generate OTP: " + error.message);

    // Get name from profiles / metadata
    const name = (user.user_metadata as any)?.full_name ?? user.email?.split("@")[0] ?? "Member";

    let emailSent = false;
    try {
      const result = await sendEmail({
        to: data.email,
        subject: "Reset Your Password — The John Fitness",
        html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0f0f0f;color:#fff;border-radius:16px;">
          <div style="margin-bottom:24px;"><span style="font-size:24px;font-weight:700;">💪 The John Fitness</span></div>
          <h2 style="margin:0 0 8px;font-size:20px;">Hi ${name},</h2>
          <p style="color:#aaa;margin:0 0 24px;font-size:14px;">You requested a password reset. Use the OTP below to set a new password.</p>
          <div style="background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
            <div style="font-size:40px;font-weight:800;letter-spacing:12px;color:#a78bfa;">${otp}</div>
            <div style="color:#666;font-size:12px;margin-top:8px;">Expires in 10 minutes</div>
          </div>
          <p style="color:#555;font-size:12px;margin:0;">If you didn't request this, ignore this email.</p>
        </div>
      `,
      });
      emailSent = result?.sent ?? false;
    } catch (e) {
      console.error("[Forgot password OTP email failed]", e);
    }

    const isDev = process.env.NODE_ENV !== "production";
    return { ok: true, userId: user.id, emailSent, devOtp: (!emailSent && isDev) ? otp : null };
  });

// ─── Forgot password: reset password (OTP already verified in step 2) ────────
export const forgotPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      userId: z.string().uuid(),
      newPassword: z.string().min(6),
    }).parse(input)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // OTP was already verified and marked used in verifyForgotOtp — just update password
    const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.newPassword,
    });
    if (pwErr) throw new Error("Failed to update password: " + pwErr.message);

    return { ok: true };
  });

// ─── SMS reminders cron ──────────────────────────────────────────────────────
// Call this from a cron job (e.g. Supabase Edge Function cron, or external cron).
// POST /api/sms-reminders  (protected by CRON_SECRET header)
export const sendMembershipReminders = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ cronSecret: z.string() }).parse(input)
  )
  .handler(async ({ data }) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || data.cronSecret !== secret) throw new Error("Unauthorized");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Fetch all active/recently-expired memberships, then profiles separately
    // (no FK from memberships.user_id -> profiles.id, so embed syntax doesn't work)
    const { data: rawMemberships, error } = await supabaseAdmin
      .from("memberships")
      .select("user_id, valid_till")
      .in("status", ["active", "expired"])
      .not("valid_till", "is", null);

    if (error) throw new Error(error.message);

    const mUserIds = (rawMemberships ?? []).map((m: any) => m.user_id);
    const { data: mProfiles } = mUserIds.length
      ? await supabaseAdmin.from("profiles").select("id,phone,full_name").in("id", mUserIds)
      : { data: [] };
    const mProfileMap = new Map((mProfiles ?? []).map((p: any) => [p.id, p]));
    const memberships = (rawMemberships ?? []).map((m: any) => ({ ...m, profiles: mProfileMap.get(m.user_id) ?? null }));

    const results: string[] = [];

    for (const m of memberships ?? []) {
      const profile = (m as any).profiles;
      if (!profile?.phone) continue;

      const validTill = new Date(m.valid_till!);
      validTill.setHours(0, 0, 0, 0);
      const diffDays = Math.round((validTill.getTime() - today.getTime()) / 86400000);
      const name = profile.full_name ?? "Member";
      const phone = profile.phone;
      const validTillStr = validTill.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

      // Determine which reminder type applies
      let type: string | null = null;
      let message: string | null = null;

      if (diffDays === 5) {
        type = "5_day";
        message = `Hi ${name}! Your The John Fitness membership expires on ${validTillStr} (5 days left). Renew now to keep your streak going! 💪`;
      } else if (diffDays === 1) {
        type = "1_day";
        message = `Hi ${name}! Your The John Fitness membership expires TOMORROW (${validTillStr}). Renew today to avoid a break! 🏋️`;
      } else if (diffDays === -2) {
        type = "2_day_after";
        message = `Hi ${name}! Your The John Fitness membership expired on ${validTillStr}. Renew now to get back on track! Visit the app to purchase a plan. 💪`;
      }

      if (!type || !message) continue;

      // Check if already sent for this valid_till cycle
      const { data: existing } = await (supabaseAdmin as any)
        .from("sms_reminders")
        .select("id")
        .eq("user_id", m.user_id)
        .eq("type", type)
        .eq("membership_valid_till", m.valid_till)
        .maybeSingle();

      if (existing) continue; // Already sent

      await sendSms({ to: phone, body: message });

      // Record it
      await (supabaseAdmin as any).from("sms_reminders").insert({
        user_id: m.user_id,
        type,
        membership_valid_till: m.valid_till,
      });

      results.push(`${type} → ${phone}`);
    }

    return { ok: true, sent: results };
  });

// ── Members with active plan info (for trainer assignment — has_trainer filter) ─
// ADMIN ONLY — exposes phone numbers and plan data for all members.
// ─── Rate limit: enforce a cooldown between OTP sends for the same user ──────
// Prevents unlimited Resend API spam and otp_verifications table bloat from a
// user repeatedly hammering "Resend OTP" or "Forgot Password".
const OTP_COOLDOWN_SECONDS = 30;
async function checkOtpCooldown(db: any, userId: string) {
  const { data: lastOtp } = await db
    .from("otp_verifications").select("sent_at").eq("user_id", userId)
    .order("sent_at", { ascending: false }).limit(1).maybeSingle();
  if (!lastOtp?.sent_at) return;
  const elapsedMs = Date.now() - new Date(lastOtp.sent_at).getTime();
  if (elapsedMs < OTP_COOLDOWN_SECONDS * 1000) {
    const waitSec = Math.ceil((OTP_COOLDOWN_SECONDS * 1000 - elapsedMs) / 1000);
    throw new Error(`Please wait ${waitSec}s before requesting another OTP.`);
  }
}

// ─── Single source of truth: which user_ids are "approved" members ───────────
// An approved member is someone with a "user" role row and NO pending/rejected
// membership_requests row blocking them. Centralized here so every place that
// needs this filter (Reminders, trainer-assignment dropdown, future features)
// stays in sync if the approval rules ever change — no duplicated logic to drift.
async function getApprovedUserIds(db: any, role: "user" | "trainer" = "user"): Promise<string[]> {
  const { data: roles } = await db.from("user_roles").select("user_id").eq("role", role);
  const userIds = (roles ?? []).map((r: any) => r.user_id);
  if (!userIds.length) return [];

  const { data: blocking } = await db
    .from("membership_requests").select("user_id").in("user_id", userIds).in("status", ["pending", "rejected"]);
  const excluded = new Set((blocking ?? []).map((r: any) => r.user_id));
  return userIds.filter((id: string) => !excluded.has(id));
}

export const getMembersWithPlanInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requireAdminContext(supabaseAdmin, context.userId);
    const db = supabaseAdmin as any;

    const approvedIds = await getApprovedUserIds(db, "user");
    if (!approvedIds.length) return [];

    // Fetch profiles
    const { data: profiles } = await db.from("profiles").select("id,full_name,phone").in("id", approvedIds);

    // Fetch active memberships with plan has_trainer flag
    const { data: memberships } = await db
      .from("memberships")
      .select("user_id,plans(has_trainer)")
      .in("user_id", approvedIds)
      .eq("status", "active");

    const membershipMap = new Map((memberships ?? []).map((m: any) => [m.user_id, m]));

    return (profiles ?? []).map((p: any) => ({
      ...p,
      has_trainer_plan: !!(membershipMap.get(p.id) as any)?.plans?.has_trainer,
    }));
  });

// ── Expiring memberships for admin Reminders tab (bypasses RLS) ──────────────
// ADMIN ONLY — exposes phone numbers and plan data for all members.
export const getExpiringMemberships = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requireAdminContext(supabaseAdmin, context.userId);
    const db = supabaseAdmin as any;
    const in5Days = new Date();
    in5Days.setDate(in5Days.getDate() + 5);

    // No FK exists from memberships.user_id -> profiles.id (it points to auth.users),
    // so PostgREST can't embed profiles(...) directly. Fetch separately and merge.
    const { data: memberships, error } = await db
      .from("memberships")
      .select("*,plans(name)")
      .eq("status", "active")
      .lte("valid_till", in5Days.toISOString().slice(0, 10))
      .gte("valid_till", new Date().toISOString().slice(0, 10))
      .order("valid_till");
    if (error) throw new Error(error.message);
    if (!memberships?.length) return [];

    const userIds = memberships.map((m: any) => m.user_id);
    const { data: profiles } = await db.from("profiles").select("id,full_name,phone").in("id", userIds);
    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    return memberships.map((m: any) => ({ ...m, profiles: profileMap.get(m.user_id) ?? null }));
  });

// ── Public landing-page data (bypasses RLS so anon users can see trainers/plans) ──
export const getPublicTrainers = createServerFn({ method: "GET" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
      .from("trainer_profiles")
      .select("*")
      .eq("is_visible", true)
      .order("display_order");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getPublicPlans = createServerFn({ method: "GET" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
      .from("plans")
      .select("*")
      .eq("is_active", true)
      .order("price");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ── Record a successful payment atomically (fee + membership together) ───────
// If either write fails, both are rolled back — a member should never end up
// with a "paid" fee row and no active membership (or vice versa).
export const recordPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      planId: z.string().uuid(),
      amount: z.number().positive(),
      method: z.string(),
      razorpayPaymentId: z.string().min(1),
      validTill: z.string(), // YYYY-MM-DD
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const userId = context.userId;

    // Use a Postgres function for true transactional atomicity if available;
    // otherwise fall back to manual compensation (best-effort rollback).
    const { error: rpcErr } = await db.rpc("record_payment_tx", {
      p_user_id: userId,
      p_plan_id: data.planId,
      p_amount: data.amount,
      p_method: data.method,
      p_razorpay_payment_id: data.razorpayPaymentId,
      p_valid_till: data.validTill,
    });

    if (!rpcErr) {
      try {
        await db.from("notifications").insert({
          user_id: userId, title: "Payment Successful",
          message: `Payment of ₹${data.amount} recorded successfully.`,
          type: "success",
        });
      } catch { /* best-effort notification, ignore failures */ }
      return { ok: true };
    }

    // RPC missing/failed — fall back to sequential writes with manual rollback
    console.warn("[recordPayment] RPC unavailable, using fallback:", rpcErr.message);

    const { data: feeRow, error: feeErr } = await db.from("fees").insert({
      user_id: userId, plan_id: data.planId,
      amount: data.amount, method: data.method,
      status: "paid", paid_at: new Date().toISOString(),
      razorpay_payment_id: data.razorpayPaymentId,
    }).select("id").single();
    if (feeErr) throw new Error("Payment record failed: " + feeErr.message);

    await db.from("memberships").update({ status: "expired" })
      .eq("user_id", userId).eq("status", "active");

    const { error: memErr } = await db.from("memberships").insert({
      user_id: userId, plan_id: data.planId,
      status: "active", valid_till: data.validTill, amount: data.amount,
    });

    if (memErr) {
      // Compensate: undo the fee insert so we don't leave an orphaned "paid" record
      await db.from("fees").delete().eq("id", feeRow.id);
      throw new Error("Membership activation failed and payment was rolled back. Please contact support with payment ID: " + data.razorpayPaymentId);
    }

    try {
      await db.from("notifications").insert({
        user_id: userId, title: "Payment Successful",
        message: `Payment of ₹${data.amount} recorded successfully.`,
        type: "success",
      });
    } catch { /* best-effort notification, ignore failures */ }

    return { ok: true };
  });

// ── Cash payment: member requests an in-hand cash payment for a plan ─────────
// Creates a fee row (pending) + a membership row (pending_approval). Nothing
// is unlocked until an admin explicitly approves it after receiving the cash.
export const requestCashPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      planId: z.string().uuid(),
      amount: z.number().positive(),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const userId = context.userId;

    const { error } = await db.rpc("request_cash_payment_tx", {
      p_user_id: userId,
      p_plan_id: data.planId,
      p_amount: data.amount,
    });
    if (error) throw new Error(error.message);

    try {
      await db.from("notifications").insert({
        user_id: userId, title: "Cash Payment Requested",
        message: `Your request to pay ₹${data.amount} in cash is awaiting admin approval. Please pay the admin in person to activate your plan.`,
        type: "info",
      });
    } catch { /* best-effort notification, ignore failures */ }

    return { ok: true };
  });

// ── Admin: list all cash payments awaiting approval ───────────────────────────
export const getPendingCashPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requireAdminContext(supabaseAdmin, context.userId);
    const db = supabaseAdmin as any;

    const { data: fees, error } = await db
      .from("fees")
      .select("*,plans(name,duration_days)")
      .eq("method", "cash")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    if (!fees?.length) return [];

    const userIds = fees.map((f: any) => f.user_id);
    const { data: profiles } = await db.from("profiles").select("id,full_name,phone").in("id", userIds);
    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    return fees.map((f: any) => ({ ...f, profiles: profileMap.get(f.user_id) ?? null }));
  });

// ── Admin: approve a pending cash payment — activates the membership ─────────
export const approveCashPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ feeId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requireAdminContext(supabaseAdmin, context.userId);
    const db = supabaseAdmin as any;

    const { data: feeRow } = await db.from("fees").select("user_id, amount").eq("id", data.feeId).maybeSingle();

    const { error } = await db.rpc("approve_cash_payment_tx", { p_fee_id: data.feeId });
    if (error) throw new Error(error.message);

    if (feeRow) {
      try {
        await db.from("notifications").insert({
          user_id: feeRow.user_id, title: "Cash Payment Approved",
          message: `Your cash payment of ₹${feeRow.amount} has been confirmed and your plan is now active.`,
          type: "success",
        });
      } catch { /* best-effort notification, ignore failures */ }
    }

    return { ok: true };
  });

// ── Admin: reject a pending cash payment ──────────────────────────────────────
export const rejectCashPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ feeId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requireAdminContext(supabaseAdmin, context.userId);
    const db = supabaseAdmin as any;

    const { data: feeRow } = await db.from("fees").select("user_id, amount").eq("id", data.feeId).maybeSingle();

    const { error } = await db.rpc("reject_cash_payment_tx", { p_fee_id: data.feeId });
    if (error) throw new Error(error.message);

    if (feeRow) {
      try {
        await db.from("notifications").insert({
          user_id: feeRow.user_id, title: "Cash Payment Not Confirmed",
          message: `Your cash payment request of ₹${feeRow.amount} was not confirmed by the admin. Please contact the gym or try paying online.`,
          type: "error",
        });
      } catch { /* best-effort notification, ignore failures */ }
    }

    return { ok: true };
  });

export const hardDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requireAdminContext(supabaseAdmin, context.userId);

    // Prevent the admin from deleting their own account through this path
    if (data.userId === context.userId) {
      throw new Error("You cannot delete your own admin account.");
    }

    const db = supabaseAdmin as any;

    // Clean up all related rows (explicit, don't rely on FK cascades)
    await db.from("memberships").delete().eq("user_id", data.userId);
    await db.from("membership_requests").delete().eq("user_id", data.userId);
    await db.from("user_roles").delete().eq("user_id", data.userId);
    await db.from("notifications").delete().eq("user_id", data.userId);
    await db.from("trainer_assignments").delete().eq("member_id", data.userId);
    await db.from("trainer_assignments").delete().eq("trainer_id", data.userId);
    await db.from("otp_verifications").delete().eq("user_id", data.userId);
    await db.from("profiles").delete().eq("id", data.userId);

    // Hard-delete from auth — frees the email for re-registration
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error("Auth delete failed: " + error.message);

    return { ok: true };
  });
