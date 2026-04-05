from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0056_messagelog'),
    ]

    operations = [
        migrations.AddField(
            model_name='tenantmessageschedule',
            name='ml_last_updated',
            field=models.DateTimeField(
                blank=True,
                null=True,
                help_text='When ML last updated this tenant schedule. Null = never updated or invalidated by new payment.'
            ),
        ),
    ]
