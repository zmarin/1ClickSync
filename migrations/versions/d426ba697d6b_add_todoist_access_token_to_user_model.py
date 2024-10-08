"""Add todoist_access_token to User model

Revision ID: d426ba697d6b
Revises: 
Create Date: 2024-10-08 09:16:23.123456

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'd426ba697d6b'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Drop dependent tables first
    op.drop_table('subtask_mappings')
    op.drop_table('comment_mappings')
    op.drop_table('task_mappings')
    op.drop_table('project_mappings')
    
    # Check if todoist_access_token column exists
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = inspector.get_columns('user')
    if 'todoist_access_token' not in [c['name'] for c in columns]:
        op.add_column('user', sa.Column('todoist_access_token', sa.String(), nullable=True))
    
    # Remove old columns if they exist
    columns_to_drop = ['todoist_api_token', 'todoist_sync_token', 'selected_portal_id']
    for column in columns_to_drop:
        if column in [c['name'] for c in columns]:
            op.drop_column('user', column)
    
    # Set hashed_password to not null
    op.alter_column('user', 'hashed_password',
               existing_type=sa.VARCHAR(),
               nullable=False)


def downgrade():
    # Add back old columns
    op.add_column('user', sa.Column('todoist_api_token', sa.String(), nullable=True))
    op.add_column('user', sa.Column('todoist_sync_token', sa.String(), nullable=True))
    op.add_column('user', sa.Column('selected_portal_id', sa.String(), nullable=True))
    
    # Set hashed_password to nullable
    op.alter_column('user', 'hashed_password',
               existing_type=sa.VARCHAR(),
               nullable=True)
    
    # Recreate dropped tables (note: this will not restore data)
    op.create_table('project_mappings',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('zoho_project_id', sa.String(), nullable=False),
    sa.Column('todoist_project_id', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('last_updated', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    
    op.create_table('task_mappings',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('zoho_task_id', sa.String(), nullable=False),
    sa.Column('todoist_task_id', sa.String(), nullable=False),
    sa.Column('zoho_parent_task_id', sa.String(), nullable=True),
    sa.Column('todoist_parent_id', sa.String(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('last_updated', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    
    op.create_table('comment_mappings',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('zoho_comment_id', sa.String(), nullable=False),
    sa.Column('todoist_comment_id', sa.String(), nullable=False),
    sa.Column('task_mapping_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('last_updated', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['task_mapping_id'], ['task_mappings.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    
    op.create_table('subtask_mappings',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('zoho_subtask_id', sa.String(), nullable=False),
    sa.Column('todoist_subtask_id', sa.String(), nullable=False),
    sa.Column('task_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('last_updated', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['task_id'], ['task_mappings.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
