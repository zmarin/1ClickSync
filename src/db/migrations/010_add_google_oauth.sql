-- Allow Google OAuth users (no password)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Track Google identity
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
