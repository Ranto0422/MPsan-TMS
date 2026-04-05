# Generated migration to make home_location, work_place, and id_photo_url optional

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0017_add_tenant_is_active'),
    ]

    operations = [
        migrations.AlterField(
            model_name='tenant',
            name='home_location',
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AlterField(
            model_name='tenant',
            name='work_place',
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AlterField(
            model_name='tenant',
            name='id_photo_url',
            field=models.CharField(blank=True, max_length=255),
        ),
    ]
