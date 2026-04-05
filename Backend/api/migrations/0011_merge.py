from django.db import migrations


class Migration(migrations.Migration):
    """Merge migration to resolve multiple leaf nodes in the migration graph.

    This migration depends on both conflicting leaf migrations and performs no operations.
    Inspect the two migrations listed in the CommandError before running `migrate`.
    """

    dependencies = [
        ('api', '0004_tenant_id_data_migration'),
        ('api', '0010_remove_tenant_layouts_property_layouts'),
    ]

    operations = []
