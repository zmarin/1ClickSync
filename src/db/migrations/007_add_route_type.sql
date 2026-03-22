-- Migration 007: Add route_type to form_configs
-- Enables forms to dispatch to different Zoho tools (Desk, Bookings, etc.)
ALTER TABLE form_configs ADD COLUMN IF NOT EXISTS route_type VARCHAR(50) DEFAULT 'crm';
