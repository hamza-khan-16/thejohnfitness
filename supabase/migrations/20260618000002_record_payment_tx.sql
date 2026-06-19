-- Wraps the fee-insert + membership-expire + membership-insert sequence in a
-- single DB transaction. If any step fails, Postgres rolls back the whole thing —
-- a member can never end up with a "paid" fee row and no active membership.
CREATE OR REPLACE FUNCTION public.record_payment_tx(
  p_user_id UUID,
  p_plan_id UUID,
  p_amount NUMERIC,
  p_method TEXT,
  p_razorpay_payment_id TEXT,
  p_valid_till DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.fees (user_id, plan_id, amount, method, status, paid_at, razorpay_payment_id)
  VALUES (p_user_id, p_plan_id, p_amount, p_method, 'paid', now(), p_razorpay_payment_id);

  UPDATE public.memberships
  SET status = 'expired'
  WHERE user_id = p_user_id AND status = 'active';

  INSERT INTO public.memberships (user_id, plan_id, status, valid_till, amount)
  VALUES (p_user_id, p_plan_id, 'active', p_valid_till, p_amount);
END;
$$;
