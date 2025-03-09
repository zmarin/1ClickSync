from flask import render_template, flash, redirect, url_for, request, session
from flask_login import current_user, login_user, logout_user, login_required
from app.auth import bp
from app.auth.forms import RegistrationForm, LoginForm, ResetPasswordRequestForm, ResetPasswordForm
from app.supabase_models import create_user, get_user_by_email, User, load_user
from app.supabase_db import get_supabase_client, get_supabase_admin
from app.email_confirmation import resend_confirmation_email

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
                flash('Congratulations, you are now a registered user! Please check your email to confirm your account.')
                return redirect(url_for('auth.login'))
            else:
                flash('Registration failed. Please try again.')
        except Exception as e:
            flash(f'Registration error: {str(e)}')
    
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
                
                # Check if the user is an admin or if the user is zmarin@zmcor.com
                if user.email == "zmarin@zmcor.com":
                    login_user(user, remember=form.remember.data)
                    
                    # Store Supabase session in Flask session
                    session['supabase_access_token'] = response.session.access_token
                    session['supabase_refresh_token'] = response.session.refresh_token
                    
                    next_page = request.args.get('next')
                    if not next_page or not next_page.startswith('/'):
                        next_page = url_for('dashboard')
                    return redirect(next_page)
                elif user.is_admin:
                    login_user(user, remember=form.remember.data)
                    
                    # Store Supabase session in Flask session
                    session['supabase_access_token'] = response.session.access_token
                    session['supabase_refresh_token'] = response.session.refresh_token
                    
                    next_page = request.args.get('next')
                    if not next_page or not next_page.startswith('/'):
                        next_page = url_for('dashboard')
                    return redirect(next_page)
                else:
                    flash('You do not have permission to access this page.')
            else:
                flash('Invalid username or password')
        except Exception as e:
            flash(f'Login error: {str(e)}')
    
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
        
        # Verify the token and confirm the user's email
        response = supabase.auth.verify_otp({
            "token": token,
            "type": "signup"
        })
        
        # Get the user ID from the response
        user_id = response.user.id
        
        # Update user's confirmed status in our users table
        supabase.table("users").update({"confirmed": True}).eq("id", user_id).execute()
        
        # Also update the email_confirmed status in Supabase Auth
        supabase.auth.admin.update_user_by_id(user_id, {
            "email_confirmed": True
        })
        
        flash('Your email has been confirmed. You can now log in.')
        return redirect(url_for('auth.login'))
    except Exception as e:
        flash(f'Email confirmation error: {str(e)}')
        return redirect(url_for('index'))

@bp.route('/reset_password_request', methods=['GET', 'POST'])
def reset_password_request():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    
    form = ResetPasswordRequestForm()
    if form.validate_on_submit():
        try:
            # Send password reset email with Supabase
            supabase = get_supabase_client()
            supabase.auth.reset_password_email(form.email.data)
            
            flash('Check your email for the instructions to reset your password')
            return redirect(url_for('auth.login'))
        except Exception as e:
            flash(f'Password reset request error: {str(e)}')
    
    return render_template('auth/reset_password_request.html', title='Reset Password', form=form)

@bp.route('/reset_password/<token>', methods=['GET', 'POST'])
def reset_password(token):
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
            
            flash('Your password has been reset.')
            return redirect(url_for('auth.login'))
        except Exception as e:
            flash(f'Password reset error: {str(e)}')
            return redirect(url_for('index'))
    
    return render_template('auth/reset_password.html', title='Reset Password', form=form)

@bp.route('/resend_confirmation', methods=['GET', 'POST'])
def resend_confirmation():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    
    if request.method == 'POST':
        email = request.form.get('email')
        if email:
            try:
                # Resend confirmation email
                if resend_confirmation_email(email):
                    flash('Confirmation email has been resent. Please check your inbox.')
                else:
                    flash('Failed to resend confirmation email. Please try again.')
            except Exception as e:
                flash(f'Error: {str(e)}')
        else:
            flash('Please provide an email address.')
        
        return redirect(url_for('auth.login'))
    
    return render_template('auth/resend_confirmation.html', title='Resend Confirmation Email')
