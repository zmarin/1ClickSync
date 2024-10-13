from celery import Celery
from celery.schedules import crontab
import os
import uuid
import socket
from flask import Flask

def make_celery(app):
    unique_id = uuid.uuid4().hex[:6]
    hostname = socket.gethostname()
    celery = Celery(
        f"{app.import_name}-{unique_id}",
        backend=app.config['result_backend'],
        broker=app.config['broker_url']
    )
    celery.conf.update(app.config)

    # Address the broker_connection_retry warning
    celery.conf.broker_connection_retry_on_startup = True
    celery.conf.worker_proc_alive_timeout = 60

    # Set a unique name for this Celery instance
    celery.conf.worker_pool_restarts = True
    celery.conf.worker_name = f"worker-{os.getpid()}-{unique_id}"

    # Ensure each worker has a unique name
    celery.conf.worker_hijack_root_logger = False
    celery.conf.worker_log_format = "[%(asctime)s: %(levelname)s/%(processName)s] %(message)s"
    celery.conf.worker_task_log_format = "[%(asctime)s: %(levelname)s/%(processName)s] [%(task_name)s(%(task_id)s)] %(message)s"

    # Set a unique node name to avoid the "already using this process mailbox" warning
    celery.conf.task_default_queue = f'celery-{unique_id}'
    celery.conf.task_default_exchange = f'celery-{unique_id}'
    celery.conf.task_default_routing_key = f'celery-{unique_id}'

    # Set a unique node name
    celery.conf.worker_state_db = f'/tmp/celery-{unique_id}-state'

    # Set a unique node name for Celery
    celery.conf.worker_direct = True
    celery.conf.worker_hostname = f"worker-{unique_id}@{hostname}"

    # Disable the default queue to avoid conflicts
    celery.conf.task_queues = None

    # Set broker_connection_retry_on_startup to True
    celery.conf.broker_connection_retry_on_startup = True

    class ContextTask(celery.Task):
        def __call__(self, *args, **kwargs):
            with app.app_context():
                return self.run(*args, **kwargs)

    celery.Task = ContextTask

    # Configure periodic tasks
    celery.conf.beat_schedule = {
        'sync-hourly': {
            'task': 'app.synchronizer.sync_for_frequency',
            'schedule': crontab(minute=0),  # Run every hour
            'args': ('hourly',)
        },
        'sync-daily': {
            'task': 'app.synchronizer.sync_for_frequency',
            'schedule': crontab(hour=0, minute=0),  # Run daily at midnight
            'args': ('daily',)
        },
        'sync-weekly': {
            'task': 'app.synchronizer.sync_for_frequency',
            'schedule': crontab(day_of_week=0, hour=0, minute=0),  # Run weekly on Sunday at midnight
            'args': ('weekly',)
        }
    }

    return celery

# Create a minimal Flask app for Celery
app = Flask(__name__)
app.config.update(
    result_backend='redis://localhost:6379/0',
    broker_url='redis://localhost:6379/0'
)

# Create the Celery app
celery = make_celery(app)
