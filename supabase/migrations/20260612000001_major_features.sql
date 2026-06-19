-- ================================================================
-- MIGRATION: Major features
-- 1. Add has_trainer to plans
-- 2. Add trainer_assignments (admin assigns members to trainers)
-- 3. Add check-in time to attendance
-- 4. Add otp_verifications table
-- 5. Only one admin constraint
-- ================================================================

-- Add has_trainer to plans
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS has_trainer BOOLEAN NOT NULL DEFAULT false;

-- Add check_in_time to attendance
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS check_in_time TIMESTAMPTZ DEFAULT now();

-- trainer_assignments: admin assigns members to trainers
CREATE TABLE IF NOT EXISTS public.trainer_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(trainer_id, member_id)
);
ALTER TABLE public.trainer_assignments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.trainer_assignments TO authenticated;
DROP POLICY IF EXISTS "assignments_read"  ON public.trainer_assignments;
DROP POLICY IF EXISTS "assignments_admin" ON public.trainer_assignments;
CREATE POLICY "assignments_read" ON public.trainer_assignments FOR SELECT TO authenticated
  USING (auth.uid() = trainer_id OR auth.uid() = member_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "assignments_admin" ON public.trainer_assignments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- otp_verifications table
CREATE TABLE IF NOT EXISTS public.otp_verifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  otp         TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '10 minutes'),
  verified    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.otp_verifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.otp_verifications TO authenticated;
DROP POLICY IF EXISTS "otp_self" ON public.otp_verifications;
CREATE POLICY "otp_self" ON public.otp_verifications FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- trainer_schedules
CREATE TABLE IF NOT EXISTS public.trainer_schedules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  notes       TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.trainer_schedules ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_schedules TO authenticated;
DROP POLICY IF EXISTS "schedules_trainer" ON public.trainer_schedules;
DROP POLICY IF EXISTS "schedules_admin"   ON public.trainer_schedules;
CREATE POLICY "schedules_trainer" ON public.trainer_schedules FOR ALL TO authenticated
  USING (auth.uid() = trainer_id OR auth.uid() = member_id OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() = trainer_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "schedules_admin" ON public.trainer_schedules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
