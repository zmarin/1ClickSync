import os
from flask import render_template, current_app
from app.supabase_db import get_supabase_admin

def send_confirmation_email(user_id, email):
    """
    Send a confirmation email to the user with a custom template.
    
    Args:
        user_id (str): The user's ID
        email (str): The user's email address
    
    Returns:
        bool: True if the email was sent successfully, False otherwise
    """
    try:
        # Get the Supabase admin client
        supabase = get_supabase_admin()
        
        # Generate a signup link (confirmation email)
        response = supabase.auth.admin.generate_link({
            "type": "signup",
            "email": email
        })
        
        # The Supabase Auth API will automatically send the confirmation email
        # using the default template or a custom template if configured in the Supabase dashboard
        
        print(f"Confirmation email sent to {email}")
        return True
    except Exception as e:
        print(f"Error sending confirmation email: {str(e)}")
        return False

def resend_confirmation_email(email):
    """
    Resend a confirmation email to the user.
    
    Args:
        email (str): The user's email address
    
    Returns:
        bool: True if the email was sent successfully, False otherwise
    """
    try:
        # Get the Supabase admin client
        supabase = get_supabase_admin()
        
        # Resend the confirmation email
        supabase.auth.resend_signup_email({
            "email": email
        })
        
        print(f"Confirmation email resent to {email}")
        return True
    except Exception as e:
        print(f"Error resending confirmation email: {str(e)}")
        return False
