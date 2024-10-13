from datetime import datetime
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from app import db

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    confirmed = db.Column(db.Boolean, default=False)
    subscription_plan = db.Column(db.String(50))
    zoho_portal_id = db.Column(db.String(50))
    sync_settings = db.Column(db.JSON)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

    oauth_tokens = db.relationship('OAuthToken', backref='user', lazy='dynamic')
    subscription = db.relationship('Subscription', backref='user', uselist=False)

    @property
    def onboarding_completed(self):
        return (self.confirmed and
                self.oauth_tokens.filter_by(service='zoho').first() is not None and
                self.oauth_tokens.filter_by(service='todoist').first() is not None and
                self.zoho_portal_id is not None and
                self.sync_settings is not None)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class OAuthToken(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    service = db.Column(db.String(20))  # 'zoho' or 'todoist'
    access_token = db.Column(db.String(256))
    refresh_token = db.Column(db.String(256))
    expires_in = db.Column(db.Integer)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

class Subscription(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    plan = db.Column(db.String(50))
    status = db.Column(db.String(20))  # 'active', 'canceled', etc.
    stripe_subscription_id = db.Column(db.String(100))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)
