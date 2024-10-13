import unittest
from unittest.mock import patch, MagicMock
from app import create_app, db
from app.models import User, TaskMapping, Conflict, SyncLog
from config import Config
from synchronizer import sync_tasks, sync_zoho_to_todoist, sync_todoist_to_zoho

class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite://'

class UserModelCase(unittest.TestCase):
    def setUp(self):
        self.app = create_app(TestConfig)
        self.app_context = self.app.app_context()
        self.app_context.push()
        db.create_all()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.app_context.pop()

    def test_password_hashing(self):
        u = User(name='john', email='john@example.com')
        u.set_password('cat')
        self.assertFalse(u.check_password('dog'))
        self.assertTrue(u.check_password('cat'))

    def test_task_mapping(self):
        u = User(name='john', email='john@example.com')
        db.session.add(u)
        db.session.commit()
        tm = TaskMapping(user_id=u.id, zoho_task_id='123', todoist_task_id='456')
        db.session.add(tm)
        db.session.commit()
        self.assertEqual(TaskMapping.query.filter_by(user_id=u.id).count(), 1)

    def test_conflict_creation(self):
        u = User(name='john', email='john@example.com')
        db.session.add(u)
        db.session.commit()
        c = Conflict(user_id=u.id, source='zoho', task_id='123', task_data='{"name": "Test Task"}')
        db.session.add(c)
        db.session.commit()
        self.assertEqual(Conflict.query.filter_by(user_id=u.id).count(), 1)

class SynchronizerTestCase(unittest.TestCase):
    def setUp(self):
        self.app = create_app(TestConfig)
        self.app_context = self.app.app_context()
        self.app_context.push()
        db.create_all()
        self.user = User(name='test', email='test@example.com', zoho_access_token='zoho_token', todoist_access_token='todoist_token')
        db.session.add(self.user)
        db.session.commit()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.app_context.pop()

    @patch('synchronizer.fetch_zoho_tasks')
    @patch('synchronizer.fetch_todoist_tasks')
    @patch('synchronizer.sync_zoho_to_todoist')
    @patch('synchronizer.sync_todoist_to_zoho')
    def test_sync_tasks(self, mock_sync_todoist_to_zoho, mock_sync_zoho_to_todoist, mock_fetch_todoist_tasks, mock_fetch_zoho_tasks):
        mock_fetch_zoho_tasks.return_value = [{'id': 'z1', 'name': 'Zoho Task 1'}]
        mock_fetch_todoist_tasks.return_value = [{'id': 't1', 'content': 'Todoist Task 1'}]
        mock_sync_zoho_to_todoist.return_value = 'synced'
        mock_sync_todoist_to_zoho.return_value = 'synced'

        result = sync_tasks(self.user.id)

        self.assertIn("Synchronization completed", result)
        self.assertEqual(SyncLog.query.count(), 1)
        sync_log = SyncLog.query.first()
        self.assertEqual(sync_log.synced_count, 2)
        self.assertEqual(sync_log.conflict_count, 0)

    @patch('synchronizer.create_todoist_task')
    @patch('synchronizer.update_todoist_task')
    def test_sync_zoho_to_todoist(self, mock_update_todoist_task, mock_create_todoist_task):
        zoho_task = {'id': 'z1', 'name': 'Zoho Task 1'}
        
        # Test creating a new task
        result = sync_zoho_to_todoist(self.user, zoho_task)
        self.assertEqual(result, 'synced')
        mock_create_todoist_task.assert_called_once()

        # Test updating an existing task
        TaskMapping(user_id=self.user.id, zoho_task_id='z1', todoist_task_id='t1').save()
        result = sync_zoho_to_todoist(self.user, zoho_task)
        self.assertEqual(result, 'synced')
        mock_update_todoist_task.assert_called_once()

    @patch('synchronizer.create_zoho_task')
    @patch('synchronizer.update_zoho_task')
    def test_sync_todoist_to_zoho(self, mock_update_zoho_task, mock_create_zoho_task):
        todoist_task = {'id': 't1', 'content': 'Todoist Task 1'}
        
        # Test creating a new task
        result = sync_todoist_to_zoho(self.user, todoist_task)
        self.assertEqual(result, 'synced')
        mock_create_zoho_task.assert_called_once()

        # Test updating an existing task
        TaskMapping(user_id=self.user.id, zoho_task_id='z1', todoist_task_id='t1').save()
        result = sync_todoist_to_zoho(self.user, todoist_task)
        self.assertEqual(result, 'synced')
        mock_update_zoho_task.assert_called_once()

if __name__ == '__main__':
    unittest.main(verbosity=2)
