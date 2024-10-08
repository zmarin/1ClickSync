import os
from flask import current_app, url_for, redirect, request, flash
from flask_login import current_user
from models import db, User
import requests
from urllib.parse import urlencode
from datetime import datetime, timedelta

ZOHO_REGIONS = {
    'US': 'https://projectsapi.zoho.com',
    'EU': 'https://projectsapi.zoho.eu',
    'IN': 'https://projectsapi.zoho.in',
    'AU': 'https://projectsapi.zoho.com.au',
    'CN': 'https://projectsapi.zoho.com.cn',
    'JP': 'https://projectsapi.zoho.jp'
}

def get_zoho_region(access_token):
    # Use the location parameter from the callback instead of trying all regions
    location = request.args.get('location', 'us').upper()
    return location if location in ZOHO_REGIONS else 'US'

def initiate_zoho_auth():
    params = {
        'scope': 'ZohoProjects.portals.READ,ZohoProjects.projects.ALL,ZohoProjects.tasks.ALL',
        'client_id': current_app.config['ZOHO_CLIENT_ID'],
        'response_type': 'code',
        'access_type': 'offline',
        'redirect_uri': current_app.config['ZOHO_REDIRECT_URI'],
        'prompt': 'consent'
    }
    auth_url = f"https://accounts.zoho.com/oauth/v2/auth?{urlencode(params)}"
    return redirect(auth_url)

def handle_zoho_callback():
    code = request.args.get('code')
    if not code:
        flash('Authorization failed. Please try again.', 'error')
        return redirect(url_for('dashboard'))

    token_url = "https://accounts.zoho.com/oauth/v2/token"
    data = {
        'code': code,
        'client_id': current_app.config['ZOHO_CLIENT_ID'],
        'client_secret': current_app.config['ZOHO_CLIENT_SECRET'],
        'redirect_uri': current_app.config['ZOHO_REDIRECT_URI'],
        'grant_type': 'authorization_code'
    }

    response = requests.post(token_url, data=data)
    if response.status_code == 200:
        token_data = response.json()
        current_user.zoho_access_token = token_data['access_token']
        current_user.zoho_refresh_token = token_data['refresh_token']
        current_user.zoho_token_expires_at = datetime.utcnow() + timedelta(seconds=token_data['expires_in'])
        
        region = get_zoho_region(current_user.zoho_access_token)
        current_user.zoho_api_domain = ZOHO_REGIONS[region]
        
        db.session.commit()
        flash('Zoho account connected successfully!', 'success')
    else:
        flash('Failed to connect Zoho account. Please try again.', 'error')

    return redirect(url_for('dashboard'))

def revoke_zoho_auth():
    if not current_user.zoho_refresh_token:
        flash('No Zoho account connected.', 'info')
        return redirect(url_for('dashboard'))

    revoke_url = "https://accounts.zoho.com/oauth/v2/token/revoke"
    data = {
        'token': current_user.zoho_refresh_token
    }

    response = requests.post(revoke_url, data=data)
    if response.status_code == 200:
        current_user.zoho_access_token = None
        current_user.zoho_refresh_token = None
        current_user.zoho_token_expires_at = None
        current_user.zoho_api_domain = None
        current_user.zoho_portal_id = None
        db.session.commit()
        flash('Zoho account disconnected successfully.', 'success')
    else:
        flash('Failed to disconnect Zoho account. Please try again.', 'error')

    return redirect(url_for('dashboard'))

def get_zoho_portals():
    if not current_user.zoho_access_token or not current_user.zoho_api_domain:
        return None

    portals_url = f"{current_user.zoho_api_domain}/restapi/portals/"
    headers = {
        'Authorization': f'Zoho-oauthtoken {current_user.zoho_access_token}'
    }

    response = requests.get(portals_url, headers=headers)
    if response.status_code == 200:
        return response.json().get('portals', [])
    elif response.status_code == 401:
        # Token might be expired, try refreshing
        if refresh_zoho_token():
            # Retry with new token
            headers['Authorization'] = f'Zoho-oauthtoken {current_user.zoho_access_token}'
            response = requests.get(portals_url, headers=headers)
            if response.status_code == 200:
                return response.json().get('portals', [])
    
    return None

def refresh_zoho_token():
    if not current_user.zoho_refresh_token:
        return False

    token_url = "https://accounts.zoho.com/oauth/v2/token"
    data = {
        'refresh_token': current_user.zoho_refresh_token,
        'client_id': current_app.config['ZOHO_CLIENT_ID'],
        'client_secret': current_app.config['ZOHO_CLIENT_SECRET'],
        'grant_type': 'refresh_token'
    }

    response = requests.post(token_url, data=data)
    if response.status_code == 200:
        token_data = response.json()
        current_user.zoho_access_token = token_data['access_token']
        current_user.zoho_token_expires_at = datetime.utcnow() + timedelta(seconds=token_data['expires_in'])
        db.session.commit()
        return True
    else:
        return False

def is_token_expired():
    return datetime.utcnow() >= current_user.zoho_token_expires_at

def populate_zoho_portals():
    portals = get_zoho_portals()
    if portals:
        return portals
    else:
        flash('Failed to fetch Zoho portals. Please try reconnecting your account.', 'error')
        return None

print("zoho_oauth.py loaded successfully")
print(f"Defined functions: {', '.join(f for f in globals() if callable(globals()[f]) and not f.startswith('__'))}")