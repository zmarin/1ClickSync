#!/bin/bash

# Activate virtual environment
source venv/bin/activate

# Export Flask environment variables
export FLASK_APP=app.py
export FLASK_ENV=development
export FLASK_DEBUG=1

# Start Flask application in the background
flask run --debug --port 8085 &
FLASK_PID=$!

# Wait for Flask to start
sleep 5

# Start LocalXpose tunnel
./loclx tunnel http --reserved-domain www.z2sync.com --to localhost:8085

# When the tunnel is stopped, also stop the Flask application
kill $FLASK_PID