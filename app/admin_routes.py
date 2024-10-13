from flask import Blueprint, redirect, render_template, url_for
from flask_login import login_required, current_user
from models import User, Analytics, db

admin_bp = Blueprint('admin', __name__)

@admin_bp.route('/dashboard')
@login_required
def admin_dashboard():
    if not current_user.is_admin:
        return redirect(url_for('main.index'))

    total_users = User.query.count()
    active_users = User.query.filter_by(subscription_status='active').count()
    mrr = calculate_mrr()
    sync_operations = Analytics.query.filter_by(metric_name='sync_operations').first().metric_value

    return render_template('admin/dashboard.html', 
                           total_users=total_users, 
                           active_users=active_users, 
                           mrr=mrr, 
                           sync_operations=sync_operations)

def calculate_mrr():
    # Implementation to calculate Monthly Recurring Revenue
    pass