#!/usr/bin/env python3
"""
Set up the 1ClickSync application with Supabase.
This script checks for dependencies, tests the Supabase connection,
fetches existing tables, and provides SQL scripts to create missing tables.
"""

import os
import sys
import json
import importlib.util
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def check_dependencies():
    """
    Check if required dependencies are installed.
    """
    missing_deps = []
    
    # Check for supabase
    if importlib.util.find_spec("supabase") is None:
        missing_deps.append("supabase")
    
    if missing_deps:
        print("Error: The following required dependencies are not installed:")
        for dep in missing_deps:
            print(f"  - {dep}")
        print("\nPlease install them using pip:")
        print(f"pip install {' '.join(missing_deps)}")
        print("\nIf you're using a virtual environment, make sure it's activated before running this script.")
        return False
    
    return True

def check_supabase_config():
    """
    Check if Supabase environment variables are set.
    """
    required_vars = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY"]
    missing_vars = []
    
    for var in required_vars:
        if not os.environ.get(var):
            missing_vars.append(var)
    
    if missing_vars:
        print("Error: The following required environment variables are not set:")
        for var in missing_vars:
            print(f"  - {var}")
        print("\nPlease set them in your .env file.")
        return False
    
    return True

def fetch_existing_tables():
    """
    Fetch existing tables from Supabase.
    """
    try:
        from supabase import create_client
        
        # Initialize Supabase client
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_SERVICE_KEY")  # Use service key for admin operations
        
        # Create Supabase client
        supabase = create_client(supabase_url, supabase_key)
        
        # Predefined tables to check
        predefined_tables = [
            "users", "oauth_tokens", "subscriptions", 
            "task_mappings", "sync_logs", "conflicts", "task_history"
        ]
        
        # Check which tables exist
        existing_tables = []
        missing_tables = []
        table_structures = {}
        
        for table_name in predefined_tables:
            try:
                # Try to get a single row from the table to check if it exists
                response = supabase.table(table_name).select("*").limit(1).execute()
                
                # If we get here, the table exists
                existing_tables.append(table_name)
                
                # Get table structure by examining the response
                if response.data:
                    # Get column names from the first row
                    columns = list(response.data[0].keys())
                    table_structures[table_name] = columns
                    print(f"\nTable: {table_name}")
                    print("Columns:")
                    for column in columns:
                        print(f"  - {column}")
                else:
                    # Table exists but is empty
                    print(f"\nTable: {table_name} (empty)")
                    print("Columns: Unable to determine columns for empty table")
            except Exception as e:
                if "relation" in str(e) and "does not exist" in str(e):
                    print(f"Table {table_name} does not exist")
                    missing_tables.append(table_name)
                else:
                    print(f"Error checking table {table_name}: {str(e)}")
        
        if existing_tables:
            print(f"\nFound tables: {', '.join(existing_tables)}")
            
            # Save table structure to a file
            with open('existing_tables_structure.json', 'w') as f:
                json.dump(table_structures, f, indent=2)
            
            print("\nTable structure saved to existing_tables_structure.json")
        
        if missing_tables:
            print(f"\nMissing tables: {', '.join(missing_tables)}")
            print("\nPlease create the following tables in the Supabase SQL Editor:")
            
            # SQL scripts for missing tables
            sql_scripts = {
                "subscriptions": """
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) NOT NULL,
    plan TEXT NOT NULL,
    status TEXT NOT NULL,
    stripe_subscription_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
                """,
                "sync_logs": """
CREATE TABLE IF NOT EXISTS sync_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) NOT NULL,
    status TEXT NOT NULL,
    details TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
                """,
                "conflicts": """
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
                """,
                "task_history": """
CREATE TABLE IF NOT EXISTS task_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) NOT NULL,
    task_mapping_id UUID REFERENCES task_mappings(id) NOT NULL,
    action TEXT NOT NULL,
    details JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
                """
            }
            
            # Save SQL scripts to a file
            with open('create_missing_tables.sql', 'w') as f:
                for table_name in missing_tables:
                    if table_name in sql_scripts:
                        f.write(f"-- {table_name.capitalize()} Table\n")
                        f.write(sql_scripts[table_name])
                        f.write("\n\n")
                        
                        # Print SQL script
                        print(f"\n-- {table_name.capitalize()} Table")
                        print(sql_scripts[table_name])
            
            print("\nSQL scripts saved to create_missing_tables.sql")
        
        return True
    except Exception as e:
        print(f"Error fetching tables: {str(e)}")
        return False

if __name__ == "__main__":
    print("1ClickSync Supabase Setup")
    print("=========================")
    
    # Check dependencies
    print("\nChecking dependencies...")
    if not check_dependencies():
        sys.exit(1)
    
    # Check Supabase configuration
    print("\nChecking Supabase configuration...")
    if not check_supabase_config():
        sys.exit(1)
    
    # Fetch existing tables
    print("\nFetching existing tables...")
    if not fetch_existing_tables():
        sys.exit(1)
    
    print("\nSetup completed successfully!")
    print("You can now run the application with: python start_supabase_app.py")
