# ZTsync Python

ZTsync Python is a synchronization tool that integrates Zoho Projects with Todoist.

## Requirements

- Python 3.7+
- PostgreSQL
- Redis

## Setup

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/ZTsync_python.git
   cd ZTsync_python
   ```

2. Create a virtual environment and activate it:
   ```
   python3 -m venv venv
   source venv/bin/activate
   ```

3. Install the required packages:
   ```
   pip install -r requirements.txt
   ```

4. Set up PostgreSQL:
   - Create a new database:
     ```
     sudo -u postgres createdb ztsync_python
     ```

5. Set up environment variables:
   Create a `.env` file in the project root and add the following variables:
   ```
   SECRET_KEY=your_secret_key
   SQLALCHEMY_DATABASE_URI=postgresql://postgres:your_password@localhost/ztsync_python
   REDIS_BROKER_URL=redis://localhost:6379/0
   REDIS_RESULT_BACKEND=redis://localhost:6379/0
   ZOHO_CLIENT_ID=your_zoho_client_id
   ZOHO_CLIENT_SECRET=your_zoho_client_secret
   TODOIST_CLIENT_ID=your_todoist_client_id
   TODOIST_CLIENT_SECRET=your_todoist_client_secret
   ```
   Replace `your_password` with your actual PostgreSQL password.

6. Set up database migrations:
   ```
   flask db init
   flask db migrate -m "Initial migration"
   flask db upgrade
   ```

## Running the Application

1. Make sure your virtual environment is activated:
   ```
   source venv/bin/activate
   ```

2. Start the Flask development server:
   ```
   ./run_flask_debug.sh
   ```
   This will start the Flask application in debug mode.

3. For production deployment, use:
   ```
   ./start_app.sh
   ```

4. Start Celery worker for background tasks:
   ```
   celery -A app.celery worker --loglevel=info
   ```

5. (Optional) Start Celery beat for scheduled tasks:
   ```
   celery -A app.celery beat --loglevel=info
   ```

## Features

- Two-way synchronization between Zoho Projects and Todoist
- User authentication and authorization
- Project and task mapping between the two platforms
- Celery-based background task processing

## Contributing

Please read CONTRIBUTING.md for details on our code of conduct, and the process for submitting pull requests to us.

## License

This project is licensed under the MIT License - see the LICENSE.md file for details.