from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Union
from werkzeug.security import generate_password_hash, check_password_hash
from app.supabase_db import get_supabase_client, get_supabase_admin

# User model functions
def create_user(email: str, password: str, name: str = "") -> Dict[str, Any]:
    """
    Create a new user in Supabase Auth and in the users table.
    """
    supabase = get_supabase_admin()
    
    # First, create the user in Supabase Auth without auto email confirmation
    auth_response = supabase.auth.admin.create_user({
        "email": email,
        "password": password,
        "email_confirm": False
    })
    
    user_id = auth_response.user.id
    
    # Split name into first_name and last_name if provided
    first_name = ""
    last_name = ""
    if name:
        name_parts = name.split(" ", 1)
        first_name = name_parts[0]
        if len(name_parts) > 1:
            last_name = name_parts[1]
    
    # Then, create the user in our users table
    user_data = {
        "id": user_id,
        "email": email,
        "first_name": first_name,
        "last_name": last_name,
        "company": "",
        "is_admin": False,
        "subscription_tier": "free",
        "sync_enabled": False,
        "sync_status": "inactive",
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    }
    
    response = supabase.table("users").insert(user_data).execute()
    
    # Send a custom confirmation email
    from app.email_confirmation import send_confirmation_email
    send_confirmation_email(user_id, email)
    
    return response.data[0] if response.data else None

def get_user_by_id(user_id: str) -> Dict[str, Any]:
    """
    Get a user by ID.
    """
    supabase = get_supabase_admin()
    response = supabase.table("users").select("*").eq("id", user_id).execute()
    return response.data[0] if response.data else None

def get_user_by_email(email: str) -> Dict[str, Any]:
    """
    Get a user by email.
    """
    supabase = get_supabase_admin()
    response = supabase.table("users").select("*").eq("email", email).execute()
    return response.data[0] if response.data else None

def update_user(user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Update a user's data.
    """
    supabase = get_supabase_admin()
    data["updated_at"] = datetime.utcnow().isoformat()
    response = supabase.table("users").update(data).eq("id", user_id).execute()
    return response.data[0] if response.data else None

def delete_user(user_id: str) -> bool:
    """
    Delete a user.
    """
    supabase = get_supabase_admin()
    
    # First, delete from our users table
    supabase.table("users").delete().eq("id", user_id).execute()
    
    # Then, delete from Supabase Auth
    supabase.auth.admin.delete_user(user_id)
    
    return True

def check_password(user_id: str, password: str) -> bool:
    """
    Check if the provided password is correct for the user.
    """
    supabase = get_supabase_admin()
    
    # In Supabase, we can use the sign-in method to check the password
    try:
        user = get_user_by_id(user_id)
        if not user:
            return False
            
        response = supabase.auth.sign_in_with_password({
            "email": user["email"],
            "password": password
        })
        return True
    except Exception:
        return False

# OAuth Token functions
def create_oauth_token(user_id: str, provider: str, access_token: str, refresh_token: str, expires_in: int) -> Dict[str, Any]:
    """
    Create a new OAuth token.
    """
    supabase = get_supabase_admin()
    
    # Calculate expires_at from expires_in
    expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
    
    token_data = {
        "user_id": user_id,
        "provider": provider,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": expires_at.isoformat(),
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    }
    
    response = supabase.table("oauth_tokens").insert(token_data).execute()
    return response.data[0] if response.data else None

def get_oauth_token(user_id: str, provider: str) -> Dict[str, Any]:
    """
    Get an OAuth token for a user and provider.
    """
    supabase = get_supabase_admin()
    response = supabase.table("oauth_tokens").select("*").eq("user_id", user_id).eq("provider", provider).execute()
    return response.data[0] if response.data else None

def update_oauth_token(token_id: str, access_token: str, refresh_token: str, expires_in: int) -> Dict[str, Any]:
    """
    Update an OAuth token.
    """
    supabase = get_supabase_admin()
    
    # Calculate expires_at from expires_in
    expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
    
    token_data = {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": expires_at.isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    }
    
    response = supabase.table("oauth_tokens").update(token_data).eq("id", token_id).execute()
    return response.data[0] if response.data else None

# Subscription functions
def create_subscription(user_id: str, plan: str, status: str, stripe_subscription_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Create a new subscription.
    """
    supabase = get_supabase_admin()
    
    subscription_data = {
        "user_id": user_id,
        "plan": plan,
        "status": status,
        "stripe_subscription_id": stripe_subscription_id,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    }
    
    response = supabase.table("subscriptions").insert(subscription_data).execute()
    return response.data[0] if response.data else None

def get_subscription(user_id: str) -> Dict[str, Any]:
    """
    Get a subscription for a user.
    """
    supabase = get_supabase_admin()
    response = supabase.table("subscriptions").select("*").eq("user_id", user_id).execute()
    return response.data[0] if response.data else None

def update_subscription(subscription_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Update a subscription.
    """
    supabase = get_supabase_admin()
    data["updated_at"] = datetime.utcnow().isoformat()
    response = supabase.table("subscriptions").update(data).eq("id", subscription_id).execute()
    return response.data[0] if response.data else None

# Task Mapping functions
def create_task_mapping(user_id: str, zoho_task_id: str, todoist_task_id: str) -> Dict[str, Any]:
    """
    Create a new task mapping.
    """
    supabase = get_supabase_admin()
    
    mapping_data = {
        "user_id": user_id,
        "zoho_task_id": zoho_task_id,
        "todoist_task_id": todoist_task_id,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    }
    
    response = supabase.table("task_mappings").insert(mapping_data).execute()
    return response.data[0] if response.data else None

def get_task_mapping_by_zoho_id(user_id: str, zoho_task_id: str) -> Dict[str, Any]:
    """
    Get a task mapping by Zoho task ID.
    """
    supabase = get_supabase_admin()
    response = supabase.table("task_mappings").select("*").eq("user_id", user_id).eq("zoho_task_id", zoho_task_id).execute()
    return response.data[0] if response.data else None

def get_task_mapping_by_todoist_id(user_id: str, todoist_task_id: str) -> Dict[str, Any]:
    """
    Get a task mapping by Todoist task ID.
    """
    supabase = get_supabase_admin()
    response = supabase.table("task_mappings").select("*").eq("user_id", user_id).eq("todoist_task_id", todoist_task_id).execute()
    return response.data[0] if response.data else None

def delete_task_mapping(mapping_id: str) -> bool:
    """
    Delete a task mapping.
    """
    supabase = get_supabase_admin()
    supabase.table("task_mappings").delete().eq("id", mapping_id).execute()
    return True

# Sync Log functions
def create_sync_log(user_id: str, status: str, details: Optional[str] = None) -> Dict[str, Any]:
    """
    Create a new sync log.
    """
    supabase = get_supabase_admin()
    
    log_data = {
        "user_id": user_id,
        "status": status,
        "details": details,
        "created_at": datetime.utcnow().isoformat()
    }
    
    response = supabase.table("sync_logs").insert(log_data).execute()
    return response.data[0] if response.data else None

def get_sync_logs(user_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    """
    Get sync logs for a user.
    """
    supabase = get_supabase_admin()
    response = supabase.table("sync_logs").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(limit).execute()
    return response.data if response.data else []

# Conflict functions
def create_conflict(user_id: str, task_mapping_id: str, zoho_data: Dict[str, Any], todoist_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a new conflict.
    """
    supabase = get_supabase_admin()
    
    conflict_data = {
        "user_id": user_id,
        "task_mapping_id": task_mapping_id,
        "zoho_data": zoho_data,
        "todoist_data": todoist_data,
        "resolved": False,
        "created_at": datetime.utcnow().isoformat()
    }
    
    response = supabase.table("conflicts").insert(conflict_data).execute()
    return response.data[0] if response.data else None

def get_conflicts(user_id: str, resolved: bool = False) -> List[Dict[str, Any]]:
    """
    Get conflicts for a user.
    """
    supabase = get_supabase_admin()
    response = supabase.table("conflicts").select("*").eq("user_id", user_id).eq("resolved", resolved).execute()
    return response.data if response.data else []

def resolve_conflict(conflict_id: str, resolution: str) -> Dict[str, Any]:
    """
    Resolve a conflict.
    """
    supabase = get_supabase_admin()
    
    conflict_data = {
        "resolved": True,
        "resolution": resolution,
        "resolved_at": datetime.utcnow().isoformat()
    }
    
    response = supabase.table("conflicts").update(conflict_data).eq("id", conflict_id).execute()
    return response.data[0] if response.data else None

# Task History functions
def create_task_history(user_id: str, task_mapping_id: str, action: str, details: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a new task history entry.
    """
    supabase = get_supabase_admin()
    
    history_data = {
        "user_id": user_id,
        "task_mapping_id": task_mapping_id,
        "action": action,
        "details": details,
        "created_at": datetime.utcnow().isoformat()
    }
    
    response = supabase.table("task_history").insert(history_data).execute()
    return response.data[0] if response.data else None

def get_task_history(task_mapping_id: str) -> List[Dict[str, Any]]:
    """
    Get history for a task mapping.
    """
    supabase = get_supabase_admin()
    response = supabase.table("task_history").select("*").eq("task_mapping_id", task_mapping_id).order("created_at", desc=True).execute()
    return response.data if response.data else []

# Zoho Portal functions
def get_zoho_portal(user_id: str) -> Dict[str, Any]:
    """
    Get a user's Zoho portal.
    """
    supabase = get_supabase_admin()
    response = supabase.table("zoho_portals").select("*").eq("user_id", user_id).execute()
    return response.data[0] if response.data else None

def create_zoho_portal(user_id: str, portal_id: str, portal_name: str, region: str = "com") -> Dict[str, Any]:
    """
    Create a new Zoho portal.
    """
    supabase = get_supabase_admin()
    
    portal_data = {
        "user_id": user_id,
        "portal_id": portal_id,
        "portal_name": portal_name,
        "region": region,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    }
    
    response = supabase.table("zoho_portals").insert(portal_data).execute()
    return response.data[0] if response.data else None

# Sync Settings functions
def get_sync_settings(user_id: str) -> Dict[str, Any]:
    """
    Get a user's sync settings.
    """
    supabase = get_supabase_admin()
    response = supabase.table("sync_settings").select("*").eq("user_id", user_id).execute()
    return response.data[0] if response.data else None

def create_sync_settings(user_id: str, sync_direction: str = "bidirectional", sync_frequency: int = 60, auto_sync: bool = True) -> Dict[str, Any]:
    """
    Create new sync settings.
    """
    supabase = get_supabase_admin()
    
    settings_data = {
        "user_id": user_id,
        "sync_direction": sync_direction,
        "sync_frequency": sync_frequency,
        "auto_sync": auto_sync,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    }
    
    response = supabase.table("sync_settings").insert(settings_data).execute()
    return response.data[0] if response.data else None

def update_sync_settings(settings_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Update sync settings.
    """
    supabase = get_supabase_admin()
    data["updated_at"] = datetime.utcnow().isoformat()
    response = supabase.table("sync_settings").update(data).eq("id", settings_id).execute()
    return response.data[0] if response.data else None

# User class for Flask-Login compatibility
class User:
    def __init__(self, user_data):
        self.id = user_data["id"]
        self.email = user_data["email"]
        self.first_name = user_data.get("first_name", "")
        self.last_name = user_data.get("last_name", "")
        self.company = user_data.get("company", "")
        self.is_admin = user_data.get("is_admin", False)
        self.subscription_tier = user_data.get("subscription_tier", "free")
        self.sync_enabled = user_data.get("sync_enabled", False)
        self.last_sync = user_data.get("last_sync")
        self.sync_status = user_data.get("sync_status", "inactive")
        self.created_at = user_data["created_at"]
        self.updated_at = user_data["updated_at"]
        
        # Check if email is confirmed from auth.users table
        self.confirmed = user_data.get("email_confirmed_at") is not None
    
    @property
    def is_active(self):
        return True
    
    @property
    def is_authenticated(self):
        return True
    
    @property
    def is_anonymous(self):
        return False
    
    def get_id(self):
        return str(self.id)
    
    @property
    def name(self):
        if self.first_name and self.last_name:
            return f"{self.first_name} {self.last_name}"
        elif self.first_name:
            return self.first_name
        return ""
    
    @property
    def onboarding_completed(self):
        # Check if user has completed onboarding
        if not self.confirmed:
            return False
        
        # Check if user has Zoho OAuth token
        zoho_token = get_oauth_token(self.id, "zoho")
        if not zoho_token:
            return False
        
        # Check if user has Todoist OAuth token
        todoist_token = get_oauth_token(self.id, "todoist")
        if not todoist_token:
            return False
        
        # Check if user has selected a Zoho portal
        zoho_portal = get_zoho_portal(self.id)
        if not zoho_portal:
            return False
        
        # Check if user has configured sync settings
        sync_settings = get_sync_settings(self.id)
        if not sync_settings:
            return False
        
        return True
    
    def set_password(self, password):
        # Update password in Supabase Auth
        supabase = get_supabase_admin()
        supabase.auth.admin.update_user_by_id(
            self.id,
            {"password": password}
        )
    
    def check_password(self, password):
        return check_password(self.id, password)

# User loader for Flask-Login
def load_user(user_id):
    user_data = get_user_by_id(user_id)
    if user_data:
        return User(user_data)
    return None
