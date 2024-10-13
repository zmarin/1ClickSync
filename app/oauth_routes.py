from flask import Blueprint, redirect, url_for, session
from authlib.integrations.flask_client import OAuth
from flask_login import current_user

oauth_bp = Blueprint('oauth', __name__)
oauth = OAuth()

zoho = oauth.register(
    name='zoho',
    client_id='YOUR_ZOHO_CLIENT_ID',
    client_secret='YOUR_ZOHO_CLIENT_SECRET',
    access_token_url='https://accounts.zoho.com/oauth/v2/token',
    authorize_url='https://accounts.zoho.com/oauth/v2/auth',
    api_base_url='https://projectsapi.zoho.com/restapi/v3/',
    client_kwargs={'scope': 'ZohoProjects.projects.ALL,ZohoProjects.tasklists.ALL,ZohoProjects.tasks.ALL'}
)

todoist = oauth.register(
    name='todoist',
    client_id='YOUR_TODOIST_CLIENT_ID',
    client_secret='YOUR_TODOIST_CLIENT_SECRET',
    access_token_url='https://todoist.com/oauth/access_token',
    authorize_url='https://todoist.com/oauth/authorize',
    api_base_url='https://api.todoist.com/rest/v1/',
    client_kwargs={'scope': 'task:add,project:add,data:read_write'}
)

@oauth_bp.route('/login/zoho')
def zoho_login():
    return zoho.authorize_redirect(redirect_uri=url_for('oauth.zoho_authorize', _external=True))

@oauth_bp.route('/login/todoist')
def todoist_login():
    return todoist.authorize_redirect(redirect_uri=url_for('oauth.todoist_authorize', _external=True))

@oauth_bp.route('/authorize/zoho')
def zoho_authorize():
    token = zoho.authorize_access_token()
    # Save token to user's account
    return redirect(url_for('user.dashboard'))

@oauth_bp.route('/authorize/todoist')
def todoist_authorize():
    token = todoist.authorize_access_token()
    # Save token to user's account
    return redirect(url_for('user.dashboard'))