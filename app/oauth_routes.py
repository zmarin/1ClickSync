from flask import Blueprint, redirect, url_for, session
from authlib.integrations.flask_client import OAuth
from flask_login import current_user

oauth_bp = Blueprint('oauth', __name__)
oauth = OAuth()

zoho = oauth.register(
    name='zoho',
    client_id='1000.3EPPUOKKGDQQUSMZU6D1W3QGYR0TTT',
    client_secret='851613bf3ac3d324690b0f6152fec43d19ef748fca',
    access_token_url='https://accounts.zoho.com/oauth/v2/token',
    authorize_url='https://accounts.zoho.com/oauth/v2/auth',
    api_base_url='https://projectsapi.zoho.com/restapi/v3/',
    client_kwargs={'scope': 'ZohoProjects.projects.ALL,ZohoProjects.tasklists.ALL,ZohoProjects.tasks.ALL'}
)

todoist = oauth.register(
    name='todoist',
    client_id='3b4b8894e7c245e990b06493fbc188bf',
    client_secret='e35df048dbcb44d9906847c29dd82fac',
    access_token_url='https://todoist.com/oauth/access_token',
    authorize_url='https://todoist.com/oauth/authorize',
    api_base_url='https://api.todoist.com/rest/v1/',
    client_kwargs={'scope': 'task:add,task:read,task:delete,data:read,data:read_write'}
)

@oauth_bp.route('/login/zoho')
def zoho_login():
    return zoho.authorize_redirect(redirect_uri=url_for('oauth.zoho_authorize', _external=True))

@oauth_bp.route('/login/todoist')
def todoist_login():
    return todoist.authorize_redirect(redirect_uri=url_for('oauth.todoist_authorize', _external=True))

from flask_login import login_required, current_user
from app.supabase_models import create_oauth_token, get_oauth_token, update_oauth_token

@oauth_bp.route('/authorize/zoho')
@login_required
def zoho_authorize():
    token = zoho.authorize_access_token()
    user_id = current_user.id
    
    # Check if token already exists
    existing_token = get_oauth_token(user_id, "zoho")
    
    if existing_token:
        update_oauth_token(existing_token["id"], token["access_token"], token.get("refresh_token"), token["expires_in"])
    else:
        create_oauth_token(user_id, "zoho", token["access_token"], token.get("refresh_token"), token["expires_in"])
    
    return redirect(url_for('user.dashboard'))

@oauth_bp.route('/authorize/todoist')
@login_required
def todoist_authorize():
    token = todoist.authorize_access_token()
    user_id = current_user.id
    
    # Check if token already exists
    existing_token = get_oauth_token(user_id, "todoist")
    
    if existing_token:
        update_oauth_token(existing_token["id"], token["access_token"], token.get("refresh_token"), token["expires_in"])
    else:
        create_oauth_token(user_id, "todoist", token["access_token"], token.get("refresh_token"), token["expires_in"])

    return redirect(url_for('user.dashboard'))
