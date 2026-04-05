from rest_framework.permissions import BasePermission


class IsAdminRole(BasePermission):
    message = 'Requires admin role.'

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        # superuser counts as admin
        if getattr(user, 'is_superuser', False):
            return True
        profile = getattr(user, 'userprofile', None)
        if not profile:
            return False
        return profile.role == 'admin'
