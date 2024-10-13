from flask import Blueprint, render_template, redirect, url_for, flash, request, jsonify
from flask_login import login_required, current_user
from app import db
from synchronizer import sync_tasks, update_zoho_task, update_todoist_task, delete_zoho_task, delete_todoist_task
from models import User, SyncLog, Conflict, TaskMapping, FeatureFlag, Role, TaskHistory
from app.feature_flags import is_feature_enabled
from app.decorators import admin_required, premium_required

main = Blueprint('main', __name__)

# ... (previous routes remain the same)

@main.route('/task/<int:mapping_id>/history')
@login_required
def task_history(mapping_id):
    task_mapping = TaskMapping.query.get_or_404(mapping_id)
    if task_mapping.user_id != current_user.id:
        flash('You do not have permission to view this task history.', 'error')
        return redirect(url_for('main.tasks'))
    
    history = TaskHistory.query.filter_by(task_mapping_id=mapping_id).order_by(TaskHistory.timestamp.desc()).all()
    return render_template('task_history.html', task_mapping=task_mapping, history=history)

# ... (rest of the file remains the same)
