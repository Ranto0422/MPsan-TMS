from django.contrib.auth.models import User
from django.db.models import Q
from rest_framework import generics
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated

from ..models import AuditLog, Property
from ..serializers import AuditLogSerializer

class AuditLogPagination(PageNumberPagination):
    page_size = 30
    page_size_query_param = 'page_size'
    max_page_size = 100


class AuditLogListView(generics.ListAPIView):
    queryset = AuditLog.objects.all()
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = AuditLogPagination

    def get_queryset(self):
        user = self.request.user
        from django.db.models import Q

        # Admin action events — visible to owners and managers so they can
        # see what the admin has done that affects them
        admin_action_events = [
            'Building Created',
            'Building Deleted',
            'User Created',
            'User Deleted',
            'Owner Assigned',
            'Owner Deassigned',
            'Owner Changed',
            'Manager Assigned',
            'Manager Deassigned',
        ]

        is_admin = user.is_superuser or getattr(user, 'is_staff', False) or (getattr(getattr(user, 'userprofile', None), 'role', None) == 'admin')
        role = getattr(getattr(user, 'userprofile', None), 'role', None)

        if is_admin:
            # Admin sees ALL logs
            qs = AuditLog.objects.all()
        elif role == 'owner':
            # Owner sees:
            # 1. Their own logs (actions they performed)
            # 2. Logs for their buildings (actions anyone did on their properties)
            # 3. Logs by their managers (actions their managers performed)
            # 4. Admin action logs (what admin did)
            owned_properties = Property.objects.filter(owner__user=user)
            manager_users = User.objects.filter(managed_properties__in=owned_properties).distinct()

            qs = AuditLog.objects.filter(
                Q(user_ref=user) |                              # own logs
                Q(property_ref__in=owned_properties) |          # logs on their buildings
                Q(user_ref__in=manager_users) |                 # their managers' logs
                Q(event__in=admin_action_events)                # admin actions
            ).distinct()
        elif role == 'manager':
            # Manager sees:
            # 1. Their own logs (actions they performed)
            # 2. Logs for properties they manage
            # 3. Admin action logs (what admin did)
            managed_properties = Property.objects.filter(managers=user)

            qs = AuditLog.objects.filter(
                Q(user_ref=user) |                              # own logs
                Q(property_ref__in=managed_properties) |        # logs on managed properties
                Q(event__in=admin_action_events)                # admin actions
            ).distinct()
        else:
            # Other users see only admin action logs
            qs = AuditLog.objects.filter(event__in=admin_action_events)

        qs = qs.order_by('-timestamp')
        
        # Filter by severity if provided
        severity = self.request.query_params.get('severity')
        if severity and severity in ['info', 'warning', 'critical']:
            qs = qs.filter(severity=severity)
        
        # Search functionality - search across event, user, and details
        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(
                Q(event__icontains=search) |
                Q(user__icontains=search) |
                Q(details__icontains=search)
            )
        
        return qs


class AuditLogDetailView(generics.RetrieveAPIView):
    queryset = AuditLog.objects.all()
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuthenticated]
