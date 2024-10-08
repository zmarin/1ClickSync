import os
import logging
import json
import time
import requests
from models import db, User, ProjectMapping, TaskMapping

# Setup logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')

# Environment variables
ZOHO_CLIENT_ID = os.getenv('ZOHO_CLIENT_ID')
ZOHO_CLIENT_SECRET = os.getenv('ZOHO_CLIENT_SECRET')
TODOIST_CLIENT_ID = os.getenv('TODOIST_CLIENT_ID')
TODOIST_CLIENT_SECRET = os.getenv('TODOIST_CLIENT_SECRET')

TODOIST_BASE_URL = "https://api.todoist.com/rest/v2"
ZOHO_PROJECTS_BASE_URL = "https://projectsapi.zoho.com/restapi/portal"

class ZohoRateLimiter:
    def __init__(self):
        self.request_count = 0
        self.start_time = time.time()

    def wait_if_needed(self):
        if self.request_count >= 100:
            elapsed_time = time.time() - self.start_time
            if elapsed_time < 120:
                time.sleep(120 - elapsed_time)
            self.request_count = 0
            self.start_time = time.time()
        self.request_count += 1

rate_limiter = ZohoRateLimiter()

def refresh_access_token(refresh_token, client_id, client_secret):
    url = "https://accounts.zoho.com/oauth/v2/token"
    data = {
        "refresh_token": refresh_token,
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "refresh_token"
    }
    response = requests.post(url, data=data)
    if response.status_code == 200:
        return response.json().get("access_token")
    else:
        logging.error(f"Failed to refresh access token: {response.text}")
        raise Exception("Failed to refresh access token")

def api_request(method, url, headers=None, data=None, params=None):
    response = requests.request(method, url, headers=headers, data=data, params=params)
    if response.status_code == 401:
        refresh_token = headers.get("Authorization", "").split()[-1]
        access_token = refresh_access_token(refresh_token, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET)
        headers["Authorization"] = f"Bearer {access_token}"
        response = requests.request(method, url, headers=headers, data=data, params=params)
    if response.status_code != 200:
        logging.error(f"API request failed: {response.text}")
        raise Exception("API request failed")
    return response.json()

def check_zoho_id_exists(user_id, table_name, zoho_id):
    if table_name == "project_mappings":
        return db.session.query(ProjectMapping).filter_by(user_id=user_id, zoho_project_id=zoho_id).first()
    elif table_name == "task_mappings":
        return db.session.query(TaskMapping).filter_by(user_id=user_id, zoho_task_id=zoho_id).first()

def store_project_mapping(user_id, zoho_project_id, todoist_project_id):
    mapping = ProjectMapping(user_id=user_id, zoho_project_id=zoho_project_id, todoist_project_id=todoist_project_id)
    db.session.add(mapping)
    db.session.commit()

def process_items(user_id, item_type, token, data, item_id=None):
    url = f"{TODOIST_BASE_URL}/{item_type}s" + (f"/{item_id}" if item_id else "")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    method = "POST" if item_id else "PUT"
    response = api_request(method, url, headers=headers, data=json.dumps(data))
    if 'id' in response:
        if not item_id:
            if item_type == 'project':
                store_project_mapping(user_id, data['zoho_project_id'], response['id'])
            elif item_type == 'task':
                store_task_mapping(user_id, data['zoho_task_id'], response['id'])
        return response['id']
    else:
        logging.error(f"Failed to process {item_type}: {response.get('error', 'Unknown error')}")
        raise Exception(f"Failed to process {item_type}")

def synchronize_data(user_id):
    logging.debug(f"Starting synchronization for user ID: {user_id}")
    user = db.session.query(User).filter_by(id=user_id).first()
    if not user:
        logging.error(f"No user found with ID: {user_id}")
        return "User not found"

    zoho_portal_id = user.selected_portal_id
    refresh_token = user.zoho_refresh_token
    todoist_token = user.todoist_access_token
    zoho_access_token = refresh_access_token(refresh_token, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET)
    
    projects = api_request("GET", f"{ZOHO_PROJECTS_BASE_URL}/{zoho_portal_id}/projects",
                           headers={"Authorization": f"Bearer {zoho_access_token}"})
    for project in projects.get('data', []):
        rate_limiter.wait_if_needed()
        todoist_project_id = process_items(user_id, 'project', todoist_token, {"name": project['name'], "zoho_project_id": project['id']})
        process_tasks(user_id, project['id'], todoist_project_id, todoist_token)

def process_tasks(user_id, zoho_project_id, todoist_project_id, todoist_token):
    tasks = api_request("GET", f"{ZOHO_PROJECTS_BASE_URL}/{zoho_project_id}/tasks",
                        headers={"Authorization": f"Bearer {todoist_token}"})
    for task in tasks.get('data', []):
        rate_limiter.wait_if_needed()
        sync_task_with_todoist(user_id, task, todoist_project_id, todoist_token)

def sync_task_with_todoist(user_id, task, todoist_project_id, todoist_token):
    zoho_task_id = task['id']
    task_name = task['content']
    existing = check_zoho_id_exists(user_id, 'task_mappings', zoho_task_id)
    if existing:
        process_items(user_id, 'task', todoist_token, {"content": task_name, "project_id": todoist_project_id}, existing.todoist_id)
    else:
        todoist_task_id = process_items(user_id, 'task', todoist_token, {"content": task_name, "project_id": todoist_project_id, "zoho_task_id": zoho_task_id})

# Entry point for the script, usually called from elsewhere or scheduled as a job
def main():
    user_ids = [1, 2, 3]  # Example user IDs
    for user_id in user_ids:
        result = synchronize_data(user_id)
        logging.info(result)

if __name__ == "__main__":
    main()
