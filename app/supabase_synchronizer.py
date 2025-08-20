import json
from datetime import datetime, timedelta
from app.supabase_models import (
    get_user_by_id, get_oauth_token, update_oauth_token,
    create_task_mapping, get_task_mapping_by_zoho_id, get_task_mapping_by_todoist_id,
    delete_task_mapping, create_sync_log, create_conflict, create_task_history
)
from app.zoho_api import get_zoho_client, refresh_zoho_token
from app.todoist_api import get_todoist_client
from app.notifications import notify_user_of_conflict, notify_user_of_sync_failure
from app.logger import log_error, log_info, log_warning
from app.api_error_handling import (
    APIError, AuthenticationError, RateLimitError, 
    ResourceNotFoundError, ServerError, NetworkError,
    retry_on_failure
)
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
    new_task = todoist_client.create_task(
        content=zoho_task['name'],
        description=zoho_task['description'],
        due_date=zoho_task['end_date']
    )
    
    # Extract last modified times
    zoho_last_modified = None
    todoist_last_modified = None
    
    if 'last_modified_time' in zoho_task:
        try:
            from app.conflict_resolution import parse_datetime
            zoho_last_modified = parse_datetime(zoho_task['last_modified_time'])
        except Exception as e:
            log_warning(f"Error parsing Zoho last modified time: {str(e)}")
    
    if 'date_completed' in new_task:
        try:
            from app.conflict_resolution import parse_datetime
            todoist_last_modified = parse_datetime(new_task['date_completed'])
        except Exception as e:
            log_warning(f"Error parsing Todoist last modified time: {str(e)}")
    
    # Create task mapping in Supabase
    task_mapping = create_task_mapping(
        user_id, 
        zoho_task['id'], 
        new_task['id'],
        zoho_last_modified,
        todoist_last_modified
    )
    
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
    
    # Extract last modified times
    zoho_last_modified = None
    todoist_last_modified = None
    
    if 'last_modified_time' in zoho_task:
        try:
            from app.conflict_resolution import parse_datetime
            zoho_last_modified = parse_datetime(zoho_task['last_modified_time'])
        except Exception as e:
            log_warning(f"Error parsing Zoho last modified time: {str(e)}")
    
    if 'date_completed' in updated_task:
        try:
            from app.conflict_resolution import parse_datetime
            todoist_last_modified = parse_datetime(updated_task['date_completed'])
        except Exception as e:
            log_warning(f"Error parsing Todoist last modified time: {str(e)}")
    
    # Update task mapping with last modified times
    update_data = {
        'last_sync_time': datetime.utcnow().isoformat()
    }
    
    if zoho_last_modified:
        update_data['zoho_last_modified'] = zoho_last_modified.isoformat()
    
    if todoist_last_modified:
        update_data['todoist_last_modified'] = todoist_last_modified.isoformat()
    
    update_task_mapping(task_mapping['id'], update_data)
    
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
    
    # Extract last modified times
    zoho_last_modified = None
    todoist_last_modified = None
    
    if 'last_modified_time' in new_task:
        try:
            from app.conflict_resolution import parse_datetime
            zoho_last_modified = parse_datetime(new_task['last_modified_time'])
        except Exception as e:
            log_warning(f"Error parsing Zoho last modified time: {str(e)}")
    
    if 'date_completed' in todoist_task:
        try:
            from app.conflict_resolution import parse_datetime
            todoist_last_modified = parse_datetime(todoist_task['date_completed'])
        except Exception as e:
            log_warning(f"Error parsing Todoist last modified time: {str(e)}")
    
    # Create task mapping in Supabase
    task_mapping = create_task_mapping(
        user_id, 
        new_task['id'], 
        todoist_task['id'],
        zoho_last_modified,
        todoist_last_modified
    )
    
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
    
    # Extract last modified times
    zoho_last_modified = None
    todoist_last_modified = None
    
    if 'last_modified_time' in updated_task:
        try:
            from app.conflict_resolution import parse_datetime
            zoho_last_modified = parse_datetime(updated_task['last_modified_time'])
        except Exception as e:
            log_warning(f"Error parsing Zoho last modified time: {str(e)}")
    
    if 'date_completed' in todoist_task:
        try:
            from app.conflict_resolution import parse_datetime
            todoist_last_modified = parse_datetime(todoist_task['date_completed'])
        except Exception as e:
            log_warning(f"Error parsing Todoist last modified time: {str(e)}")
    
    # Update task mapping with last modified times
    update_data = {
        'last_sync_time': datetime.utcnow().isoformat()
    }
    
    if zoho_last_modified:
        update_data['zoho_last_modified'] = zoho_last_modified.isoformat()
    
    if todoist_last_modified:
        update_data['todoist_last_modified'] = todoist_last_modified.isoformat()
    
    update_task_mapping(task_mapping['id'], update_data)
    
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

from app.conflict_resolution import apply_resolution

@shared_task
@retry_on_failure(max_retries=2, backoff_factor=1.0, retry_on=(NetworkError, ServerError))
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
        try:
            zoho_tasks = get_zoho_tasks(user_id)
        except APIError as e:
            log_error(f"Failed to get Zoho tasks: {str(e)}")
            create_sync_log(user_id, 'failure', f"Failed to get Zoho tasks: {str(e)}")
            notify_user_of_sync_failure(user)
            return

        for zoho_task in zoho_tasks:
            try:
                task_mapping = get_task_mapping_by_zoho_id(user_id, zoho_task['id'])
                if task_mapping:
                    # Check if there's a corresponding Todoist task
                    todoist_task_id = task_mapping['todoist_task_id']
                    todoist_client = get_todoist_client(user)
                    
                    try:
                        todoist_task = todoist_client.get_task(todoist_task_id)
                        
                        # Resolve based on last modified time
                        success, resolution = apply_resolution(user_id, zoho_task, todoist_task, task_mapping)
                        if success:
                            log_info(f"Applied {resolution} resolution for task mapping {task_mapping['id']}")
                        else:
                            # If resolution fails, default to updating Todoist with Zoho data
                            update_todoist_task(user_id, todoist_task_id, zoho_task)
                    except ResourceNotFoundError:
                        # Todoist task doesn't exist, create it
                        log_warning(f"Todoist task {todoist_task_id} not found, creating new task")
                        create_todoist_task(user_id, zoho_task)
                    except APIError as e:
                        log_error(f"Error processing Todoist task {todoist_task_id}: {str(e)}")
                        continue
                else:
                    # No mapping exists, create Todoist task
                    create_todoist_task(user_id, zoho_task)
            except Exception as e:
                log_error(f"Error processing Zoho task {zoho_task['id']}: {str(e)}")
                continue

        # Sync Todoist tasks to Zoho
        try:
            todoist_tasks = get_todoist_tasks(user_id)
        except APIError as e:
            log_error(f"Failed to get Todoist tasks: {str(e)}")
            create_sync_log(user_id, 'failure', f"Failed to get Todoist tasks: {str(e)}")
            notify_user_of_sync_failure(user)
            return

        for todoist_task in todoist_tasks:
            try:
                task_mapping = get_task_mapping_by_todoist_id(user_id, todoist_task['id'])
                if task_mapping:
                    # Check if there's a corresponding Zoho task
                    zoho_task_id = task_mapping['zoho_task_id']
                    zoho_client = get_zoho_client(user)
                    
                    try:
                        zoho_task = zoho_client.get_task(zoho_task_id)
                        # We already handled this case in the Zoho to Todoist sync
                        # No need to do anything here
                    except ResourceNotFoundError:
                        # Zoho task doesn't exist, create it
                        log_warning(f"Zoho task {zoho_task_id} not found, creating new task")
                        create_zoho_task(user_id, todoist_task)
                    except APIError as e:
                        log_error(f"Error processing Zoho task {zoho_task_id}: {str(e)}")
                        continue
                else:
                    # No mapping exists, create Zoho task
                    create_zoho_task(user_id, todoist_task)
            except Exception as e:
                log_error(f"Error processing Todoist task {todoist_task['id']}: {str(e)}")
                continue

        # Update last sync time for all task mappings
        try:
            from app.supabase_db import get_supabase_admin
            supabase = get_supabase_admin()
            
            # Get all task mappings for the user
            response = supabase.table("task_mappings").select("id").eq("user_id", user_id).execute()
            
            if response.data:
                for mapping in response.data:
                    # Update last sync time
                    from app.supabase_models import update_task_mapping
                    update_task_mapping(mapping['id'], {
                        'last_sync_time': datetime.utcnow().isoformat()
                    })
        except Exception as e:
            log_error(f"Error updating last sync time: {str(e)}")
            # Continue with the sync process even if updating last sync time fails

        # Log successful sync
        log_info(f"Sync completed successfully for user {user_id}")
        create_sync_log(user_id, 'success')

    except AuthenticationError as e:
        log_error(f"Authentication error during sync for user {user_id}: {str(e)}")
        create_sync_log(user_id, 'failure', f"Authentication error: {str(e)}")
        notify_user_of_sync_failure(user)
    except RateLimitError as e:
        log_error(f"Rate limit exceeded during sync for user {user_id}: {str(e)}")
        create_sync_log(user_id, 'failure', f"Rate limit exceeded: {str(e)}")
        notify_user_of_sync_failure(user)
    except APIError as e:
        log_error(f"API error during sync for user {user_id}: {str(e)}")
        create_sync_log(user_id, 'failure', f"API error: {str(e)}")
        notify_user_of_sync_failure(user)
    except Exception as e:
        log_error(f"Sync failed for user {user_id}: {str(e)}")
        create_sync_log(user_id, 'failure', f"Unexpected error: {str(e)}")
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
