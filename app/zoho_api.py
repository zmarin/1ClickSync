"""
Zoho API client for 1ClickSync.
This module provides a client for interacting with the Zoho Projects API.
"""

import os
import json
from datetime import datetime, timedelta
from requests_oauthlib import OAuth2Session
from app.supabase_models import get_oauth_token, update_oauth_token
from app.api_error_handling import (
    APIError, AuthenticationError, RateLimitError, 
    ResourceNotFoundError, ServerError, NetworkError,
    retry_on_failure, safe_request, handle_api_exception
)
from app.logger import log_error, log_info, log_warning

# Zoho API configuration
ZOHO_CLIENT_ID = os.environ.get('ZOHO_CLIENT_ID')
ZOHO_CLIENT_SECRET = os.environ.get('ZOHO_CLIENT_SECRET')
ZOHO_AUTHORIZE_URL = 'https://accounts.zoho.com/oauth/v2/auth'
ZOHO_TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token'
ZOHO_API_BASE_URL = 'https://projectsapi.zoho.com/restapi/v3/'
ZOHO_SCOPE = ['ZohoProjects.projects.ALL', 'ZohoProjects.tasks.ALL']

class ZohoClient:
    """
    Client for interacting with the Zoho Projects API.
    """
    
    def __init__(self, user):
        """
        Initialize the Zoho client.
        
        Args:
            user: User object with Zoho OAuth token
        """
        self.user = user
        self.user_id = user.id
        self.token = get_oauth_token(user.id, 'zoho')
        
        if not self.token:
            raise AuthenticationError("No Zoho OAuth token found for user")
        
        self.session = OAuth2Session(
            ZOHO_CLIENT_ID,
            token={
                'access_token': self.token['access_token'],
                'refresh_token': self.token['refresh_token'],
                'token_type': 'Bearer'
            }
        )
    
    def _refresh_token_if_needed(self):
        """
        Refresh the Zoho OAuth token if it's expired or about to expire.
        """
        # Check if token is expired or about to expire (within 5 minutes)
        expires_at = datetime.fromisoformat(self.token['expires_at'].replace('Z', '+00:00')) if 'expires_at' in self.token else None
        
        if not expires_at or expires_at <= datetime.utcnow() + timedelta(minutes=5):
            log_info(f"Refreshing Zoho token for user {self.user_id}")
            self._refresh_token()
    
    @retry_on_failure(max_retries=3, backoff_factor=1.0)
    def _refresh_token(self):
        """
        Refresh the Zoho OAuth token.
        """
        try:
            # Prepare token refresh parameters
            extra = {
                'client_id': ZOHO_CLIENT_ID,
                'client_secret': ZOHO_CLIENT_SECRET,
                'refresh_token': self.token['refresh_token']
            }
            
            # Refresh the token
            new_token = self.session.refresh_token(ZOHO_TOKEN_URL, **extra)
            
            # Update the token in the database
            update_oauth_token(
                self.token['id'],
                new_token['access_token'],
                self.token['refresh_token'],  # Zoho doesn't update refresh tokens
                new_token.get('expires_in', 3600)
            )
            
            # Update the session token
            self.session.token = {
                'access_token': new_token['access_token'],
                'refresh_token': self.token['refresh_token'],
                'token_type': 'Bearer'
            }
            
            # Update the local token
            self.token = get_oauth_token(self.user_id, 'zoho')
            
            log_info(f"Successfully refreshed Zoho token for user {self.user_id}")
        except Exception as e:
            log_error(f"Failed to refresh Zoho token: {str(e)}")
            raise handle_api_exception(e, 'Zoho')
    
    @retry_on_failure(max_retries=2)
    def _make_request(self, method, endpoint, **kwargs):
        """
        Make a request to the Zoho API with error handling and token refresh.
        
        Args:
            method: HTTP method (get, post, put, delete)
            endpoint: API endpoint (without base URL)
            **kwargs: Additional arguments to pass to requests
            
        Returns:
            Response data as a dictionary
        """
        # Refresh token if needed
        self._refresh_token_if_needed()
        
        # Prepare URL
        url = f"{ZOHO_API_BASE_URL}{endpoint}"
        
        try:
            # Make the request
            response = safe_request(method, url, 'Zoho', **kwargs)
            
            # Parse JSON response
            data = response.json()
            
            # Check for API-specific errors
            if 'error' in data:
                error_message = data.get('error', {}).get('message', 'Unknown Zoho API error')
                error_code = data.get('error', {}).get('code', 'unknown')
                
                log_error(f"Zoho API error: {error_code} - {error_message}")
                
                if error_code == 'INVALID_TOKEN':
                    raise AuthenticationError(f"Invalid Zoho token: {error_message}")
                elif error_code == 'RESOURCE_NOT_FOUND':
                    raise ResourceNotFoundError(f"Resource not found in Zoho: {error_message}")
                elif error_code == 'RATE_LIMIT_EXCEEDED':
                    raise RateLimitError(f"Zoho rate limit exceeded: {error_message}")
                else:
                    raise APIError(f"Zoho API error: {error_message}", response=response)
            
            return data
        except APIError:
            # Re-raise API errors
            raise
        except Exception as e:
            # Handle other exceptions
            raise handle_api_exception(e, 'Zoho')
    
    def get_portals(self):
        """
        Get a list of Zoho portals.
        
        Returns:
            List of portal dictionaries
        """
        response = self._make_request('get', 'portals/')
        return response.get('portals', [])
    
    def get_projects(self, portal_id=None):
        """
        Get a list of projects in a portal.
        
        Args:
            portal_id: Portal ID (if None, uses the user's selected portal)
            
        Returns:
            List of project dictionaries
        """
        if not portal_id:
            portal_id = self.user.zoho_portal_id
        
        if not portal_id:
            raise ValueError("No Zoho portal ID provided or selected")
        
        response = self._make_request('get', f'portal/{portal_id}/projects/')
        return response.get('projects', [])
    
    def get_tasks(self, portal_id=None, project_id=None):
        """
        Get a list of tasks in a project.
        
        Args:
            portal_id: Portal ID (if None, uses the user's selected portal)
            project_id: Project ID (if None, gets tasks from all projects)
            
        Returns:
            List of task dictionaries
        """
        if not portal_id:
            portal_id = self.user.zoho_portal_id
        
        if not portal_id:
            raise ValueError("No Zoho portal ID provided or selected")
        
        tasks = []
        
        if project_id:
            # Get tasks for a specific project
            response = self._make_request('get', f'portal/{portal_id}/projects/{project_id}/tasks/')
            tasks.extend(response.get('tasks', []))
        else:
            # Get tasks for all projects
            projects = self.get_projects(portal_id)
            
            for project in projects:
                project_id = project['id']
                response = self._make_request('get', f'portal/{portal_id}/projects/{project_id}/tasks/')
                tasks.extend(response.get('tasks', []))
        
        return tasks
    
    def get_task(self, task_id, portal_id=None, project_id=None):
        """
        Get a specific task.
        
        Args:
            task_id: Task ID
            portal_id: Portal ID (if None, uses the user's selected portal)
            project_id: Project ID (if None, searches all projects)
            
        Returns:
            Task dictionary
        """
        if not portal_id:
            portal_id = self.user.zoho_portal_id
        
        if not portal_id:
            raise ValueError("No Zoho portal ID provided or selected")
        
        if project_id:
            # Get task from a specific project
            response = self._make_request('get', f'portal/{portal_id}/projects/{project_id}/tasks/{task_id}/')
            return response.get('task', {})
        else:
            # Search for task in all projects
            projects = self.get_projects(portal_id)
            
            for project in projects:
                project_id = project['id']
                try:
                    response = self._make_request('get', f'portal/{portal_id}/projects/{project_id}/tasks/{task_id}/')
                    return response.get('task', {})
                except ResourceNotFoundError:
                    # Task not found in this project, continue searching
                    continue
            
            # Task not found in any project
            raise ResourceNotFoundError(f"Task {task_id} not found in any project")
    
    def create_task(self, name, description=None, due_date=None, portal_id=None, project_id=None):
        """
        Create a new task.
        
        Args:
            name: Task name
            description: Task description
            due_date: Task due date (YYYY-MM-DD)
            portal_id: Portal ID (if None, uses the user's selected portal)
            project_id: Project ID (if None, uses the first project)
            
        Returns:
            Created task dictionary
        """
        if not portal_id:
            portal_id = self.user.zoho_portal_id
        
        if not portal_id:
            raise ValueError("No Zoho portal ID provided or selected")
        
        if not project_id:
            # Get the first project
            projects = self.get_projects(portal_id)
            
            if not projects:
                raise ValueError("No projects found in the portal")
            
            project_id = projects[0]['id']
        
        # Prepare task data
        task_data = {
            'name': name
        }
        
        if description:
            task_data['description'] = description
        
        if due_date:
            task_data['end_date'] = due_date
        
        # Create the task
        response = self._make_request(
            'post', 
            f'portal/{portal_id}/projects/{project_id}/tasks/', 
            json={'tasks': [task_data]}
        )
        
        return response.get('tasks', [{}])[0]
    
    def update_task(self, task_id, name=None, description=None, due_date=None, portal_id=None, project_id=None):
        """
        Update a task.
        
        Args:
            task_id: Task ID
            name: New task name
            description: New task description
            due_date: New task due date (YYYY-MM-DD)
            portal_id: Portal ID (if None, uses the user's selected portal)
            project_id: Project ID (if None, searches all projects)
            
        Returns:
            Updated task dictionary
        """
        if not portal_id:
            portal_id = self.user.zoho_portal_id
        
        if not portal_id:
            raise ValueError("No Zoho portal ID provided or selected")
        
        # Find the project if not provided
        if not project_id:
            # Get the task to find its project
            task = self.get_task(task_id, portal_id)
            project_id = task.get('project', {}).get('id')
            
            if not project_id:
                raise ValueError(f"Could not determine project ID for task {task_id}")
        
        # Prepare task data
        task_data = {}
        
        if name:
            task_data['name'] = name
        
        if description:
            task_data['description'] = description
        
        if due_date:
            task_data['end_date'] = due_date
        
        # Update the task
        response = self._make_request(
            'put', 
            f'portal/{portal_id}/projects/{project_id}/tasks/{task_id}/', 
            json={'tasks': [task_data]}
        )
        
        return response.get('tasks', [{}])[0]
    
    def delete_task(self, task_id, portal_id=None, project_id=None):
        """
        Delete a task.
        
        Args:
            task_id: Task ID
            portal_id: Portal ID (if None, uses the user's selected portal)
            project_id: Project ID (if None, searches all projects)
            
        Returns:
            True if successful
        """
        if not portal_id:
            portal_id = self.user.zoho_portal_id
        
        if not portal_id:
            raise ValueError("No Zoho portal ID provided or selected")
        
        # Find the project if not provided
        if not project_id:
            # Get the task to find its project
            task = self.get_task(task_id, portal_id)
            project_id = task.get('project', {}).get('id')
            
            if not project_id:
                raise ValueError(f"Could not determine project ID for task {task_id}")
        
        # Delete the task
        self._make_request('delete', f'portal/{portal_id}/projects/{project_id}/tasks/{task_id}/')
        
        return True

def refresh_zoho_token(user):
    """
    Refresh the Zoho OAuth token for a user.
    
    Args:
        user: User object
        
    Returns:
        Updated token dictionary
    """
    client = ZohoClient(user)
    client._refresh_token()
    return client.token

def get_zoho_client(user):
    """
    Get a Zoho client for a user.
    
    Args:
        user: User object
        
    Returns:
        ZohoClient instance
    """
    return ZohoClient(user)
