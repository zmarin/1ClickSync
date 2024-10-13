from flask_socketio import emit
from app import socketio, db
from flask_login import current_user
from synchronizer import sync_tasks
from models import Conflict, SyncLog

@socketio.on('connect')
def handle_connect():
    if current_user.is_authenticated:
        emit('connection_response', {'data': 'Connected'})

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

@socketio.on('start_sync')
def handle_start_sync():
    emit('sync_status', {'status': 'Sync started'})
    
    # Start the synchronization process
    result = sync_tasks(current_user.id)
    
    # Emit progress updates
    emit('sync_status', {'status': 'Fetching tasks'})
    socketio.sleep(1)
    emit('sync_status', {'status': 'Comparing tasks'})
    socketio.sleep(1)
    emit('sync_status', {'status': 'Updating tasks'})
    socketio.sleep(1)
    
    # Check for conflicts
    conflicts = Conflict.query.filter_by(user_id=current_user.id, resolved=False).count()
    if conflicts > 0:
        emit('sync_status', {'status': f'Sync completed with {conflicts} conflicts'})
        emit('new_conflicts', {'count': conflicts})
    else:
        emit('sync_status', {'status': 'Sync completed successfully'})
    
    # Log the sync
    sync_log = SyncLog(user_id=current_user.id, synced_count=result.get('synced', 0), conflict_count=conflicts)
    db.session.add(sync_log)
    db.session.commit()

@socketio.on('get_sync_history')
def handle_get_sync_history():
    sync_logs = SyncLog.query.filter_by(user_id=current_user.id).order_by(SyncLog.timestamp.desc()).limit(5).all()
    history = [{'timestamp': log.timestamp.isoformat(), 'synced': log.synced_count, 'conflicts': log.conflict_count} for log in sync_logs]
    emit('sync_history', {'history': history})
