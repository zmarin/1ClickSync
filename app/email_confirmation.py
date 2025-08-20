import os
from flask import render_template, current_app, url_for, request
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
        
        # Set the redirect URL to our confirm_signup route
        redirect_url = request.url_root.rstrip('/') + url_for('auth.confirm_signup')
        
        # Use the invite_user_by_email method to send a confirmation email
        response = supabase.auth.admin.invite_user_by_email(
            email,
            {
                "redirect_to": redirect_url
            }
        )
        
        print(f"Confirmation email sent to {email}")
        return True
    except Exception as e:
        print(f"Error sending confirmation email: {str(e)}")
        print(f"Exception details: {type(e).__name__}: {str(e)}")
        import traceback
        traceback.print_exc()
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
        
        # Set the redirect URL to our confirm_signup route
        redirect_url = request.url_root.rstrip('/') + url_for('auth.confirm_signup')
        
        # Use the sign_in_with_otp method to resend a confirmation email
        response = supabase.auth.sign_in_with_otp({
            "email": email,
            "options": {
                "should_create_user": False,
                "redirect_to": redirect_url
            }
        })

        print(f"Confirmation email resent to {email}")
        return True
    except Exception as e:
        print(f"Error resending confirmation email: {str(e)}")
        print(f"Exception details: {type(e).__name__}: {str(e)}")
        import traceback
        traceback.print_exc()
        return False
