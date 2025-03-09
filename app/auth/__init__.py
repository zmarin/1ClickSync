from flask import Blueprint

bp = Blueprint('auth', __name__)
auth = bp  # Export auth for compatibility with existing code

from app.auth import supabase_routes
