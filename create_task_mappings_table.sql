-- Task Mappings Table
CREATE TABLE IF NOT EXISTS task_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) NOT NULL,
    zoho_task_id TEXT NOT NULL,
    todoist_task_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE task_mappings ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own task mappings" ON task_mappings
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own task mappings" ON task_mappings
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own task mappings" ON task_mappings
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own task mappings" ON task_mappings
    FOR DELETE USING (auth.uid() = user_id);
