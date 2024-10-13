from celery import Celery
from celery.schedules import crontab

def make_celery(app):
    celery = Celery(
        app.import_name,
        backend=app.config['result_backend'],
        broker=app.config['broker_url']
    )
    celery.conf.update(app.config)

    class ContextTask(celery.Task):
        def __call__(self, *args, **kwargs):
            with app.app_context():
                return self.run(*args, **kwargs)

    celery.Task = ContextTask

    # Add periodic tasks
    celery.conf.beat_schedule = {
        'run-scheduled-sync': {
            'task': 'tasks.run_scheduled_sync',
            'schedule': crontab(minute='*'),  # Run every minute
        },
    }

    return celery
