from django.urls import path
from .consumers import PropertyConsumer

websocket_urlpatterns = [
    path('ws/properties/<int:pk>/', PropertyConsumer.as_asgi()),
]
