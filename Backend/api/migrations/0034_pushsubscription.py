# Generated migration for PushSubscription model (PWA push notifications)

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('api', '0033_scheduled_test_message'),
    ]

    operations = [
        migrations.CreateModel(
            name='PushSubscription',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('endpoint', models.TextField(help_text='Push service endpoint URL', unique=True)),
                ('p256dh', models.TextField(help_text='Client public key for encryption')),
                ('auth', models.TextField(help_text='Client auth secret')),
                ('user_agent', models.CharField(blank=True, help_text='Browser user agent', max_length=500)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('is_active', models.BooleanField(default=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='push_subscriptions', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Push Subscription',
                'verbose_name_plural': 'Push Subscriptions',
                'ordering': ['-created_at'],
            },
        ),
    ]
