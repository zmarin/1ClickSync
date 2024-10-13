import logging
from logging.handlers import RotatingFileHandler
import os
from flask import has_request_context, request
from flask_login import current_user

class RequestFormatter(logging.Formatter):
    def format(self, record):
        if has_request_context():
            record.url = request.url
            record.remote_addr = request.remote_addr
            if current_user.is_authenticated:
                record.user = current_user.email
            else:
                record.user = 'Anonymous'
        else:
            record.url = None
            record.remote_addr = None
            record.user = None

        return super().format(record)

def setup_logger(app):
    if not os.path.exists('logs'):
        os.mkdir('logs')
    file_handler = RotatingFileHandler('logs/ztsync.log', maxBytes=10240, backupCount=10)
    file_handler.setFormatter(RequestFormatter(
        '%(asctime)s %(levelname)s: %(message)s '
        '[in %(pathname)s:%(lineno)d] - %(url)s - %(remote_addr)s - %(user)s'
    ))
    file_handler.setLevel(logging.INFO)
    app.logger.addHandler(file_handler)
    app.logger.setLevel(logging.INFO)

def log_error(error_type, error_message):
    logging.error(f"{error_type}: {error_message}")

def log_info(message):
    logging.info(message)

def log_warning(message):
    logging.warning(message)
