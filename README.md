# The John Fitness — Gym Management Platform

A full-stack gym management app built with TanStack Start, Supabase, and Razorpay.

## Roles
| Role    | Login Path | Sign Up | Notes |
|---------|-----------|---------|-------|
| Member  | `/auth` (Member tab) | ✅ Self-register | Default role |
| Trainer | `/auth` (Trainer tab) | ✅ Self-register | Trainer-specific signup |
| Admin   | `/auth` → Admin Login link | ❌ No public signup | **Only one admin**. First admin is bootstrapped via SQL or `ADMIN_SIGNUP_CODE`. |

## Setup

### 1. Clone & Install
```bash
git clone <repo>
cd gym-pro
bun install
```

### 2. Configure Environment
Copy `.env` and fill in your values:
```bash
cp .env .env.local
```

Required values:
- `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` — from Supabase Dashboard > Settings > API
- `SUPABASE_SERVICE_ROLE_KEY` — from same page (keep secret, server-only)
- `VITE_RAZORPAY_KEY_ID` — from Razorpay Dashboard > Settings > API Keys
- `ADMIN_SIGNUP_CODE` — a strong secret string for promoting the first admin

### 3. Set Up Supabase Database
```bash
# Option A: paste supabase/schema.sql into Supabase SQL Editor and Run
# Option B: use CLI
supabase link --project-ref YOUR_PROJECT_ID
supabase db push
```

### 4. Run Locally
```bash
bun run dev
```

## Payments (Razorpay)
- Supports UPI, Google Pay, PhonePe, Cards, Net Banking, Wallets
- All routed through Razorpay checkout
- Payment ID (`pay_XXXXXXXX`) stored in `fees.razorpay_payment_id`
- Test: use `rzp_test_` key + test cards from https://razorpay.com/docs/payments/payments/test-card-details/

## Project Structure
```
src/
  routes/
    auth.tsx                   ← Member / Trainer / Admin login + signup
    _authenticated/
      dashboard.tsx            ← Member dashboard + Razorpay payment
      trainer.tsx              ← Trainer dashboard
      admin.tsx                ← Admin dashboard (single admin only)
  lib/
    razorpay.ts                ← Razorpay SDK loader + checkout helper
    admin.functions.ts         ← claimAdminRole server function
  integrations/supabase/
    client.ts                  ← Browser Supabase client
    client.server.ts           ← Server Supabase admin client
    types.ts                   ← Generated Supabase types
    auth-middleware.ts         ← Server function auth guard
    auth-attacher.ts           ← Client middleware to attach Bearer token
supabase/
  schema.sql                   ← Full DB schema (run this in Supabase)
  config.toml                  ← Supabase CLI config
  COMMANDS.md                  ← All Supabase CLI commands + useful SQL
  migrations/                  ← Incremental migration files
```
