from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from models import db, User
import os
from dotenv import load_dotenv
from sqlalchemy import text, inspect

load_dotenv()

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('SQLALCHEMY_DATABASE_URI')
db.init_app(app)
migrate = Migrate(app, db)

def column_exists(conn, table_name, column_name):
    insp = inspect(conn)
    columns = insp.get_columns(table_name)
    return any(c["name"] == column_name for c in columns)

def upgrade():
    with app.app_context():
        with db.engine.connect() as conn:
            if column_exists(conn, 'user', 'password'):
                if not column_exists(conn, 'user', 'hashed_password'):
                    conn.execute(text('ALTER TABLE "user" RENAME COLUMN password TO hashed_password'))
                else:
                    conn.execute(text('ALTER TABLE "user" DROP COLUMN password'))
            
            if column_exists(conn, 'user', 'hashed_password'):
                conn.execute(text('ALTER TABLE "user" ALTER COLUMN hashed_password DROP NOT NULL'))
            else:
                conn.execute(text('ALTER TABLE "user" ADD COLUMN hashed_password VARCHAR(255)'))
            
            conn.execute(text('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS created_at TIMESTAMP'))
            conn.execute(text('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS zoho_token_expires_at TIMESTAMP'))
            conn.execute(text('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS zoho_portal_id VARCHAR(255)'))
            conn.execute(text('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS zoho_api_domain VARCHAR(255)'))
            conn.execute(text('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS todoist_api_token VARCHAR(255)'))
            conn.execute(text('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP'))
            conn.commit()

def downgrade():
    with app.app_context():
        with db.engine.connect() as conn:
            if column_exists(conn, 'user', 'hashed_password'):
                conn.execute(text('ALTER TABLE "user" RENAME COLUMN hashed_password TO password'))
                conn.execute(text('ALTER TABLE "user" ALTER COLUMN password SET NOT NULL'))
            
            conn.execute(text('ALTER TABLE "user" DROP COLUMN IF EXISTS created_at'))
            conn.execute(text('ALTER TABLE "user" DROP COLUMN IF EXISTS zoho_token_expires_at'))
            conn.execute(text('ALTER TABLE "user" DROP COLUMN IF EXISTS zoho_portal_id'))
            conn.execute(text('ALTER TABLE "user" DROP COLUMN IF EXISTS zoho_api_domain'))
            conn.execute(text('ALTER TABLE "user" DROP COLUMN IF EXISTS todoist_api_token'))
            conn.execute(text('ALTER TABLE "user" DROP COLUMN IF EXISTS last_synced_at'))
            conn.commit()

if __name__ == '__main__':
    with app.app_context():
        upgrade()
        print("Migration completed successfully.")