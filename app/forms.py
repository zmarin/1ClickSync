from flask_wtf import FlaskForm
from wtforms import StringField, PasswordField, SubmitField, BooleanField, SelectField, TimeField
from wtforms.validators import DataRequired, Email, EqualTo, Optional, Length

class LoginForm(FlaskForm):
    email = StringField('Email', validators=[DataRequired(), Email()])
    password = PasswordField('Password', validators=[DataRequired()])
    remember = BooleanField('Remember Me')
    submit = SubmitField('Log In')

class RegistrationForm(FlaskForm):
    name = StringField('Name', validators=[DataRequired()])
    email = StringField('Email', validators=[DataRequired(), Email()])
    password = PasswordField('Password', validators=[DataRequired()])
    confirm_password = PasswordField('Confirm Password', validators=[DataRequired(), EqualTo('password')])
    submit = SubmitField('Register')

class SettingsForm(FlaskForm):
    name = StringField('Name', validators=[DataRequired()])
    email = StringField('Email', validators=[DataRequired(), Email()])
    
    sync_frequency = SelectField('Sync Frequency', choices=[
        ('15', 'Every 15 minutes'),
        ('30', 'Every 30 minutes'),
        ('60', 'Every hour'),
        ('360', 'Every 6 hours'),
        ('720', 'Every 12 hours'),
        ('1440', 'Every 24 hours')
    ])
    
    sync_direction = SelectField('Sync Direction', choices=[
        ('bidirectional', 'Two-way sync (Zoho ↔ Todoist)'),
        ('zoho_to_todoist', 'One-way sync (Zoho → Todoist)'),
        ('todoist_to_zoho', 'One-way sync (Todoist → Zoho)')
    ])
    
    sync_schedule = StringField('Sync Schedule (Optional)', validators=[Optional()])
    
    password = PasswordField('New Password', validators=[Optional(), Length(min=8)])
    confirm_password = PasswordField('Confirm New Password', validators=[Optional(), EqualTo('password')])
    
    submit = SubmitField('Save Changes')
