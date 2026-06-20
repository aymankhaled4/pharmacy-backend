-- Account lifecycle status on admin_profiles (same as user_profiles).
-- Run in Supabase SQL Editor after 003_user_account_status.sql.

ALTER TABLE public.admin_profiles
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
CHECK (status IN ('active', 'blocked', 'deleted'));

ALTER TABLE public.admin_profiles
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
