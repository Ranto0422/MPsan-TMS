# Migration to add tenant_name and tenant_layout_id if not already present.
# Idempotent: safe when 0035 already created the table with these columns (e.g. Docker).

from django.db import migrations


def add_columns_if_missing(apps, schema_editor):
    conn = schema_editor.connection
    with conn.cursor() as cursor:
        cursor.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'api_scheduledautomatedmessage' AND column_name = 'tenant_name';
        """)
        if cursor.fetchone() is None:
            cursor.execute("""
                ALTER TABLE api_scheduledautomatedmessage
                ADD COLUMN tenant_name varchar(100) NOT NULL DEFAULT '';
            """)
        cursor.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'api_scheduledautomatedmessage' AND column_name = 'tenant_layout_id';
        """)
        if cursor.fetchone() is None:
            cursor.execute("""
                ALTER TABLE api_scheduledautomatedmessage
                ADD COLUMN tenant_layout_id bigint NULL;
            """)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0035_automated_messaging'),
    ]

    operations = [
        migrations.RunPython(add_columns_if_missing, noop_reverse),
    ]
