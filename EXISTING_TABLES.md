# Existing Supabase Tables Structure

This document describes the structure of the existing tables in the Supabase database.

## Users Table

The `users` table.

| Column | Description |
|--------|-------------|
| id | Primary key, UUID |
| email | User's email address |
| first_name | User's first name |
| last_name | User's last name |
| company | User's company |
| is_admin | Whether the user is an admin |
| subscription_tier | User's subscription tier |
| sync_enabled | Whether sync is enabled for the user |
| last_sync | Timestamp of the last sync |
| sync_status | Status of the last sync |
| created_at | Timestamp when the user was created |
| updated_at | Timestamp when the user was last updated |

## OAuth Tokens Table

The `oauth_tokens` table exists but is currently empty.

## Task Mappings Table

The `task_mappings` table exists but is currently empty.

## Tables to be Created

The following tables need to be created manually in the Supabase SQL Editor:

### Subscriptions Table

```sql
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) NOT NULL,
    plan TEXT NOT NULL,
    status TEXT NOT NULL,
    stripe_subscription_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Sync Logs Table

```sql
CREATE TABLE IF NOT EXISTS sync_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) NOT NULL,
    status TEXT NOT NULL,
    details TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

### Conflicts Table

```sql
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
```

### Task History Table

```sql
CREATE TABLE IF NOT EXISTS task_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) NOT NULL,
    task_mapping_id UUID REFERENCES task_mappings(id) NOT NULL,
    action TEXT NOT NULL,
    details JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
```
