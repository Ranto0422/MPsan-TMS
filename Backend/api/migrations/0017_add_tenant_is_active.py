# Generated migration for adding is_active field to Tenant model

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0016_add_tenant_move_in'),
    ]

    operations = [
        migrations.AddField(
            model_name='tenant',
            name='is_active',
            field=models.BooleanField(default=True),
        ),
    ]
