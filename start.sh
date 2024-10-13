#!/bin/bash

# Activate the virtual environment
source ~/Projects/ZTsync_python/new_venv/bin/activate

# Upgrade pip and install/upgrade requirements
pip install --upgrade pip
pip install --upgrade -r requirements.txt

# Set environment variables
export FLASK_APP=app
export FLASK_ENV=development
export DATABASE_URL="postgresql://zmarin:your_password@localhost/1clicksync"

# Run database migrations
flask db upgrade

# Start Celery worker with unique nodename
celery -A app.celery_worker.celery worker --loglevel=info -n worker1@%h &

# Start Celery beat with unique nodename
celery -A app.celery_worker.celery beat --loglevel=info -n beat1@%h &

# Start Gunicorn
gunicorn -b 0.0.0.0:8085 "app:create_app()" --workers 3 --timeout 120 --access-logfile gunicorn_access.log --error-logfile gunicorn_error.log --log-level debug &

# Start LocalXpose tunnel (replace YOUR_TOKEN with your actual token)
loclx tunnel http --to localhost:8085 --token YOUR_TOKEN > tunnel_info.log 2>&1 &

echo "ZTsync application started successfully."
echo "Press Ctrl+C to stop the application."

# Wait for user interrupt
wait
