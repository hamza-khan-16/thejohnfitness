-- Lightweight rate-limiting: track when an OTP was last sent per user so
-- resend/forgot-password endpoints can enforce a cooldown without a separate
-- rate-limit table or external service (Redis, etc).
ALTER TABLE public.otp_verifications
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_otp_verifications_user_sent
  ON public.otp_verifications (user_id, sent_at DESC);
