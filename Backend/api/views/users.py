import logging

from django.contrib.auth.models import User
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import AuditLog
from ..permissions import IsAdminRole
from ..serializers import UserSerializer
from .utils import get_client_ip


class UserListView(generics.ListAPIView):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]


class AdminUserListCreateView(generics.ListCreateAPIView):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]

    def create(self, request, *args, **kwargs):
        # allow admin to set role when creating users
        role = request.data.get('role')
        serializer = self.get_serializer(data=request.data, context={'role': role})
        serializer.is_valid(raise_exception=True)
        user = serializer.save()

        # Log user creation in audit log
        try:
            AuditLog.objects.create(
                severity='info',
                event='User Created',
                user=request.user.username if request.user.is_authenticated else 'Anonymous',
                ip_address=get_client_ip(request),
                details=f'Created user: {user.username} (ID: {user.id}) with email {user.email} and role {role or "default"}',
                user_ref=request.user if request.user.is_authenticated else None
            )
        except Exception:
            logging.getLogger(__name__).exception('Failed to create audit log for user creation')

        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=201, headers=headers)


class CurrentUserView(generics.RetrieveAPIView):
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user


class UserDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        user_username = instance.username
        user_email = instance.email
        user_id = instance.id

        result = super().destroy(request, *args, **kwargs)

        # Log user deletion in audit log
        try:
            AuditLog.objects.create(
                severity='info',
                event='User Deleted',
                user=request.user.username if request.user.is_authenticated else 'Anonymous',
                ip_address=get_client_ip(request),
                details=f'Deleted user: {user_username} (ID: {user_id}) with email {user_email}',
                user_ref=request.user if request.user.is_authenticated else None
            )
        except Exception:
            logging.getLogger(__name__).exception('Failed to create audit log for user deletion')

        return result
