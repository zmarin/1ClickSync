CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    first_name TEXT,
    last_name TEXT,
    company TEXT,
    is_admin BOOLEAN DEFAULT false,
    subscription_tier TEXT DEFAULT 'free',
    sync_enabled BOOLEAN DEFAULT false,
    sync_status TEXT DEFAULT 'inactive',
    last_sync TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
