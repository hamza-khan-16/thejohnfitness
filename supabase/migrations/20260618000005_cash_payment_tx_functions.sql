-- Creates a fee row (status='pending') and a membership row (status='pending_approval')
-- atomically when a member opts for in-hand cash payment. Nothing here unlocks
-- the plan — that only happens when an admin approves it via approve_cash_payment_tx.
CREATE OR REPLACE FUNCTION public.request_cash_payment_tx(
  p_user_id UUID,
  p_plan_id UUID,
  p_amount NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fee_id UUID;
BEGIN
  -- A member shouldn't be able to stack multiple cash requests for the same plan
  -- while one is already awaiting approval.
  IF EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = p_user_id AND status = 'pending_approval'
  ) THEN
    RAISE EXCEPTION 'A cash payment request is already awaiting admin approval.';
  END IF;

  INSERT INTO public.fees (user_id, plan_id, amount, method, status)
  VALUES (p_user_id, p_plan_id, p_amount, 'cash', 'pending')
  RETURNING id INTO v_fee_id;

  INSERT INTO public.memberships (user_id, plan_id, status, valid_till, amount)
  VALUES (p_user_id, p_plan_id, 'pending_approval', NULL, p_amount);

  RETURN v_fee_id;
END;
$$;

-- Admin approves a pending cash payment: fee flips to 'paid', membership flips
-- to 'active' with a valid_till computed from the plan's duration_days, and any
-- previously-active membership for this user is expired (mirrors record_payment_tx).
CREATE OR REPLACE FUNCTION public.approve_cash_payment_tx(
  p_fee_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_plan_id UUID;
  v_duration_days INT;
BEGIN
  SELECT user_id, plan_id INTO v_user_id, v_plan_id
  FROM public.fees WHERE id = p_fee_id AND method = 'cash' AND status = 'pending';

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Cash payment request not found or already processed.';
  END IF;

  SELECT duration_days INTO v_duration_days FROM public.plans WHERE id = v_plan_id;
  IF v_duration_days IS NULL THEN v_duration_days := 30; END IF;

  UPDATE public.fees SET status = 'paid', paid_at = now() WHERE id = p_fee_id;

  UPDATE public.memberships SET status = 'expired'
  WHERE user_id = v_user_id AND status = 'active';

  UPDATE public.memberships
  SET status = 'active', valid_till = (CURRENT_DATE + v_duration_days)
  WHERE user_id = v_user_id AND plan_id = v_plan_id AND status = 'pending_approval';
END;
$$;

-- Admin rejects a pending cash payment: fee flips to 'failed', the placeholder
-- membership row is removed entirely so it doesn't linger or block a future request.
CREATE OR REPLACE FUNCTION public.reject_cash_payment_tx(
  p_fee_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_plan_id UUID;
BEGIN
  SELECT user_id, plan_id INTO v_user_id, v_plan_id
  FROM public.fees WHERE id = p_fee_id AND method = 'cash' AND status = 'pending';

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Cash payment request not found or already processed.';
  END IF;

  UPDATE public.fees SET status = 'failed' WHERE id = p_fee_id;

  DELETE FROM public.memberships
  WHERE user_id = v_user_id AND plan_id = v_plan_id AND status = 'pending_approval';
END;
$$;
