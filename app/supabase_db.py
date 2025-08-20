import os
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Supabase client
supabase_url = os.environ.get("SUPABASE_URL")
supabase_key = os.environ.get("SUPABASE_ANON_KEY")  # Use SUPABASE_ANON_KEY
supabase_service_key = os.environ.get("SUPABASE_SERVICE_KEY")
supabase_jwt_secret = os.environ.get("SUPABASE_JWT_SECRET")

# Create Supabase client with anonymous key (for client-side operations)
supabase: Client = create_client(supabase_url, supabase_key)

# Create Supabase admin client with service key (for server-side operations)
supabase_admin: Client = create_client(supabase_url, supabase_service_key)

def get_supabase_client():
    """
    Returns the Supabase client with anonymous key.
    Use this for client-side operations.
    """
    return supabase

def get_supabase_admin():
    """
    Returns the Supabase client with service key.
    Use this for server-side operations that require admin privileges.
    """
    return supabase_admin

def refresh_postgrest_schema():
    """Refresh PostgREST schema cache by invoking the database function 'reload_pgrst_schema'.
    Note: You must create this function in your database via the Supabase SQL Editor.
    
    SQL to run in the Supabase SQL Editor:
    ---------------------------------------
    CREATE OR REPLACE FUNCTION reload_pgrst_schema()
    RETURNS void AS $$
    BEGIN
      NOTIFY pgrst, 'reload schema';
    END;
    $$ LANGUAGE plpgsql;
    ---------------------------------------
    """
    return supabase_admin.rpc('reload_pgrst_schema', {}).execute()
