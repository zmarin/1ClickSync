-- 1ClickSync Database Schema
-- Automated Zoho One Setup Platform

-- ============================================
-- USERS & AUTH
-- ============================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  company VARCHAR(255),
  plan VARCHAR(50) DEFAULT 'free',
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  subscription_status VARCHAR(50),
  subscription_ends_at TIMESTAMPTZ,
  email_verified BOOLEAN DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reset_tokens_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_expiry ON password_reset_tokens(expires_at);

-- ============================================
-- CUSTOMERS (Zoho accounts being configured)
-- ============================================

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  site_name VARCHAR(255) NOT NULL,
  company_name VARCHAR(255),
  contact_email VARCHAR(255),
  plan VARCHAR(50) DEFAULT 'starter',
  stripe_customer_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_user ON customers(user_id);

-- ============================================
-- ZOHO OAUTH TOKENS (encrypted at rest)
-- ============================================

CREATE TABLE IF NOT EXISTS zoho_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  dc VARCHAR(10) NOT NULL DEFAULT 'com',
  org_id VARCHAR(50),
  scopes TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  is_valid BOOLEAN DEFAULT TRUE,
  consecutive_failures INT DEFAULT 0,
  last_refreshed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tokens_customer ON zoho_tokens(customer_id);
CREATE INDEX IF NOT EXISTS idx_tokens_expiry ON zoho_tokens(expires_at) WHERE is_valid = TRUE;

-- ============================================
-- SETUP JOBS & STEPS (template execution)
-- ============================================

CREATE TABLE IF NOT EXISTS setup_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  template_id VARCHAR(255) NOT NULL,
  template_version VARCHAR(50) NOT NULL DEFAULT '1.0',
  status VARCHAR(50) DEFAULT 'pending',
  total_steps INT DEFAULT 0,
  completed_steps INT DEFAULT 0,
  failed_steps INT DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_customer ON setup_jobs(customer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON setup_jobs(status);

CREATE TABLE IF NOT EXISTS setup_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES setup_jobs(id) ON DELETE CASCADE,
  step_id VARCHAR(255) NOT NULL,
  action VARCHAR(255) NOT NULL,
  module VARCHAR(255),
  config JSONB DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'pending',
  idempotency_key VARCHAR(512) UNIQUE,
  depends_on TEXT[] DEFAULT '{}',
  result JSONB,
  error_message TEXT,
  attempt_count INT DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_steps_job ON setup_steps(job_id);
CREATE INDEX IF NOT EXISTS idx_steps_status ON setup_steps(status);
CREATE INDEX IF NOT EXISTS idx_steps_idempotency ON setup_steps(idempotency_key);

-- ============================================
-- AUDIT & TRACKING
-- ============================================

CREATE TABLE IF NOT EXISTS api_audit_log (
  id BIGSERIAL PRIMARY KEY,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  method VARCHAR(10),
  url TEXT,
  status_code INT,
  request_body JSONB,
  response_body JSONB,
  duration_ms INT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_customer ON api_audit_log(customer_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON api_audit_log(created_at);

CREATE TABLE IF NOT EXISTS created_resources (
  id BIGSERIAL PRIMARY KEY,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  step_id UUID REFERENCES setup_steps(id) ON DELETE SET NULL,
  resource_type VARCHAR(100),
  resource_id VARCHAR(255),
  resource_name VARCHAR(255),
  module VARCHAR(100),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resources_customer ON created_resources(customer_id);
CREATE INDEX IF NOT EXISTS idx_resources_type ON created_resources(resource_type);

-- ============================================
-- TEMPLATES REGISTRY (optional)
-- ============================================

CREATE TABLE IF NOT EXISTS templates (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  version VARCHAR(50) DEFAULT '1.0',
  category VARCHAR(100),
  config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
