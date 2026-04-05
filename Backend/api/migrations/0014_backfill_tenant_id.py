"""Backfill `tenant_id` for existing Tenant rows using year+sequence.

This migration assigns a numeric tenant_id of the form YYYYNNNN where
YYYY is the tenant's created_at year (or current year if missing) and
NNNN is a zero-padded sequence unique within that year. The operation
only updates rows where `tenant_id` is NULL.
"""

from django.db import migrations


def generate_tenant_ids(apps, schema_editor):
    Tenant = apps.get_model('api', 'Tenant')
    from collections import defaultdict
    import datetime

    counts = defaultdict(int)

    qs = Tenant.objects.filter(tenant_id__isnull=True).order_by('created_at', 'pk')
    for t in qs:
        created = getattr(t, 'created_at', None)
        year = created.year if created else datetime.date.today().year
        counts[year] += 1
        new_id = int(f"{year}{counts[year]:04d}")
        # avoid collisions by bumping sequence if needed
        while Tenant.objects.filter(tenant_id=new_id).exists():
            counts[year] += 1
            new_id = int(f"{year}{counts[year]:04d}")
        Tenant.objects.filter(pk=t.pk).update(tenant_id=new_id)


def noop_reverse(apps, schema_editor):
    # No-op reverse: do not attempt to remove generated IDs automatically
    return


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0013_owner_section_rename_unit_number_unit_unit_no_and_more'),
    ]

    operations = [
        migrations.RunPython(generate_tenant_ids, reverse_code=noop_reverse),
    ]
