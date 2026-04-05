import json
import logging

from django.contrib.auth import get_user_model
from django.conf import settings
from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import PushSubscription, MessageLog
from ..serializers import MessageLogSerializer

def send_push_notification(user, title, body, data=None, icon=None, tag=None):
    """
    Send a push notification to all active subscriptions for a user.
    Returns (success_count, fail_count).
    """
    logger = logging.getLogger(__name__)
    
    try:
        from pywebpush import webpush, WebPushException
        from django.conf import settings
        import json
    except ImportError:
        logger.warning('pywebpush not installed, cannot send push notifications')
        return 0, 0

    subscriptions = PushSubscription.objects.filter(user=user, is_active=True)
    if not subscriptions.exists():
        logger.info('No active push subscriptions for user %s', user.username)
        return 0, 0

    vapid_private_key = getattr(settings, 'VAPID_PRIVATE_KEY', None)
    vapid_public_key = getattr(settings, 'VAPID_PUBLIC_KEY', None)
    vapid_claims = getattr(settings, 'VAPID_CLAIMS', {}).copy()
    
    logger.info('VAPID config: public_key=%s..., private_key=%s..., claims=%s', 
                vapid_public_key[:20] if vapid_public_key else None,
                vapid_private_key[:10] if vapid_private_key else None,
                vapid_claims)
    
    if not vapid_private_key:
        logger.warning('VAPID_PRIVATE_KEY not configured')
        return 0, 0

    payload = json.dumps({
        'title': title,
        'body': body,
        'icon': icon or '/vite.svg',
        'tag': tag or 'mpsan-notification',
        'data': data or {},
    })

    success_count = 0
    fail_count = 0

    for sub in subscriptions:
        subscription_info = {
            'endpoint': sub.endpoint,
            'keys': {
                'p256dh': sub.p256dh,
                'auth': sub.auth,
            }
        }
        logger.info('Sending push to endpoint: %s...', sub.endpoint[:50])
        try:
            webpush(
                subscription_info=subscription_info,
                data=payload,
                vapid_private_key=vapid_private_key,
                vapid_claims=vapid_claims,
                ttl=86400,  # 24 hours - required by some push services like WNS
            )
            success_count += 1
            logger.info('Push notification sent successfully to user %s', user.username)
        except WebPushException as e:
            fail_count += 1
            response_text = ''
            response_headers = ''
            if e.response is not None:
                try:
                    response_text = e.response.text[:500] if e.response.text else '(empty)'
                    response_headers = str(dict(e.response.headers))[:500]
                except:
                    pass
            logger.warning('Push notification failed for user %s: %s\nStatus: %s\nResponse body: %s\nResponse headers: %s', 
                          user.username, e, 
                          e.response.status_code if e.response else 'N/A',
                          response_text,
                          response_headers)
            # If subscription is gone (410 Gone), mark it inactive
            if e.response and e.response.status_code in (404, 410):
                sub.is_active = False
                sub.save()
                logger.info('Marked subscription as inactive due to %d response', e.response.status_code)
        except Exception as e:
            fail_count += 1
            logger.exception('Unexpected error sending push notification: %s', e)

    return success_count, fail_count


def send_push_to_all_admins(title, body, data=None, icon=None, tag=None):
    """Send push notification to all admin users with active subscriptions."""
    User = get_user_model()
    admins = User.objects.filter(is_superuser=True) | User.objects.filter(is_staff=True)
    total_success = 0
    total_fail = 0
    for admin in admins:
        s, f = send_push_notification(admin, title, body, data, icon, tag)
        total_success += s
        total_fail += f
    return total_success, total_fail


class PushSubscriptionView(APIView):
    """
    Manage push notification subscriptions.
    POST: Subscribe to push notifications
    DELETE: Unsubscribe from push notifications
    GET: Get subscription status and VAPID public key
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        """Get VAPID public key and subscription status."""
        from django.conf import settings
        vapid_public_key = getattr(settings, 'VAPID_PUBLIC_KEY', None)
        
        subscriptions = PushSubscription.objects.filter(user=request.user, is_active=True)
        
        return Response({
            'vapid_public_key': vapid_public_key,
            'subscribed': subscriptions.exists(),
            'subscription_count': subscriptions.count(),
        })

    def post(self, request):
        """Subscribe to push notifications."""
        endpoint = request.data.get('endpoint')
        p256dh = request.data.get('keys', {}).get('p256dh') or request.data.get('p256dh')
        auth = request.data.get('keys', {}).get('auth') or request.data.get('auth')
        user_agent = request.META.get('HTTP_USER_AGENT', '')[:500]

        if not endpoint or not p256dh or not auth:
            return Response(
                {'detail': 'Missing required fields: endpoint, keys.p256dh, keys.auth'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Update or create subscription
        sub, created = PushSubscription.objects.update_or_create(
            endpoint=endpoint,
            defaults={
                'user': request.user,
                'p256dh': p256dh,
                'auth': auth,
                'user_agent': user_agent,
                'is_active': True,
            }
        )

        return Response({
            'detail': 'Subscribed to push notifications.',
            'created': created,
            'subscription_id': sub.id,
        }, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def delete(self, request):
        """Unsubscribe from push notifications."""
        endpoint = request.data.get('endpoint')
        clear_all = request.data.get('clear_all', False)
        
        if clear_all:
            # Delete ALL subscriptions for this user (useful when VAPID keys change)
            deleted, _ = PushSubscription.objects.filter(user=request.user).delete()
            logging.getLogger(__name__).info('Cleared all %d push subscriptions for user %s', deleted, request.user.username)
        elif endpoint:
            # Delete specific subscription
            deleted, _ = PushSubscription.objects.filter(
                user=request.user, endpoint=endpoint
            ).delete()
        else:
            # Delete all subscriptions for user
            deleted, _ = PushSubscription.objects.filter(user=request.user).delete()

        return Response({
            'detail': f'Unsubscribed from push notifications.',
            'deleted_count': deleted,
        })


class PushNotificationTestView(APIView):
    """Send a test push notification to the current user."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        title = request.data.get('title', 'Test Notification')
        body = request.data.get('body', 'This is a test notification from MP-SAN TMS!')
        
        # Check if user has any subscriptions
        sub_count = PushSubscription.objects.filter(user=request.user, is_active=True).count()
        if sub_count == 0:
            return Response({
                'detail': 'No active push subscriptions found. Please enable notifications first.',
                'subscribed': False,
            }, status=status.HTTP_400_BAD_REQUEST)

        success, fail = send_push_notification(
            request.user,
            title,
            body,
            data={'type': 'test', 'url': '/'},
            tag='mpsan-test'
        )

        return Response({
            'detail': f'Test notification sent to {success} device(s), {fail} failed.',
            'success_count': success,
            'fail_count': fail,
        })


# ─────────────────────────────────────────────────────────────────────────────
# MESSAGE LOGS
# ─────────────────────────────────────────────────────────────────────────────

# (already imported at top)


class MessageLogPagination(PageNumberPagination):
    page_size = 30
    page_size_query_param = 'page_size'
    max_page_size = 200


class MessageLogListView(generics.ListAPIView):
    """List message logs with filtering by property, status, channel, message_type.

    Query params:
      - property_id: filter by property
      - status: 'sent' or 'failed'
      - channel: 'sms', 'email', 'push'
      - message_type: 'manual', 'mass', 'automated', 'payment_confirmation', 'test'
      - search: search tenant_name or recipient
      - page: page number
      - page_size: results per page (default 30, max 200)
    """
    serializer_class = MessageLogSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = MessageLogPagination

    def get_queryset(self):
        qs = MessageLog.objects.all()
        property_id = self.request.query_params.get('property_id')
        if property_id:
            qs = qs.filter(property_id=property_id)
        for field in ('status', 'channel', 'message_type'):
            val = self.request.query_params.get(field)
            if val:
                qs = qs.filter(**{field: val})
        search = self.request.query_params.get('search', '').strip()
        if search:
            from django.db.models import Q
            qs = qs.filter(Q(tenant_name__icontains=search) | Q(recipient__icontains=search))
        return qs


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def message_log_failed_count_view(request):
    """Return count of failed messages (for badge/notification in UI)."""
    property_id = request.query_params.get('property_id')
    since = request.query_params.get('since')
    qs = MessageLog.objects.filter(status='failed')
    if property_id:
        qs = qs.filter(property_id=property_id)
    if since:
        from django.utils.dateparse import parse_datetime
        since_dt = parse_datetime(since)
        if since_dt:
            qs = qs.filter(created_at__gt=since_dt)
    return Response({'failed_count': qs.count()})
