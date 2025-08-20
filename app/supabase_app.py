import os
from flask import Flask
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

def create_app():
    app = Flask(__name__, template_folder='../templates', static_folder='../static')
    
    # Configure Flask app
    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY')
    
    # Initialize Supabase (no need to initialize here as it's done in supabase_db.py)
    
    # Import and register routes
    from app.supabase_init_complete import create_app as init_app
    init_app(app)
    
    return app

app = create_app()

if __name__ == '__main__':
    app.run(debug=True)
