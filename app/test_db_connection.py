import os
from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError

# Load the DATABASE_URL from the .env file
from dotenv import load_dotenv
load_dotenv()

DATABASE_URL = os.getenv('DATABASE_URL')

try:
    # Create an engine
    engine = create_engine(DATABASE_URL)
    
    # Try to connect
    with engine.connect() as connection:
        result = connection.execute("SELECT 1")
        print("Connection successful!")
        print(result.fetchone())
except SQLAlchemyError as e:
    print(f"An error occurred: {e}")
