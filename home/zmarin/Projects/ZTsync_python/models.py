from ZTsync_python.extensions import db
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import UserMixin

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    confirmed = db.Column(db.Boolean, default=False)
    subscription_plan = db.Column(db.String(50))

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class OAuthToken(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    service = db.Column(db.String(20))
    access_token = db.Column(db.String(256))
    refresh_token = db.Column(db.String(256))
    expires_in = db.Column(db.Integer)

class ProjectMapping(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    zoho_project_id = db.Column(db.String(50))
    todoist_project_id = db.Column(db.String(50))

class TaskMapping(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    zoho_task_id = db.Column(db.String(50))
    todoist_task_id = db.Column(db.String(50))
    parent_task_id = db.Column(db.Integer, db.ForeignKey('task_mapping.id'))

class Subscription(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    plan = db.Column(db.String(50))
    status = db.Column(db.String(20))
    stripe_subscription_id = db.Column(db.String(100))
