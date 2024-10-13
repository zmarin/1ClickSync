from app import create_app, db
from models import User, TaskMapping, TaskHistory, Role, SyncLog, Conflict, FeatureFlag
from sqlalchemy import inspect, Table, Column, Integer, String, Boolean, DateTime, ForeignKey
import traceback

app = create_app()

with app.app_context():
    print(f"Database URI: {app.config['SQLALCHEMY_DATABASE_URI']}")
    
    print("Models to be created:")
    for model in [User, TaskMapping, TaskHistory, Role, SyncLog, Conflict, FeatureFlag]:
        print(f"- {model.__name__}")
    
    try:
        # Drop existing tables
        db.drop_all()
        print("Existing tables dropped")

        # Manually create tables
        user_table = Table('user', db.metadata,
            Column('id', Integer, primary_key=True),
            Column('username', String(64), unique=True, nullable=False),
            Column('email', String(120), unique=True, nullable=False),
            Column('password_hash', String(128)),
            Column('zoho_access_token', String(255)),
            Column('zoho_refresh_token', String(255)),
            Column('todoist_access_token', String(255)),
            Column('onboarding_completed', Boolean, default=False),
            Column('todoist_project_id', String(255))
        )

        role_table = Table('role', db.metadata,
            Column('id', Integer, primary_key=True),
            Column('name', String(64), unique=True)
        )

        user_table.create(db.engine, checkfirst=True)
        role_table.create(db.engine, checkfirst=True)
        
        # Create other tables using SQLAlchemy's create_all
        db.create_all()
        
        print("Tables created successfully")
    except Exception as e:
        print(f"Error creating tables: {str(e)}")
        print("Traceback:")
        traceback.print_exc()

    inspector = inspect(db.engine)
    print("Existing tables:", inspector.get_table_names())

    for table_name in inspector.get_table_names():
        print(f"\nColumns in {table_name}:")
        for column in inspector.get_columns(table_name):
            print(f"- {column['name']}: {column['type']}")

    # Try to create a test user
    try:
        test_user = User(username="test_user", email="test@example.com", password_hash="test_hash")
        db.session.add(test_user)
        db.session.commit()
        print("Test user created successfully")
    except Exception as e:
        print(f"Error creating test user: {str(e)}")
        print("Traceback:")
        traceback.print_exc()
