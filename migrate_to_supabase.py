import os
import json
from dotenv import load_dotenv
from flask import Flask
from app.models import User, OAuthToken, Subscription
from app.database import db
from app.supabase_db import get_supabase_admin
from app.supabase_models import create_user, create_oauth_token, create_subscription
from werkzeug.security import generate_password_hash

# Load environment variables
load_dotenv()

def create_app():
    """
    Create a Flask app with SQLAlchemy configuration.
    """
    app = Flask(__name__)
    app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL')
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db.init_app(app)
    return app

def migrate_users(app):
    """
    Migrate users from SQLAlchemy to Supabase.
    """
    print("Migrating users...")
    supabase = get_supabase_admin()
    
    with app.app_context():
        users = User.query.all()
        for user in users:
            try:
                # Create user in Supabase Auth
                auth_response = supabase.auth.admin.create_user({
                    "email": user.email,
                    "password": "temporary_password",  # We'll update this later
                    "email_confirm": user.confirmed
                })
                
                user_id = auth_response.user.id
                
                # Create user in our users table
                user_data = {
                    "id": user_id,
                    "email": user.email,
                    "confirmed": user.confirmed,
                    "subscription_plan": user.subscription_plan,
                    "zoho_portal_id": user.zoho_portal_id,
                    "sync_settings": user.sync_settings,
                    "created_at": user.created_at.isoformat() if user.created_at else None,
                    "updated_at": user.updated_at.isoformat() if user.updated_at else None
                }
                
                supabase.table("users").insert(user_data).execute()
                
                print(f"Migrated user: {user.email}")
            except Exception as e:
                print(f"Error migrating user {user.email}: {str(e)}")

def migrate_oauth_tokens(app):
    """
    Migrate OAuth tokens from SQLAlchemy to Supabase.
    """
    print("Migrating OAuth tokens...")
    supabase = get_supabase_admin()
    
    with app.app_context():
        tokens = OAuthToken.query.all()
        for token in tokens:
            try:
                # Get the user's Supabase ID
                user_response = supabase.table("users").select("id").eq("email", token.user.email).execute()
                if not user_response.data:
                    print(f"User not found for token: {token.id}")
                    continue
                
                user_id = user_response.data[0]["id"]
                
                # Create token in Supabase
                token_data = {
                    "user_id": user_id,
                    "service": token.service,
                    "access_token": token.access_token,
                    "refresh_token": token.refresh_token,
                    "expires_in": token.expires_in,
                    "created_at": token.created_at.isoformat() if token.created_at else None,
                    "updated_at": token.updated_at.isoformat() if token.updated_at else None
                }
                
                supabase.table("oauth_tokens").insert(token_data).execute()
                
                print(f"Migrated OAuth token for user: {token.user.email}, service: {token.service}")
            except Exception as e:
                print(f"Error migrating OAuth token {token.id}: {str(e)}")

def migrate_subscriptions(app):
    """
    Migrate subscriptions from SQLAlchemy to Supabase.
    """
    print("Migrating subscriptions...")
    supabase = get_supabase_admin()
    
    with app.app_context():
        subscriptions = Subscription.query.all()
        for subscription in subscriptions:
            try:
                # Get the user's Supabase ID
                user_response = supabase.table("users").select("id").eq("email", subscription.user.email).execute()
                if not user_response.data:
                    print(f"User not found for subscription: {subscription.id}")
                    continue
                
                user_id = user_response.data[0]["id"]
                
                # Create subscription in Supabase
                subscription_data = {
                    "user_id": user_id,
                    "plan": subscription.plan,
                    "status": subscription.status,
                    "stripe_subscription_id": subscription.stripe_subscription_id,
                    "created_at": subscription.created_at.isoformat() if subscription.created_at else None,
                    "updated_at": subscription.updated_at.isoformat() if subscription.updated_at else None
                }
                
                supabase.table("subscriptions").insert(subscription_data).execute()
                
                print(f"Migrated subscription for user: {subscription.user.email}")
            except Exception as e:
                print(f"Error migrating subscription {subscription.id}: {str(e)}")

def migrate_data():
    """
    Migrate all data from SQLAlchemy to Supabase.
    """
    app = create_app()
    
    # Migrate data
    migrate_users(app)
    migrate_oauth_tokens(app)
    migrate_subscriptions(app)
    
    print("Migration completed!")

if __name__ == "__main__":
    migrate_data()
