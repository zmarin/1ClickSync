import logging
import os
from flask import Flask, render_template, request, jsonify, redirect, url_for
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
        return render_template('user/dashboard.html')

    @app.route('/pricing')
    def pricing():
        return render_template('main/pricing.html')

    # Auth blueprint is already registered in app/supabase_app.py
    # No need to register it again here

    # OAuth routes
    @app.route('/auth/zoho')
    @login_required
    def zoho_auth():
        # TODO: Implement Zoho OAuth flow
        pass

    @app.route('/auth/zoho/callback')
    def zoho_callback():
        # TODO: Handle Zoho OAuth callback
        pass

    @app.route('/auth/todoist')
    @login_required
    def todoist_auth():
        # TODO: Implement Todoist OAuth flow
        pass

    @app.route('/auth/todoist/callback')
    def todoist_callback():
        # TODO: Handle Todoist OAuth callback
        pass

    # Zoho portal selection
    @app.route('/select_zoho_portal', methods=['GET', 'POST'])
    @login_required
    def select_zoho_portal():
        if request.method == 'POST':
            portal_id = request.form.get('portal_id')
            # Update user's Zoho portal ID using Supabase
            from app.supabase_models import update_user
            update_user(current_user.id, {"zoho_portal_id": portal_id})
            return redirect(url_for('dashboard'))
        # TODO: Fetch Zoho portals and pass them to the template
        return render_template('select_zoho_portal.html')

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
        # Get sync history from Supabase
        from app.supabase_models import get_sync_logs
        logs = get_sync_logs(current_user.id)
        return render_template('sync_history.html', logs=logs)

    # Settings routes
    @app.route('/settings', methods=['GET', 'POST'])
    @login_required
    def settings():
        # TODO: Implement user settings
        return render_template('settings.html')

    # Subscription routes
    @app.route('/subscribe', methods=['GET', 'POST'])
    @login_required
    def subscribe():
        # TODO: Implement subscription plan selection and payment
        return render_template('subscribe.html')

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
