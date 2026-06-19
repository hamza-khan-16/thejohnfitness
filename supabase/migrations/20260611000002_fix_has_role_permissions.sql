-- =============================================================
-- Migration: Fix has_role & get_primary_role execute permissions
-- 
-- The schema revokes EXECUTE from `authenticated`, but RLS policies
-- call these functions in USING/WITH CHECK clauses on behalf of
-- authenticated users. Without EXECUTE, any INSERT/UPDATE that
-- triggers a policy calling has_role fails with:
--   "permission denied for function has_role"
--
-- Fix: grant EXECUTE back to authenticated. The functions are
-- SECURITY DEFINER so they run as the owner (postgres/supabase_admin)
-- not as the calling user — no privilege escalation risk.
-- =============================================================

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_primary_role(uuid) TO authenticated;

-- Also deduplicate plans in case seed ran multiple times
DELETE FROM public.plans
WHERE id NOT IN (
  SELECT MIN(id)
  FROM public.plans
  GROUP BY name, price, duration_days
);
