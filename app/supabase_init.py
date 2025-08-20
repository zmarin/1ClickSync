import logging
import os
from flask import Flask, render_template, request, jsonify, redirect, url_for, flash, session
from flask_login import LoginManager, login_required, current_user
from config import Config
from celery_app import make_celery

login = LoginManager()
login.login_view = 'auth.login'

def create_app(app=None, config_class=Config):
    if app is None:
        app = Flask(__name__)
        app.config.from_object(config_class)

    # Initialize Flask-Login
    login.init_app(app)

    # Main routes
    @app.route('/')
    def index():
        return render_template('main/home.html')

    @app.route('/dashboard')
    @login_required
    def dashboard():
        # Get task mappings for the current user
        # from app.supabase_models import get_task_mappings
        page = request.args.get('page', 1, type=int)
        search_query = request.args.get('search', '')
        status_filter = request.args.get('status', '')
        
        # Create a pagination object (mock for now)
        class Pagination:
            def __init__(self, items, page, per_page, total):
                self.items = items
                self.page = page
                self.per_page = per_page
                self.total = total
                self.prev_num = page - 1 if page > 1 else None
                self.next_num = page + 1 if page * per_page < total else None
                self.has_prev = self.prev_num is not None
                self.has_next = self.next_num is not None
        
        # Mock task mappings for now
        task_mappings = Pagination([], page, 10, 0)
        
        # Create a mock form for settings tab
        class MockForm:
            def __init__(self):
                self.name = MockField("Name", value=current_user.name)
                self.email = MockField("Email", value=current_user.email)
                self.sync_frequency = MockField("Sync Frequency", value="60")
                self.sync_direction = MockField("Sync Direction", value="bidirectional")
                self.sync_schedule = MockField("Sync Schedule", value="")
                self.password = MockField("New Password", value="")
                self.confirm_password = MockField("Confirm Password", value="")
                self.submit = MockField("Save Changes", value="")
            
            def hidden_tag(self):
                return ""
        
        class MockField:
            def __init__(self, label_text, value=""):
                self.label_text = label_text
                self.data = value
            
            def label(self, **kwargs):
                return f'<label for="{self.label_text.lower().replace(" ", "_")}">{self.label_text}</label>'
            
            def __call__(self, **kwargs):
                field_type = "password" if "password" in self.label_text.lower() else "text"
                return f'<input type="{field_type}" name="{self.label_text.lower().replace(" ", "_")}" value="{self.data}" id="{self.label_text.lower().replace(" ", "_")}">'
        
        form = MockForm()
        
        # Add properties to current_user for template
        # Check if user has Zoho connection
        current_user.zoho_connected = hasattr(current_user, 'zoho_portal_id') and current_user.zoho_portal_id is not None
        
        # Check if user has Todoist connection
        from app.supabase_models import get_oauth_token
        todoist_token = get_oauth_token(current_user.id, 'todoist')
        current_user.todoist_connected = todoist_token is not None
        
        # Set default subscription tier if not present
        if not hasattr(current_user, 'subscription_tier') or current_user.subscription_tier is None:
            current_user.subscription_tier = "free"
        
        return render_template('user/dashboard.html', 
                              task_mappings=task_mappings,
                              search_query=search_query,
                              status_filter=status_filter,
                              form=form)

    @app.route('/pricing')
    def pricing():
        return render_template('main/pricing.html')

    # Auth blueprint is already registered in app/supabase_app.py
    # No need to register it again here

    # OAuth routes
    @app.route('/auth/zoho')
    @login_required
    def zoho_auth():
        try:
            import secrets
            from requests_oauthlib import OAuth2Session
            
            # Zoho OAuth configuration
            zoho_client_id = app.config.get('ZOHO_CLIENT_ID') or os.environ.get('ZOHO_CLIENT_ID')
            zoho_redirect_uri = app.config.get('ZOHO_REDIRECT_URI') or os.environ.get('ZOHO_REDIRECT_URI')
            zoho_auth_url = 'https://accounts.zoho.com/oauth/v2/auth'
            zoho_scopes = ['ZohoProjects.projects.ALL', 'ZohoProjects.tasks.ALL']
            
            # Check if we have the required configuration
            if not zoho_client_id or not zoho_redirect_uri:
                app.logger.error("Missing Zoho OAuth configuration")
                flash('Zoho OAuth configuration is missing. Please contact support.')
                return redirect(url_for('dashboard'))
            
            # Initialize OAuth session
            oauth = OAuth2Session(
                client_id=zoho_client_id,
                redirect_uri=zoho_redirect_uri,
                scope=zoho_scopes
            )
            
            # Generate and store state parameter for security
            state = secrets.token_urlsafe(16)
            session['oauth_state'] = state
            
            # Get authorization URL
            authorization_url, _ = oauth.authorization_url(
                zoho_auth_url,
                state=state
            )
            
            # Redirect to Zoho for authorization
            return redirect(authorization_url)
        except Exception as e:
            app.logger.error(f"Zoho auth error: {str(e)}")
            flash(f'An error occurred during Zoho authentication: {str(e)}')
            return redirect(url_for('dashboard'))

    @app.route('/auth/zoho/callback')
    @login_required
    def zoho_callback():
        try:
            import secrets
            from requests_oauthlib import OAuth2Session
            
            # Zoho OAuth configuration
            zoho_client_id = app.config.get('ZOHO_CLIENT_ID') or os.environ.get('ZOHO_CLIENT_ID')
            zoho_client_secret = app.config.get('ZOHO_CLIENT_SECRET') or os.environ.get('ZOHO_CLIENT_SECRET')
            zoho_redirect_uri = app.config.get('ZOHO_REDIRECT_URI') or os.environ.get('ZOHO_REDIRECT_URI')
            zoho_token_url = 'https://accounts.zoho.com/oauth/v2/token'
            
            # Check if we have the required configuration
            if not zoho_client_id or not zoho_client_secret or not zoho_redirect_uri:
                app.logger.error("Missing Zoho OAuth configuration")
                flash('Zoho OAuth configuration is missing. Please contact support.')
                return redirect(url_for('dashboard'))
            
            # Verify state parameter to prevent CSRF
            stored_state = session.pop('oauth_state', None)
            request_state = request.args.get('state')
            
            if not stored_state or not request_state or stored_state != request_state:
                app.logger.error("Invalid OAuth state parameter")
                flash('Invalid state parameter. Authentication failed.')
                return redirect(url_for('dashboard'))
            
            # Check for error in the callback
            if 'error' in request.args:
                error = request.args.get('error')
                error_description = request.args.get('error_description', 'No description provided')
                app.logger.error(f"Zoho OAuth error: {error} - {error_description}")
                flash(f'Zoho authentication failed: {error_description}')
                return redirect(url_for('dashboard'))
            
            # Check for authorization code
            if 'code' not in request.args:
                app.logger.error("No authorization code in callback")
                flash('No authorization code received from Zoho.')
                return redirect(url_for('dashboard'))
            
            # Initialize OAuth session
            oauth = OAuth2Session(
                client_id=zoho_client_id,
                redirect_uri=zoho_redirect_uri
            )
            
            # Exchange authorization code for tokens
            token = oauth.fetch_token(
                zoho_token_url,
                code=request.args.get('code'),
                client_secret=zoho_client_secret
            )
            
            # Extract tokens
            access_token = token.get('access_token')
            refresh_token = token.get('refresh_token')
            expires_in = token.get('expires_in', 3600)
            
            if not access_token or not refresh_token:
                app.logger.error("Missing tokens in Zoho response")
                flash('Failed to obtain access tokens from Zoho.')
                return redirect(url_for('dashboard'))
            
            # Store tokens securely
            from app.supabase_models import create_oauth_token, get_oauth_token, update_oauth_token
            
            # Check if token already exists
            existing_token = get_oauth_token(current_user.id, 'zoho')
            
            if existing_token:
                # Update existing token
                update_oauth_token(existing_token['id'], access_token, refresh_token, expires_in)
            else:
                # Create new token
                create_oauth_token(current_user.id, 'zoho', access_token, refresh_token, expires_in)
            
            # Update user's connection status
            from app.supabase_models import update_user
            update_user(current_user.id, {"zoho_connected": True})
            
            flash('Successfully connected to Zoho Projects!')
            return redirect(url_for('dashboard'))
        except Exception as e:
            app.logger.error(f"Zoho callback error: {str(e)}")
            flash(f'An error occurred during Zoho authentication: {str(e)}')
            return redirect(url_for('dashboard'))

    @app.route('/auth/todoist')
    @login_required
    def todoist_auth():
        try:
            import secrets
            from requests_oauthlib import OAuth2Session
            
            # Todoist OAuth configuration
            todoist_client_id = app.config.get('TODOIST_CLIENT_ID') or os.environ.get('TODOIST_CLIENT_ID')
            todoist_redirect_uri = app.config.get('TODOIST_REDIRECT_URI') or os.environ.get('TODOIST_REDIRECT_URI')
            todoist_auth_url = 'https://todoist.com/oauth/authorize'
            todoist_scopes = ['task:add', 'task:read', 'task:delete', 'data:read', 'data:read_write']
            
            # Check if we have the required configuration
            if not todoist_client_id or not todoist_redirect_uri:
                app.logger.error("Missing Todoist OAuth configuration")
                flash('Todoist OAuth configuration is missing. Please contact support.')
                return redirect(url_for('dashboard'))
            
            # Initialize OAuth session
            oauth = OAuth2Session(
                client_id=todoist_client_id,
                redirect_uri=todoist_redirect_uri,
                scope=todoist_scopes
            )
            
            # Generate and store state parameter for security
            state = secrets.token_urlsafe(16)
            session['oauth_state'] = state
            
            # Get authorization URL
            authorization_url, _ = oauth.authorization_url(
                todoist_auth_url,
                state=state
            )
            
            # Redirect to Todoist for authorization
            return redirect(authorization_url)
        except Exception as e:
            app.logger.error(f"Todoist auth error: {str(e)}")
            flash(f'An error occurred during Todoist authentication: {str(e)}')
            return redirect(url_for('dashboard'))

    @app.route('/auth/todoist/callback')
    @login_required
    def todoist_callback():
        try:
            import secrets
            from requests_oauthlib import OAuth2Session
            
            # Todoist OAuth configuration
            todoist_client_id = app.config.get('TODOIST_CLIENT_ID') or os.environ.get('TODOIST_CLIENT_ID')
            todoist_client_secret = app.config.get('TODOIST_CLIENT_SECRET') or os.environ.get('TODOIST_CLIENT_SECRET')
            todoist_redirect_uri = app.config.get('TODOIST_REDIRECT_URI') or os.environ.get('TODOIST_REDIRECT_URI')
            todoist_token_url = 'https://todoist.com/oauth/access_token'
            
            # Check if we have the required configuration
            if not todoist_client_id or not todoist_client_secret or not todoist_redirect_uri:
                app.logger.error("Missing Todoist OAuth configuration")
                flash('Todoist OAuth configuration is missing. Please contact support.')
                return redirect(url_for('dashboard'))
            
            # Verify state parameter to prevent CSRF
            stored_state = session.pop('oauth_state', None)
            request_state = request.args.get('state')
            
            if not stored_state or not request_state or stored_state != request_state:
                app.logger.error("Invalid OAuth state parameter")
                flash('Invalid state parameter. Authentication failed.')
                return redirect(url_for('dashboard'))
            
            # Check for error in the callback
            if 'error' in request.args:
                error = request.args.get('error')
                error_description = request.args.get('error_description', 'No description provided')
                app.logger.error(f"Todoist OAuth error: {error} - {error_description}")
                flash(f'Todoist authentication failed: {error_description}')
                return redirect(url_for('dashboard'))
            
            # Check for authorization code
            if 'code' not in request.args:
                app.logger.error("No authorization code in callback")
                flash('No authorization code received from Todoist.')
                return redirect(url_for('dashboard'))
            
            # Todoist uses a different approach for token exchange
            import requests
            
            # Exchange authorization code for tokens
            token_response = requests.post(
                todoist_token_url,
                data={
                    'client_id': todoist_client_id,
                    'client_secret': todoist_client_secret,
                    'code': request.args.get('code'),
                    'redirect_uri': todoist_redirect_uri
                }
            )
            
            if token_response.status_code != 200:
                app.logger.error(f"Todoist token exchange failed: {token_response.text}")
                flash('Failed to obtain access token from Todoist.')
                return redirect(url_for('dashboard'))
            
            token_data = token_response.json()
            
            # Extract tokens
            access_token = token_data.get('access_token')
            
            if not access_token:
                app.logger.error("Missing access token in Todoist response")
                flash('Failed to obtain access token from Todoist.')
                return redirect(url_for('dashboard'))
            
            # Store token securely
            from app.supabase_models import create_oauth_token, get_oauth_token, update_oauth_token
            
            # Check if token already exists
            existing_token = get_oauth_token(current_user.id, 'todoist')
            
            # Todoist doesn't provide refresh tokens or expiration
            # We'll set a default expiration of 1 year (31536000 seconds)
            expires_in = 31536000
            refresh_token = ""
            
            if existing_token:
                # Update existing token
                update_oauth_token(existing_token['id'], access_token, refresh_token, expires_in)
            else:
                # Create new token
                create_oauth_token(current_user.id, 'todoist', access_token, refresh_token, expires_in)
            
            # Update user's connection status
            from app.supabase_models import update_user
            update_user(current_user.id, {"todoist_connected": True})
            
            flash('Successfully connected to Todoist!')
            return redirect(url_for('dashboard'))
        except Exception as e:
            app.logger.error(f"Todoist callback error: {str(e)}")
            flash(f'An error occurred during Todoist authentication: {str(e)}')
            return redirect(url_for('dashboard'))

    # Zoho portal selection
    @app.route('/select_zoho_portal', methods=['GET', 'POST'])
    @login_required
    def select_zoho_portal():
        if request.method == 'POST':
            portal_id = request.form.get('portal_id')
            # Update user's Zoho portal ID using Supabase
            from app.supabase_models import update_user
            update_user(current_user.id, {"zoho_portal_id": portal_id})
            flash('Zoho portal selected successfully!')
            return redirect(url_for('dashboard'))
        
        # Mock portals for now
        portals = [
            {"id": "portal1", "name": "Portal 1"},
            {"id": "portal2", "name": "Portal 2"},
            {"id": "portal3", "name": "Portal 3"}
        ]
        
        # Check if select_zoho_portal.html exists, if not use a simple template
        try:
            return render_template('select_zoho_portal.html', portals=portals)
        except:
            # Create a simple HTML response
            html = """
            <!DOCTYPE html>
            <html>
            <head>
                <title>Select Zoho Portal</title>
                <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
            </head>
            <body class="bg-gray-100">
                <div class="container mx-auto px-4 py-8">
                    <h1 class="text-3xl font-bold mb-6">Select Zoho Portal</h1>
                    <div class="bg-white shadow-md rounded px-8 pt-6 pb-8 mb-4">
                        <form method="POST">
                            <div class="mb-4">
                                <label class="block text-gray-700 text-sm font-bold mb-2" for="portal_id">
                                    Select Portal
                                </label>
                                <select name="portal_id" id="portal_id" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline">
            """
            
            for portal in portals:
                html += f'<option value="{portal["id"]}">{portal["name"]}</option>'
                
            html += """
                                </select>
                            </div>
                            <div class="flex items-center justify-between">
                                <button class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline" type="submit">
                                    Select
                                </button>
                                <a href="/dashboard" class="inline-block align-baseline font-bold text-sm text-blue-500 hover:text-blue-800">
                                    Cancel
                                </a>
                            </div>
                        </form>
                    </div>
                </div>
            </body>
            </html>
            """
            return html

    # Sync settings
    @app.route('/sync_settings', methods=['GET', 'POST'])
    @login_required
    def sync_settings():
        if request.method == 'POST':
            settings = request.form.to_dict()
            # Update user's sync settings using Supabase
            from app.supabase_models import update_user
            update_user(current_user.id, {"sync_settings": settings})
            return redirect(url_for('dashboard'))
        return render_template('sync_settings.html', settings=current_user.sync_settings)

    # Synchronization routes
    @app.route('/sync/manual', methods=['POST'])
    @login_required
    def manual_sync():
        # TODO: Implement manual synchronization
        return jsonify({"status": "Sync triggered"}), 200

    @app.route('/sync/status')
    @login_required
    def sync_status():
        # TODO: Implement sync status retrieval
        return jsonify({"status": "Not implemented"}), 501

    @app.route('/sync/history')
    @login_required
    def sync_history():
        try:
            # Get sync history from Supabase
            from app.supabase_models import get_sync_logs
            logs = get_sync_logs(current_user.id)
            return render_template('sync/sync_history.html', logs=logs)
        except Exception as e:
            # Handle case where sync_logs table doesn't exist yet
            flash(f"Could not retrieve sync history: {str(e)}")
            return redirect(url_for('dashboard'))

    # Settings routes
    @app.route('/settings', methods=['GET', 'POST'])
    @login_required
    def settings():
        # Create a mock form for now
        class MockForm:
            def __init__(self):
                self.name = MockField("Name", value=current_user.name)
                self.email = MockField("Email", value=current_user.email)
                self.sync_frequency = MockField("Sync Frequency", value="60")
                self.sync_direction = MockField("Sync Direction", value="bidirectional")
                self.sync_schedule = MockField("Sync Schedule", value="")
                self.password = MockField("New Password", value="")
                self.confirm_password = MockField("Confirm Password", value="")
                self.submit = MockField("Save Changes", value="")
            
            def hidden_tag(self):
                return ""
        
        class MockField:
            def __init__(self, label_text, value=""):
                self.label_text = label_text
                self.data = value
            
            def label(self, **kwargs):
                return f'<label for="{self.label_text.lower().replace(" ", "_")}">{self.label_text}</label>'
            
            def __call__(self, **kwargs):
                field_type = "password" if "password" in self.label_text.lower() else "text"
                return f'<input type="{field_type}" name="{self.label_text.lower().replace(" ", "_")}" value="{self.data}" id="{self.label_text.lower().replace(" ", "_")}">'
        
        form = MockForm()
        
        if request.method == 'POST':
            # TODO: Implement form processing
            flash('Settings updated successfully!')
            return redirect(url_for('dashboard'))
        
        return render_template('user/settings.html', form=form)

    # Subscription routes
    @app.route('/subscribe', methods=['GET', 'POST'])
    @login_required
    def subscribe():
        if request.method == 'POST':
            plan = request.form.get('plan')
            # Update user's subscription tier using Supabase
            from app.supabase_models import update_user
            update_user(current_user.id, {"subscription_tier": plan})
            flash(f'Subscription updated to {plan.capitalize()} plan!')
            return redirect(url_for('dashboard'))
        
        # Mock subscription plans
        plans = [
            {
                "id": "free",
                "name": "Free",
                "price": "$0/month",
                "features": ["Basic synchronization", "Up to 50 tasks", "Daily sync"]
            },
            {
                "id": "pro",
                "name": "Pro",
                "price": "$9.99/month",
                "features": ["Unlimited synchronization", "Unlimited tasks", "Hourly sync", "Priority support"]
            },
            {
                "id": "enterprise",
                "name": "Enterprise",
                "price": "$29.99/month",
                "features": ["Everything in Pro", "Real-time sync", "Dedicated support", "Custom integrations"]
            }
        ]
        
        # Check if subscribe.html exists, if not use a simple template
        try:
            return render_template('subscribe.html', plans=plans, current_plan=current_user.subscription_tier)
        except:
            # Create a simple HTML response
            html = """
            <!DOCTYPE html>
            <html>
            <head>
                <title>Subscription Plans</title>
                <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
            </head>
            <body class="bg-gray-100">
                <div class="container mx-auto px-4 py-8">
                    <h1 class="text-3xl font-bold mb-6">Choose a Subscription Plan</h1>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            """
            
            for plan in plans:
                is_current = plan["id"] == current_user.subscription_tier
                html += f"""
                <div class="bg-white rounded-lg shadow-lg overflow-hidden {'border-4 border-blue-500' if is_current else ''}">
                    <div class="px-6 py-4 bg-{'blue-500' if is_current else 'gray-200'} {'text-white' if is_current else 'text-gray-700'}">
                        <h2 class="text-xl font-bold">{plan["name"]}</h2>
                        <p class="text-2xl font-bold mt-2">{plan["price"]}</p>
                        {'<span class="inline-block bg-white text-blue-500 rounded-full px-3 py-1 text-sm font-semibold mt-2">Current Plan</span>' if is_current else ''}
                    </div>
                    <div class="px-6 py-4">
                        <ul class="mt-4 space-y-2">
                """
                
                for feature in plan["features"]:
                    html += f"""
                            <li class="flex items-center">
                                <svg class="h-5 w-5 text-green-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                                </svg>
                                {feature}
                            </li>
                    """
                
                html += """
                        </ul>
                    </div>
                    <div class="px-6 py-4">
                """
                
                if is_current:
                    html += """
                        <button disabled class="w-full bg-gray-300 text-gray-700 font-bold py-2 px-4 rounded opacity-50 cursor-not-allowed">
                            Current Plan
                        </button>
                    """
                else:
                    html += f"""
                        <form method="POST">
                            <input type="hidden" name="plan" value="{plan["id"]}">
                            <button type="submit" class="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline">
                                {'Upgrade' if plan["id"] in ["pro", "enterprise"] else 'Downgrade'} to {plan["name"]}
                            </button>
                        </form>
                    """
                
                html += """
                    </div>
                </div>
                """
            
            html += """
                    </div>
                    <div class="mt-6 text-center">
                        <a href="/dashboard" class="inline-block bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline">
                            Back to Dashboard
                        </a>
                    </div>
                </div>
            </body>
            </html>
            """
            return html

    @app.route('/billing/webhook', methods=['POST'])
    def billing_webhook():
        # TODO: Handle Stripe webhook events
        return "", 200

    # Error handlers
    @app.errorhandler(404)
    def not_found_error(error):
        return render_template('errors/404.html'), 404

    @app.errorhandler(500)
    def internal_error(error):
        return render_template('errors/500.html'), 500

    # User loader for Flask-Login
    from app.supabase_models import load_user
    login.user_loader(load_user)

    return app
