# Supabase Commands & Reference — The John Fitness

## Quick Start

### 1. Apply Schema (choose one method)

**Option A — SQL Editor (easiest):**
1. Open Supabase Dashboard → SQL Editor → New Query
2. Paste the entire contents of `supabase/schema.sql`
3. Click **Run**

**Option B — Supabase CLI:**
```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_ID
supabase db push
```

### 2. Bootstrap First Admin
After creating your account via `/auth`:
```sql
-- Find your user ID
SELECT id, email FROM auth.users ORDER BY created_at LIMIT 5;

-- Promote to admin (replace with your actual UUID)
INSERT INTO public.user_roles (user_id, role)
VALUES ('your-user-uuid-here', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
```

---

## CLI Commands Reference

```bash
# Link project
supabase link --project-ref <project-id>

# Push local migrations to remote
supabase db push

# Pull remote schema to local
supabase db pull

# Start local dev stack (requires Docker)
supabase start
supabase stop
supabase status

# Reset local DB (re-applies all migrations)
supabase db reset

# Create new migration file
supabase migration new <name>
# e.g.: supabase migration new add_razorpay_payment_id

# List migration status
supabase migration list

# Regenerate TypeScript types from live schema
supabase gen types typescript --linked > src/integrations/supabase/types.ts

# Open local Supabase Studio
supabase studio

# Show DB diff vs remote
supabase db diff
```

---

## Environment Variables

| Variable | Location | Description |
|---|---|---|
| `SUPABASE_URL` | `.env` | Project REST URL |
| `SUPABASE_PUBLISHABLE_KEY` | `.env` | Anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env` (server only) | Service role — never expose to browser |
| `VITE_SUPABASE_URL` | `.env` | Same URL for Vite client |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env` | Same anon key for Vite |
| `ADMIN_SIGNUP_CODE` | `.env` (server only) | Secret to promote users to admin |
| `VITE_RAZORPAY_KEY_ID` | `.env` | Razorpay Key ID |

---

## Useful SQL Queries

```sql
-- All users with roles
SELECT p.full_name, p.phone, ur.role, p.created_at
FROM public.profiles p
JOIN public.user_roles ur ON ur.user_id = p.id
ORDER BY ur.role, p.created_at;

-- Active memberships
SELECT p.full_name, pl.name AS plan, m.valid_till, m.status
FROM public.memberships m
JOIN public.profiles p ON p.id = m.user_id
JOIN public.plans pl ON pl.id = m.plan_id
WHERE m.status = 'active' AND m.valid_till >= CURRENT_DATE
ORDER BY m.valid_till;

-- Members expiring in next 7 days
SELECT p.full_name, p.phone, m.valid_till
FROM public.memberships m
JOIN public.profiles p ON p.id = m.user_id
WHERE m.status = 'active'
  AND m.valid_till BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days';

-- All paid fees with Razorpay IDs
SELECT p.full_name, f.amount, f.method, f.razorpay_payment_id, f.paid_at
FROM public.fees f
JOIN public.profiles p ON p.id = f.user_id
WHERE f.status = 'paid'
ORDER BY f.paid_at DESC;

-- Monthly revenue
SELECT DATE_TRUNC('month', paid_at) AS month,
       COUNT(*) AS payments,
       SUM(amount) AS revenue
FROM public.fees WHERE status = 'paid'
GROUP BY 1 ORDER BY 1 DESC;

-- Attendance this week
SELECT p.full_name, COUNT(*) AS days
FROM public.attendance a
JOIN public.profiles p ON p.id = a.user_id
WHERE a.date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY p.full_name ORDER BY days DESC;

-- Promote user to trainer
UPDATE public.user_roles SET role = 'trainer'
WHERE user_id = '<uuid>' AND role = 'user';

-- Manually expire old memberships
UPDATE public.memberships
SET status = 'expired'
WHERE status = 'active' AND valid_till < CURRENT_DATE;

-- Send notification to all members
INSERT INTO public.notifications (user_id, title, message, type)
SELECT user_id, 'Gym Closed Tomorrow', 'The gym will be closed on 15 Aug for Independence Day.', 'info'
FROM public.user_roles WHERE role = 'user';
```

---

## Razorpay Setup

1. Create account at https://dashboard.razorpay.com
2. Complete KYC (required for live payments)
3. Go to **Settings → API Keys → Generate Key**
4. Copy Key ID (starts with `rzp_test_` or `rzp_live_`)
5. Add to `.env`:
   ```
   VITE_RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXXXXXX
   ```
6. Test cards: https://razorpay.com/docs/payments/payments/test-card-details/
   - Card: `4111 1111 1111 1111` / Any future date / Any CVV
   - UPI: `success@razorpay`

---

## Security Notes

- **Never** commit `.env` to git (already in `.gitignore`)
- **Never** use `SUPABASE_SERVICE_ROLE_KEY` in client-side code
- RLS is enabled on all tables — users can only see their own data
- Admin role cannot be self-assigned via signup metadata (blocked in DB trigger)
- Razorpay payment verification should be done server-side in production
