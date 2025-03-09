import os
import json
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

def fetch_table_structure():
    """
    Fetch the structure of tables in Supabase.
    """
    print("Fetching Supabase table structure...")
    
    # Initialize Supabase client
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_KEY")  # Use service key for admin operations
    
    if not supabase_url or not supabase_key:
        print("Error: Supabase environment variables are not set.")
        return
    
    # Create Supabase client
    supabase = create_client(supabase_url, supabase_key)
    
    # Predefined tables based on our create_supabase_tables.py script
    predefined_tables = [
        "users", "oauth_tokens", "subscriptions", 
        "task_mappings", "sync_logs", "conflicts", "task_history"
    ]
    
    table_structures = {}
    
    # Try to fetch table structure using SQL query
    try:
        # Get list of tables from the public schema
        query = """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        """
        
        response = supabase.rpc('execute_sql', {'query': query}).execute()
        
        if response.data:
            tables = [table['table_name'] for table in response.data]
            print(f"Found tables: {', '.join(tables)}")
            
            for table_name in tables:
                try:
                    # Get table structure
                    columns_query = f"""
                    SELECT column_name, data_type, is_nullable
                    FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = '{table_name}'
                    ORDER BY ordinal_position
                    """
                    
                    columns_response = supabase.rpc('execute_sql', {'query': columns_query}).execute()
                    
                    if columns_response.data:
                        table_structures[table_name] = columns_response.data
                        print(f"\nTable: {table_name}")
                        print("Columns:")
                        for column in columns_response.data:
                            nullable = "NULL" if column['is_nullable'] == "YES" else "NOT NULL"
                            print(f"  - {column['column_name']} ({column['data_type']}) {nullable}")
                except Exception as e:
                    print(f"Error fetching structure for table {table_name}: {str(e)}")
        else:
            print("No tables found or unable to fetch table information.")
    except Exception as e:
        print(f"Error fetching tables: {str(e)}")
    
    # If we couldn't fetch the table structure, use the predefined structure
    if not table_structures:
        print("\nFalling back to predefined table structure:")
        
        predefined_structure = {
            "users": {
                "id": "uuid references auth.users(id) primary key",
                "email": "text unique not null",
                "confirmed": "boolean default false",
                "subscription_plan": "text",
                "zoho_portal_id": "text",
                "sync_settings": "jsonb",
                "created_at": "timestamptz default now()",
                "updated_at": "timestamptz default now()"
            },
            "oauth_tokens": {
                "id": "uuid primary key default uuid_generate_v4()",
                "user_id": "uuid references users(id) not null",
                "service": "text not null",
                "access_token": "text not null",
                "refresh_token": "text not null",
                "expires_in": "integer",
                "created_at": "timestamptz default now()",
                "updated_at": "timestamptz default now()"
            },
            "subscriptions": {
                "id": "uuid primary key default uuid_generate_v4()",
                "user_id": "uuid references users(id) not null",
                "plan": "text not null",
                "status": "text not null",
                "stripe_subscription_id": "text",
                "created_at": "timestamptz default now()",
                "updated_at": "timestamptz default now()"
            },
            "task_mappings": {
                "id": "uuid primary key default uuid_generate_v4()",
                "user_id": "uuid references users(id) not null",
                "zoho_task_id": "text not null",
                "todoist_task_id": "text not null",
                "created_at": "timestamptz default now()",
                "updated_at": "timestamptz default now()"
            },
            "sync_logs": {
                "id": "uuid primary key default uuid_generate_v4()",
                "user_id": "uuid references users(id) not null",
                "status": "text not null",
                "details": "text",
                "created_at": "timestamptz default now()"
            },
            "conflicts": {
                "id": "uuid primary key default uuid_generate_v4()",
                "user_id": "uuid references users(id) not null",
                "task_mapping_id": "uuid references task_mappings(id) not null",
                "zoho_data": "jsonb not null",
                "todoist_data": "jsonb not null",
                "resolved": "boolean default false",
                "resolution": "text",
                "created_at": "timestamptz default now()",
                "resolved_at": "timestamptz"
            },
            "task_history": {
                "id": "uuid primary key default uuid_generate_v4()",
                "user_id": "uuid references users(id) not null",
                "task_mapping_id": "uuid references task_mappings(id) not null",
                "action": "text not null",
                "details": "jsonb not null",
                "created_at": "timestamptz default now()"
            }
        }
        
        for table_name, columns in predefined_structure.items():
            print(f"\nTable: {table_name}")
            print("Columns:")
            for column_name, column_type in columns.items():
                print(f"  - {column_name}: {column_type}")
        
        table_structures = predefined_structure
    
    # Save table structure to a file
    with open('supabase_tables_structure.json', 'w') as f:
        json.dump(table_structures, f, indent=2)
    
    print("\nTable structure saved to supabase_tables_structure.json")

if __name__ == "__main__":
    fetch_table_structure()
