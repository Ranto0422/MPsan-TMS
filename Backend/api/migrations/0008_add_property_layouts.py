from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0007_remove_property_manager_remove_property_owner_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='property',
            name='layouts',
            field=models.JSONField(default=dict, blank=True),
        ),
    ]
