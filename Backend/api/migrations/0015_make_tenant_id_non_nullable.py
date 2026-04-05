"""Make `tenant.tenant_id` non-nullable after backfill.

Depends on 0014_backfill_tenant_id which populates existing NULL values.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0014_backfill_tenant_id'),
    ]

    operations = [
        migrations.AlterField(
            model_name='tenant',
            name='tenant_id',
            field=models.IntegerField(unique=True),
        ),
    ]
