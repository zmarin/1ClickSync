"""
Todoist API client for 1ClickSync.
This module provides a client for interacting with the Todoist API.
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

# Todoist API configuration
TODOIST_CLIENT_ID = os.environ.get('TODOIST_CLIENT_ID')
TODOIST_CLIENT_SECRET = os.environ.get('TODOIST_CLIENT_SECRET')
TODOIST_AUTHORIZE_URL = 'https://todoist.com/oauth/authorize'
TODOIST_TOKEN_URL = 'https://todoist.com/oauth/access_token'
TODOIST_API_BASE_URL = 'https://api.todoist.com/rest/v2/'
TODOIST_SYNC_API_URL = 'https://api.todoist.com/sync/v9/'
TODOIST_SCOPE = ['task:add', 'task:read', 'task:delete', 'data:read', 'data:read_write']

class TodoistClient:
    """
    Client for interacting with the Todoist API.
    """
    
    def __init__(self, user):
        """
        Initialize the Todoist client.
        
        Args:
            user: User object with Todoist OAuth token
        """
        self.user = user
        self.user_id = user.id
        self.token = get_oauth_token(user.id, 'todoist')
        
        if not self.token:
            raise AuthenticationError("No Todoist OAuth token found for user")
        
        self.session = OAuth2Session(
            TODOIST_CLIENT_ID,
            token={
                'access_token': self.token['access_token'],
                'token_type': 'Bearer'
            }
        )
    
    @retry_on_failure(max_retries=2)
    def _make_request(self, method, endpoint, api_type='rest', **kwargs):
        """
        Make a request to the Todoist API with error handling.
        
        Args:
            method: HTTP method (get, post, put, delete)
            endpoint: API endpoint (without base URL)
            api_type: API type ('rest' or 'sync')
            **kwargs: Additional arguments to pass to requests
            
        Returns:
            Response data as a dictionary
        """
        # Prepare URL
        base_url = TODOIST_API_BASE_URL if api_type == 'rest' else TODOIST_SYNC_API_URL
        url = f"{base_url}{endpoint}"
        
        # Add authorization header
        headers = kwargs.get('headers', {})
        headers['Authorization'] = f"Bearer {self.token['access_token']}"
        kwargs['headers'] = headers
        
        try:
            # Make the request
            response = safe_request(method, url, 'Todoist', **kwargs)
            
            # Parse JSON response if it's not empty
            if response.text:
                data = response.json()
            else:
                data = {}
            
            return data
        except APIError:
            # Re-raise API errors
            raise
        except Exception as e:
            # Handle other exceptions
            raise handle_api_exception(e, 'Todoist')
    
    def get_projects(self):
        """
        Get a list of Todoist projects.
        
        Returns:
            List of project dictionaries
        """
        return self._make_request('get', 'projects')
    
    def get_tasks(self, project_id=None):
        """
        Get a list of tasks.
        
        Args:
            project_id: Project ID (if None, gets all tasks)
            
        Returns:
            List of task dictionaries
        """
        params = {}
        if project_id:
            params['project_id'] = project_id
        
        return self._make_request('get', 'tasks', params=params)
    
    def get_task(self, task_id):
        """
        Get a specific task.
        
        Args:
            task_id: Task ID
            
        Returns:
            Task dictionary
        """
        try:
            return self._make_request('get', f'tasks/{task_id}')
        except ResourceNotFoundError:
            # Task not found
            raise ResourceNotFoundError(f"Task {task_id} not found in Todoist")
    
    def create_task(self, content, description=None, due_date=None, project_id=None, priority=None, labels=None):
        """
        Create a new task.
        
        Args:
            content: Task content (title)
            description: Task description
            due_date: Task due date (YYYY-MM-DD)
            project_id: Project ID
            priority: Task priority (1-4)
            labels: List of label IDs
            
        Returns:
            Created task dictionary
        """
        # Prepare task data
        task_data = {
            'content': content
        }
        
        if description:
            task_data['description'] = description
        
        if due_date:
            task_data['due_date'] = due_date
        
        if project_id:
            task_data['project_id'] = project_id
        
        if priority:
            task_data['priority'] = priority
        
        if labels:
            task_data['label_ids'] = labels
        
        # Create the task
        return self._make_request('post', 'tasks', json=task_data)
    
    def update_task(self, task_id, content=None, description=None, due_date=None, project_id=None, priority=None, labels=None):
        """
        Update a task.
        
        Args:
            task_id: Task ID
            content: New task content (title)
            description: New task description
            due_date: New task due date (YYYY-MM-DD)
            project_id: New project ID
            priority: New task priority (1-4)
            labels: New list of label IDs
            
        Returns:
            Updated task dictionary
        """
        # Prepare task data
        task_data = {}
        
        if content:
            task_data['content'] = content
        
        if description is not None:  # Allow empty description
            task_data['description'] = description
        
        if due_date is not None:  # Allow removing due date
            task_data['due_date'] = due_date
        
        if project_id:
            task_data['project_id'] = project_id
        
        if priority:
            task_data['priority'] = priority
        
        if labels is not None:  # Allow empty labels
            task_data['label_ids'] = labels
        
        # Update the task
        self._make_request('post', f'tasks/{task_id}', json=task_data)
        
        # Get the updated task
        return self.get_task(task_id)
    
    def close_task(self, task_id):
        """
        Close (complete) a task.
        
        Args:
            task_id: Task ID
            
        Returns:
            True if successful
        """
        self._make_request('post', f'tasks/{task_id}/close')
        return True
    
    def reopen_task(self, task_id):
        """
        Reopen a closed task.
        
        Args:
            task_id: Task ID
            
        Returns:
            True if successful
        """
        self._make_request('post', f'tasks/{task_id}/reopen')
        return True
    
    def delete_task(self, task_id):
        """
        Delete a task.
        
        Args:
            task_id: Task ID
            
        Returns:
            True if successful
        """
        self._make_request('delete', f'tasks/{task_id}')
        return True
    
    def get_comments(self, task_id):
        """
        Get comments for a task.
        
        Args:
            task_id: Task ID
            
        Returns:
            List of comment dictionaries
        """
        params = {'task_id': task_id}
        return self._make_request('get', 'comments', params=params)
    
    def add_comment(self, task_id, content):
        """
        Add a comment to a task.
        
        Args:
            task_id: Task ID
            content: Comment content
            
        Returns:
            Created comment dictionary
        """
        comment_data = {
            'task_id': task_id,
            'content': content
        }
        
        return self._make_request('post', 'comments', json=comment_data)
    
    def get_labels(self):
        """
        Get a list of labels.
        
        Returns:
            List of label dictionaries
        """
        return self._make_request('get', 'labels')
    
    def get_user(self):
        """
        Get user information.
        
        Returns:
            User dictionary
        """
        return self._make_request('get', 'user', api_type='sync')

def get_todoist_client(user):
    """
    Get a Todoist client for a user.
    
    Args:
        user: User object
        
    Returns:
        TodoistClient instance
    """
    return TodoistClient(user)
