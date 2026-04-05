# Generated migration to add owner and manager fields to Property
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0003_remove_unit_unique_property_unit_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='property',
            name='owner',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='owned_properties', to='auth.user'),
        ),
        migrations.AddField(
            model_name='property',
            name='manager',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='managed_properties', to='auth.user'),
        ),
    ]
