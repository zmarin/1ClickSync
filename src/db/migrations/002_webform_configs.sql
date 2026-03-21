-- Webform configurations: each form has a unique key, styling, and field mapping
CREATE TABLE IF NOT EXISTS form_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  form_key VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT 'Contact Form',
  -- Which Zoho CRM module to push into (Leads, Contacts, etc.)
  target_module VARCHAR(100) NOT NULL DEFAULT 'Leads',
  -- Field mapping: { formField: zohoField } e.g. {"email":"Email","name":"Last_Name"}
  field_mapping JSONB NOT NULL DEFAULT '{}',
  -- LLM-editable CSS/style config
  style_config JSONB NOT NULL DEFAULT '{}',
  -- Lead Source value written to CRM record
  lead_source VARCHAR(255),
  -- Form status
  is_active BOOLEAN DEFAULT TRUE,
  submissions_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_form_configs_customer ON form_configs(customer_id);
CREATE INDEX IF NOT EXISTS idx_form_configs_key ON form_configs(form_key);
CREATE INDEX IF NOT EXISTS idx_form_configs_user ON form_configs(user_id);

-- Track every form submission
CREATE TABLE IF NOT EXISTS form_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES form_configs(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL,
  -- Raw submitted data
  payload JSONB NOT NULL,
  -- Zoho CRM record ID if created successfully
  zoho_record_id VARCHAR(100),
  zoho_module VARCHAR(100),
  status VARCHAR(20) DEFAULT 'pending',
  error TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_form ON form_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_status ON form_submissions(status);
