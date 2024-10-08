import sys
import os
import logging
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, render_template, redirect, url_for, flash, request, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from celery import Celery
import requests
from dotenv import load_dotenv
from flask_wtf.csrf import CSRFProtect
from urllib.parse import urlencode
from forms import LoginForm, RegisterForm
from models import db, User, ProjectMapping, TaskMapping, CommentMapping, StatusMapping
import uuid
from flask_cors import CORS
from flask_migrate import Migrate
from marketing import get_marketing_content

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

logger.debug(f"Current working directory: {os.getcwd()}")
logger.debug(f"Contents of current directory: {os.listdir('.')}")
logger.debug(f"Python path: {sys.path}")

logger.debug("Attempting to import Zoho OAuth functions")
try:
    from zoho_oauth import initiate_zoho_auth, handle_zoho_callback, revoke_zoho_auth, get_zoho_portals, populate_zoho_portals, refresh_zoho_token, is_token_expired
    logger.debug("Successfully imported Zoho OAuth functions")
    logger.debug(f"Imported functions: initiate_zoho_auth={initiate_zoho_auth}, handle_zoho_callback={handle_zoho_callback}, revoke_zoho_auth={revoke_zoho_auth}, get_zoho_portals={get_zoho_portals}, populate_zoho_portals={populate_zoho_portals}")
except ImportError as e:
    logger.error(f"Failed to import Zoho OAuth functions: {str(e)}")
    logger.error(f"zoho_oauth.py contents: {open('zoho_oauth.py', 'r').read()}")
    raise

logger.debug("Attempting to import Todoist OAuth functions")
try:
    from todoist_oauth import initiate_todoist_auth, handle_todoist_callback, revoke_todoist_auth
    logger.debug("Successfully imported Todoist OAuth functions")
    logger.debug(f"Imported functions: initiate_todoist_auth={initiate_todoist_auth}, handle_todoist_callback={handle_todoist_callback}, revoke_todoist_auth={revoke_todoist_auth}")
except ImportError as e:
    logger.error(f"Failed to import Todoist OAuth functions: {str(e)}")
    logger.error(f"todoist_oauth.py contents: {open('todoist_oauth.py', 'r').read()}")
    raise

load_dotenv()

app = Flask(__name__)
app.config['DEBUG'] = True  # Enable debug mode
CORS(app)
app.config.from_mapping(
    SECRET_KEY=os.getenv('SECRET_KEY'),
    SQLALCHEMY_DATABASE_URI=os.getenv('SQLALCHEMY_DATABASE_URI'),
    CELERY_BROKER_URL=os.getenv('REDIS_BROKER_URL'),
    CELERY_RESULT_BACKEND=os.getenv('REDIS_RESULT_BACKEND'),
    ZOHO_CLIENT_ID=os.getenv('ZOHO_CLIENT_ID'),
    ZOHO_CLIENT_SECRET=os.getenv('ZOHO_CLIENT_SECRET'),
    ZOHO_REDIRECT_URI=os.getenv('ZOHO_REDIRECT_URI'),
    TODOIST_CLIENT_ID=os.getenv('TODOIST_CLIENT_ID'),
    TODOIST_CLIENT_SECRET=os.getenv('TODOIST_CLIENT_SECRET'),
    TODOIST_REDIRECT_URI=os.getenv('TODOIST_REDIRECT_URI'),
    WTF_CSRF_TIME_LIMIT=3600 * 24,
    SESSION_PERMANENT=True
)

csrf = CSRFProtect(app)
db.init_app(app)
migrate = Migrate(app, db)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

def init_db():
    with app.app_context():
        db.create_all()
        logger.info("Database tables created.")

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

def make_celery(app):
    celery = Celery(app.import_name, broker=app.config['CELERY_BROKER_URL'], backend=app.config['CELERY_RESULT_BACKEND'])
    class ContextTask(celery.Task):
        def __call__(self, *args, **kwargs):
            with app.app_context():
                return self.run(*args, **kwargs)
    celery.Task = ContextTask
    return celery

celery = make_celery(app)

@app.context_processor
def inject_zoho_form():
    zoho_form_html = '''
    <div id="zf_div_QLNs-m9FnAlYgJ1N919ozMdtX2bqBPz03YRiLCT63kw"></div>
    <script type="text/javascript">
    (function() {
        try {
            var f = document.createElement("iframe");
            f.src = 'https://forms.zohopublic.com/zmcore/form/z2syncinterested/formperma/QLNs-m9FnAlYgJ1N919ozMdtX2bqBPz03YRiLCT63kw';
            f.style.border = "none";
            f.style.height = "925px";
            f.style.width = "100%";
            f.style.transition = "all 0.5s ease";
            f.style.backgroundColor = "transparent";
            f.style.borderRadius = "8px";
            f.style.boxShadow = "0 4px 6px rgba(0, 0, 0, 0.1)";
            var d = document.getElementById("zf_div_QLNs-m9FnAlYgJ1N919ozMdtX2bqBPz03YRiLCT63kw");
            d.appendChild(f);
        } catch(e) {}
    })();
    </script>
    '''
    return dict(zoho_form_html=zoho_form_html)

@app.route('/')
def home():
    logger.info('Home page accessed')
    zoho_apps = [
        {"name": "Zoho One", "description": "All-in-one suite of business applications", "affiliate_link": "https://go.zoho.com/wDt"},
        {"name": "Zoho CRM", "description": "Customer Relationship Management software", "affiliate_link": "https://go.zoho.com/FI9"},
        {"name": "Zoho Marketing Automation", "description": "Automate your marketing efforts", "affiliate_link": "https://go.zoho.com/5Iy"},
        {"name": "Zoho Campaigns", "description": "Email marketing campaigns made easy", "affiliate_link": "https://go.zoho.com/oUc"},
        {"name": "Zoho Payroll", "description": "Streamline your payroll process", "affiliate_link": "https://go.zoho.com/cVx"},
        {"name": "Zoho Recruit", "description": "Applicant Tracking System", "affiliate_link": "https://go.zoho.com/QbF"},
        {"name": "Zoho CRM Plus", "description": "Unified customer experience platform", "affiliate_link": "https://go.zoho.com/MGh"},
        {"name": "Zoho Bookings", "description": "Online Scheduling Software", "affiliate_link": "https://go.zoho.com/hrp"},
        {"name": "Zoho WorkDrive", "description": "Team File Collaboration Platform", "affiliate_link": "https://go.zoho.com/vdp"},
        {"name": "Zoho Inventory", "description": "Order management software", "affiliate_link": "https://go.zoho.com/KjL"},
        {"name": "Zoho Marketing Plus", "description": "Unified marketing platform", "affiliate_link": "https://go.zoho.com/GrS"},
        {"name": "Zoho Commerce", "description": "E-commerce platform", "affiliate_link": "https://go.zoho.com/Uhf"},
        {"name": "Zoho SalesIQ", "description": "Live chat and website tracking", "affiliate_link": "https://go.zoho.com/Hzw"},
        {"name": "Zoho Books", "description": "Online accounting software", "affiliate_link": "https://go.zoho.com/YzS"},
        {"name": "Zoho Analytics", "description": "Self-service BI and analytics platform", "affiliate_link": "https://go.zoho.com/BgH"},
        {"name": "Zoho Forms", "description": "Online form builder", "affiliate_link": "https://go.zoho.com/ej1"},
        {"name": "Zoho Sign", "description": "Digital signature app", "affiliate_link": "https://go.zoho.com/uOc"},
    ]
    return render_template('home.html', zoho_apps=zoho_apps)

@app.route('/logout')
@login_required
def logout():
    logger.info(f'User {current_user.id} logged out')
    logout_user()
    flash('You have been logged out.', 'info')
    return redirect(url_for('home'))

@app.route('/register', methods=['GET', 'POST'])
def register():
    form = RegisterForm()
    if form.validate_on_submit():
        existing_user = User.query.filter_by(email=form.email.data).first()
        if existing_user:
            logger.warning(f'Registration attempt with existing email: {form.email.data}')
            flash('Email already exists. Please login or use a different email.', 'danger')
            return redirect(url_for('register'))
        hashed_password = generate_password_hash(form.password.data, method='pbkdf2:sha256')
        new_user = User(name=form.name.data, email=form.email.data, hashed_password=hashed_password)
        db.session.add(new_user)
        db.session.commit()
        logger.info(f'New user registered: {new_user.id}')
        flash('Your account has been created! Please log in.', 'success')
        return redirect(url_for('login'))
    return render_template('register.html', form=form)

@app.route('/login', methods=['GET', 'POST'])
def login():
    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(email=form.email.data).first()
        if user and check_password_hash(user.hashed_password, form.password.data):
            login_user(user)
            logger.info(f'User {user.id} logged in')
            return redirect(url_for('dashboard'))
        else:
            logger.warning(f'Failed login attempt for email: {form.email.data}')
            flash('Login Unsuccessful. Please check email and password.', 'danger')
    return render_template('login.html', form=form)

@app.route('/dashboard', methods=['GET'])
@login_required
def dashboard():
    logger.info(f'User {current_user.id} accessed dashboard')
    zoho_portals = None
    if current_user.zoho_access_token:
        if is_token_expired():
            if refresh_zoho_token():
                zoho_portals = populate_zoho_portals()
            else:
                flash('Your Zoho token has expired. Please reconnect your account.', 'warning')
        else:
            zoho_portals = populate_zoho_portals()
    zoho_apps = [
        {"name": "Zoho One", "description": "All-in-one suite of business applications", "affiliate_link": "https://go.zoho.com/wDt"},
        {"name": "Zoho CRM", "description": "Customer Relationship Management software", "affiliate_link": "https://go.zoho.com/FI9"},
        {"name": "Zoho Marketing Automation", "description": "Automate your marketing efforts", "affiliate_link": "https://go.zoho.com/5Iy"},
        {"name": "Zoho Campaigns", "description": "Email marketing campaigns made easy", "affiliate_link": "https://go.zoho.com/oUc"},
        {"name": "Zoho Payroll", "description": "Streamline your payroll process", "affiliate_link": "https://go.zoho.com/cVx"},
        {"name": "Zoho Recruit", "description": "Applicant Tracking System", "affiliate_link": "https://go.zoho.com/QbF"},
        {"name": "Zoho CRM Plus", "description": "Unified customer experience platform", "affiliate_link": "https://go.zoho.com/MGh"},
        {"name": "Zoho Bookings", "description": "Online Scheduling Software", "affiliate_link": "https://go.zoho.com/hrp"},
        {"name": "Zoho WorkDrive", "description": "Team File Collaboration Platform", "affiliate_link": "https://go.zoho.com/vdp"},
        {"name": "Zoho Inventory", "description": "Order management software", "affiliate_link": "https://go.zoho.com/KjL"},
        {"name": "Zoho Marketing Plus", "description": "Unified marketing platform", "affiliate_link": "https://go.zoho.com/GrS"},
        {"name": "Zoho Commerce", "description": "E-commerce platform", "affiliate_link": "https://go.zoho.com/Uhf"},
        {"name": "Zoho SalesIQ", "description": "Live chat and website tracking", "affiliate_link": "https://go.zoho.com/Hzw"},
        {"name": "Zoho Books", "description": "Online accounting software", "affiliate_link": "https://go.zoho.com/YzS"},
        {"name": "Zoho Analytics", "description": "Self-service BI and analytics platform", "affiliate_link": "https://go.zoho.com/BgH"},
        {"name": "Zoho Forms", "description": "Online form builder", "affiliate_link": "https://go.zoho.com/ej1"},
        {"name": "Zoho Sign", "description": "Digital signature app", "affiliate_link": "https://go.zoho.com/uOc"},
    ]
    return render_template('dashboard.html', zoho_portals=zoho_portals, zoho_apps=zoho_apps)

@app.route('/pricing')
def pricing():
    logger.info('Pricing page accessed')
    plans = [
        {"name": "Starter", "price": "$4", "features": ["Two-way sync of projects and tasks", "Sync frequency: Every 24 hours"]},
        {"name": "Professional", "price": "$9", "features": ["Two-way sync between both platforms", "Sync frequency: Every 6 hours", "TAGS/LABELS syncing"]},
        {"name": "Business", "price": "$15", "features": ["Two-way sync with advanced features", "Sync frequency: Every hour", "TAGS/LABELS syncing", "Comments syncing", "Zoho project Stages as Layouts in Todoist", "Priority access to new features"]},
        {"name": "Enterprise", "price": "$19", "features": ["All features from Business plan", "Zoho sync every 5 minutes", "Instant Todoist sync", "Early access to new features", "Priority access to new integrations", "Access to project and tasks visualization app (coming soon)"]}
    ]
    zoho_apps = [
        {"name": "Zoho One", "description": "All-in-one suite of business applications", "affiliate_link": "https://go.zoho.com/wDt"},
        {"name": "Zoho CRM", "description": "Customer Relationship Management software", "affiliate_link": "https://go.zoho.com/FI9"},
        {"name": "Zoho Marketing Automation", "description": "Automate your marketing efforts", "affiliate_link": "https://go.zoho.com/5Iy"},
        {"name": "Zoho Campaigns", "description": "Email marketing campaigns made easy", "affiliate_link": "https://go.zoho.com/oUc"},
        {"name": "Zoho Payroll", "description": "Streamline your payroll process", "affiliate_link": "https://go.zoho.com/cVx"},
        {"name": "Zoho Recruit", "description": "Applicant Tracking System", "affiliate_link": "https://go.zoho.com/QbF"},
        {"name": "Zoho CRM Plus", "description": "Unified customer experience platform", "affiliate_link": "https://go.zoho.com/MGh"},
        {"name": "Zoho Bookings", "description": "Online Scheduling Software", "affiliate_link": "https://go.zoho.com/hrp"},
        {"name": "Zoho WorkDrive", "description": "Team File Collaboration Platform", "affiliate_link": "https://go.zoho.com/vdp"},
        {"name": "Zoho Inventory", "description": "Order management software", "affiliate_link": "https://go.zoho.com/KjL"},
        {"name": "Zoho Marketing Plus", "description": "Unified marketing platform", "affiliate_link": "https://go.zoho.com/GrS"},
        {"name": "Zoho Commerce", "description": "E-commerce platform", "affiliate_link": "https://go.zoho.com/Uhf"},
        {"name": "Zoho SalesIQ", "description": "Live chat and website tracking", "affiliate_link": "https://go.zoho.com/Hzw"},
        {"name": "Zoho Books", "description": "Online accounting software", "affiliate_link": "https://go.zoho.com/YzS"},
        {"name": "Zoho Analytics", "description": "Self-service BI and analytics platform", "affiliate_link": "https://go.zoho.com/BgH"},
        {"name": "Zoho Forms", "description": "Online form builder", "affiliate_link": "https://go.zoho.com/ej1"},
        {"name": "Zoho Sign", "description": "Digital signature app", "affiliate_link": "https://go.zoho.com/uOc"},
    ]
    return render_template('pricing.html', plans=plans, zoho_apps=zoho_apps)

@app.route('/zoho_auth')
@login_required
def zoho_auth():
    logger.info(f'User {current_user.id} initiated Zoho authentication')
    logger.debug("Calling initiate_zoho_auth function")
    return initiate_zoho_auth()

@app.route('/oauth_callback')
@login_required
def zoho_callback():
    logger.info(f'Zoho callback received for user {current_user.id}')
    logger.debug("Calling handle_zoho_callback function")
    return handle_zoho_callback()

@app.route('/get_zoho_portals')
@login_required
def fetch_zoho_portals():
    logger.info(f'User {current_user.id} requested Zoho portals')
    logger.debug("Calling get_zoho_portals function")
    portals = get_zoho_portals()
    if portals is None:
        return jsonify({'error': 'Failed to fetch Zoho portals'}), 400
    return jsonify(portals)

@app.route('/select_zoho_portal', methods=['POST'])
@login_required
@csrf.exempt
def select_zoho_portal():
    portal_id = request.json.get('portal_id')
    if not portal_id:
        return jsonify({'error': 'No portal ID provided'}), 400
    
    current_user.zoho_portal_id = portal_id
    db.session.commit()
    logger.info(f'User {current_user.id} selected Zoho portal: {portal_id}')
    return jsonify({'message': 'Portal selected successfully'}), 200

@app.route('/detach_zoho_portal', methods=['POST'])
@login_required
@csrf.exempt
def detach_zoho_portal():
    if current_user.zoho_portal_id:
        current_user.zoho_portal_id = None
        db.session.commit()
        logger.info(f'User {current_user.id} detached Zoho portal')
        return jsonify({'message': 'Portal detached successfully'}), 200
    else:
        return jsonify({'error': 'No portal attached'}), 400

@app.route('/revoke_zoho_auth')
@login_required
def revoke_zoho_authorization():
    logger.info(f'User {current_user.id} initiated Zoho authorization revocation')
    logger.debug("Calling revoke_zoho_auth function")
    return revoke_zoho_auth()

@app.route('/todoist_auth')
@login_required
def todoist_auth():
    logger.info(f'User {current_user.id} initiated Todoist authentication')
    logger.debug("Calling initiate_todoist_auth function")
    return initiate_todoist_auth()

@app.route('/auth/todoist/callback')
@login_required
def todoist_callback():
    logger.info(f'Todoist callback received for user {current_user.id}')
    logger.debug("Calling handle_todoist_callback function")
    return handle_todoist_callback()

@app.route('/revoke_todoist_auth')
@login_required
def revoke_todoist_authorization():
    logger.info(f'User {current_user.id} initiated Todoist authorization revocation')
    logger.debug("Calling revoke_todoist_auth function")
    return revoke_todoist_auth()

@app.route('/user_info')
@login_required
def user_info():
    users = User.query.all()
    user_data = []
    for user in users:
        user_data.append({
            'id': user.id,
            'name': user.name,
            'email': user.email,
            'zoho_portal_id': user.zoho_portal_id,
            'zoho_access_token': 'Present' if user.zoho_access_token else 'Not present',
            'zoho_refresh_token': 'Present' if user.zoho_refresh_token else 'Not present',
            'zoho_token_expires_at': user.zoho_token_expires_at,
            'zoho_api_domain': user.zoho_api_domain,
            'todoist_access_token': 'Present' if user.todoist_access_token else 'Not present'
        })
    return jsonify(user_data)

if __name__ == "__main__":
    init_db()
    app.run(host='0.0.0.0', port=8085)
