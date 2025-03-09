#!/usr/bin/env python3
"""
Start the 1ClickSync application with Supabase.
This script checks for dependencies, tests the Supabase connection,
and starts the Flask application.
"""

import os
import sys
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
    
    # Check for email_validator
    if importlib.util.find_spec("email_validator") is None:
        missing_deps.append("email_validator")
    
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

def test_supabase_connection():
    """
    Test the connection to Supabase.
    """
    try:
        from supabase import create_client
        
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_ANON_KEY")
        
        # Create Supabase client
        supabase = create_client(supabase_url, supabase_key)
        
        # Test connection
        response = supabase.auth.get_user()
        print("Supabase connection successful!")
        return True
    except Exception as e:
        print(f"Error connecting to Supabase: {str(e)}")
        return False

def start_app():
    """
    Start the Flask application.
    """
    try:
        from app.supabase_app import app
        
        print("Starting 1ClickSync with Supabase...")
        app.run(debug=True, host='127.0.0.1', port=5001)
    except Exception as e:
        print(f"Error starting application: {str(e)}")
        return False
    
    return True

if __name__ == "__main__":
    print("1ClickSync with Supabase")
    print("========================")
    
    # Check dependencies
    print("\nChecking dependencies...")
    if not check_dependencies():
        sys.exit(1)
    
    # Check Supabase configuration
    print("\nChecking Supabase configuration...")
    if not check_supabase_config():
        sys.exit(1)
    
    # Test Supabase connection
    print("\nTesting Supabase connection...")
    if not test_supabase_connection():
        sys.exit(1)
    
    # Start the application
    print("\nStarting application...")
    if not start_app():
        sys.exit(1)
