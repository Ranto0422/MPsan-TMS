# Generated migration for ScheduledTestMessage (test automated messaging)

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('api', '0032_tenant_receivables'),
    ]

    operations = [
        migrations.CreateModel(
            name='ScheduledTestMessage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('send_at', models.DateTimeField(help_text='When to send the test message')),
                ('message', models.TextField()),
                ('phone_number', models.CharField(max_length=25)),
                ('sent', models.BooleanField(default=False)),
                ('sent_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=models.SET_NULL, related_name='scheduled_test_messages', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['send_at'],
            },
        ),
    ]
