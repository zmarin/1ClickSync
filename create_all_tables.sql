-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    email TEXT NOT NULL UNIQUE,
    confirmed BOOLEAN DEFAULT false,
    subscription_plan TEXT,
    zoho_portal_id TEXT,
    sync_settings JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security for users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Create policies for users
CREATE POLICY "Users can view their own data" ON users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own data" ON users
    FOR UPDATE USING (auth.uid() = id);

-- OAuth Tokens Table
CREATE TABLE IF NOT EXISTS oauth_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) NOT NULL,
    service TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_in INTEGER,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security for oauth_tokens
ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Create policies for oauth_tokens
CREATE POLICY "Users can view their own tokens" ON oauth_tokens
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own tokens" ON oauth_tokens
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tokens" ON oauth_tokens
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tokens" ON oauth_tokens
    FOR DELETE USING (auth.uid() = user_id);

-- Task Mappings Table
CREATE TABLE IF NOT EXISTS task_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) NOT NULL,
    zoho_task_id TEXT NOT NULL,
    todoist_task_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security for task_mappings
ALTER TABLE task_mappings ENABLE ROW LEVEL SECURITY;

-- Create policies for task_mappings
CREATE POLICY "Users can view their own task mappings" ON task_mappings
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own task mappings" ON task_mappings
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own task mappings" ON task_mappings
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own task mappings" ON task_mappings
    FOR DELETE USING (auth.uid() = user_id);

-- Subscriptions Table
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) NOT NULL,
    plan TEXT NOT NULL,
    status TEXT NOT NULL,
    stripe_subscription_id TEXT,
    stripe_customer_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security for subscriptions
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Create policies for subscriptions
CREATE POLICY "Users can view their own subscriptions" ON subscriptions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own subscriptions" ON subscriptions
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own subscriptions" ON subscriptions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Sync Logs Table
CREATE TABLE IF NOT EXISTS sync_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) NOT NULL,
    status TEXT NOT NULL,
    details TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security for sync_logs
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

-- Create policies for sync_logs
CREATE POLICY "Users can view their own sync logs" ON sync_logs
    FOR SELECT USING (auth.uid() = user_id);

-- Conflicts Table
CREATE TABLE IF NOT EXISTS conflicts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) NOT NULL,
    task_mapping_id UUID REFERENCES task_mappings(id) NOT NULL,
    zoho_data JSONB NOT NULL,
    todoist_data JSONB NOT NULL,
    resolved BOOLEAN DEFAULT false,
    resolution TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

-- Enable Row Level Security for conflicts
ALTER TABLE conflicts ENABLE ROW LEVEL SECURITY;

-- Create policies for conflicts
CREATE POLICY "Users can view their own conflicts" ON conflicts
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own conflicts" ON conflicts
    FOR UPDATE USING (auth.uid() = user_id);

-- Task History Table
CREATE TABLE IF NOT EXISTS task_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) NOT NULL,
    task_mapping_id UUID REFERENCES task_mappings(id) NOT NULL,
    action TEXT NOT NULL,
    details JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security for task_history
ALTER TABLE task_history ENABLE ROW LEVEL SECURITY;

-- Create policies for task_history
CREATE POLICY "Users can view their own task history" ON task_history
    FOR SELECT USING (auth.uid() = user_id);
