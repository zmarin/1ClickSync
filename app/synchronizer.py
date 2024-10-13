import json
from app import db, celery
from models import User, TaskMapping, SyncLog, Conflict, TaskHistory
from zoho_oauth import refresh_zoho_token, get_zoho_client
from todoist_oauth import get_todoist_client
from flask import current_app
from datetime import datetime, timedelta
from notifications import notify_user_of_conflict, notify_user_of_sync_failure
from app.logger import log_error, log_info, log_warning

# ... (previous functions remain the same)

def create_task_history(user, task_mapping, action, details):
    history = TaskHistory(
        user_id=user.id,
        task_mapping_id=task_mapping.id,
        action=action,
        details=json.dumps(details)
    )
    db.session.add(history)
    db.session.commit()

def create_todoist_task(user, zoho_task):
    # ... (previous code remains the same)
    todoist_client = get_todoist_client(user)
    new_task = todoist_client.add_task(
        content=zoho_task['name'],
        description=zoho_task['description'],
        due_date=zoho_task['end_date']
    )
    task_mapping = TaskMapping(user_id=user.id, zoho_task_id=zoho_task['id'], todoist_task_id=new_task['id'])
    db.session.add(task_mapping)
    db.session.commit()
    
    create_task_history(user, task_mapping, 'created', {
        'zoho_task': zoho_task,
        'todoist_task': new_task
    })

def update_todoist_task(user, todoist_task_id, zoho_task):
    # ... (previous code remains the same)
    todoist_client = get_todoist_client(user)
    updated_task = todoist_client.update_task(
        task_id=todoist_task_id,
        content=zoho_task['name'],
        description=zoho_task['description'],
        due_date=zoho_task['end_date']
    )
    task_mapping = TaskMapping.query.filter_by(user_id=user.id, todoist_task_id=todoist_task_id).first()
    
    create_task_history(user, task_mapping, 'updated', {
        'zoho_task': zoho_task,
        'todoist_task': updated_task
    })

def delete_todoist_task(user, todoist_task_id):
    # ... (previous code remains the same)
    todoist_client = get_todoist_client(user)
    todoist_client.delete_task(task_id=todoist_task_id)
    task_mapping = TaskMapping.query.filter_by(user_id=user.id, todoist_task_id=todoist_task_id).first()
    
    create_task_history(user, task_mapping, 'deleted', {
        'todoist_task_id': todoist_task_id
    })
    
    db.session.delete(task_mapping)
    db.session.commit()

def create_zoho_task(user, todoist_task):
    # Implement the logic to create a task in Zoho Projects
    zoho_client = get_zoho_client(user)
    new_task = zoho_client.create_task(
        name=todoist_task['content'],
        description=todoist_task['description'],
        due_date=todoist_task['due']['date']
    )
    task_mapping = TaskMapping(user_id=user.id, zoho_task_id=new_task['id'], todoist_task_id=todoist_task['id'])
    db.session.add(task_mapping)
    db.session.commit()
    
    create_task_history(user, task_mapping, 'created', {
        'zoho_task': new_task,
        'todoist_task': todoist_task
    })

def update_zoho_task(user, zoho_task_id, todoist_task):
    # Implement the logic to update a task in Zoho Projects
    zoho_client = get_zoho_client(user)
    updated_task = zoho_client.update_task(
        task_id=zoho_task_id,
        name=todoist_task['content'],
        description=todoist_task['description'],
        due_date=todoist_task['due']['date']
    )
    task_mapping = TaskMapping.query.filter_by(user_id=user.id, zoho_task_id=zoho_task_id).first()
    
    create_task_history(user, task_mapping, 'updated', {
        'zoho_task': updated_task,
        'todoist_task': todoist_task
    })

def delete_zoho_task(user, zoho_task_id):
    # Implement the logic to delete a task in Zoho Projects
    zoho_client = get_zoho_client(user)
    zoho_client.delete_task(task_id=zoho_task_id)
    task_mapping = TaskMapping.query.filter_by(user_id=user.id, zoho_task_id=zoho_task_id).first()
    
    create_task_history(user, task_mapping, 'deleted', {
        'zoho_task_id': zoho_task_id
    })
    
    db.session.delete(task_mapping)
    db.session.commit()

def get_zoho_tasks(user):
    zoho_client = get_zoho_client(user)
    return zoho_client.get_tasks()

def get_todoist_tasks(user):
    todoist_client = get_todoist_client(user)
    return todoist_client.get_tasks()

@celery.task
def sync_tasks(user_id):
    user = User.query.get(user_id)
    if not user:
        log_error(f"User with id {user_id} not found")
        return

    try:
        # Refresh Zoho token if necessary
        refresh_zoho_token(user)

        # Sync Zoho tasks to Todoist
        zoho_tasks = get_zoho_tasks(user)
        for zoho_task in zoho_tasks:
            task_mapping = TaskMapping.query.filter_by(user_id=user.id, zoho_task_id=zoho_task['id']).first()
            if task_mapping:
                update_todoist_task(user, task_mapping.todoist_task_id, zoho_task)
            else:
                create_todoist_task(user, zoho_task)

        # Sync Todoist tasks to Zoho
        todoist_tasks = get_todoist_tasks(user)
        for todoist_task in todoist_tasks:
            task_mapping = TaskMapping.query.filter_by(user_id=user.id, todoist_task_id=todoist_task['id']).first()
            if task_mapping:
                update_zoho_task(user, task_mapping.zoho_task_id, todoist_task)
            else:
                create_zoho_task(user, todoist_task)

        # Log successful sync
        log_info(f"Sync completed successfully for user {user.id}")
        sync_log = SyncLog(user_id=user.id, status='success')
        db.session.add(sync_log)
        db.session.commit()

    except Exception as e:
        log_error(f"Sync failed for user {user.id}: {str(e)}")
        sync_log = SyncLog(user_id=user.id, status='failure', details=str(e))
        db.session.add(sync_log)
        db.session.commit()
        notify_user_of_sync_failure(user)

# ... (rest of the file remains the same)
