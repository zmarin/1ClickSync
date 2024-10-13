import stripe
import json
from flask import Blueprint, jsonify, request, url_for
from flask_login import current_user
from models import User, db

subscription_bp = Blueprint('subscription', __name__)
stripe.api_key = 'YOUR_STRIPE_SECRET_KEY'

@subscription_bp.route('/create-checkout-session', methods=['POST'])
def create_checkout_session():
    user = User.query.get(current_user.id)
    try:
        checkout_session = stripe.checkout.Session.create(
            payment_method_types=['card'],
            line_items=[{
                'price': request.form['price_id'],
                'quantity': 1,
            }],
            mode='subscription',
            success_url=url_for('subscription.success', _external=True) + '?session_id={CHECKOUT_SESSION_ID}',
            cancel_url=url_for('subscription.cancel', _external=True),
            client_reference_id=user.id,
        )
        return jsonify({'id': checkout_session.id})
    except Exception as e:
        return jsonify(error=str(e)), 403

@subscription_bp.route('/webhook', methods=['POST'])
def webhook_received():
    webhook_secret = 'YOUR_STRIPE_WEBHOOK_SECRET'
    request_data = json.loads(request.data)

    if webhook_secret:
        signature = request.headers.get('stripe-signature')
        try:
            event = stripe.Webhook.construct_event(
                payload=request.data, sig_header=signature, secret=webhook_secret)
            data = event['data']
        except Exception as e:
            return e
        event_type = event['type']
    else:
        data = request_data['data']
        event_type = request_data['type']

    data_object = data['object']

    if event_type == 'checkout.session.completed':
        user = User.query.get(data_object['client_reference_id'])
        user.subscription_status = 'active'
        user.stripe_customer_id = data_object['customer']
        db.session.commit()

    return jsonify({'status': 'success'})