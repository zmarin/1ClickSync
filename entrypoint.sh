#!/bin/bash
set -e

# Activate virtual environment if you're using one
# source /path/to/your/venv/bin/activate

# Run database migrations (if using a database)
python manage.py migrate

# Collect static files (if needed)
python manage.py collectstatic --noinput

# Start the Django development server
python manage.py runserver 0.0.0.0:8000