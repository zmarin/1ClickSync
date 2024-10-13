import os
from flask import Blueprint, redirect, url_for, request, session
from flask_login import current_user, login_required
from requests_oauthlib import OAuth2Session
from app import db
from models import User

zoho_oauth = Blueprint('zoho_oauth', __name__)

ZOHO_CLIENT_ID = os.environ.get('ZOHO_CLIENT_ID')
ZOHO_CLIENT_SECRET = os.environ.get('ZOHO_CLIENT_SECRET')
ZOHO_AUTHORIZE_URL = 'https://accounts.zoho.com/oauth/v2/auth'
ZOHO_TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token'
ZOHO_SCOPE = ['ZohoProjects.projects.ALL', 'ZohoProjects.tasks.ALL']

@zoho_oauth.route('/zoho/authorize')
@login_required
def zoho_authorize():
    zoho = OAuth2Session(ZOHO_CLIENT_ID, scope=ZOHO_SCOPE, redirect_uri=url_for('zoho_oauth.zoho_callback', _external=True))
    authorization_url, state = zoho.authorization_url(ZOHO_AUTHORIZE_URL)
    session['oauth_state'] = state
    return redirect(authorization_url)

@zoho_oauth.route('/zoho/callback')
@login_required
def zoho_callback():
    zoho = OAuth2Session(ZOHO_CLIENT_ID, state=session['oauth_state'], redirect_uri=url_for('zoho_oauth.zoho_callback', _external=True))
    token = zoho.fetch_token(ZOHO_TOKEN_URL, client_secret=ZOHO_CLIENT_SECRET, authorization_response=request.url)
    
    # Store the token in the database
    user = User.query.get(current_user.id)
    user.zoho_access_token = token['access_token']
    user.zoho_refresh_token = token['refresh_token']
    db.session.commit()
    
    return redirect(url_for('main.dashboard'))

def refresh_zoho_token(user):
    extra = {
        'client_id': ZOHO_CLIENT_ID,
        'client_secret': ZOHO_CLIENT_SECRET,
    }
    zoho = OAuth2Session(ZOHO_CLIENT_ID, token={'refresh_token': user.zoho_refresh_token})
    new_token = zoho.refresh_token(ZOHO_TOKEN_URL, **extra)
    
    user.zoho_access_token = new_token['access_token']
    db.session.commit()
    
    return new_token

def get_zoho_client(user):
    zoho = OAuth2Session(ZOHO_CLIENT_ID, token={'access_token': user.zoho_access_token})
    return zoho
