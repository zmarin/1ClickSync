from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from sqlalchemy import DateTime
from datetime import datetime

db = SQLAlchemy()

class User(db.Model, UserMixin):
    __tablename__ = 'user'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String, nullable=False)
    email = db.Column(db.String, unique=True, nullable=False)
    hashed_password = db.Column(db.String, nullable=False)
    created_at = db.Column(DateTime, default=datetime.utcnow)
    zoho_access_token = db.Column(db.String)
    zoho_refresh_token = db.Column(db.String)
    zoho_token_expires_at = db.Column(DateTime)
    zoho_portal_id = db.Column(db.String)
    zoho_api_domain = db.Column(db.String)
    todoist_access_token = db.Column(db.String)
    last_synced_at = db.Column(DateTime)

class ProjectMapping(db.Model):
    __tablename__ = 'project_mapping'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    zoho_project_id = db.Column(db.String, nullable=False)
    todoist_project_id = db.Column(db.String, nullable=False)
    created_at = db.Column(DateTime, default=datetime.utcnow)
    last_updated = db.Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class TaskMapping(db.Model):
    __tablename__ = 'task_mapping'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    zoho_task_id = db.Column(db.String, nullable=False)
    todoist_task_id = db.Column(db.String, nullable=False)
    zoho_parent_task_id = db.Column(db.String)
    todoist_parent_id = db.Column(db.String)
    created_at = db.Column(DateTime, default=datetime.utcnow)
    last_updated = db.Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class CommentMapping(db.Model):
    __tablename__ = 'comment_mapping'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    zoho_comment_id = db.Column(db.String, nullable=False)
    todoist_comment_id = db.Column(db.String, nullable=False)
    task_mapping_id = db.Column(db.Integer, db.ForeignKey('task_mapping.id'), nullable=False)
    created_at = db.Column(DateTime, default=datetime.utcnow)
    last_updated = db.Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class StatusMapping(db.Model):
    __tablename__ = 'status_mapping'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    zoho_status = db.Column(db.String, nullable=False)
    todoist_section = db.Column(db.String, nullable=False)
    created_at = db.Column(DateTime, default=datetime.utcnow)
    last_updated = db.Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
