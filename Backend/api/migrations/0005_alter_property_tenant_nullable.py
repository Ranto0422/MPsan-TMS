from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0004_add_owner_manager'),
    ]

    operations = [
        migrations.AlterField(
            model_name='property',
            name='tenant',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='properties', to='api.tenant'),
        ),
    ]
