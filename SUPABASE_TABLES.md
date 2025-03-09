# Supabase Tables Structure

This document describes the structure of the tables in the Supabase database for the 1ClickSync application.

## Users Table

The `users` table stores user information.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key, references auth.users(id) |
| email | text | User's email address, unique, not null |
| confirmed | boolean | Whether the user's email is confirmed |
| subscription_plan | text | User's subscription plan |
| zoho_portal_id | text | ID of the user's Zoho portal |
| sync_settings | jsonb | User's synchronization settings |
| created_at | timestamptz | Timestamp when the user was created |
| updated_at | timestamptz | Timestamp when the user was last updated |

## OAuth Tokens Table

The `oauth_tokens` table stores OAuth tokens for external services.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | References users(id), not null |
| service | text | Name of the service (e.g., 'zoho', 'todoist'), not null |
| access_token | text | OAuth access token, not null |
| refresh_token | text | OAuth refresh token, not null |
| expires_in | integer | Token expiration time in seconds |
| created_at | timestamptz | Timestamp when the token was created |
| updated_at | timestamptz | Timestamp when the token was last updated |

## Subscriptions Table

The `subscriptions` table stores subscription information.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | References users(id), not null |
| plan | text | Subscription plan name, not null |
| status | text | Subscription status (e.g., 'active', 'canceled'), not null |
| stripe_subscription_id | text | Stripe subscription ID |
| created_at | timestamptz | Timestamp when the subscription was created |
| updated_at | timestamptz | Timestamp when the subscription was last updated |

## Task Mappings Table

The `task_mappings` table maps tasks between Zoho and Todoist.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | References users(id), not null |
| zoho_task_id | text | Zoho task ID, not null |
| todoist_task_id | text | Todoist task ID, not null |
| created_at | timestamptz | Timestamp when the mapping was created |
| updated_at | timestamptz | Timestamp when the mapping was last updated |

## Sync Logs Table

The `sync_logs` table stores synchronization logs.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | References users(id), not null |
| status | text | Sync status (e.g., 'success', 'failure'), not null |
| details | text | Additional details about the sync |
| created_at | timestamptz | Timestamp when the log was created |

## Conflicts Table

The `conflicts` table stores synchronization conflicts.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | References users(id), not null |
| task_mapping_id | uuid | References task_mappings(id), not null |
| zoho_data | jsonb | Zoho task data, not null |
| todoist_data | jsonb | Todoist task data, not null |
| resolved | boolean | Whether the conflict is resolved |
| resolution | text | How the conflict was resolved |
| created_at | timestamptz | Timestamp when the conflict was created |
| resolved_at | timestamptz | Timestamp when the conflict was resolved |

## Task History Table

The `task_history` table stores task history.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | References users(id), not null |
| task_mapping_id | uuid | References task_mappings(id), not null |
| action | text | Action performed (e.g., 'created', 'updated', 'deleted'), not null |
| details | jsonb | Additional details about the action, not null |
| created_at | timestamptz | Timestamp when the history entry was created |
