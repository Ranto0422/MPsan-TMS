# Migration to sync Django's migration state with the database reality.
# Previous migrations used raw SQL which Django's state tracker can't follow.
# This migration updates Django's internal state without modifying the database.

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0039_add_pwa_sms_notification_fields'),
    ]

    operations = [
        # Sync all fields that were modified via raw SQL in previous migrations
        migrations.SeparateDatabaseAndState(
            state_operations=[
                # ScheduledAutomatedMessage: tenant_layout_id made non-nullable in 0037
                migrations.AlterField(
                    model_name='scheduledautomatedmessage',
                    name='tenant_layout_id',
                    field=models.BigIntegerField(help_text='Tenant ID from layout data'),
                ),
                # ScheduledAutomatedMessage: tenant_name made non-nullable in 0037
                migrations.AlterField(
                    model_name='scheduledautomatedmessage',
                    name='tenant_name',
                    field=models.CharField(max_length=100, help_text='Tenant name from layout data'),
                ),
                # ScheduledAutomatedMessage: remove tenant field (was removed in 0037)
                migrations.RemoveField(
                    model_name='scheduledautomatedmessage',
                    name='tenant',
                ),
                # Unit: unit_id is now AutoField primary key (was changed in prior migrations)
                migrations.AlterField(
                    model_name='unit',
                    name='unit_id',
                    field=models.AutoField(primary_key=True, serialize=False),
                ),
                # Tenant: tenant_id is AutoField primary key, remove old 'id' field from state
                migrations.RemoveField(
                    model_name='tenant',
                    name='id',
                ),
                migrations.AlterField(
                    model_name='tenant',
                    name='tenant_id',
                    field=models.AutoField(primary_key=True, serialize=False),
                ),
                # Tenant: phone is unique and required
                migrations.AlterField(
                    model_name='tenant',
                    name='phone',
                    field=models.CharField(max_length=25, unique=True),
                ),
            ],
            database_operations=[
                # No database operations - all changes already applied via raw SQL
            ],
        ),
    ]
