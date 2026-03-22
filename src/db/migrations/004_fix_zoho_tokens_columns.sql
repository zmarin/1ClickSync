-- Fix zoho_tokens table columns to match API code expectations
-- Code references zoho_dc, zoho_org_id, token_expires_at, refresh_failures, connected_at
-- but DB has dc, org_id, expires_at, consecutive_failures, and no connected_at

-- Rename columns to match code
ALTER TABLE zoho_tokens RENAME COLUMN dc TO zoho_dc;
ALTER TABLE zoho_tokens RENAME COLUMN org_id TO zoho_org_id;
ALTER TABLE zoho_tokens RENAME COLUMN expires_at TO token_expires_at;
ALTER TABLE zoho_tokens RENAME COLUMN consecutive_failures TO refresh_failures;

-- Add missing connected_at column
ALTER TABLE zoho_tokens ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ DEFAULT NOW();

-- Add UNIQUE constraint on customer_id (required for ON CONFLICT upsert)
ALTER TABLE zoho_tokens ADD CONSTRAINT zoho_tokens_customer_id_unique UNIQUE (customer_id);
