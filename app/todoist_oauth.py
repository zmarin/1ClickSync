import os
from flask import Blueprint, redirect, url_for, request, session
from flask_login import current_user, login_required
from requests_oauthlib import OAuth2Session
from app import db
from models import User

todoist_oauth = Blueprint('todoist_oauth', __name__)

TODOIST_CLIENT_ID = os.environ.get('TODOIST_CLIENT_ID')
TODOIST_CLIENT_SECRET = os.environ.get('TODOIST_CLIENT_SECRET')
TODOIST_AUTHORIZE_URL = 'https://todoist.com/oauth/authorize'
TODOIST_TOKEN_URL = 'https://todoist.com/oauth/access_token'
TODOIST_SCOPE = ['task:add', 'task:read', 'task:write', 'data:read', 'data:read_write']

@todoist_oauth.route('/todoist/authorize')
@login_required
def todoist_authorize():
    todoist = OAuth2Session(TODOIST_CLIENT_ID, scope=TODOIST_SCOPE, redirect_uri=url_for('todoist_oauth.todoist_callback', _external=True))
    authorization_url, state = todoist.authorization_url(TODOIST_AUTHORIZE_URL)
    session['oauth_state'] = state
    return redirect(authorization_url)

@todoist_oauth.route('/todoist/callback')
@login_required
def todoist_callback():
    todoist = OAuth2Session(TODOIST_CLIENT_ID, state=session['oauth_state'], redirect_uri=url_for('todoist_oauth.todoist_callback', _external=True))
    token = todoist.fetch_token(TODOIST_TOKEN_URL, client_secret=TODOIST_CLIENT_SECRET, authorization_response=request.url)
    
    # Store the token in the database
    user = User.query.get(current_user.id)
    user.todoist_access_token = token['access_token']
    db.session.commit()
    
    return redirect(url_for('main.dashboard'))

# Todoist doesn't use refresh tokens, so we don't need a refresh function

def get_todoist_client(user):
    todoist = OAuth2Session(TODOIST_CLIENT_ID, token={'access_token': user.todoist_access_token})
    return todoist
