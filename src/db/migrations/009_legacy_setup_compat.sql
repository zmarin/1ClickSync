-- Migration 009: bring legacy setup automation tables in line with the current worker/API code
-- The setup flow is no longer the primary product surface, but these columns keep the
-- legacy beta paths working for backward-compatible installs.

ALTER TABLE setup_steps
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS step_order INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS target_app VARCHAR(100),
  ADD COLUMN IF NOT EXISTS error TEXT,
  ADD COLUMN IF NOT EXISTS attempts INT DEFAULT 0;

UPDATE setup_steps ss
SET
  customer_id = sj.customer_id,
  step_order = COALESCE(ss.step_order, 0),
  target_app = COALESCE(ss.target_app, ss.module),
  error = COALESCE(ss.error, ss.error_message),
  attempts = COALESCE(ss.attempts, ss.attempt_count, 0)
FROM setup_jobs sj
WHERE ss.job_id = sj.id
  AND (
    ss.customer_id IS NULL
    OR ss.target_app IS NULL
    OR ss.error IS NULL
    OR ss.attempts IS NULL
  );

CREATE INDEX IF NOT EXISTS idx_setup_steps_customer ON setup_steps(customer_id);
CREATE INDEX IF NOT EXISTS idx_setup_steps_order ON setup_steps(job_id, step_order);

ALTER TABLE created_resources
  ADD COLUMN IF NOT EXISTS zoho_app VARCHAR(100);

UPDATE created_resources
SET zoho_app = COALESCE(zoho_app, module)
WHERE zoho_app IS NULL;
