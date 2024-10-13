from flask import render_template
from app import db
from app.logger import log_error

def register_error_handlers(app):
    @app.errorhandler(404)
    def not_found_error(error):
        log_error('404 Error', str(error))
        return render_template('errors/404.html'), 404

    @app.errorhandler(500)
    def internal_error(error):
        db.session.rollback()
        log_error('500 Error', str(error))
        return render_template('errors/500.html'), 500

    @app.errorhandler(Exception)
    def unhandled_exception(e):
        db.session.rollback()
        log_error('Unhandled Exception', str(e))
        return render_template('errors/500.html'), 500
