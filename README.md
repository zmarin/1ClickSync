# ZTsync

ZTsync is a web application that synchronizes tasks between Zoho Projects and Todoist.

## Features

- User registration and authentication
- Task synchronization between Zoho Projects and Todoist
- Dashboard for managing synced tasks
- Conflict resolution for task updates

## Project Structure

The application is now organized in a more modular structure without using Flask blueprints:

### Main Application (app/__init__.py)
- Creates and configures the Flask application
- Defines basic routes (index, pricing)
- Initializes extensions (SQLAlchemy, Flask-Migrate, Flask-Login)

### Authentication (app/auth.py)
- login: User login
- logout: User logout
- register: New user registration
- reset_password_request: Request password reset
- reset_password: Reset password with token

### Models (app/models.py)
- Defines database models (User, TaskMapping, TaskHistory, etc.)

### Forms (app/forms.py)
- Defines forms used in the application (LoginForm, RegistrationForm, etc.)

### User Management (to be implemented)
- onboarding: User onboarding process
- dashboard: User dashboard
- profile: User profile management
- settings: User settings
- task_history: History of task changes

### Sync Management (to be implemented)
- zoho_auth, zoho_callback: Zoho OAuth flow
- fetch_zoho_portals, select_zoho_portal, detach_zoho_portal: Zoho portal management
- todoist_auth, todoist_callback: Todoist OAuth flow
- revoke_zoho_authorization, revoke_todoist_authorization: Revoke OAuth access
- trigger_sync: Initiate synchronization process
- sync_history: View synchronization history

## Template Structure

Templates are organized in the templates directory:

- templates/: All templates (home, pricing, login, register, dashboard, etc.)

## Setup

1. Clone the repository
2. Install dependencies: `pip install -r requirements.txt`
3. Set up environment variables in `.env` file
4. Initialize the database: `flask db upgrade`

## Starting the Application

To start the ZTsync application, use the following command:

```
./start-app.sh
```

This script will:
1. Run database migrations
2. Start Redis
3. Start Celery worker and beat
4. Start LocalXpose tunnel
5. Start Gunicorn server

Make sure you have all the necessary components (Redis, LocalXpose) installed and configured before running the script.

## User Registration and Login

1. Navigate to the `/register` route to create a new account
2. Fill out the registration form with your name, email, and password
3. Submit the form to create your account
4. You will be redirected to the login page
5. Enter your email and password on the login page to access your account

## Development

- The application uses Flask as the web framework
- SQLAlchemy is used for database operations
- Alembic is used for database migrations
- Celery with Redis is used for background tasks and scheduling
- LocalXpose is used for exposing the local development server
- Tailwind CSS is used for styling the frontend

To make changes to the database schema:

1. Update the models in `app/models.py`
2. Generate a new migration: `flask db migrate -m "Description of changes"`
3. Apply the migration: `flask db upgrade`

## Testing

To run tests: `pytest`

## Contributing

Please read CONTRIBUTING.md for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the LICENSE.md file for details.
