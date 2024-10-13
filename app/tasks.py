from celery import shared_task
from models import User, db
from blueprints.sync.synchronizer import sync_user_data
import time
from datetime import datetime, timedelta

@shared_task
def sync_all_users():
    users = User.query.all()
    for user in users:
        sync_user_data(user.id)

@shared_task
def sync_user(user_id):
    sync_user_data(user_id)

@shared_task
def test_task():
    time.sleep(5)  # Simulate some work being done
    return "Test task completed successfully"

@shared_task
def scheduled_sync():
    current_time = datetime.utcnow()
    users = User.query.filter(User.sync_schedule.isnot(None)).all()
    
    for user in users:
        schedule_time = datetime.strptime(user.sync_schedule, "%H:%M").time()
        user_last_synced = user.last_synced_at or datetime.min
        
        if (current_time.time() >= schedule_time and 
            (user_last_synced.date() < current_time.date() or 
             (user_last_synced.date() == current_time.date() and user_last_synced.time() < schedule_time))):
            
            sync_user.delay(user.id)
            user.last_synced_at = current_time
            db.session.commit()

@shared_task
def run_scheduled_sync():
    while True:
        scheduled_sync.delay()
        time.sleep(60)  # Check every minute

@shared_task
def bulk_sync_tasks(user_id, operation, items):
    user = User.query.get(user_id)
    if not user:
        return {"error": "User not found"}

    results = []
    for item in items:
        try:
            if operation == 'sync':
                result = sync_item(user, item)
            elif operation == 'edit':
                result = edit_item(user, item)
            elif operation == 'delete':
                result = delete_item(user, item)
            else:
                result = {"error": "Invalid operation"}
            results.append(result)
        except Exception as e:
            results.append({"error": str(e)})

    return results

def sync_item(user, item):
    # Implement the logic to sync a single item
    # This should use the existing sync logic from sync_user_data
    # but applied to a single item instead of all items
    pass

def edit_item(user, item):
    # Implement the logic to edit a single item
    # This should update the item in both Zoho and Todoist
    pass

def delete_item(user, item):
    # Implement the logic to delete a single item
    # This should delete the item from both Zoho and Todoist
    pass
