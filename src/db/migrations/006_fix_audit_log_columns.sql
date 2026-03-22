-- Migration 006: Add missing columns to api_audit_log
-- The init.sql schema had: url, status_code, error
-- But the code inserts: step_id, zoho_app, endpoint, response_status
-- This migration adds the missing columns.

ALTER TABLE api_audit_log ADD COLUMN IF NOT EXISTS step_id UUID;
ALTER TABLE api_audit_log ADD COLUMN IF NOT EXISTS zoho_app VARCHAR(50);
ALTER TABLE api_audit_log ADD COLUMN IF NOT EXISTS endpoint TEXT;
ALTER TABLE api_audit_log ADD COLUMN IF NOT EXISTS response_status INT;
