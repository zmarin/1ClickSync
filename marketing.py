from flask import render_template_string

def get_marketing_content():
    left_content = """
    <div class="bg-gray-100 p-4 rounded-lg shadow">
        <h3 class="text-lg font-bold mb-2">Special Offer!</h3>
        <p>Get 20% off on annual subscriptions. Limited time offer!</p>
    </div>
    """

    right_content = """
    <div class="bg-gray-100 p-4 rounded-lg shadow">
        <h3 class="text-lg font-bold mb-2">New Features</h3>
        <ul class="list-disc list-inside">
            <li>Advanced project analytics</li>
            <li>Improved task synchronization</li>
            <li>Custom field mapping</li>
        </ul>
    </div>
    """

    return {
        'left': render_template_string(left_content),
        'right': render_template_string(right_content)
    }