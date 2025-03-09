import os
import json
import sys
import requests
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

def fetch_existing_tables():
    """
    Fetch existing tables from Supabase.
    """
    print("Fetching existing tables from Supabase...")
    
    # Initialize Supabase client
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_KEY")  # Use service key for admin operations
    
    if not supabase_url or not supabase_key:
        print("Error: Supabase environment variables are not set.")
        print("Please set SUPABASE_URL and SUPABASE_SERVICE_KEY in your .env file.")
        return
    
    # Create Supabase client
    supabase = create_client(supabase_url, supabase_key)
    
    # Predefined tables to check
    predefined_tables = [
        "users", "oauth_tokens", "subscriptions", 
        "task_mappings", "sync_logs", "conflicts", "task_history"
    ]
    
    # Fetch tables from Supabase
    try:
        # Try to get tables directly
        table_structures = {}
        existing_tables = []
        
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
                    # Table exists but is empty, try to get columns from metadata
                    print(f"\nTable: {table_name} (empty)")
                    print("Columns: Unable to determine columns for empty table")
            except Exception as e:
                if "relation" in str(e) and "does not exist" in str(e):
                    print(f"Table {table_name} does not exist")
                else:
                    print(f"Error checking table {table_name}: {str(e)}")
        
        if existing_tables:
            print(f"\nFound tables: {', '.join(existing_tables)}")
            
            # Save table structure to a file
            with open('existing_tables_structure.json', 'w') as f:
                json.dump(table_structures, f, indent=2)
            
            print("\nTable structure saved to existing_tables_structure.json")
            
            # Generate Markdown documentation
            with open('EXISTING_TABLES.md', 'w') as f:
                f.write("# Existing Supabase Tables Structure\n\n")
                f.write("This document describes the structure of the existing tables in the Supabase database.\n\n")
                
                for table_name, columns in table_structures.items():
                    f.write(f"## {table_name.capitalize()} Table\n\n")
                    f.write(f"The `{table_name}` table.\n\n")
                    f.write("| Column | Description |\n")
                    f.write("|--------|-------------|\n")
                    
                    for column in columns:
                        f.write(f"| {column} | |\n")
                    
                    f.write("\n")
            
            print("Table documentation saved to EXISTING_TABLES.md")
            
            return table_structures
        else:
            print("No tables found in the public schema.")
            
            # Create a file with the predefined table structure
            with open('EXISTING_TABLES.md', 'w') as f:
                f.write("# Existing Supabase Tables Structure\n\n")
                f.write("No existing tables found in the Supabase database.\n\n")
                f.write("## Expected Tables\n\n")
                f.write("The following tables are expected to be created:\n\n")
                
                for table_name in predefined_tables:
                    f.write(f"- `{table_name}`\n")
            
            print("Table documentation saved to EXISTING_TABLES.md")
            
            return {}
    except Exception as e:
        print(f"Error fetching tables: {str(e)}")
        
        # Create a file with the predefined table structure
        with open('EXISTING_TABLES.md', 'w') as f:
            f.write("# Existing Supabase Tables Structure\n\n")
            f.write(f"Error fetching tables: {str(e)}\n\n")
            f.write("## Expected Tables\n\n")
            f.write("The following tables are expected to be created:\n\n")
            
            for table_name in predefined_tables:
                f.write(f"- `{table_name}`\n")
        
        print("Table documentation saved to EXISTING_TABLES.md")
        
        return {}

if __name__ == "__main__":
    fetch_existing_tables()
