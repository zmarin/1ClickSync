-- Fix customers table to match API route expectations
-- Adds missing columns: email, site_url, business_type

ALTER TABLE customers ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS site_url VARCHAR(500);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS business_type VARCHAR(100) DEFAULT 'saas';

-- Backfill email from contact_email if it exists
UPDATE customers SET email = contact_email WHERE email IS NULL AND contact_email IS NOT NULL;

-- Create index on email for the duplicate check
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
