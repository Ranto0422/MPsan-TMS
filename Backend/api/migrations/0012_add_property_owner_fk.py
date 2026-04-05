from django.db import migrations, models
import django.db.models.deletion
from django.conf import settings


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0011_merge'),
    ]

    operations = [
        # Temporarily create an `owner` FK to the auth user model so the
        # column exists before the dedicated `Owner` model is created in
        # a later migration. That later migration will alter this field to
        # reference `api.Owner`.
        migrations.AddField(
            model_name='property',
            name='owner',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='properties', to=settings.AUTH_USER_MODEL),
        ),
    ]
