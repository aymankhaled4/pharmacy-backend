-- User account status: active | blocked | deleted
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
CHECK (status IN ('active', 'blocked', 'deleted'));

-- Sync existing soft-deleted rows
UPDATE user_profiles
SET status = 'deleted'
WHERE deleted_at IS NOT NULL AND status <> 'deleted';
