from flask import Blueprint
from .routes import main

main_bp = Blueprint('main', __name__)

# Register the main routes
main_bp.register_blueprint(main)
