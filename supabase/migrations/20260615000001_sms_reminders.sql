-- Track which SMS reminders have been sent so we don't duplicate
create table if not exists sms_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  type text not null, -- '5_day', '1_day', '2_day_after'
  sent_at timestamptz default now(),
  membership_valid_till date,
  unique(user_id, type, membership_valid_till)
);
alter table sms_reminders enable row level security;
-- Only service role writes; no user reads needed
