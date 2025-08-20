import os
import jwt
from datetime import datetime
from flask import render_template, flash, redirect, url_for, request, session
from flask_login import current_user, login_user, logout_user, login_required
from app.auth import bp
from app.auth.forms import RegistrationForm, LoginForm, ResetPasswordRequestForm, ResetPasswordForm, ResendConfirmationForm
from app.supabase_models import create_user, get_user_by_email, User, load_user
from app.supabase_db import get_supabase_client, get_supabase_admin
from app.email_confirmation import resend_confirmation_email
from app.jwt_utils import decode_jwt_token_without_verification

@bp.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    
    form = RegistrationForm()
    if form.validate_on_submit():
        try:
            # Create user in Supabase
            user_data = create_user(form.email.data, form.password.data)
            
            if user_data:
                flash('Congratulations, you are now a registered user! Please check your email to confirm your account.', 'success')
                return redirect(url_for('auth.login'))
            else:
                flash('Registration failed. Please try again.', 'error')
        except Exception as e:
            flash(f'Registration error: {str(e)}', 'error')
    
    return render_template('auth/register.html', title='Register', form=form)

@bp.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    
    form = LoginForm()
    if form.validate_on_submit():
        try:
            # Sign in with Supabase
            supabase = get_supabase_client()
            response = supabase.auth.sign_in_with_password({
                "email": form.email.data,
                "password": form.password.data
            })
            
            # Get user data from our users table
            user_data = get_user_by_email(form.email.data)
            
            if user_data:
                user = User(user_data)
                login_user(user, remember=form.remember.data)

                # Store Supabase session in Flask session
                session['supabase_access_token'] = response.session.access_token
                session['supabase_refresh_token'] = response.session.refresh_token

                next_page = request.args.get('next')
                if not next_page or not next_page.startswith('/'):
                    next_page = url_for('dashboard')
                return redirect(next_page)
            else:
                flash('Invalid username or password', 'error')
        except Exception as e:
            flash(f'Login error: {str(e)}', 'error')

    return render_template('auth/login.html', title='Sign In', form=form)

@bp.route('/logout')
def logout():
    # Sign out from Supabase
    if 'supabase_access_token' in session:
        try:
            supabase = get_supabase_client()
            supabase.auth.sign_out()
        except:
            pass
        
        # Clear Supabase session from Flask session
        session.pop('supabase_access_token', None)
        session.pop('supabase_refresh_token', None)
    
    # Log out from Flask-Login
    logout_user()
    
    return redirect(url_for('index'))

@bp.route('/confirm_email/<token>')
def confirm_email(token):
    try:
        # Verify email with Supabase
        supabase = get_supabase_admin()
        
        # Extract user ID from the token using our JWT utility
        try:
            # Decode the JWT token to get the user ID
            decoded = decode_jwt_token_without_verification(token)
            user_id = decoded.get('sub')
            
            if not user_id:
                raise ValueError("User ID not found in token")
                
            # Update user's confirmed status in our users table
            # Use email_confirmed_at instead of confirmed
            supabase.table("users").update({"email_confirmed_at": datetime.utcnow().isoformat()}).eq("id", user_id).execute()
            
            # Return success JSON for the API call
            return {"success": True, "message": "Email confirmed successfully"}
            
        except jwt.InvalidTokenError:
            # If it's not a JWT, try the OTP verification
            response = supabase.auth.verify_otp({
                "token": token,
                "type": "signup"
            })
            
            # Get the user ID from the response
            user_id = response.user.id
            
            # Update user's confirmed status in our users table
            supabase.table("users").update({"email_confirmed_at": datetime.utcnow().isoformat()}).eq("id", user_id).execute()
            
            # Return success JSON for the API call
            return {"success": True, "message": "Email confirmed successfully"}
            
    except Exception as e:
        # Return error JSON for the API call
        return {"success": False, "message": str(e)}, 400

@bp.route('/confirm_signup')
def confirm_signup():
    """
    Handle the redirect from Supabase email confirmation.
    This route captures the access_token, refresh_token, and other parameters from the URL hash.
    """
    # The actual confirmation happens client-side with JavaScript that extracts the token from the URL hash
    return render_template('auth/confirm_signup.html')

@bp.route('/reset_password_request', methods=['GET', 'POST'])
def reset_password_request():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    
    form = ResetPasswordRequestForm()
    if form.validate_on_submit():
        try:
            # Send password reset email with Supabase
            supabase = get_supabase_client()
            
            # Use the SITE_URL from environment variables
            site_url = os.environ.get('SITE_URL', 'http://localhost:5001')
            redirect_url = f"{site_url}/auth/reset_password_hash"
            
            # Use reset_password_for_email instead of reset_password_email
            supabase.auth.reset_password_for_email(
                form.email.data,
                {
                    "redirect_to": redirect_url
                }
            )
            
            flash('Check your email for the instructions to reset your password', 'success')
            return redirect(url_for('auth.login'))
        except Exception as e:
            flash(f'Password reset request error: {str(e)}', 'error')
    
    return render_template('auth/reset_password_request.html', title='Reset Password', form=form)

@bp.route('/reset_password_hash', methods=['GET'])
def reset_password_hash():
    """
    Handle the redirect from Supabase password reset email.
    This route captures the access_token, refresh_token, and other parameters from the URL hash.
    """
    # The actual password reset happens client-side with JavaScript that extracts the token from the URL hash
    return render_template('auth/reset_password_hash.html', title='Reset Password')

@bp.route('/reset_password', methods=['GET', 'POST'])
def reset_password():
    # Check if there's a hash in the URL (from Supabase redirect)
    if '#' in request.url:
        # Use the hash-based template for handling tokens in URL fragment
        return render_template('auth/reset_password_hash.html', title='Reset Password')
    
    # Get token from query parameters or request form
    token = request.args.get('token') or request.form.get('token')
    if not token:
        flash('Invalid or missing reset token. Please try requesting a new password reset link.', 'error')
        return redirect(url_for('auth.reset_password_request'))
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    
    form = ResetPasswordForm()
    if form.validate_on_submit():
        try:
            # Update password with Supabase
            supabase = get_supabase_client()
            supabase.auth.verify_otp({
                "token": token,
                "type": "recovery",
                "new_password": form.password.data
            })
            
            flash('Your password has been reset.', 'success')
            return redirect(url_for('auth.login'))
        except Exception as e:
            flash(f'Password reset error: {str(e)}', 'error')
            return redirect(url_for('index'))
    
    return render_template('auth/reset_password.html', title='Reset Password', form=form)

@bp.route('/reset_password_api', methods=['POST'])
def reset_password_api():
    """API endpoint for resetting password from the hash-based form"""
    try:
        data = request.get_json()
        token = data.get('token')
        password = data.get('password')
        
        if not token or not password:
            return {"success": False, "message": "Missing token or password"}, 400
        
        try:
            # Extract email from token
            decoded = decode_jwt_token_without_verification(token)
            email = decoded.get('email')
            
            if not email:
                return {"success": False, "message": "Email not found in token"}, 400
            
            # Use the client to sign in with the token
            supabase = get_supabase_client()
            
            # First, set the session with the token and a dummy refresh token
            supabase.auth.set_session(token, "dummy_refresh_token")
            
            # Then update the user's password
            response = supabase.auth.update_user({
                "password": password
            })
            
            return {"success": True, "message": "Password reset successfully"}
            
        except jwt.InvalidTokenError as e:
            return {"success": False, "message": f"Invalid token: {str(e)}"}, 400
        except Exception as e:
            return {"success": False, "message": f"Password reset error: {str(e)}"}, 400
            
    except Exception as e:
        return {"success": False, "message": str(e)}, 400

@bp.route('/resend_confirmation', methods=['GET', 'POST'])
def resend_confirmation():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    
    form = ResendConfirmationForm()
    if form.validate_on_submit():
        try:
            # Resend confirmation email
            if resend_confirmation_email(form.email.data):
                flash('Confirmation email has been resent. Please check your inbox.', 'success')
            else:
                flash('Failed to resend confirmation email. Please try again.', 'error')
            return redirect(url_for('auth.login'))
        except Exception as e:
            flash(f'Error: {str(e)}', 'error')
    
    return render_template('auth/resend_confirmation.html', title='Resend Confirmation Email', form=form)
