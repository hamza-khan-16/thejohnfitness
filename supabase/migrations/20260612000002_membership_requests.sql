-- ================================================================
-- MIGRATION: Membership approval system
-- Users must be approved by admin before accessing the app
-- ================================================================

CREATE TABLE IF NOT EXISTS public.membership_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name    TEXT NOT NULL,
  email        TEXT NOT NULL,
  phone        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','trainer')),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','rejected')),
  reject_reason TEXT,
  reviewed_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.membership_requests ENABLE ROW LEVEL SECURITY;

-- User can see their own request
DROP POLICY IF EXISTS "requests_self"   ON public.membership_requests;
DROP POLICY IF EXISTS "requests_admin"  ON public.membership_requests;
DROP POLICY IF EXISTS "requests_insert" ON public.membership_requests;

CREATE POLICY "requests_self" ON public.membership_requests
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Admin can see and update all
CREATE POLICY "requests_admin" ON public.membership_requests
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- User can insert their own request
CREATE POLICY "requests_insert" ON public.membership_requests
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT ON public.membership_requests TO authenticated;
GRANT UPDATE ON public.membership_requests TO authenticated;
GRANT ALL ON public.membership_requests TO service_role;
