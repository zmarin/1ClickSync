from flask import render_template
from app import mail
from flask_mail import Message

def notify_user_of_conflict(user, conflict):
    subject = "Task Conflict Detected"
    sender = "noreply@yourdomain.com"
    recipients = [user.email]
    
    html_body = render_template(
        'email/conflict_notification.html',
        user=user,
        conflict=conflict
    )
    
    msg = Message(subject=subject, sender=sender, recipients=recipients, html=html_body)
    mail.send(msg)

def notify_user_of_sync_failure(user):
    subject = "Sync Failure"
    sender = "noreply@yourdomain.com"
    recipients = [user.email]
    
    html_body = render_template(
        'email/sync_failure_notification.html',
        user=user
    )
    
    msg = Message(subject=subject, sender=sender, recipients=recipients, html=html_body)
    mail.send(msg)
