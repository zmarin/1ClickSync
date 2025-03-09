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

-- Enable Row Level Security
ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own tokens" ON oauth_tokens
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own tokens" ON oauth_tokens
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tokens" ON oauth_tokens
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tokens" ON oauth_tokens
    FOR DELETE USING (auth.uid() = user_id);
