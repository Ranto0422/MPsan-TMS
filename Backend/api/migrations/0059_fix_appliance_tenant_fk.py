"""Fix Appliance FK constraint to reference api_tenant.tenant_id instead of old id column.

Migration 0013 created the Appliance FK without to_field='tenant_id', so PostgreSQL
created the constraint referencing the old api_tenant.id column. Migration 0040 updated
Django's state (making tenant_id the PK) but didn't update the actual DB constraint.
This migration drops the old constraint and creates a new one pointing to tenant_id.
"""

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0058_add_email_to_scheduledtestmessage'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    sql=[
                        # Drop the old FK constraint that references api_tenant.id
                        'ALTER TABLE api_appliance DROP CONSTRAINT IF EXISTS "api_appliance_tenant_id_312a06b6_fk_api_tenant_id";',
                        # Create new FK constraint referencing api_tenant.tenant_id
                        'ALTER TABLE api_appliance ADD CONSTRAINT "api_appliance_tenant_id_fk_api_tenant_tenant_id" '
                        'FOREIGN KEY (tenant_id) REFERENCES api_tenant(tenant_id) '
                        'ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;',
                    ],
                    reverse_sql=[
                        'ALTER TABLE api_appliance DROP CONSTRAINT IF EXISTS "api_appliance_tenant_id_fk_api_tenant_tenant_id";',
                        'ALTER TABLE api_appliance ADD CONSTRAINT "api_appliance_tenant_id_312a06b6_fk_api_tenant_id" '
                        'FOREIGN KEY (tenant_id) REFERENCES api_tenant(tenant_id) '
                        'ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;',
                    ],
                ),
            ],
            state_operations=[
                migrations.AlterField(
                    model_name='appliance',
                    name='tenant',
                    field=models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='appliances',
                        to='api.tenant',
                        to_field='tenant_id',
                    ),
                ),
            ],
        ),
    ]
