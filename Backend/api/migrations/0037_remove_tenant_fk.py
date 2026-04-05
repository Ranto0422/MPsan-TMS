# Migration to remove tenant FK from ScheduledAutomatedMessage
# Tenant data comes from layouts JSON, not the Tenant table

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0036_add_tenant_name_fields'),
    ]

    operations = [
        # Use raw SQL to properly handle the constraint changes
        migrations.RunSQL(
            # Forward SQL - remove FK and old constraint, add new constraint
            sql="""
                -- Drop the foreign key constraint first
                ALTER TABLE api_scheduledautomatedmessage 
                DROP CONSTRAINT IF EXISTS api_scheduledautomat_tenant_id_696396b2_fk_api_tenan;
                
                -- Drop any unique constraint that involves tenant
                ALTER TABLE api_scheduledautomatedmessage
                DROP CONSTRAINT IF EXISTS api_scheduledautomatedmessage_tenant_id_due_date_days_be_key;
                
                -- Drop the tenant_id column
                ALTER TABLE api_scheduledautomatedmessage
                DROP COLUMN IF EXISTS tenant_id;
                
                -- Make tenant_name NOT NULL (set default for any nulls first)
                UPDATE api_scheduledautomatedmessage SET tenant_name = 'Unknown' WHERE tenant_name IS NULL OR tenant_name = '';
                ALTER TABLE api_scheduledautomatedmessage ALTER COLUMN tenant_name SET NOT NULL;
                
                -- Make tenant_layout_id NOT NULL (set default for any nulls first)  
                UPDATE api_scheduledautomatedmessage SET tenant_layout_id = 0 WHERE tenant_layout_id IS NULL;
                ALTER TABLE api_scheduledautomatedmessage ALTER COLUMN tenant_layout_id SET NOT NULL;
                
                -- Add new unique constraint without tenant
                ALTER TABLE api_scheduledautomatedmessage
                ADD CONSTRAINT api_scheduledautomatedmessage_prop_room_due_days_uniq
                UNIQUE (property_id, room_number, due_date, days_before_due);
            """,
            # Reverse SQL - recreate the tenant_id column (won't restore data)
            reverse_sql="""
                -- Remove new constraint
                ALTER TABLE api_scheduledautomatedmessage
                DROP CONSTRAINT IF EXISTS api_scheduledautomatedmessage_prop_room_due_days_uniq;
                
                -- Add tenant_id column back
                ALTER TABLE api_scheduledautomatedmessage
                ADD COLUMN tenant_id BIGINT NULL;
                
                -- Make tenant_name nullable again
                ALTER TABLE api_scheduledautomatedmessage ALTER COLUMN tenant_name DROP NOT NULL;
                
                -- Make tenant_layout_id nullable again
                ALTER TABLE api_scheduledautomatedmessage ALTER COLUMN tenant_layout_id DROP NOT NULL;
            """
        ),
    ]
