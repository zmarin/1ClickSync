import os
import sys
import importlib.util
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def check_supabase_installed():
    """
    Check if the supabase module is installed.
    """
    if importlib.util.find_spec("supabase") is None:
        print("Error: The 'supabase' module is not installed.")
        print("\nPlease install it using pip:")
        print("pip install supabase")
        print("\nIf you're using a virtual environment, make sure it's activated before running this script.")
        print("\nSee SUPABASE_README.md for more detailed setup instructions.")
        return False
    return True

def test_connection():
    """
    Test the connection to Supabase.
    """
    # Check if supabase module is installed
    if not check_supabase_installed():
        return False
    
    print("Testing Supabase connection...")
    
    try:
        # Import Supabase client
        from supabase import create_client, Client
        
        # Initialize Supabase client
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_ANON_KEY")
        supabase_service_key = os.environ.get("SUPABASE_SERVICE_KEY")
        
        if not supabase_url or not supabase_key or not supabase_service_key:
            print("Error: Supabase environment variables are not set.")
            print("Please set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_KEY in your .env file.")
            return False
        
        # Test anonymous client connection
        try:
            supabase = create_client(supabase_url, supabase_key)
            response = supabase.auth.get_user()
            print("Anonymous client connection successful!")
        except Exception as e:
            print(f"Anonymous client connection failed: {str(e)}")
        
        # Test admin client connection
        try:
            supabase_admin = create_client(supabase_url, supabase_service_key)
            response = supabase_admin.table("users").select("count", count="exact").execute()
            print(f"Admin client connection successful! Found {response.count} users.")
        except Exception as e:
            print(f"Admin client connection failed: {str(e)}")
        
        print("Supabase connection test completed.")
        return True
    
    except ImportError as e:
        if "No module named 'supabase'" in str(e):
            print("Error: The 'supabase' module is not installed.")
            print("\nPlease install it using pip:")
            print("pip install supabase")
            print("\nIf you're using a virtual environment, make sure it's activated before running this script.")
            return False
        else:
            print(f"Error: {str(e)}")
            return False
    except Exception as e:
        print(f"Error testing Supabase connection: {str(e)}")
        return False

if __name__ == "__main__":
    test_connection()
