import json
from datetime import datetime, timedelta
from app.supabase_models import (
    get_user_by_id, get_oauth_token, update_oauth_token,
    create_task_mapping, get_task_mapping_by_zoho_id, get_task_mapping_by_todoist_id,
    delete_task_mapping, create_sync_log, create_conflict, create_task_history
)
from app.zoho_oauth import refresh_zoho_token, get_zoho_client
from app.todoist_oauth import get_todoist_client
from app.notifications import notify_user_of_conflict, notify_user_of_sync_failure
from app.logger import log_error, log_info, log_warning
from celery import shared_task

def create_task_history_entry(user_id, task_mapping_id, action, details):
    """
    Create a task history entry in Supabase.
    """
    create_task_history(user_id, task_mapping_id, action, details)

def create_todoist_task(user_id, zoho_task):
    """
    Create a task in Todoist based on a Zoho task.
    """
    user = get_user_by_id(user_id)
    if not user:
        log_error(f"User with id {user_id} not found")
        return
    
    todoist_client = get_todoist_client(user)
    new_task = todoist_client.add_task(
        content=zoho_task['name'],
        description=zoho_task['description'],
        due_date=zoho_task['end_date']
    )
    
    # Create task mapping in Supabase
    task_mapping = create_task_mapping(user_id, zoho_task['id'], new_task['id'])
    
    # Create task history entry
    create_task_history_entry(user_id, task_mapping['id'], 'created', {
        'zoho_task': zoho_task,
        'todoist_task': new_task
    })

def update_todoist_task(user_id, todoist_task_id, zoho_task):
    """
    Update a Todoist task based on a Zoho task.
    """
    user = get_user_by_id(user_id)
    if not user:
        log_error(f"User with id {user_id} not found")
        return
    
    todoist_client = get_todoist_client(user)
    updated_task = todoist_client.update_task(
        task_id=todoist_task_id,
        content=zoho_task['name'],
        description=zoho_task['description'],
        due_date=zoho_task['end_date']
    )
    
    # Get task mapping from Supabase
    task_mapping = get_task_mapping_by_todoist_id(user_id, todoist_task_id)
    
    # Create task history entry
    create_task_history_entry(user_id, task_mapping['id'], 'updated', {
        'zoho_task': zoho_task,
        'todoist_task': updated_task
    })

def delete_todoist_task(user_id, todoist_task_id):
    """
    Delete a task in Todoist.
    """
    user = get_user_by_id(user_id)
    if not user:
        log_error(f"User with id {user_id} not found")
        return
    
    todoist_client = get_todoist_client(user)
    todoist_client.delete_task(task_id=todoist_task_id)
    
    # Get task mapping from Supabase
    task_mapping = get_task_mapping_by_todoist_id(user_id, todoist_task_id)
    
    # Create task history entry
    create_task_history_entry(user_id, task_mapping['id'], 'deleted', {
        'todoist_task_id': todoist_task_id
    })
    
    # Delete task mapping from Supabase
    delete_task_mapping(task_mapping['id'])

def create_zoho_task(user_id, todoist_task):
    """
    Create a task in Zoho Projects based on a Todoist task.
    """
    user = get_user_by_id(user_id)
    if not user:
        log_error(f"User with id {user_id} not found")
        return
    
    zoho_client = get_zoho_client(user)
    new_task = zoho_client.create_task(
        name=todoist_task['content'],
        description=todoist_task['description'],
        due_date=todoist_task['due']['date']
    )
    
    # Create task mapping in Supabase
    task_mapping = create_task_mapping(user_id, new_task['id'], todoist_task['id'])
    
    # Create task history entry
    create_task_history_entry(user_id, task_mapping['id'], 'created', {
        'zoho_task': new_task,
        'todoist_task': todoist_task
    })

def update_zoho_task(user_id, zoho_task_id, todoist_task):
    """
    Update a Zoho task based on a Todoist task.
    """
    user = get_user_by_id(user_id)
    if not user:
        log_error(f"User with id {user_id} not found")
        return
    
    zoho_client = get_zoho_client(user)
    updated_task = zoho_client.update_task(
        task_id=zoho_task_id,
        name=todoist_task['content'],
        description=todoist_task['description'],
        due_date=todoist_task['due']['date']
    )
    
    # Get task mapping from Supabase
    task_mapping = get_task_mapping_by_zoho_id(user_id, zoho_task_id)
    
    # Create task history entry
    create_task_history_entry(user_id, task_mapping['id'], 'updated', {
        'zoho_task': updated_task,
        'todoist_task': todoist_task
    })

def delete_zoho_task(user_id, zoho_task_id):
    """
    Delete a task in Zoho Projects.
    """
    user = get_user_by_id(user_id)
    if not user:
        log_error(f"User with id {user_id} not found")
        return
    
    zoho_client = get_zoho_client(user)
    zoho_client.delete_task(task_id=zoho_task_id)
    
    # Get task mapping from Supabase
    task_mapping = get_task_mapping_by_zoho_id(user_id, zoho_task_id)
    
    # Create task history entry
    create_task_history_entry(user_id, task_mapping['id'], 'deleted', {
        'zoho_task_id': zoho_task_id
    })
    
    # Delete task mapping from Supabase
    delete_task_mapping(task_mapping['id'])

def get_zoho_tasks(user_id):
    """
    Get tasks from Zoho Projects.
    """
    user = get_user_by_id(user_id)
    if not user:
        log_error(f"User with id {user_id} not found")
        return []
    
    zoho_client = get_zoho_client(user)
    return zoho_client.get_tasks()

def get_todoist_tasks(user_id):
    """
    Get tasks from Todoist.
    """
    user = get_user_by_id(user_id)
    if not user:
        log_error(f"User with id {user_id} not found")
        return []
    
    todoist_client = get_todoist_client(user)
    return todoist_client.get_tasks()

@shared_task
def sync_tasks(user_id):
    """
    Synchronize tasks between Zoho Projects and Todoist.
    """
    user = get_user_by_id(user_id)
    if not user:
        log_error(f"User with id {user_id} not found")
        return

    try:
        # Refresh Zoho token if necessary
        refresh_zoho_token(user)

        # Sync Zoho tasks to Todoist
        zoho_tasks = get_zoho_tasks(user_id)
        for zoho_task in zoho_tasks:
            task_mapping = get_task_mapping_by_zoho_id(user_id, zoho_task['id'])
            if task_mapping:
                update_todoist_task(user_id, task_mapping['todoist_task_id'], zoho_task)
            else:
                create_todoist_task(user_id, zoho_task)

        # Sync Todoist tasks to Zoho
        todoist_tasks = get_todoist_tasks(user_id)
        for todoist_task in todoist_tasks:
            task_mapping = get_task_mapping_by_todoist_id(user_id, todoist_task['id'])
            if task_mapping:
                update_zoho_task(user_id, task_mapping['zoho_task_id'], todoist_task)
            else:
                create_zoho_task(user_id, todoist_task)

        # Log successful sync
        log_info(f"Sync completed successfully for user {user_id}")
        create_sync_log(user_id, 'success')

    except Exception as e:
        log_error(f"Sync failed for user {user_id}: {str(e)}")
        create_sync_log(user_id, 'failure', str(e))
        notify_user_of_sync_failure(user)

@shared_task
def scheduled_sync():
    """
    Run scheduled synchronization for all users.
    """
    # Get all users from Supabase
    from app.supabase_db import get_supabase_admin
    supabase = get_supabase_admin()
    response = supabase.table("users").select("id").execute()
    
    if response.data:
        for user in response.data:
            sync_tasks.delay(user['id'])
