import unittest
from app import create_app, db
from app.models import User, TaskMapping, Conflict, SyncLog
from config import Config
from synchronizer import sync_tasks
from unittest.mock import patch

class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite://'

class IntegrationTestCase(unittest.TestCase):
    def setUp(self):
        self.app = create_app(TestConfig)
        self.app_context = self.app.app_context()
        self.app_context.push()
        db.create_all()
        self.client = self.app.test_client()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.app_context.pop()

    def register_user(self, name, email, password):
        return self.client.post('/auth/register', data=dict(
            name=name,
            email=email,
            password=password,
            confirm_password=password
        ), follow_redirects=True)

    def login(self, email, password):
        return self.client.post('/auth/login', data=dict(
            email=email,
            password=password
        ), follow_redirects=True)

    def logout(self):
        return self.client.get('/auth/logout', follow_redirects=True)

    @patch('synchronizer.fetch_zoho_tasks')
    @patch('synchronizer.fetch_todoist_tasks')
    @patch('synchronizer.create_todoist_task')
    @patch('synchronizer.create_zoho_task')
    def test_full_sync_process(self, mock_create_zoho_task, mock_create_todoist_task, mock_fetch_todoist_tasks, mock_fetch_zoho_tasks):
        # Register and login a user
        self.register_user('Test User', 'test@example.com', 'password123')
        self.login('test@example.com', 'password123')

        # Mock API responses
        mock_fetch_zoho_tasks.return_value = [{'id': 'z1', 'name': 'Zoho Task 1'}]
        mock_fetch_todoist_tasks.return_value = [{'id': 't1', 'content': 'Todoist Task 1'}]
        mock_create_todoist_task.return_value = {'id': 't2'}
        mock_create_zoho_task.return_value = {'id': 'z2'}

        # Simulate connecting Zoho and Todoist accounts
        user = User.query.filter_by(email='test@example.com').first()
        user.zoho_access_token = 'fake_zoho_token'
        user.todoist_access_token = 'fake_todoist_token'
        db.session.commit()

        # Trigger sync process
        with self.app.test_request_context():
            result = sync_tasks(user.id)

        # Check the results
        self.assertIn("Synchronization completed", result)
        self.assertEqual(SyncLog.query.count(), 1)
        self.assertEqual(TaskMapping.query.count(), 2)
        self.assertEqual(Conflict.query.count(), 0)

        # Check if tasks were created in both directions
        mock_create_todoist_task.assert_called_once()
        mock_create_zoho_task.assert_called_once()

if __name__ == '__main__':
    unittest.main(verbosity=2)
