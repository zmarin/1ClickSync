-- Migration 005: Create apps table and reparent entities from customers to apps
-- This is the core structural change: "App" becomes the first-class entity.

-- ═══════════════════════════════════════════════════
-- 1. Create the apps table
-- ═══════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  domain VARCHAR(255),
  business_type VARCHAR(100) DEFAULT 'saas',
  zoho_tools JSONB DEFAULT '["crm"]',
  settings JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_apps_user ON apps(user_id);
CREATE INDEX IF NOT EXISTS idx_apps_slug ON apps(slug);

-- ═══════════════════════════════════════════════════
-- 2. Add app_id columns to existing tables
-- ═══════════════════════════════════════════════════
ALTER TABLE zoho_tokens ADD COLUMN IF NOT EXISTS app_id UUID REFERENCES apps(id) ON DELETE CASCADE;
ALTER TABLE form_configs ADD COLUMN IF NOT EXISTS app_id UUID REFERENCES apps(id) ON DELETE CASCADE;
ALTER TABLE setup_jobs ADD COLUMN IF NOT EXISTS app_id UUID REFERENCES apps(id) ON DELETE CASCADE;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS app_id UUID;
ALTER TABLE api_audit_log ADD COLUMN IF NOT EXISTS app_id UUID REFERENCES apps(id) ON DELETE SET NULL;
ALTER TABLE created_resources ADD COLUMN IF NOT EXISTS app_id UUID REFERENCES apps(id) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════
-- 3. Backfill: Create an app for each existing customer
-- ═══════════════════════════════════════════════════
INSERT INTO apps (id, user_id, name, slug, domain, business_type, created_at, updated_at)
SELECT
  c.id,                                          -- reuse customer UUID as app UUID
  c.user_id,
  c.site_name,
  LOWER(REPLACE(REPLACE(c.site_name, ' ', '-'), '.', '-')) || '-' || LEFT(c.id::text, 8),
  c.site_url,
  COALESCE(c.business_type, 'saas'),
  c.created_at,
  c.updated_at
FROM customers c
WHERE c.user_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════
-- 4. Backfill app_id from customer_id (same UUID)
-- ═══════════════════════════════════════════════════
UPDATE zoho_tokens SET app_id = customer_id
WHERE app_id IS NULL AND customer_id IN (SELECT id FROM apps);

UPDATE form_configs SET app_id = customer_id
WHERE app_id IS NULL AND customer_id IN (SELECT id FROM apps);

UPDATE setup_jobs SET app_id = customer_id
WHERE app_id IS NULL AND customer_id IN (SELECT id FROM apps);

UPDATE form_submissions SET app_id = customer_id
WHERE app_id IS NULL AND customer_id IN (SELECT id FROM apps);

UPDATE api_audit_log SET app_id = customer_id
WHERE app_id IS NULL AND customer_id IN (SELECT id FROM apps);

UPDATE created_resources SET app_id = customer_id
WHERE app_id IS NULL AND customer_id IN (SELECT id FROM apps);

-- ═══════════════════════════════════════════════════
-- 5. Add unique constraint on app_id for zoho_tokens
-- ═══════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS idx_zoho_tokens_app_id ON zoho_tokens(app_id);
CREATE INDEX IF NOT EXISTS idx_form_configs_app ON form_configs(app_id);
CREATE INDEX IF NOT EXISTS idx_setup_jobs_app ON setup_jobs(app_id);
