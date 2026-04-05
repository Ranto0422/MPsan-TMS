from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0026_add_tenant_removal_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='property',
            name='floors',
            field=models.PositiveIntegerField(default=1, help_text='Number of floors in the building'),
        ),
    ]
