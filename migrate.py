# migrate.py
from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
import os

# Import your application's configuration and models
from app import app, db

# Setup Flask-Migrate
migrate = Migrate(app, db)

# No need for Flask-Script anymore

if __name__ == '__main__':
    # Use Flask CLI instead of Flask-Script
    app.cli()
