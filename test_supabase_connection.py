from supabase import create_client, Client
import os

url: str = os.getenv('SUPABASE_URL')
key: str = os.getenv('SUPABASE_SERVICE_KEY')
supabase: Client = create_client(url, key)

try:
    response = supabase.table('users').select("*").limit(1).execute()
    print("Successfully connected to Supabase!")
    print(response)
except Exception as e:
    print(f"Failed to connect to Supabase: {e}")
