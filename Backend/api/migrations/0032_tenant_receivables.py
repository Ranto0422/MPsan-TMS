# Generated migration for Tenant.receivables (tenant owes owner - reimbursements)

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0031_add_tenant_released_rooms'),
    ]

    operations = [
        migrations.AddField(
            model_name='tenant',
            name='receivables',
            field=models.JSONField(blank=True, default=list, help_text='Amounts tenant owes owner (reimbursements); each: id, amount, reason, date, received, received_at'),
        ),
    ]
