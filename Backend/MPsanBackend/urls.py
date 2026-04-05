"""
URL configuration for MPsanBackend project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from api.views.auth import (
    UserCreateView, EmailTokenObtainPairView, DebugTokenRefreshView,
    change_password_view, verify_two_factor_view,
)

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/user/register/', UserCreateView.as_view(), name='user-register'),
    path('api/user/change-password/', change_password_view, name='change-password-root'),
    path('api/token/', EmailTokenObtainPairView.as_view(), name='get_token'),
    path('api/token/refresh/', DebugTokenRefreshView.as_view(), name='token_refresh'),
    path('api/token/verify-2fa/', verify_two_factor_view, name='verify-2fa'),
    path('api-auth/', include('rest_framework.urls')),
    path('api/', include('api.urls')),
]

# Serve media files in development (in production, use nginx/apache or S3)
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
