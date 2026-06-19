-- Migration: Add razorpay_payment_id to fees table
-- Run after initial schema if upgrading an existing deployment

ALTER TABLE public.fees
  ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT;

COMMENT ON COLUMN public.fees.razorpay_payment_id IS 'Razorpay payment ID (pay_XXXXXXXX) returned after successful checkout';
