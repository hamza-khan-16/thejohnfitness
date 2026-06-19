-- Adds intended_role so OTP verification doesn't have to trust a client-supplied
-- role at verify time (it's now recorded once, at signup, and read back server-side).
ALTER TABLE public.otp_verifications
  ADD COLUMN IF NOT EXISTS intended_role TEXT CHECK (intended_role IN ('user','trainer'));

-- Hard guarantee at the database level: only one admin row can ever exist.
-- This closes the race-condition window where two concurrent claimAdminRole
-- calls could both pass the application-level count check before either insert lands.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_single_admin
  ON public.user_roles (role)
  WHERE role = 'admin';
