import importlib.util
import sys

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

if __name__ == '__main__':
    # Check if supabase module is installed
    if not check_supabase_installed():
        sys.exit(1)
    
    try:
        from app.create_supabase_tables import create_tables
        
        print("Setting up Supabase tables...")
        create_tables()
        print("Supabase tables created successfully!")
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
