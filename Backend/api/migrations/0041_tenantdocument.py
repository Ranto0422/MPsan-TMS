# Migration for TenantDocument model

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import api.models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('api', '0040_sync_tenant_layout_id_nonnullable'),
    ]

    operations = [
        migrations.CreateModel(
            name='TenantDocument',
            fields=[
                ('document_id', models.AutoField(primary_key=True, serialize=False)),
                ('document_type', models.CharField(
                    choices=[
                        ('id_photo', 'ID Photo'),
                        ('contract', 'Contract'),
                        ('proof_of_billing', 'Proof of Billing'),
                        ('authorization', 'Authorization Letter'),
                        ('other', 'Other Document'),
                    ],
                    default='other',
                    max_length=50,
                )),
                ('file', models.FileField(upload_to=api.models.tenant_document_path)),
                ('original_filename', models.CharField(help_text='Original filename when uploaded', max_length=255)),
                ('file_size', models.PositiveIntegerField(help_text='File size in bytes')),
                ('mime_type', models.CharField(help_text='MIME type of the file', max_length=100)),
                ('description', models.CharField(blank=True, help_text='Optional description of the document', max_length=255)),
                ('extracted_data', models.JSONField(blank=True, default=dict, help_text='AI-extracted data from document (OCR, etc.)')),
                ('is_primary_id', models.BooleanField(default=False, help_text='If True, this is the primary ID photo for the tenant')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='uploaded_documents',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('tenant', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='documents',
                    to='api.tenant',
                    to_field='tenant_id',
                )),
            ],
            options={
                'verbose_name': 'Tenant Document',
                'verbose_name_plural': 'Tenant Documents',
                'ordering': ['-created_at'],
            },
        ),
    ]
