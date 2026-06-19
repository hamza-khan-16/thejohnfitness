-- ================================================================
-- THE JOHN FITNESS — COMPLETE SUPABASE SCHEMA
-- Paste this entire file into Supabase SQL Editor and click Run.
-- ================================================================

-- ── 1. EXTENSIONS ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 2. ENUM ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','trainer','user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. TABLES ────────────────────────────────────────────────────

-- profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT,
  phone       TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- user_roles
CREATE TABLE IF NOT EXISTS public.user_roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

-- plans
CREATE TABLE IF NOT EXISTS public.plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  price         NUMERIC(10,2) NOT NULL,
  duration_days INT NOT NULL DEFAULT 30,
  features      TEXT[] DEFAULT '{}',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- memberships
CREATE TABLE IF NOT EXISTS public.memberships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id     UUID REFERENCES public.plans(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
  valid_till  DATE,
  amount      NUMERIC(10,2),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- fees
CREATE TABLE IF NOT EXISTS public.fees (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id             UUID REFERENCES public.plans(id) ON DELETE SET NULL,
  amount              NUMERIC(10,2) NOT NULL,
  method              TEXT,
  razorpay_payment_id TEXT,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded')),
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- workouts
CREATE TABLE IF NOT EXISTS public.workouts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  trainer_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- attendance
CREATE TABLE IF NOT EXISTS public.attendance (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date       DATE NOT NULL DEFAULT CURRENT_DATE,
  status     TEXT NOT NULL DEFAULT 'present',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

-- notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info','warning','success','error')),
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- admin_promotions (audit log)
CREATE TABLE IF NOT EXISTS public.admin_promotions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT,
  flow       TEXT NOT NULL,
  reason     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- user_goals
CREATE TABLE IF NOT EXISTS public.user_goals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_type     TEXT NOT NULL CHECK (goal_type IN ('attendance','weight','custom')),
  title         TEXT NOT NULL,
  target_value  NUMERIC,
  current_value NUMERIC DEFAULT 0,
  unit          TEXT,
  deadline      DATE,
  completed     BOOLEAN NOT NULL DEFAULT false,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 4. FUNCTIONS ─────────────────────────────────────────────────

-- has_role: used in RLS policies
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
-- GRANT (not revoke): authenticated users need EXECUTE so RLS policies can call this function.
-- The function is SECURITY DEFINER so it runs as owner — no privilege escalation risk.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- get_primary_role
CREATE OR REPLACE FUNCTION public.get_primary_role(_user_id UUID)
RETURNS public.app_role LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'trainer' THEN 2 ELSE 3 END
  LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.get_primary_role(uuid) TO authenticated;

-- auto-create profile + role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  req_role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', '')
  ) ON CONFLICT (id) DO NOTHING;

  req_role := COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'user');
  IF req_role = 'admin' THEN req_role := 'user'; END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, req_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- auto-expire memberships daily (call via pg_cron or supabase cron)
CREATE OR REPLACE FUNCTION public.expire_memberships()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.memberships
  SET status = 'expired'
  WHERE status = 'active' AND valid_till < CURRENT_DATE;
END;
$$;

-- send membership expiry notifications
CREATE OR REPLACE FUNCTION public.notify_expiring_memberships()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Notify members whose membership expires in 3 days
  INSERT INTO public.notifications (user_id, title, message, type)
  SELECT m.user_id,
    'Membership Expiring Soon',
    'Your membership expires on ' || to_char(m.valid_till, 'DD Mon YYYY') || '. Renew now to stay active.',
    'warning'
  FROM public.memberships m
  WHERE m.status = 'active'
    AND m.valid_till = CURRENT_DATE + INTERVAL '3 days'
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = m.user_id
        AND n.title = 'Membership Expiring Soon'
        AND n.created_at > now() - INTERVAL '2 days'
    );

  -- Notify members with no active membership (never had one or expired)
  INSERT INTO public.notifications (user_id, title, message, type)
  SELECT ur.user_id,
    'No Active Membership',
    'You don''t have an active membership. Choose a plan to get started!',
    'info'
  FROM public.user_roles ur
  WHERE ur.role = 'user'
    AND NOT EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = ur.user_id AND m.status = 'active' AND m.valid_till >= CURRENT_DATE
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = ur.user_id
        AND n.title = 'No Active Membership'
        AND n.created_at > now() - INTERVAL '7 days'
    );
END;
$$;

-- ── 5. RLS ENABLE ────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_promotions ENABLE ROW LEVEL SECURITY;

-- ── 6. GRANTS ────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT SELECT ON public.plans TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE ON public.memberships TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.fees TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workouts TO authenticated;
GRANT SELECT, INSERT ON public.attendance TO authenticated;
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT SELECT ON public.admin_promotions TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_goals TO authenticated;

-- ── 7. RLS POLICIES ──────────────────────────────────────────────

-- profiles
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'trainer'));
CREATE POLICY "profiles_insert" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(),'admin'));

-- user_roles
DROP POLICY IF EXISTS "roles_select" ON public.user_roles;
DROP POLICY IF EXISTS "roles_admin_all" ON public.user_roles;
CREATE POLICY "roles_select" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "roles_admin_all" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- plans
DROP POLICY IF EXISTS "plans_select" ON public.plans;
DROP POLICY IF EXISTS "plans_admin" ON public.plans;
CREATE POLICY "plans_select" ON public.plans FOR SELECT USING (true);
CREATE POLICY "plans_admin" ON public.plans FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- memberships
DROP POLICY IF EXISTS "memberships_select" ON public.memberships;
DROP POLICY IF EXISTS "memberships_insert" ON public.memberships;
DROP POLICY IF EXISTS "memberships_update_self" ON public.memberships;
DROP POLICY IF EXISTS "memberships_admin" ON public.memberships;
CREATE POLICY "memberships_select" ON public.memberships FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'trainer'));
CREATE POLICY "memberships_insert" ON public.memberships FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
-- FIX: users must be able to UPDATE their own memberships (expiring old ones on renewal)
CREATE POLICY "memberships_update_self" ON public.memberships FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "memberships_admin" ON public.memberships FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- fees
DROP POLICY IF EXISTS "fees_select" ON public.fees;
DROP POLICY IF EXISTS "fees_insert" ON public.fees;
DROP POLICY IF EXISTS "fees_admin" ON public.fees;
CREATE POLICY "fees_select" ON public.fees FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "fees_insert" ON public.fees FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "fees_admin" ON public.fees FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- workouts
DROP POLICY IF EXISTS "workouts_select" ON public.workouts;
DROP POLICY IF EXISTS "workouts_trainer_admin" ON public.workouts;
CREATE POLICY "workouts_select" ON public.workouts FOR SELECT TO authenticated USING (true);
CREATE POLICY "workouts_trainer_admin" ON public.workouts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'trainer'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'trainer'));

-- attendance
DROP POLICY IF EXISTS "attendance_select" ON public.attendance;
DROP POLICY IF EXISTS "attendance_insert" ON public.attendance;
DROP POLICY IF EXISTS "attendance_trainer_admin" ON public.attendance;
CREATE POLICY "attendance_select" ON public.attendance FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'trainer'));
CREATE POLICY "attendance_insert" ON public.attendance FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(),'trainer') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "attendance_trainer_admin" ON public.attendance FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'trainer'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'trainer'));

-- notifications
DROP POLICY IF EXISTS "notif_select" ON public.notifications;
DROP POLICY IF EXISTS "notif_update" ON public.notifications;
DROP POLICY IF EXISTS "notif_admin_insert" ON public.notifications;
CREATE POLICY "notif_select" ON public.notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "notif_update" ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "notif_admin_insert" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR auth.uid() = user_id);

-- admin_promotions
DROP POLICY IF EXISTS "promotions_admin" ON public.admin_promotions;
CREATE POLICY "promotions_admin" ON public.admin_promotions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- user_goals
ALTER TABLE public.user_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "goals_self" ON public.user_goals;
CREATE POLICY "goals_self" ON public.user_goals FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "goals_admin" ON public.user_goals;
CREATE POLICY "goals_admin" ON public.user_goals FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ── 8. SEED DATA ─────────────────────────────────────────────────
INSERT INTO public.plans (name, price, duration_days, features) VALUES
  ('Basic',    1500, 30, ARRAY['Gym access','Locker','Basic equipment']),
  ('Standard', 2000, 30, ARRAY['Gym access','Group classes','Locker','Diet guidance']),
  ('Premium',  2500, 30, ARRAY['Gym access','Personal trainer','All classes','Diet & nutrition plan','Sauna'])
ON CONFLICT DO NOTHING;

-- ── 9. ADMIN BOOTSTRAP ───────────────────────────────────────────
-- After running this schema, sign up once via /auth, then run:
--   SELECT id, email FROM auth.users ORDER BY created_at LIMIT 5;
-- Copy your UUID and run:
--   INSERT INTO public.user_roles (user_id, role) VALUES ('<your-uuid>', 'admin');
