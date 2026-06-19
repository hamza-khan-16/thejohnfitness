-- Allow memberships to sit in a "pending_approval" state for cash payments —
-- the member has requested the plan but it isn't active until an admin
-- confirms they actually received the cash in person.
ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_status_check;
ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_status_check
  CHECK (status IN ('active','expired','cancelled','pending_approval'));

-- 'cash' is already accepted by fees.method (it's a free-text TEXT column),
-- no constraint change needed there. fees.status already supports 'pending'.

CREATE INDEX IF NOT EXISTS idx_memberships_pending_approval
  ON public.memberships (status) WHERE status = 'pending_approval';
