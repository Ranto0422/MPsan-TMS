# Generated manually for automated messaging feature

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('api', '0034_pushsubscription'),
    ]

    operations = [
        migrations.CreateModel(
            name='AutomatedMessageSettings',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('enabled', models.BooleanField(default=True, help_text='Whether automated messaging is enabled')),
                ('message_template', models.TextField(default='Good Day [Tenant Name]! This is a reminder that your rent payment of ₱[Payment Amount] is due in [Days Left] days. Please settle on or before [Due Date]. Thank you!', help_text='Message template with placeholders like [Tenant Name], [Payment Amount], etc.')),
                ('message_days', models.JSONField(default=list, help_text='List of days before due date to send reminders (e.g., [7, 3, 0] for 7 days, 3 days, and on due date)')),
                ('send_hour', models.PositiveIntegerField(default=8, help_text='Hour to send messages (0-23)')),
                ('send_minute', models.PositiveIntegerField(default=0, help_text='Minute to send messages (0-59)')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('property', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='automated_message_settings', to='api.property')),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_message_settings', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Automated Message Settings',
                'verbose_name_plural': 'Automated Message Settings',
            },
        ),
        migrations.CreateModel(
            name='ScheduledAutomatedMessage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('tenant_name', models.CharField(blank=True, help_text='Tenant name (stored directly for reliability)', max_length=100)),
                ('tenant_layout_id', models.BigIntegerField(blank=True, null=True, help_text='Original tenant ID from layout data')),
                ('room_number', models.CharField(help_text='Room number for this message', max_length=50)),
                ('phone_number', models.CharField(max_length=25)),
                ('message', models.TextField(help_text='The actual message with placeholders replaced')),
                ('send_at', models.DateTimeField(help_text='When to send the message')),
                ('days_before_due', models.IntegerField(help_text='Number of days before due date this message is for')),
                ('due_date', models.DateField(help_text='The payment due date this message relates to')),
                ('status', models.CharField(choices=[('pending', 'Pending'), ('sent', 'Sent'), ('failed', 'Failed'), ('cancelled', 'Cancelled')], default='pending', max_length=20)),
                ('sent_at', models.DateTimeField(blank=True, null=True)),
                ('error_message', models.TextField(blank=True, help_text='Error message if send failed')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('property', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='scheduled_automated_messages', to='api.property')),
                ('tenant', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='scheduled_automated_messages', to='api.tenant')),
            ],
            options={
                'verbose_name': 'Scheduled Automated Message',
                'verbose_name_plural': 'Scheduled Automated Messages',
                'ordering': ['send_at'],
                'unique_together': {('property', 'room_number', 'due_date', 'days_before_due')},
            },
        ),
    ]
