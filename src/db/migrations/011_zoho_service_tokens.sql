-- Migration 011: add service-scoped Zoho OAuth connections for the studio.

CREATE TABLE IF NOT EXISTS zoho_service_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  service VARCHAR(50) NOT NULL,
  zoho_dc VARCHAR(10) NOT NULL DEFAULT 'com',
  zoho_org_id VARCHAR(100),
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  scopes JSONB NOT NULL DEFAULT '[]',
  token_expires_at TIMESTAMPTZ NOT NULL,
  is_valid BOOLEAN NOT NULL DEFAULT TRUE,
  refresh_failures INT NOT NULL DEFAULT 0,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_refreshed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zoho_service_tokens_app_service
  ON zoho_service_tokens(app_id, service);

CREATE INDEX IF NOT EXISTS idx_zoho_service_tokens_valid_expiry
  ON zoho_service_tokens(token_expires_at)
  WHERE is_valid = TRUE;
