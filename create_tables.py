from app.models import User, OAuthToken, Subscription
from app import create_app, db

app = create_app()

def create_tables():
    with app.app_context():
        db.create_all()

if __name__ == '__main__':
    create_tables()
