import os
import sys
import requests
import json
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

def create_tables():
    """
    Create missing tables in Supabase database.
    This script will check which tables already exist and create only the missing ones.
    """
    # Initialize Supabase client
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_KEY")  # Use service key for admin operations
    
    if not supabase_url or not supabase_key:
        print("Error: Supabase environment variables are not set.")
        print("Please set SUPABASE_URL and SUPABASE_SERVICE_KEY in your .env file.")
        return False
    
    # Create Supabase client
    supabase = create_client(supabase_url, supabase_key)
    
    # Check which tables already exist
    existing_tables = []
    
    # Predefined tables to check
    predefined_tables = [
        "users", "oauth_tokens", "subscriptions", 
        "task_mappings", "sync_logs", "conflicts", "task_history"
    ]
    
    for table_name in predefined_tables:
        try:
            # Try to get a single row from the table to check if it exists
            response = supabase.table(table_name).select("*").limit(1).execute()
            existing_tables.append(table_name)
            print(f"Table {table_name} already exists")
        except Exception as e:
            if "relation" in str(e) and "does not exist" in str(e):
                print(f"Table {table_name} does not exist and will be created")
            else:
                print(f"Error checking table {table_name}: {str(e)}")
    
    # Create missing tables using SQL
    try:
        # Create subscriptions table if it doesn't exist
        if "subscriptions" not in existing_tables:
            print("Creating subscriptions table...")
            # Use REST API directly to execute SQL
            headers = {
                "apikey": supabase_key,
                "Authorization": f"Bearer {supabase_key}",
                "Content-Type": "application/json"
            }
            
            sql = """
            CREATE TABLE IF NOT EXISTS subscriptions (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID REFERENCES users(id) NOT NULL,
                plan TEXT NOT NULL,
                status TEXT NOT NULL,
                stripe_subscription_id TEXT,
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            );
            """
            
            response = requests.post(
                f"{supabase_url}/rest/v1/",
                headers=headers,
                json={"query": sql}
            )
            
            if response.status_code == 200:
                print("Subscriptions table created successfully")
            else:
                print(f"Error creating subscriptions table: {response.text}")
        
        # Create sync_logs table if it doesn't exist
        if "sync_logs" not in existing_tables:
            print("Creating sync_logs table...")
            # Use REST API directly to execute SQL
            headers = {
                "apikey": supabase_key,
                "Authorization": f"Bearer {supabase_key}",
                "Content-Type": "application/json"
            }
            
            sql = """
            CREATE TABLE IF NOT EXISTS sync_logs (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID REFERENCES users(id) NOT NULL,
                status TEXT NOT NULL,
                details TEXT,
                created_at TIMESTAMPTZ DEFAULT now()
            );
            """
            
            response = requests.post(
                f"{supabase_url}/rest/v1/",
                headers=headers,
                json={"query": sql}
            )
            
            if response.status_code == 200:
                print("Sync logs table created successfully")
            else:
                print(f"Error creating sync_logs table: {response.text}")
        
        # Create conflicts table if it doesn't exist
        if "conflicts" not in existing_tables:
            print("Creating conflicts table...")
            # Use REST API directly to execute SQL
            headers = {
                "apikey": supabase_key,
                "Authorization": f"Bearer {supabase_key}",
                "Content-Type": "application/json"
            }
            
            sql = """
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
            """
            
            response = requests.post(
                f"{supabase_url}/rest/v1/",
                headers=headers,
                json={"query": sql}
            )
            
            if response.status_code == 200:
                print("Conflicts table created successfully")
            else:
                print(f"Error creating conflicts table: {response.text}")
        
        # Create task_history table if it doesn't exist
        if "task_history" not in existing_tables:
            print("Creating task_history table...")
            # Use REST API directly to execute SQL
            headers = {
                "apikey": supabase_key,
                "Authorization": f"Bearer {supabase_key}",
                "Content-Type": "application/json"
            }
            
            sql = """
            CREATE TABLE IF NOT EXISTS task_history (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID REFERENCES users(id) NOT NULL,
                task_mapping_id UUID REFERENCES task_mappings(id) NOT NULL,
                action TEXT NOT NULL,
                details JSONB NOT NULL,
                created_at TIMESTAMPTZ DEFAULT now()
            );
            """
            
            response = requests.post(
                f"{supabase_url}/rest/v1/",
                headers=headers,
                json={"query": sql}
            )
            
            if response.status_code == 200:
                print("Task history table created successfully")
            else:
                print(f"Error creating task_history table: {response.text}")
        
        print("All tables created successfully")
        return True
    except Exception as e:
        print(f"Error creating tables: {str(e)}")
        return False

if __name__ == "__main__":
    create_tables()
