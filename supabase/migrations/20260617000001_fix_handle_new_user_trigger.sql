-- FIX: handle_new_user trigger was inserting into user_roles immediately on signup,
-- bypassing OTP verification. Now it only inserts the profile row.
-- user_roles is inserted by approveRequest (admin) after OTP is verified.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only create the profile row. Do NOT insert user_roles here.
  -- The user_roles row is inserted by the admin approve flow (after OTP verification).
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', '')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;
