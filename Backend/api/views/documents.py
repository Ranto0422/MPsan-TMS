import logging

from django.conf import settings
from rest_framework import generics, serializers, status
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import Tenant, AuditLog, TenantDocument
from ..serializers import TenantDocumentSerializer, TenantDocumentUploadSerializer
from .utils import get_client_ip

class TenantDocumentListCreateView(generics.ListCreateAPIView):
    """List all documents for a tenant or create a single document."""
    serializer_class = TenantDocumentSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        tenant_id = self.kwargs.get('pk')
        return TenantDocument.objects.filter(tenant_id=tenant_id)

    def perform_create(self, serializer):
        tenant_id = self.kwargs.get('pk')
        file_obj = self.request.FILES.get('file')

        # Get tenant (verify it exists)
        try:
            tenant = Tenant.objects.get(tenant_id=tenant_id)
        except Tenant.DoesNotExist:
            raise serializers.ValidationError({'tenant': 'Tenant not found'})

        serializer.save(
            tenant=tenant,
            created_by=self.request.user,
            original_filename=file_obj.name if file_obj else '',
            file_size=file_obj.size if file_obj else 0,
            mime_type=file_obj.content_type if file_obj else '',
        )

        # Log the upload
        try:
            AuditLog.objects.create(
                severity='info',
                event='Document Uploaded',
                user=self.request.user.username if self.request.user.is_authenticated else 'Anonymous',
                ip_address=get_client_ip(self.request),
                details=f"Document '{file_obj.name if file_obj else 'unknown'}' uploaded for tenant {tenant.full_name} (ID: {tenant_id})",
            )
        except Exception:
            logging.getLogger(__name__).exception('Failed to create audit log for document upload')


class TenantDocumentUploadView(APIView):
    """Upload multiple documents for a tenant at once."""
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, pk):
        # Verify tenant exists
        try:
            tenant = Tenant.objects.get(tenant_id=pk)
        except Tenant.DoesNotExist:
            return Response({'error': 'Tenant not found'}, status=status.HTTP_404_NOT_FOUND)

        # Get files from request
        files = request.FILES.getlist('files')
        if not files:
            # Also check for single file upload
            single_file = request.FILES.get('file')
            if single_file:
                files = [single_file]
            else:
                return Response({'error': 'No files provided'}, status=status.HTTP_400_BAD_REQUEST)

        document_type = request.data.get('document_type', 'other')
        description = request.data.get('description', '')
        is_primary_id = request.data.get('is_primary_id', 'false').lower() in ('true', '1', 'yes')

        # Validate file types and sizes
        max_size = getattr(settings, 'MAX_UPLOAD_SIZE', 10 * 1024 * 1024)
        allowed_types = getattr(settings, 'ALLOWED_DOCUMENT_TYPES', [
            'application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'image/bmp', 'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ])

        errors = []
        for f in files:
            if f.size > max_size:
                errors.append(f"File '{f.name}' exceeds maximum size of {max_size / 1024 / 1024:.0f}MB")
            if f.content_type not in allowed_types:
                errors.append(f"File '{f.name}' has unsupported type '{f.content_type}'")

        if errors:
            return Response({'errors': errors}, status=status.HTTP_400_BAD_REQUEST)

        # If marking as primary ID, unset any existing primary
        if is_primary_id and document_type == 'id_photo':
            TenantDocument.objects.filter(
                tenant=tenant, is_primary_id=True
            ).update(is_primary_id=False)

        # Create document records
        created_docs = []
        for f in files:
            doc = TenantDocument.objects.create(
                tenant=tenant,
                document_type=document_type,
                file=f,
                original_filename=f.name,
                file_size=f.size,
                mime_type=f.content_type,
                description=description,
                is_primary_id=is_primary_id and document_type == 'id_photo',
                created_by=request.user,
            )
            created_docs.append(doc)

            # Only first file gets primary status in batch upload
            is_primary_id = False

        # Update tenant's id_photo_url if this is a primary ID photo
        primary_doc = next((d for d in created_docs if d.is_primary_id), None)
        if primary_doc:
            tenant.id_photo_url = primary_doc.file.url
            tenant.save(update_fields=['id_photo_url'])

        # Log the upload
        try:
            AuditLog.objects.create(
                severity='info',
                event='Documents Uploaded',
                user=request.user.username if request.user.is_authenticated else 'Anonymous',
                ip_address=get_client_ip(request),
                details=f"{len(created_docs)} document(s) uploaded for tenant {tenant.full_name} (ID: {pk})",
            )
        except Exception:
            logging.getLogger(__name__).exception('Failed to create audit log for document upload')

        # Return created documents
        serializer = TenantDocumentSerializer(created_docs, many=True, context={'request': request})
        return Response({
            'message': f'{len(created_docs)} document(s) uploaded successfully',
            'documents': serializer.data
        }, status=status.HTTP_201_CREATED)


class TenantDocumentDetailView(APIView):
    """Retrieve, update, or delete a specific tenant document."""
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get_object(self, pk, doc_id):
        try:
            return TenantDocument.objects.get(tenant_id=pk, document_id=doc_id)
        except TenantDocument.DoesNotExist:
            return None

    def get(self, request, pk, doc_id):
        doc = self.get_object(pk, doc_id)
        if not doc:
            return Response({'error': 'Document not found'}, status=status.HTTP_404_NOT_FOUND)

        serializer = TenantDocumentSerializer(doc, context={'request': request})
        return Response(serializer.data)

    def patch(self, request, pk, doc_id):
        doc = self.get_object(pk, doc_id)
        if not doc:
            return Response({'error': 'Document not found'}, status=status.HTTP_404_NOT_FOUND)

        # Update allowed fields
        if 'document_type' in request.data:
            doc.document_type = request.data['document_type']
        if 'description' in request.data:
            doc.description = request.data['description']
        if 'is_primary_id' in request.data:
            is_primary = request.data['is_primary_id']
            if isinstance(is_primary, str):
                is_primary = is_primary.lower() in ('true', '1', 'yes')

            if is_primary and doc.document_type == 'id_photo':
                # Unset other primary IDs for this tenant
                TenantDocument.objects.filter(
                    tenant_id=pk, is_primary_id=True
                ).exclude(document_id=doc_id).update(is_primary_id=False)
                doc.is_primary_id = True

                # Update tenant's id_photo_url
                doc.tenant.id_photo_url = doc.file.url
                doc.tenant.save(update_fields=['id_photo_url'])
            else:
                doc.is_primary_id = False

        doc.save()

        serializer = TenantDocumentSerializer(doc, context={'request': request})
        return Response(serializer.data)

    def delete(self, request, pk, doc_id):
        doc = self.get_object(pk, doc_id)
        if not doc:
            return Response({'error': 'Document not found'}, status=status.HTTP_404_NOT_FOUND)

        filename = doc.original_filename
        tenant_name = doc.tenant.full_name

        # If this was the primary ID, clear tenant's id_photo_url
        if doc.is_primary_id:
            doc.tenant.id_photo_url = ''
            doc.tenant.save(update_fields=['id_photo_url'])

        # Delete the document (this also deletes the file from storage)
        doc.delete()

        # Log the deletion
        try:
            AuditLog.objects.create(
                severity='info',
                event='Document Deleted',
                user=request.user.username if request.user.is_authenticated else 'Anonymous',
                ip_address=get_client_ip(request),
                details=f"Document '{filename}' deleted for tenant {tenant_name} (ID: {pk})",
            )
        except Exception:
            logging.getLogger(__name__).exception('Failed to create audit log for document deletion')

        return Response({'message': 'Document deleted successfully'}, status=status.HTTP_204_NO_CONTENT)
