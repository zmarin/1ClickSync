from app import app, db
from models import User
from sqlalchemy.exc import SQLAlchemyError, IntegrityError
from werkzeug.security import generate_password_hash

with app.app_context():
    for key, value in app.config.items():
        print(f"{key}: {value}")
    
    print("\nTesting database connection:")
    try:
        db.engine.connect()
        print("Successfully connected to the database.")
        
        # Test querying users
        users = User.query.all()
        print(f"Number of users in the database: {len(users)}")
        for user in users:
            print(f"User: {user.name}, Email: {user.email}")
        
        # Test creating a user
        hashed_password = generate_password_hash('test_password')
        new_user = User(name='Test User 2', email='testuser2@example.com', hashed_password=hashed_password)
        try:
            db.session.add(new_user)
            db.session.commit()
            print("Successfully created a new user.")
        except IntegrityError:
            db.session.rollback()
            print("User with this email already exists.")
        
        # Verify the users in the database
        users = User.query.all()
        print(f"Updated number of users in the database: {len(users)}")
        for user in users:
            print(f"User: {user.name}, Email: {user.email}")
    except SQLAlchemyError as e:
        print(f"Error with database operations: {str(e)}")
