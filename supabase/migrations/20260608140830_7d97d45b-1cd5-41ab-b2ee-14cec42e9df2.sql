CREATE TABLE public.admin_promotions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT,
  flow TEXT NOT NULL CHECK (flow IN ('signup','dashboard')),
  reason TEXT NOT NULL CHECK (reason IN ('bootstrap','code')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_promotions TO authenticated;
GRANT ALL ON public.admin_promotions TO service_role;
ALTER TABLE public.admin_promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view promotions" ON public.admin_promotions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));