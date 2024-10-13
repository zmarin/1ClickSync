import sys
from app import create_app
from models import Role, db
from sqlalchemy.exc import SQLAlchemyError

app = create_app()

try:
    with app.app_context():
        db.engine.execute("""
            CREATE TABLE IF NOT EXISTS role (
                id SERIAL PRIMARY KEY,
                name VARCHAR(64) UNIQUE NOT NULL
            )
        """)
        print("Role table created successfully")

        roles = ['user', 'premium', 'admin']
        for role_name in roles:
            role = Role.query.filter_by(name=role_name).first()
            if not role:
                role = Role(name=role_name)
                db.session.add(role)
                print(f"Added role: {role_name}")
            else:
                print(f"Role already exists: {role_name}")
        db.session.commit()
        print("Roles created successfully")
        all_roles = Role.query.all()
        print("All roles:", [role.name for role in all_roles])
except SQLAlchemyError as e:
    print(f"An error occurred: {e}", file=sys.stderr)
    db.session.rollback()
except Exception as e:
    print(f"An unexpected error occurred: {e}", file=sys.stderr)
