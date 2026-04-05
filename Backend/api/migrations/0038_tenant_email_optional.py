# Migration: make Tenant.email optional (blank=True, null=True). Phone remains required.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0037_remove_tenant_fk'),
    ]

    operations = [
        migrations.AlterField(
            model_name='tenant',
            name='email',
            field=models.CharField(blank=True, max_length=100, null=True, unique=True),
        ),
    ]
