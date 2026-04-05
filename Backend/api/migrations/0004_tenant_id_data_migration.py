from django.db import migrations, transaction


def copy_id_to_tenant_id(apps, schema_editor):
    """Safely copy `id` -> `tenant_id` when both columns exist using the ORM.

    Use DB introspection to detect columns and update rows via the historical
    `Tenant` model. This avoids raw SQL dialect issues across SQLite/Postgres.
    """
    Tenant = apps.get_model('api', 'Tenant')
    conn = schema_editor.connection
    try:
        cursor = conn.cursor()
        try:
            cols = [c.name for c in conn.introspection.get_table_description(cursor, Tenant._meta.db_table)]
        finally:
            try:
                cursor.close()
            except Exception:
                pass
    except Exception:
        cols = []

    if 'tenant_id' not in cols or 'id' not in cols:
        # nothing to do if either column is missing
        return

    # Update rows where tenant_id is null/zero using ORM; swallow row errors.
    try:
        with transaction.atomic():
            qs = Tenant.objects.all()
            for obj in qs:
                try:
                    current = getattr(obj, 'tenant_id', None)
                    if not current:
                        legacy = getattr(obj, 'id', None)
                        if legacy is not None:
                            setattr(obj, 'tenant_id', legacy)
                            obj.save(update_fields=['tenant_id'])
                except Exception:
                    # best-effort per-row; continue on errors
                    continue
    except Exception:
        # Do not fail the entire migration run for unexpected DB/runtime errors
        return


def noop_reverse(apps, schema_editor):
    return


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0003_remove_unit_unique_property_unit_and_more'),
    ]

    operations = [
        migrations.RunPython(copy_id_to_tenant_id, reverse_code=noop_reverse),
    ]
