-- =============================================================
-- Migration: Fix memberships UPDATE RLS + add user_goals table
-- Run in Supabase SQL Editor
-- =============================================================

-- ── FIX: memberships UPDATE policy for users ─────────────────
-- Without this, regular users can INSERT memberships but cannot
-- UPDATE (expire old ones), causing a silent RLS violation when
-- they pay for a new plan.
DROP POLICY IF EXISTS "memberships_update_self" ON public.memberships;
CREATE POLICY "memberships_update_self" ON public.memberships
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── user_goals table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_goals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_type       TEXT NOT NULL CHECK (goal_type IN ('attendance','weight','custom')),
  title           TEXT NOT NULL,
  target_value    NUMERIC,         -- e.g. 20 (days/month), 75 (kg)
  current_value   NUMERIC DEFAULT 0,
  unit            TEXT,            -- 'days', 'kg', 'reps', etc.
  deadline        DATE,
  completed       BOOLEAN NOT NULL DEFAULT false,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_goals ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_goals TO authenticated;

DROP POLICY IF EXISTS "goals_self" ON public.user_goals;
CREATE POLICY "goals_self" ON public.user_goals FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "goals_admin" ON public.user_goals;
CREATE POLICY "goals_admin" ON public.user_goals FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
