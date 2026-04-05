from urllib.parse import parse_qs
from channels.middleware import BaseMiddleware
from channels.db import database_sync_to_async
import logging
from django.http import JsonResponse

class JwtAuthMiddleware(BaseMiddleware):
    """Middleware that takes a JWT token from the querystring `?token=` and
    authenticates the user for WebSocket connections.

    If no token is provided or validation fails, falls back to AnonymousUser.
    """

    async def resolve_scope(self, scope):
        scope = dict(scope)
        # Prefer Authorization header (Bearer), fall back to query param `?token=` for convenience
        token = None
        try:
            headers = {k.decode().lower(): v.decode() for k, v in scope.get('headers', [])}
        except Exception:
            headers = {}

        auth_header = headers.get('authorization')
        if auth_header:
            if auth_header.lower().startswith('bearer '):
                token = auth_header.split(' ', 1)[1].strip()

        # accept token via WebSocket subprotocol (safer than query string)
        if not token:
            subproto = headers.get('sec-websocket-protocol')
            if subproto:
                try:
                    token = subproto.split(',')[0].strip()
                except Exception:
                    token = None

        if not token:
            try:
                query_string = scope.get('query_string', b'').decode()
            except Exception:
                query_string = ''
            params = parse_qs(query_string)
            token_list = params.get('token') or params.get('access_token')
            if token_list:
                token = token_list[0]

        if not token:
            # import here to avoid touching Django app registry at module import time
            from django.contrib.auth.models import AnonymousUser

            scope['user'] = AnonymousUser()
            return scope

        try:
            # import Django-dependent modules lazily to avoid AppRegistryNotReady during ASGI import
            from django.conf import settings
            from rest_framework_simplejwt.backends import TokenBackend
            from django.contrib.auth import get_user_model
            tb = TokenBackend(algorithm=settings.SIMPLE_JWT.get('ALGORITHM', 'HS256'), signing_key=settings.SECRET_KEY)
            validated = tb.decode(token, verify=True)
            user_id = validated.get(settings.SIMPLE_JWT.get('USER_ID_CLAIM', 'user_id'))
            if user_id is None:
                from django.contrib.auth.models import AnonymousUser
                scope['user'] = AnonymousUser()
                return scope
            User = get_user_model()
            user = await database_sync_to_async(User.objects.get)(pk=user_id)
            scope['user'] = user
        except Exception as exc:
            logging.exception('WebSocket JWT auth failed: %s', exc)
            from django.contrib.auth.models import AnonymousUser

            scope['user'] = AnonymousUser()
        return scope


class SessionValidationMiddleware:
    """
    HTTP Middleware to validate that the session_id in the JWT token is still active.
    This ensures that when a session is revoked, the user is logged out immediately
    on their next API request, even if the access token hasn't expired yet.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Check if this is an authenticated request with a JWT token
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')

        if auth_header.startswith('Bearer '):
            token_str = auth_header.split(' ')[1]

            try:
                # Import here to avoid Django app registry issues at module import time
                from rest_framework_simplejwt.tokens import AccessToken
                from rest_framework_simplejwt.exceptions import TokenError

                # Decode the access token
                token = AccessToken(token_str)
                session_id = token.get('session_id')

                # If token has a session_id, check if it's still active
                if session_id:
                    from api.models import UserSession
                    from django.utils import timezone

                    try:
                        session = UserSession.objects.get(session_id=session_id)

                        # Check if session is active and not expired
                        if not session.is_active or session.expires_at < timezone.now():
                            return JsonResponse(
                                {
                                    'detail': 'Session has been revoked or expired',
                                    'code': 'session_revoked'
                                },
                                status=401
                            )

                        # Update last_activity timestamp
                        session.last_activity = timezone.now()
                        session.save(update_fields=['last_activity'])

                    except UserSession.DoesNotExist:
                        # Session doesn't exist - token is invalid
                        return JsonResponse(
                            {
                                'detail': 'Session not found',
                                'code': 'session_not_found'
                            },
                            status=401
                        )

            except TokenError:
                # Invalid token - let Django REST Framework handle it
                pass
            except Exception:
                # Unexpected error - let the request continue
                # (don't block valid requests due to middleware errors)
                pass

        # Continue with the request
        response = self.get_response(request)
        return response
