import os
from flask import current_app, url_for, redirect, request, flash
from flask_login import current_user
from models import db, User
import requests
from todoist_api_python.api import TodoistAPI

def initiate_todoist_auth():
    client_id = current_app.config['TODOIST_CLIENT_ID']
    scope = 'data:read_write'
    state = 'random_state_string'  # You should generate a random string for security
    redirect_uri = current_app.config['TODOIST_REDIRECT_URI']
    
    auth_url = f"https://todoist.com/oauth/authorize?client_id={client_id}&scope={scope}&state={state}&redirect_uri={redirect_uri}"
    return redirect(auth_url)

def handle_todoist_callback():
    code = request.args.get('code')
    state = request.args.get('state')
    
    if not code:
        flash('Todoist authorization failed. Please try again.', 'error')
        return redirect(url_for('dashboard'))
    
    token_url = "https://todoist.com/oauth/access_token"
    data = {
        'client_id': current_app.config['TODOIST_CLIENT_ID'],
        'client_secret': current_app.config['TODOIST_CLIENT_SECRET'],
        'code': code,
        'redirect_uri': current_app.config['TODOIST_REDIRECT_URI']
    }
    
    response = requests.post(token_url, data=data)
    if response.status_code == 200:
        token_data = response.json()
        current_user.todoist_access_token = token_data['access_token']
        db.session.commit()
        flash('Todoist account connected successfully!', 'success')
    else:
        flash('Failed to connect Todoist account. Please try again.', 'error')
    
    return redirect(url_for('dashboard'))

def revoke_todoist_auth():
    if not current_user.todoist_access_token:
        flash('No Todoist account connected.', 'info')
        return redirect(url_for('dashboard'))
    
    # Todoist doesn't have a specific revoke endpoint, so we'll just remove the token
    current_user.todoist_access_token = None
    db.session.commit()
    flash('Todoist account disconnected successfully.', 'success')
    return redirect(url_for('dashboard'))

def get_todoist_projects():
    if not current_user.todoist_access_token:
        return None
    
    api = TodoistAPI(current_user.todoist_access_token)
    try:
        projects = api.get_projects()
        return projects
    except Exception as e:
        flash(f'Failed to fetch Todoist projects: {str(e)}', 'error')
        return None

print("todoist_oauth.py loaded successfully")
print(f"Defined functions: {', '.join(f for f in globals() if callable(globals()[f]) and not f.startswith('__'))}")