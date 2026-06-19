-- ================================================================
-- Migration: Add trainer_profiles table for home page trainer cards
-- Admin can manage name, specialisation, experience, certification
-- ================================================================

CREATE TABLE IF NOT EXISTS public.trainer_profiles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  specialisation TEXT NOT NULL DEFAULT '',
  experience     TEXT NOT NULL DEFAULT '',
  certification  TEXT NOT NULL DEFAULT '',
  bio            TEXT,
  display_order  INT NOT NULL DEFAULT 0,
  is_visible     BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.trainer_profiles ENABLE ROW LEVEL SECURITY;

-- Anyone can read visible trainer profiles (shown on public home page)
DROP POLICY IF EXISTS "trainer_profiles_select" ON public.trainer_profiles;
CREATE POLICY "trainer_profiles_select" ON public.trainer_profiles
  FOR SELECT USING (true);

-- Only admins can create / update / delete
DROP POLICY IF EXISTS "trainer_profiles_admin" ON public.trainer_profiles;
CREATE POLICY "trainer_profiles_admin" ON public.trainer_profiles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.trainer_profiles TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.trainer_profiles TO authenticated;

-- Seed with the existing hardcoded trainers
INSERT INTO public.trainer_profiles (name, specialisation, experience, certification, display_order) VALUES
  ('Arjun Patel',  'Strength & Conditioning', '8 years', 'NSCA-CSCS',        1),
  ('Priya Nair',   'Yoga & Flexibility',      '6 years', 'RYT-500',          2),
  ('Vikram Singh', 'HIIT & Cardio',           '7 years', 'ACE CPT',          3),
  ('Meera Joshi',  'Nutrition & Wellness',    '5 years', 'ISSA Nutritionist', 4)
ON CONFLICT DO NOTHING;
