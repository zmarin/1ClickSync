from models import FeatureFlag
from flask_login import current_user

def is_feature_enabled(feature_name):
    feature = FeatureFlag.query.filter_by(name=feature_name).first()
    if not feature:
        return False
    if feature.is_enabled:
        if not feature.users:
            return True
        user_ids = [int(id) for id in feature.users.split(',') if id]
        return current_user.id in user_ids
    return False
