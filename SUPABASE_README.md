# 1ClickSync with Supabase

This is a version of 1ClickSync that uses Supabase as the database backend instead of PostgreSQL with SQLAlchemy.

## Setup

1. Create and activate a virtual environment (recommended):
   ```
   # Windows
   python -m venv venv
   venv\Scripts\activate

   # macOS/Linux
   python -m venv venv
   source venv/bin/activate
   ```

2. Install the Supabase Python client and email validator:
   ```
   pip install supabase email-validator
   ```

3. Install the required dependencies:
   ```
   pip install -r requirements.txt
   ```

4. Set up your environment variables in the `.env` file. Make sure you have the following Supabase variables set:
   ```
   SUPABASE_URL=your_supabase_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_KEY=your_supabase_service_key
   ```

5. Run the setup script to check dependencies, fetch existing tables, and generate SQL scripts for missing tables:
   ```
   python setup_supabase_app.py
   ```

6. Create the required tables in the Supabase SQL Editor:
   
   The application requires several tables to be created in Supabase. We've provided SQL scripts to create these tables:
   
   - `create_all_tables.sql`: Contains SQL to create all required tables with proper permissions
   
   To create the tables:
   1. Open the Supabase dashboard (https://app.supabase.com/)
   2. Navigate to your project
   3. Go to the SQL Editor
   4. Copy the contents of `create_all_tables.sql` into the editor
   5. Run the SQL script
   
   Alternatively, if the setup script identified missing tables, it will generate a `create_missing_tables.sql` file with the necessary SQL scripts. You can run this script instead if you only need to create the missing tables.

7.  Configure Email Settings in Supabase:
    *   Go to Authentication > Email in the Supabase dashboard.
    *   Enable the Email provider and Confirm email options.
    *   Customize the email templates to match your application branding.
    *   Set up a custom SMTP server for production:
        *   Choose an SMTP provider (SendGrid, Mailgun, etc.).
        *   Create an account and verify your domain.
        *   Obtain the SMTP credentials (host, port, username, password).
        *   Enter the SMTP credentials in the Supabase dashboard under Authentication > Email > SMTP Settings.

8.  Set the `NODE_ENV` environment variable to `production` in your Coolify deployment settings.

9.  Run the application:
   ```
   python start_supabase_app.py
   ```

## Troubleshooting

If you encounter the error "No module named 'supabase'", make sure you have installed the Supabase Python client:

```
pip install supabase
```

If you're using a virtual environment, make sure it's activated before running any commands.

If you're still having issues, try installing the Supabase client with a specific version:

```
pip install supabase==2.13.0
```

## Project Structure

- `app/supabase_db.py`: Initializes the Supabase client
- `app/supabase_models.py`: Contains functions to interact with Supabase tables
- `app/supabase_init.py`: Initializes the Flask application with Supabase
- `app/auth/supabase_routes.py`: Authentication routes using Supabase Auth
- `app/email_confirmation.py`: Functions for sending and resending confirmation emails
- `app/supabase_synchronizer.py`: Synchronization logic using Supabase
- `app/supabase_app.py`: Main application file
- `start_supabase_app.py`: Script to run the application
- `setup_supabase_app.py`: Script to set up Supabase tables and fetch existing tables
- `EXISTING_TABLES.md`: Documentation of the existing tables in Supabase
- `SUPABASE_TABLES.md`: Documentation of the Supabase tables structure

## Database Structure

The Supabase database structure is documented in [SUPABASE_TABLES.md](SUPABASE_TABLES.md). This file contains detailed information about each table, including column names, data types, and descriptions.

## Differences from SQLAlchemy Version

The Supabase version of 1ClickSync differs from the SQLAlchemy version in the following ways:

1. **Authentication**: Uses Supabase Auth instead of Flask-Login with SQLAlchemy models
   - Email confirmation is handled by Supabase Auth
   - Users can resend confirmation emails if needed
2. **Database Access**: Uses Supabase client instead of SQLAlchemy ORM
3. **Data Models**: Uses Supabase tables instead of SQLAlchemy models
4. **Migrations**: No need for Alembic migrations, as Supabase handles schema changes

## API Endpoints

The API endpoints include:

- `/`: Home page
- `/dashboard`: User dashboard
- `/auth/register`: User registration
- `/auth/login`: User login
- `/auth/logout`: User logout
- `/auth/confirm_email/<token>`: Confirm user email with token
- `/auth/resend_confirmation`: Resend confirmation email
- `/sync/manual`: Trigger manual synchronization
- `/sync/status`: Get synchronization status
- `/sync/history`: View synchronization history

## OAuth Integration

The OAuth integration with Zoho and Todoist remains the same, but the token storage is now handled by Supabase.
