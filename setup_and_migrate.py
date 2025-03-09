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

def setup_and_migrate():
    """
    Set up Supabase tables and migrate data from SQLAlchemy.
    """
    print("Starting setup and migration process...")
    
    # Check if supabase module is installed
    if not check_supabase_installed():
        sys.exit(1)
    
    # Check if Supabase environment variables are set
    if not os.environ.get('SUPABASE_URL') or not os.environ.get('SUPABASE_ANON_KEY') or not os.environ.get('SUPABASE_SERVICE_KEY'):
        print("Error: Supabase environment variables are not set. Please set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_KEY in your .env file.")
        sys.exit(1)
    
    # Test Supabase connection
    print("\n1. Testing Supabase connection...")
    try:
        from test_supabase_connection import test_connection
        test_connection()
    except ImportError as e:
        if "No module named 'supabase'" in str(e):
            print("Error: The 'supabase' module is not installed.")
            print("\nPlease install it using pip:")
            print("pip install supabase")
            print("\nIf you're using a virtual environment, make sure it's activated before running this script.")
            sys.exit(1)
        else:
            print(f"Error importing test_connection: {str(e)}")
            sys.exit(1)
    except Exception as e:
        print(f"Error testing Supabase connection: {str(e)}")
        sys.exit(1)
    
    # Create Supabase tables
    print("\n2. Creating Supabase tables...")
    try:
        from app.create_supabase_tables import create_tables
        create_tables()
    except ImportError as e:
        if "No module named 'supabase'" in str(e):
            print("Error: The 'supabase' module is not installed.")
            print("\nPlease install it using pip:")
            print("pip install supabase")
            print("\nIf you're using a virtual environment, make sure it's activated before running this script.")
            sys.exit(1)
        else:
            print(f"Error importing create_tables: {str(e)}")
            sys.exit(1)
    except Exception as e:
        print(f"Error creating Supabase tables: {str(e)}")
        sys.exit(1)
    
    # Migrate data from SQLAlchemy to Supabase
    print("\n3. Migrating data from SQLAlchemy to Supabase...")
    try:
        from migrate_to_supabase import migrate_data
        migrate_data()
    except ImportError as e:
        if "No module named 'supabase'" in str(e):
            print("Error: The 'supabase' module is not installed.")
            print("\nPlease install it using pip:")
            print("pip install supabase")
            print("\nIf you're using a virtual environment, make sure it's activated before running this script.")
            sys.exit(1)
        else:
            print(f"Error importing migrate_data: {str(e)}")
            sys.exit(1)
    except Exception as e:
        print(f"Error migrating data: {str(e)}")
        sys.exit(1)
    
    print("\nSetup and migration completed successfully!")
    print("You can now run the application with: python run_supabase_app.py")

if __name__ == "__main__":
    setup_and_migrate()
