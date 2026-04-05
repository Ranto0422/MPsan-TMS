"""
ASGI config for MPsanBackend project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.2/howto/deployment/asgi/
"""

import os

from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from api.jwt_middleware import JwtAuthMiddleware

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'MPsanBackend.settings')

django_asgi_app = get_asgi_application()

from api import routing as api_routing

application = ProtocolTypeRouter({
	'http': django_asgi_app,
	'websocket': JwtAuthMiddleware(
		AuthMiddlewareStack(
			URLRouter(api_routing.websocket_urlpatterns)
		)
	),
})
