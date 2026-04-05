# Generated migration

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0025_activitylog'),
    ]

    operations = [
        migrations.AddField(
            model_name='tenant',
            name='move_out',
            field=models.DateField(blank=True, help_text='Date tenant moved out or was removed', null=True),
        ),
        migrations.AddField(
            model_name='tenant',
            name='last_room',
            field=models.CharField(blank=True, help_text='Last room number tenant occupied', max_length=50),
        ),
        migrations.AddField(
            model_name='tenant',
            name='last_property_id',
            field=models.IntegerField(blank=True, help_text='Last property ID tenant occupied', null=True),
        ),
        migrations.AddField(
            model_name='tenant',
            name='last_payment',
            field=models.DecimalField(blank=True, decimal_places=2, help_text='Last monthly payment amount', max_digits=10, null=True),
        ),
    ]
