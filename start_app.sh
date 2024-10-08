#!/bin/bash

# Activate virtual environment
source venv/bin/activate

# Start the Flask application in the background
nohup python app.py > flask.log 2>&1 &

# Save the process ID
echo $! > flask_app.pid

echo "Flask application started in the background. PID saved in flask_app.pid"