import os
import re
import copy
import json
import logging
import time
import calendar
from datetime import datetime, timedelta, date

import requests
from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import (
    Tenant, Property, ScheduledTestMessage, AutomatedMessageSettings,
    ScheduledAutomatedMessage, TenantMessageSchedule, MessageLog, PushSubscription,
)
from ..serializers import (
    AutomatedMessageSettingsSerializer, ScheduledAutomatedMessageSerializer,
    TenantMessageScheduleSerializer,
)
from ..email_service import send_rent_reminder_email, send_owner_notification_email, is_email_configured
from .utils import get_client_ip, format_room_display, _normalize_room_for_compare, _iter_layout_boxes

# Deduplication dict for overdue notifications: {(property_id, YYYY-MM-DD): True}
_overdue_notified_today: dict = {}

def _tenant_ids_from_property_layouts(property_id):
    """Collect unique tenant IDs (pk) from a property's layout boxes."""
    try:
        prop = Property.objects.get(pk=property_id)
    except Property.DoesNotExist:
        return []
    layouts = prop.layouts or {}
    seen = set()
    out = []
    for b, _ in _iter_layout_boxes(layouts):
        tenant_data = b.get('tenant') if isinstance(b.get('tenant'), dict) else None
        if not tenant_data:
            continue
        tid = tenant_data.get('tenant_id') or tenant_data.get('id')
        if tid is not None and tid not in seen:
            seen.add(tid)
            out.append(tid)
    return out


def _normalize_phone(phone):
    """
    Normalize phone number for SMS Gate API.
    Converts Philippine local 09xxxxxxxxx (11 digits) to +639xxxxxxxxx.
    Returns phone in E.164 format with + prefix.
    """
    if not phone or not isinstance(phone, str):
        return None
    digits = ''.join(c for c in phone if c.isdigit())
    if not digits:
        return None
    # Philippine local: 09xxxxxxxxx (11 digits) -> 639xxxxxxxxx
    if digits.startswith('0') and len(digits) == 11:
        digits = '63' + digits[1:]
    # Return with + prefix for E.164 format
    return '+' + digits


def _log_message(recipient, channel, message_type, message, status='sent',
                  error_message='', tenant_name='', tenant_id=None,
                  property_obj=None, room_number='', sent_by=None, subject=''):
    """Log a sent or failed message to the MessageLog table."""
    try:
        MessageLog.objects.create(
            property=property_obj,
            tenant_name=tenant_name,
            tenant_id=tenant_id,
            recipient=recipient,
            channel=channel,
            message_type=message_type,
            subject=subject,
            message=message[:2000] if message else '',
            status=status,
            error_message=error_message,
            room_number=room_number,
            sent_by=sent_by,
        )
    except Exception as e:
        logging.getLogger(__name__).warning('Failed to write message log: %s', e)


def _send_sms_to_phones(message_text, numbers):
    """
    Send SMS to a list of phone numbers via the configured Android SMS Gateway.
    Returns (success: bool, detail: str). detail is error message if success is False.
    Reference: https://capcom6.github.io/android-sms-gateway/
    """
    if not message_text or not numbers:
        return False, 'Message and phone numbers are required.'
    numbers = [n for n in numbers if n]
    if not numbers:
        return False, 'No valid phone numbers.'
    username = getattr(settings, 'SMS_GATEWAY_USERNAME', None) or os.environ.get('SMS_GATEWAY_USERNAME')
    password = getattr(settings, 'SMS_GATEWAY_PASSWORD', None) or os.environ.get('SMS_GATEWAY_PASSWORD')
    raw_url = (getattr(settings, 'SMS_GATEWAY_URL', None) or os.environ.get('SMS_GATEWAY_URL') or 'https://api.sms-gate.app/3rdparty/v1').strip()
    if not raw_url.startswith('http://') and not raw_url.startswith('https://'):
        raw_url = 'https://' + raw_url
    base_url = raw_url.rstrip('/')
    if '/3rdparty/v1' not in base_url:
        base_url = base_url.rstrip('/') + '/3rdparty/v1'
    base_url = base_url.rstrip('/')
    if not username or not password:
        return False, 'SMS gateway credentials not configured.'
    # Add skipPhoneValidation=true to handle international number formats
    url = f'{base_url}/messages?skipPhoneValidation=true'
    # Use 'message' field (deprecated but more compatible) for simplicity
    payload = {'phoneNumbers': numbers, 'message': message_text}
    logger = logging.getLogger(__name__)
    logger.info('SMS Gateway request: url=%s, phones=%s, msg_len=%d', url, numbers, len(message_text))
    try:
        r = requests.post(url, json=payload, auth=(username, password), headers={'Content-Type': 'application/json'}, timeout=30)
    except requests.RequestException as e:
        logger.exception('SMS gateway request failed: %s', e)
        return False, str(e)
    logger.info('SMS Gateway response: status=%d, body=%s', r.status_code, r.text[:500] if r.text else '')
    if r.status_code in (200, 202):
        return True, None
    try:
        err_body = r.json()
        detail = err_body.get('message', r.text or f'HTTP {r.status_code}')
    except Exception:
        detail = r.text or f'HTTP {r.status_code}'
    return False, detail


def process_scheduled_test_messages():
    """Send any scheduled test messages whose send_at time has passed. Call from a background thread or cron."""
    from django.utils import timezone
    from .push_notifications import send_push_notification
    logger = logging.getLogger(__name__)
    now = timezone.now()
    
    # Log how many pending messages exist
    total_pending = ScheduledTestMessage.objects.filter(sent=False).count()
    pending = ScheduledTestMessage.objects.filter(sent=False, send_at__lte=now).order_by('send_at')
    ready_count = pending.count()
    
    if total_pending > 0 or ready_count > 0:
        logger.info('Scheduled messages: %d total pending, %d ready to send (now=%s)', total_pending, ready_count, now.isoformat())
    
    for obj in pending:
        logger.info('Processing scheduled message id=%s, send_at=%s, phone=%s, email=%s', obj.id, obj.send_at, obj.phone_number, obj.email)
        sms_ok = False
        email_ok = False
        results = []

        # --- SMS ---
        phone = _normalize_phone(obj.phone_number) if obj.phone_number else None
        if obj.phone_number and not phone:
            logger.warning('Scheduled message id=%s has invalid phone number: %s', obj.id, obj.phone_number)
            results.append(f'SMS failed: invalid phone {obj.phone_number}')
        elif phone:
            logger.info('Sending scheduled SMS id=%s to phone=%s', obj.id, phone)
            sms_ok, sms_err = _send_sms_to_phones(obj.message, [phone])
            if sms_ok:
                logger.info('Scheduled test SMS id=%s sent successfully to %s', obj.id, phone)
                _log_message(phone, 'sms', 'test', obj.message, 'sent', sent_by=obj.created_by)
                results.append(f'SMS sent to {phone}')
            else:
                logger.warning('Scheduled test SMS id=%s send failed: %s', obj.id, sms_err)
                _log_message(phone, 'sms', 'test', obj.message, 'failed',
                             error_message=sms_err or '', sent_by=obj.created_by)
                results.append(f'SMS failed: {(sms_err or "unknown error")[:80]}')

        # --- Email ---
        if obj.email:
            logger.info('Sending scheduled test email id=%s to %s', obj.id, obj.email)
            try:
                from ..email_service import send_generic_styled_email
                # Get property name from the user's associated property
                property_name = 'MPSAN'
                try:
                    from ..models import Property
                    prop = Property.objects.filter(owner__user=obj.created_by).first()
                    if prop:
                        property_name = prop.name
                except Exception:
                    pass
                email_ok, email_err = send_generic_styled_email(
                    to_email=obj.email,
                    subject='Test Automated Message',
                    message_body=obj.message,
                    property_name=property_name,
                )
                if email_ok:
                    logger.info('Scheduled test email id=%s sent to %s', obj.id, obj.email)
                    _log_message(obj.email, 'email', 'test', obj.message, 'sent', sent_by=obj.created_by)
                    results.append(f'Email sent to {obj.email}')
                else:
                    logger.warning('Scheduled test email id=%s failed: %s', obj.id, email_err)
                    _log_message(obj.email, 'email', 'test', obj.message, 'failed',
                                 error_message=email_err or '', sent_by=obj.created_by)
                    results.append(f'Email failed: {(email_err or "unknown error")[:80]}')
            except Exception as e:
                logger.exception('Scheduled test email id=%s exception: %s', obj.id, e)
                results.append(f'Email error: {str(e)[:80]}')

        # Mark as sent
        obj.sent = True
        obj.sent_at = now
        obj.save()

        # Send push notification with combined results
        if obj.created_by:
            any_ok = sms_ok or email_ok
            title = 'Test Message Sent' if any_ok else 'Test Message Failed'
            body = '; '.join(results) if results else 'No channels configured'
            try:
                send_push_notification(
                    obj.created_by, title, body,
                    data={'type': 'test_message_result', 'message_id': obj.id},
                    tag='mpsan-test-result'
                )
            except Exception:
                pass
    
    # Also process automated messages
    try:
        process_scheduled_automated_messages()
    except Exception as e:
        logger.exception('Error processing automated messages: %s', e)
    # Notify owners/managers of overdue tenants (once per property per day)
    try:
        check_and_notify_overdue_tenants()
    except Exception as e:
        logger.exception('Error in overdue tenant check: %s', e)


def _is_box_overdue_py(box, today):
    """Python port of frontend isBoxOverdue(). Returns True if room rent is overdue."""
    import calendar as cal_mod
    from datetime import date as date_cls
    tenant = box.get('tenant')
    if not tenant or box.get('status') != 'occupied':
        return False
    try:
        monthly_rent = float(str(box.get('payment') or tenant.get('payment') or tenant.get('rent') or 0).replace(',', ''))
    except (ValueError, TypeError):
        monthly_rent = 0
    if monthly_rent <= 0:
        return False
    move_in_str = tenant.get('move_in') or tenant.get('date_of_occupancy')
    if not move_in_str:
        return False
    try:
        mi = move_in_str if hasattr(move_in_str, 'year') else date_cls.fromisoformat(str(move_in_str)[:10])
    except (ValueError, TypeError):
        return False
    year, month = today.year, today.month
    last_day = cal_mod.monthrange(year, month)[1]
    due_date = date_cls(year, month, min(mi.day, last_day))
    if due_date <= mi:
        nm = month % 12 + 1
        ny = year + 1 if month == 12 else year
        due_date = date_cls(ny, nm, min(mi.day, cal_mod.monthrange(ny, nm)[1]))
    if today <= due_date:
        return False
    transactions = box.get('transactions') or []
    tenant_id = str(tenant.get('tenant_id') or tenant.get('id') or '')
    rent_types = {'rent', 'monthly_rent', 'monthly rent'}
    paid = 0.0
    has_tx = False
    for t in transactions:
        if tenant_id:
            tx_tid = str(t.get('tenant_id') or t.get('tenant') or '')
            if tx_tid and tx_tid != tenant_id:
                continue
        if str(t.get('payment_type') or '').lower().strip() not in rent_types:
            continue
        try:
            tx_date = date_cls.fromisoformat(str(t.get('timestamp') or t.get('date') or '')[:10])
        except (ValueError, TypeError):
            continue
        if tx_date.year != year or tx_date.month != month:
            continue
        has_tx = True
        try:
            paid += float(str(t.get('amount') or 0).replace(',', ''))
        except (ValueError, TypeError):
            pass
    return not has_tx or paid < monthly_rent


def check_and_notify_overdue_tenants():
    """Scan all properties for overdue tenants; send push to owner+managers once per day."""
    from django.utils import timezone
    from .push_notifications import send_push_notification
    from ..models import Property, AutomatedMessageSettings
    logger = logging.getLogger(__name__)
    today = timezone.localdate()
    today_str = today.isoformat()

    properties = (Property.objects
        .filter(is_archived=False)
        .select_related('owner__user')
        .prefetch_related('managers'))
    for prop in properties:
        key = (prop.pk, today_str)
        if _overdue_notified_today.get(key):
            continue
        try:
            if not prop.automated_message_settings.pwa_notifications_enabled:
                continue
        except AutomatedMessageSettings.DoesNotExist:
            pass

        overdue_rooms = []
        for variant_boxes in (prop.layouts or {}).values():
            if not isinstance(variant_boxes, list):
                continue
            for box in variant_boxes:
                if isinstance(box, dict) and _is_box_overdue_py(box, today):
                    room_no = box.get('number') or box.get('room_number') or box.get('label') or '?'
                    t_info = box.get('tenant') or {}
                    tenant_name = t_info.get('full_name') or 'Unknown'
                    overdue_rooms.append(f'Room {room_no} – {tenant_name}')

        if not overdue_rooms:
            continue

        _overdue_notified_today[key] = True
        count = len(overdue_rooms)
        if count == 1:
            notif_title = f'⚠️ Overdue Rent – {prop.name}'
            notif_body = overdue_rooms[0] + ' has not paid rent this month.'
        else:
            notif_title = f'⚠️ {count} Overdue Tenants – {prop.name}'
            notif_body = '; '.join(overdue_rooms[:3])
            if count > 3:
                notif_body += f', and {count - 3} more.'

        notif_data = {'type': 'overdue_alert', 'property_id': prop.pk, 'url': '/dashboard'}
        notif_tag = f'mpsan-overdue-{prop.pk}-{today_str}'

        users_to_notify = []
        try:
            owner = prop.owner
            if owner and owner.user:
                users_to_notify.append(('owner', owner.user))
        except Exception:
            pass
        try:
            for mgr in prop.managers.all():
                if mgr not in [u[1] for u in users_to_notify]:
                    users_to_notify.append(('manager', mgr))
        except Exception:
            pass

        for role, user in users_to_notify:
            try:
                send_push_notification(user, notif_title, notif_body,
                    data=notif_data, tag=notif_tag)
            except Exception:
                logger.exception('Overdue push failed for %s (%s) property %s', role, user.pk, prop.pk)

        logger.info('Overdue push sent: %s — %d overdue, %d recipients',
            prop.name, count, len(users_to_notify))

    # Prune old keys to avoid unbounded growth
    for k in [k for k in list(_overdue_notified_today) if k[1] != today_str]:
        del _overdue_notified_today[k]

class SMSGatewayDiagnosticView(APIView):
    """
    Diagnostic endpoint to test SMS gateway connectivity and configuration.
    GET: Check configuration and test health endpoint
    POST: Send a test SMS to verify full pipeline
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        """Check SMS gateway configuration and health."""
        username = getattr(settings, 'SMS_GATEWAY_USERNAME', None) or os.environ.get('SMS_GATEWAY_USERNAME')
        password = getattr(settings, 'SMS_GATEWAY_PASSWORD', None) or os.environ.get('SMS_GATEWAY_PASSWORD')
        raw_url = (getattr(settings, 'SMS_GATEWAY_URL', None) or os.environ.get('SMS_GATEWAY_URL') or 'https://api.sms-gate.app/3rdparty/v1').strip()
        if not raw_url.startswith('http://') and not raw_url.startswith('https://'):
            raw_url = 'https://' + raw_url
        base_url = raw_url.rstrip('/')
        if '/3rdparty/v1' not in base_url:
            base_url = base_url.rstrip('/') + '/3rdparty/v1'
        base_url = base_url.rstrip('/')

        result = {
            'configured': bool(username and password),
            'username': username[:4] + '***' if username else None,
            'base_url': base_url,
            'health_check': None,
            'devices': None,
        }

        if not username or not password:
            result['error'] = 'SMS_GATEWAY_USERNAME or SMS_GATEWAY_PASSWORD not configured'
            return Response(result, status=status.HTTP_200_OK)

        # Test health endpoint (no auth required)
        try:
            health_url = f'{base_url}/health'
            r = requests.get(health_url, timeout=10)
            result['health_check'] = {
                'status_code': r.status_code,
                'ok': r.status_code == 200,
                'response': r.json() if r.status_code == 200 else r.text[:500],
            }
        except Exception as e:
            result['health_check'] = {'error': str(e)}

        # Test auth by fetching devices list
        try:
            devices_url = f'{base_url}/devices'
            r = requests.get(devices_url, auth=(username, password), headers={'Content-Type': 'application/json'}, timeout=15)
            if r.status_code == 200:
                try:
                    devices = r.json()
                    result['devices'] = {
                        'ok': True,
                        'count': len(devices) if isinstance(devices, list) else 0,
                        'devices': devices[:5] if isinstance(devices, list) else devices,
                    }
                except Exception:
                    result['devices'] = {'ok': True, 'raw': r.text[:500]}
            else:
                result['devices'] = {
                    'ok': False,
                    'status_code': r.status_code,
                    'error': r.text[:500],
                }
        except Exception as e:
            result['devices'] = {'error': str(e)}

        return Response(result, status=status.HTTP_200_OK)

    def post(self, request):
        """Send a test SMS and/or email and return detailed diagnostic info."""
        phone = (request.data.get('phone') or request.data.get('test_phone') or '').strip()
        email_addr = (request.data.get('email') or request.data.get('test_email') or '').strip()
        message = (request.data.get('message') or 'Test message from MP-SAN Tenant Management System').strip()

        if not phone and not email_addr:
            return Response({'detail': 'Phone number or email is required.'}, status=status.HTTP_400_BAD_REQUEST)

        sms_result = None
        email_result = None
        any_ok = False

        # --- SMS ---
        if phone:
            normalized_phone = _normalize_phone(phone)
            if not normalized_phone:
                sms_result = {'ok': False, 'detail': f'Invalid phone number: {phone}'}
            else:
                username = getattr(settings, 'SMS_GATEWAY_USERNAME', None) or os.environ.get('SMS_GATEWAY_USERNAME')
                password = getattr(settings, 'SMS_GATEWAY_PASSWORD', None) or os.environ.get('SMS_GATEWAY_PASSWORD')
                raw_url = (getattr(settings, 'SMS_GATEWAY_URL', None) or os.environ.get('SMS_GATEWAY_URL') or 'https://api.sms-gate.app/3rdparty/v1').strip()
                if not raw_url.startswith('http://') and not raw_url.startswith('https://'):
                    raw_url = 'https://' + raw_url
                base_url = raw_url.rstrip('/')
                if '/3rdparty/v1' not in base_url:
                    base_url = base_url.rstrip('/') + '/3rdparty/v1'
                base_url = base_url.rstrip('/')

                if not username or not password:
                    sms_result = {'ok': False, 'detail': 'SMS gateway credentials not configured.'}
                else:
                    url = f'{base_url}/messages?skipPhoneValidation=true'
                    payload = {
                        'phoneNumbers': [normalized_phone],
                        'message': message,
                    }
                    sms_result = {
                        'original_phone': phone,
                        'normalized_phone': normalized_phone,
                        'url': url,
                        'payload': payload,
                    }
                    try:
                        r = requests.post(
                            url, json=payload,
                            auth=(username, password),
                            headers={'Content-Type': 'application/json'},
                            timeout=30,
                        )
                        sms_result['response'] = {
                            'status_code': r.status_code,
                            'ok': r.status_code in (200, 202),
                            'headers': dict(r.headers),
                        }
                        try:
                            sms_result['response']['body'] = r.json()
                        except Exception:
                            sms_result['response']['body'] = r.text[:1000]
                        sms_result['ok'] = r.status_code in (200, 202)
                        if sms_result['ok']:
                            any_ok = True
                    except requests.RequestException as e:
                        sms_result['error'] = str(e)
                        sms_result['ok'] = False

        # --- Email ---
        if email_addr:
            try:
                from ..email_service import send_generic_styled_email
                property_name = 'MPSAN'
                try:
                    from ..models import Property
                    prop = Property.objects.filter(owner__user=request.user).first()
                    if prop:
                        property_name = prop.name
                except Exception:
                    pass
                ok, err = send_generic_styled_email(
                    to_email=email_addr,
                    subject='Test Automated Message',
                    message_body=message,
                    property_name=property_name,
                )
                email_result = {'ok': ok, 'email': email_addr}
                if not ok:
                    email_result['error'] = err
                else:
                    any_ok = True
            except Exception as e:
                email_result = {'ok': False, 'email': email_addr, 'error': str(e)}

        # Build response
        details = []
        if sms_result and sms_result.get('ok'):
            details.append('SMS enqueued')
        elif sms_result:
            details.append(f'SMS failed: {sms_result.get("error") or sms_result.get("detail") or "error"}')
        if email_result and email_result.get('ok'):
            details.append('Email sent')
        elif email_result:
            details.append(f'Email failed: {email_result.get("error") or "error"}')

        response_status = status.HTTP_202_ACCEPTED if any_ok else status.HTTP_502_BAD_GATEWAY
        return Response({
            'detail': '; '.join(details) if details else 'No channels specified',
            'diagnostic': sms_result,
            'email_result': email_result,
        }, status=response_status)


class SendMessageView(APIView):
    """
    Send messages to tenants via SMS, email, or both.
    Accepts message text and either tenant_ids, property_id, or phone_numbers.
    Optional 'channel' param: 'sms' (default), 'email', 'both'.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        message = (request.data.get('message') or '').strip()
        if not message:
            return Response({'detail': 'Message text is required.'}, status=status.HTTP_400_BAD_REQUEST)

        channel = (request.data.get('channel') or 'sms').lower()
        if channel not in ('sms', 'email', 'both'):
            channel = 'sms'

        tenant_ids = request.data.get('tenant_ids')
        property_id = request.data.get('property_id')
        phone_numbers = request.data.get('phone_numbers')

        # Resolve tenants
        tenants = None
        numbers = []

        if phone_numbers and isinstance(phone_numbers, list):
            numbers = [n for n in (_normalize_phone(p) for p in phone_numbers) if n]
        else:
            ids = []
            if tenant_ids and isinstance(tenant_ids, list):
                ids = [int(x) for x in tenant_ids if x is not None and str(x).strip() != '']
            elif property_id is not None:
                ids = _tenant_ids_from_property_layouts(property_id)

            if not ids:
                return Response(
                    {'detail': 'Provide tenant_ids, property_id, or phone_numbers.'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            tenants = list(Tenant.objects.filter(pk__in=ids, is_active=True))
            numbers = [n for n in (_normalize_phone(t.phone) for t in tenants) if n]

        send_sms = channel in ('sms', 'both')
        send_email = channel in ('email', 'both')

        sms_recipients = 0
        sms_error = None
        email_sent = 0
        email_failed = 0

        # Resolve property for logging
        prop_obj = None
        if property_id:
            try:
                prop_obj = Property.objects.get(pk=int(property_id))
            except Property.DoesNotExist:
                pass

        # Determine message type: mass if multiple tenants/numbers, else manual
        is_mass = (tenants and len(tenants) > 1) or (not tenants and len(numbers) > 1)
        msg_type = 'mass' if is_mass else 'manual'

        # --- SMS path ---
        # Send one-by-one with a short delay to avoid Android's
        # "this app is sending multiple messages" prompt.
        if send_sms and numbers:
            import time
            sms_errors = []
            # Build phone->tenant lookup for logging
            phone_tenant_map = {}
            if tenants:
                for t in tenants:
                    ph = _normalize_phone(t.phone)
                    if ph:
                        phone_tenant_map[ph] = t

            for i, num in enumerate(numbers):
                if i > 0:
                    time.sleep(3)  # 3-second delay between each SMS
                ok, err = _send_sms_to_phones(message, [num])
                t = phone_tenant_map.get(num)
                if ok:
                    sms_recipients += 1
                    _log_message(num, 'sms', msg_type, message, 'sent',
                                 tenant_name=t.full_name if t else '',
                                 tenant_id=t.pk if t else None,
                                 property_obj=prop_obj, sent_by=request.user)
                else:
                    sms_errors.append(err or 'Unknown error')
                    _log_message(num, 'sms', msg_type, message, 'failed',
                                 error_message=err or '',
                                 tenant_name=t.full_name if t else '',
                                 tenant_id=t.pk if t else None,
                                 property_obj=prop_obj, sent_by=request.user)

            if sms_recipients == 0 and sms_errors:
                sms_error = sms_errors[0]
        elif send_sms and not numbers and channel == 'sms':
            return Response(
                {'detail': 'No valid phone numbers found for the given tenants.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # --- Email path ---
        if send_email and tenants:
            from ..email_service import send_generic_styled_email

            # Resolve property name
            prop_name = prop_obj.name if prop_obj else 'Property Management'

            for t in tenants:
                if not t.email:
                    continue
                email_subject = 'Message from ' + prop_name
                ok, err = send_generic_styled_email(
                    to_email=t.email,
                    subject=email_subject,
                    message_body=message,
                    property_name=prop_name,
                    tenant_name=t.full_name,
                )
                if ok:
                    email_sent += 1
                    _log_message(t.email, 'email', msg_type, message, 'sent',
                                 tenant_name=t.full_name, tenant_id=t.pk,
                                 property_obj=prop_obj, sent_by=request.user,
                                 subject=email_subject)
                else:
                    email_failed += 1
                    logging.getLogger(__name__).warning('Email send failed for %s: %s', t.email, err)
                    _log_message(t.email, 'email', msg_type, message, 'failed',
                                 error_message=err or '',
                                 tenant_name=t.full_name, tenant_id=t.pk,
                                 property_obj=prop_obj, sent_by=request.user,
                                 subject=email_subject)

            if channel == 'email' and email_sent == 0 and email_failed == 0:
                return Response(
                    {'detail': 'No tenants with email addresses found.'},
                    status=status.HTTP_400_BAD_REQUEST
                )

        result = {
            'detail': 'Message sent.',
            'recipients': sms_recipients,
            'email_recipients': email_sent,
            'email_failed': email_failed,
        }
        if sms_error and channel == 'sms':
            return Response(
                {'detail': f'SMS send failed: {sms_error}', 'error': sms_error},
                status=status.HTTP_502_BAD_GATEWAY
            )

        return Response(result, status=status.HTTP_202_ACCEPTED)


class ScheduleTestMessageView(APIView):
    """
    Temporarily allow testing automated messaging: schedule a test SMS to be sent at a specific time today.
    POST: { "message": "...", "send_at": "2026-01-30T14:30:00", "test_phone": "09171234567" }
    send_at is ISO 8601 datetime (e.g. today at the time you select). A background thread sends when the time comes.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        message = (request.data.get('message') or '').strip()
        if not message:
            return Response({'detail': 'Message text is required.'}, status=status.HTTP_400_BAD_REQUEST)
        test_phone = (request.data.get('test_phone') or request.data.get('phone_number') or '').strip()
        test_email = (request.data.get('test_email') or request.data.get('email') or '').strip()
        if not test_phone and not test_email:
            return Response({'detail': 'At least one of test_phone or test_email is required.'}, status=status.HTTP_400_BAD_REQUEST)
        send_at_raw = request.data.get('send_at')
        if not send_at_raw:
            return Response({'detail': 'send_at is required (ISO datetime, e.g. 2026-01-30T14:30:00).'}, status=status.HTTP_400_BAD_REQUEST)
        from django.utils import timezone
        from datetime import datetime
        try:
            send_at = datetime.fromisoformat(send_at_raw.replace('Z', '+00:00'))
            if send_at.tzinfo is None:
                send_at = timezone.make_aware(send_at)
        except (ValueError, TypeError) as e:
            return Response({'detail': f'Invalid send_at (use ISO format e.g. 2026-01-30T14:30:00): {e}'}, status=status.HTTP_400_BAD_REQUEST)
        now = timezone.now()
        if send_at <= now:
            return Response({'detail': 'send_at must be in the future.'}, status=status.HTTP_400_BAD_REQUEST)
        ScheduledTestMessage.objects.create(
            send_at=send_at,
            message=message,
            phone_number=test_phone,
            email=test_email,
            created_by=request.user,
        )
        response_data = {
            'detail': 'Test message scheduled.',
            'send_at': send_at.isoformat(),
        }
        if test_phone:
            response_data['test_phone'] = test_phone
        if test_email:
            response_data['test_email'] = test_email
        return Response(response_data, status=status.HTTP_201_CREATED)


class ScheduledMessagesStatusView(APIView):
    """
    View and manage scheduled test messages.
    GET: List all scheduled messages (recent first)
    POST: Manually trigger processing of due messages
    DELETE: Clear all pending scheduled messages
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from django.utils import timezone
        now = timezone.now()
        messages = ScheduledTestMessage.objects.all().order_by('-created_at')[:20]
        result = []
        for m in messages:
            result.append({
                'id': m.id,
                'phone_number': m.phone_number,
                'message': m.message[:100] + ('...' if len(m.message) > 100 else ''),
                'send_at': m.send_at.isoformat(),
                'sent': m.sent,
                'sent_at': m.sent_at.isoformat() if m.sent_at else None,
                'created_at': m.created_at.isoformat(),
                'is_due': m.send_at <= now,
            })
        
        total_pending = ScheduledTestMessage.objects.filter(sent=False).count()
        ready_to_send = ScheduledTestMessage.objects.filter(sent=False, send_at__lte=now).count()
        
        return Response({
            'messages': result,
            'total_pending': total_pending,
            'ready_to_send': ready_to_send,
            'server_time': now.isoformat(),
        })

    def post(self, request):
        """Manually trigger processing of scheduled messages."""
        from django.utils import timezone
        now = timezone.now()
        
        # Count before
        ready_before = ScheduledTestMessage.objects.filter(sent=False, send_at__lte=now).count()
        
        # Process
        process_scheduled_test_messages()
        
        # Count after
        ready_after = ScheduledTestMessage.objects.filter(sent=False, send_at__lte=now).count()
        processed = ready_before - ready_after
        
        return Response({
            'detail': f'Processed {processed} scheduled message(s).',
            'ready_before': ready_before,
            'ready_after': ready_after,
            'server_time': now.isoformat(),
        })

    def delete(self, request):
        """Delete all pending (unsent) scheduled messages."""
        deleted_count, _ = ScheduledTestMessage.objects.filter(sent=False).delete()
        return Response({
            'detail': f'Deleted {deleted_count} pending scheduled message(s).',
            'deleted_count': deleted_count,
        })


# =============================================================================
# AUTOMATED MESSAGING SYSTEM
# =============================================================================

def _replace_message_placeholders(template, tenant_data, room_data, days_left, due_date):
    """
    Replace placeholders in message template with actual tenant data.
    
    Placeholders:
    - [Tenant Name]: Tenant's full name
    - [Payment Amount]: Monthly rent amount (formatted with comma separators)
    - [Days Left]: Days until due date
    - [Due Date]: Payment due date (formatted as Month Day, Year)
    - [Room Number]: Room/unit number
    - [Balance]: Outstanding balance
    """
    import locale
    from datetime import datetime
    
    message = template
    
    # [Tenant Name]
    tenant_name = tenant_data.get('full_name', tenant_data.get('name', 'Tenant'))
    message = message.replace('[Tenant Name]', str(tenant_name))
    
    # [Payment Amount] - get from room data (includes appliance surcharges if any)
    payment = room_data.get('payment') or room_data.get('monthly_rent') or 0
    try:
        payment_float = float(payment)
        payment_formatted = f"{payment_float:,.0f}"  # Format with comma separators, no decimals
    except (ValueError, TypeError):
        payment_formatted = str(payment)
    message = message.replace('[Payment Amount]', payment_formatted)
    
    # [Days Left]
    if days_left == 0:
        days_left_text = "today"
    elif days_left == 1:
        days_left_text = "1"
    else:
        days_left_text = str(days_left)
    message = message.replace('[Days Left]', days_left_text)
    
    # [Due Date]
    if isinstance(due_date, str):
        try:
            due_date = datetime.strptime(due_date, '%Y-%m-%d').date()
        except ValueError:
            pass
    if hasattr(due_date, 'strftime'):
        due_date_formatted = due_date.strftime('%B %d, %Y')  # e.g., "February 15, 2026"
    else:
        due_date_formatted = str(due_date)
    message = message.replace('[Due Date]', due_date_formatted)
    
    # [Room Number]
    room_number = room_data.get('number', room_data.get('room_number', room_data.get('unit_no', '')))
    # Format with section prefix if available
    section = room_data.get('section', '')
    if section:
        room_display = f"{section}{room_number}"
    else:
        room_display = str(room_number)
    message = message.replace('[Room Number]', room_display)
    
    # [Balance] - check for remaining balance from payments
    balance = room_data.get('remaining_balance', 0)
    # Check payment history for most recent balance
    payments = room_data.get('payments', [])
    if payments and isinstance(payments, list):
        for p in reversed(payments):
            if isinstance(p, dict) and p.get('remaining_balance'):
                try:
                    balance = float(p.get('remaining_balance', 0))
                except (ValueError, TypeError):
                    pass
                break
    try:
        balance_float = float(balance)
        balance_formatted = f"{balance_float:,.0f}"
    except (ValueError, TypeError):
        balance_formatted = str(balance)
    message = message.replace('[Balance]', balance_formatted)
    
    return message


def _calculate_next_due_date(preferred_payment_day, reference_date=None):
    """
    Calculate the next due date based on preferred payment day.
    
    Args:
        preferred_payment_day: Day of month (1-31) when payment is due
        reference_date: Date to calculate from (defaults to today)
    
    Returns:
        date: The next payment due date
    """
    from datetime import date, timedelta
    import calendar
    
    if reference_date is None:
        reference_date = date.today()
    
    if not preferred_payment_day:
        # Default to 1st of next month if not set
        preferred_payment_day = 1
    
    try:
        preferred_payment_day = int(preferred_payment_day)
    except (ValueError, TypeError):
        preferred_payment_day = 1
    
    # Clamp to valid day range
    preferred_payment_day = max(1, min(31, preferred_payment_day))
    
    year = reference_date.year
    month = reference_date.month
    
    # Get the actual last day of the current month
    last_day_of_month = calendar.monthrange(year, month)[1]
    
    # Adjust payment day if it exceeds month's days
    actual_day = min(preferred_payment_day, last_day_of_month)
    
    try:
        due_date = date(year, month, actual_day)
    except ValueError:
        due_date = date(year, month, last_day_of_month)
    
    # If the due date has already passed this month, move to next month
    if due_date < reference_date:
        # Move to next month
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1
        
        last_day_of_month = calendar.monthrange(year, month)[1]
        actual_day = min(preferred_payment_day, last_day_of_month)
        
        try:
            due_date = date(year, month, actual_day)
        except ValueError:
            due_date = date(year, month, last_day_of_month)
    
    return due_date


def generate_scheduled_automated_messages(property_id=None):
    """
    Generate scheduled automated messages for all (or specific) properties.
    
    This function:
    1. Gets all properties with automated messaging enabled
    2. For each property, iterates through all occupied rooms
    3. For each tenant, calculates their next due date
    4. Creates scheduled messages for each configured day (e.g., 7 days before, 3 days before, etc.)
    
    Returns:
        dict: Summary of messages created
    """
    from django.utils import timezone
    from datetime import datetime, timedelta
    import logging
    
    logger = logging.getLogger(__name__)
    now = timezone.now()
    today = now.date()
    
    stats = {
        'properties_processed': 0,
        'tenants_processed': 0,
        'messages_created': 0,
        'messages_skipped': 0,
        'errors': []
    }
    
    # Get properties with automated messaging enabled
    if property_id:
        settings_qs = AutomatedMessageSettings.objects.filter(property_id=property_id, enabled=True)
    else:
        settings_qs = AutomatedMessageSettings.objects.filter(enabled=True)
    
    for settings in settings_qs:
        try:
            prop = settings.property
            stats['properties_processed'] += 1
            
            layouts = prop.layouts or {}
            if not isinstance(layouts, dict):
                continue
            
            message_days = settings.message_days or []
            if not message_days:
                logger.info('Property %s has no message days configured', prop.id)
                continue
            
            send_hour = settings.send_hour or 8
            send_minute = settings.send_minute or 0
            
            # Iterate through all rooms in layouts
            for variant, rooms in layouts.items():
                if not isinstance(rooms, list):
                    continue
                
                for room in rooms:
                    if not isinstance(room, dict):
                        continue
                    
                    # Check if room is occupied
                    if room.get('status') != 'occupied':
                        continue
                    
                    tenant_data = room.get('tenant')
                    if not tenant_data:
                        continue
                    
                    tenant_id = tenant_data.get('tenant_id') or tenant_data.get('id')
                    if not tenant_id:
                        continue
                    
                    # Convert tenant_id to int if it's a string
                    try:
                        tenant_id = int(tenant_id)
                    except (ValueError, TypeError):
                        logger.warning('Invalid tenant_id format: %s', tenant_id)
                        continue
                    
                    # Get tenant name from layout data (primary source for reliability)
                    tenant_name = tenant_data.get('full_name') or tenant_data.get('name') or 'Unknown'
                    
                    # Try to get tenant from database (optional - for FK if exists)
                    tenant = None
                    try:
                        tenant = Tenant.objects.filter(tenant_id=tenant_id, is_active=True).first()
                    except Exception:
                        pass  # Tenant FK is optional
                    
                    stats['tenants_processed'] += 1
                    
                    # Get phone number from tenant record (if exists) or layout data
                    phone = None
                    if tenant:
                        phone = tenant.phone
                    if not phone:
                        phone = tenant_data.get('phone')
                    if not phone:
                        logger.warning('Tenant %s (%s) has no phone number', tenant_id, tenant_name)
                        continue
                    
                    normalized_phone = _normalize_phone(phone)
                    if not normalized_phone:
                        logger.warning('Tenant %s has invalid phone: %s', tenant_id, phone)
                        continue
                    
                    # Get preferred payment day
                    preferred_day = room.get('preferred_payment_day') or (tenant.preferred_payment_day if tenant else 28)
                    
                    # Get move-in date
                    move_in_date = tenant_data.get('move_in')
                    
                    # Parse move_in date if it's a string
                    if move_in_date and isinstance(move_in_date, str):
                        try:
                            move_in_date = datetime.strptime(move_in_date[:10], '%Y-%m-%d').date()
                        except (ValueError, TypeError):
                            move_in_date = today
                    elif not move_in_date:
                        move_in_date = today
                    
                    # For new tenants (move-in this month), first rent is due NEXT month
                    import calendar
                    
                    if move_in_date.year == today.year and move_in_date.month == today.month:
                        # Tenant moved in this month - first rent due next month
                        year = today.year
                        month = today.month + 1
                        if month > 12:
                            month = 1
                            year += 1
                        
                        last_day = calendar.monthrange(year, month)[1]
                        actual_day = min(int(preferred_day) if preferred_day else 28, last_day)
                        
                        try:
                            from datetime import date as date_cls
                            due_date = date_cls(year, month, actual_day)
                        except ValueError:
                            due_date = _calculate_next_due_date(preferred_day, today)
                    else:
                        # Existing tenant (moved in before this month) - use normal calculation
                        due_date = _calculate_next_due_date(preferred_day, today)
                    
                    # Get room number for display
                    room_number = room.get('number', '')
                    section = room.get('section', '')
                    room_display = f"{section}{room_number}" if section else str(room_number)
                    
                    # Get tenant email for email notifications
                    tenant_email = ''
                    if tenant and tenant.email:
                        tenant_email = tenant.email
                    elif tenant_data.get('email'):
                        tenant_email = tenant_data.get('email')

                    # Per-tenant send time: use ML-predicted schedule if available, else property default
                    tenant_send_hour = send_hour
                    tenant_send_minute = send_minute
                    try:
                        tenant_schedule = TenantMessageSchedule.objects.get(
                            property=prop,
                            room_number=room_display,
                            use_custom_schedule=True
                        )
                        tenant_send_hour = tenant_schedule.send_hour
                        tenant_send_minute = tenant_schedule.send_minute
                    except TenantMessageSchedule.DoesNotExist:
                        pass  # fall back to property-level defaults

                    # Create messages for each configured day
                    for days_before in message_days:
                        try:
                            days_before = int(days_before)
                        except (ValueError, TypeError):
                            continue

                        # Calculate send date
                        send_date = due_date - timedelta(days=days_before)

                        # Skip if send date is in the past
                        if send_date < today:
                            stats['messages_skipped'] += 1
                            continue

                        # If send_date is today, skip if the send time has already passed
                        # This prevents creating messages that the background processor
                        # would immediately fire (e.g. new tenant added at 9 PM but send_hour is 8 AM)
                        if send_date == today:
                            send_at_check = timezone.make_aware(
                                datetime.combine(send_date, datetime.min.time().replace(hour=tenant_send_hour, minute=tenant_send_minute))
                            )
                            if send_at_check <= timezone.now():
                                stats['messages_skipped'] += 1
                                continue

                        # Calculate days left at send time
                        days_left = days_before

                        # Create the message by replacing placeholders
                        # Use tenant data from DB if available, otherwise from layout
                        message_text = _replace_message_placeholders(
                            settings.message_template,
                            {
                                'full_name': tenant.full_name if tenant else tenant_name,
                                'email': tenant.email if tenant else tenant_data.get('email', ''),
                                'phone': phone,
                            },
                            room,
                            days_left,
                            due_date
                        )

                        # Calculate send_at datetime (uses per-tenant hour if ML schedule exists)
                        send_at = timezone.make_aware(
                            datetime.combine(send_date, datetime.min.time().replace(hour=tenant_send_hour, minute=tenant_send_minute))
                        )

                        # Check if message already exists (any status - unique constraint is on room+date+days)
                        existing = ScheduledAutomatedMessage.objects.filter(
                            property=prop,
                            room_number=room_display,
                            due_date=due_date,
                            days_before_due=days_before
                        ).first()

                        if existing:
                            # Update existing message (reactivate if cancelled, update content or send time)
                            needs_update = (
                                existing.status == 'cancelled' or
                                existing.message != message_text or
                                existing.tenant_name != tenant_name or
                                existing.phone_number != normalized_phone or
                                existing.tenant_email != tenant_email or
                                existing.send_hour != tenant_send_hour or
                                existing.send_minute != tenant_send_minute
                            )
                            if needs_update:
                                existing.message = message_text
                                existing.send_at = send_at
                                existing.send_hour = tenant_send_hour
                                existing.send_minute = tenant_send_minute
                                existing.tenant_name = tenant_name
                                existing.tenant_layout_id = tenant_id
                                existing.phone_number = normalized_phone
                                existing.tenant_email = tenant_email
                                if existing.status == 'cancelled':
                                    existing.status = 'pending'
                                    existing.error_message = ''
                                    stats['messages_created'] += 1
                                    logger.info('Reactivated message for %s, room %s', tenant_name, room_display)
                                existing.save()
                            else:
                                stats['messages_skipped'] += 1
                            continue

                        # Create new scheduled message
                        ScheduledAutomatedMessage.objects.create(
                            property=prop,
                            tenant_name=tenant_name,
                            tenant_layout_id=tenant_id,
                            room_number=room_display,
                            phone_number=normalized_phone,
                            tenant_email=tenant_email,
                            message=message_text,
                            send_at=send_at,
                            send_hour=tenant_send_hour,
                            send_minute=tenant_send_minute,
                            days_before_due=days_before,
                            due_date=due_date,
                            status='pending'
                        )
                        stats['messages_created'] += 1
                        logger.info(
                            'Created scheduled message for %s, room %s, %d days before %s',
                            tenant_name, room_display, days_before, due_date
                        )
                    
        except Exception as e:
            logger.exception('Error processing property %s: %s', settings.property_id, e)
            stats['errors'].append(str(e))
    
    return stats


def _cleanup_messages_for_removed_tenants():
    """
    Cancel pending automated messages for tenants that have been removed from property layouts.
    This runs periodically to clean up orphaned messages.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    # Get all pending messages
    pending_messages = ScheduledAutomatedMessage.objects.filter(status='pending')
    
    if not pending_messages.exists():
        return 0
    
    # Build a set of valid (property_id, room_number) combinations from layouts
    valid_tenant_rooms = set()
    
    # Get all properties that have pending messages
    property_ids = pending_messages.values_list('property_id', flat=True).distinct()
    properties = Property.objects.filter(id__in=property_ids)
    
    for prop in properties:
        layouts = prop.layouts or {}
        for variant_name, rooms in layouts.items():
            if not isinstance(rooms, list):
                continue
            for room in rooms:
                if room.get('status') != 'occupied' or not room.get('tenant'):
                    continue
                    
                tenant_data = room.get('tenant', {})
                tenant_layout_id = tenant_data.get('tenant_id') or tenant_data.get('id')
                
                if not tenant_layout_id:
                    continue
                    
                tid = int(tenant_layout_id)
                
                # Get room display number - add BOTH formats to handle inconsistencies
                room_number = room.get('number', '')
                room_type = room.get('type', 'room')
                section = room.get('section', '')
                
                # Format 1: Section prefix style (M1, C1, etc.)
                if room_type == 'commercial':
                    room_display_formatted = f"C{room_number}"
                elif section:
                    room_display_formatted = f"{section[0].upper()}{room_number}"
                else:
                    room_display_formatted = str(room_number)
                
                # Format 2: Raw variant name style (middle1, left2, etc.) 
                room_display_raw = f"{section}{room_number}" if section else str(room_number)
                
                # Add all possible formats
                valid_tenant_rooms.add((prop.id, room_display_formatted, tid))
                valid_tenant_rooms.add((prop.id, room_display_raw, tid))
                valid_tenant_rooms.add((prop.id, str(room_number), tid))  # Just the number
                
                # Also add variant name if it matches a pattern like "middle1"
                if variant_name and room_number:
                    valid_tenant_rooms.add((prop.id, f"{variant_name}{room_number}", tid))
    
    # Cancel messages for tenants that no longer exist
    # Grace period: don't cancel messages created in the last 2 minutes to avoid race conditions
    from django.utils import timezone
    from datetime import timedelta
    grace_period = timezone.now() - timedelta(minutes=2)

    cancelled_count = 0
    for msg in pending_messages:
        # Skip recently created messages (grace period to avoid race conditions)
        if msg.created_at > grace_period:
            continue

        # Check if this message's tenant still exists in layouts
        key = (msg.property_id, msg.room_number, msg.tenant_layout_id)

        if key not in valid_tenant_rooms:
            # Log for debugging before cancelling
            logger.debug('Message key not found: property=%s, room=%s, tenant_id=%s',
                        msg.property_id, msg.room_number, msg.tenant_layout_id)
            logger.debug('Valid keys for this property: %s',
                        [k for k in valid_tenant_rooms if k[0] == msg.property_id])

            msg.status = 'cancelled'
            msg.error_message = 'Tenant removed from property'
            msg.save()
            cancelled_count += 1
            logger.info('Cancelled message id=%s for removed tenant %s (room %s)',
                       msg.id, msg.tenant_name, msg.room_number)
    
    return cancelled_count


def _generate_messages_for_new_tenant(prop, tenant, room_numbers):
    """
    Auto-generate scheduled automated messages for a newly added tenant.
    This is called when a tenant is created to ensure they're included in automated messaging
    without requiring manual intervention in the settings page.
    """
    from django.utils import timezone
    from datetime import datetime, timedelta
    import logging

    logger = logging.getLogger(__name__)

    logger.info('=== _generate_messages_for_new_tenant called ===')
    logger.info('Property: %s (ID: %s)', prop.name, prop.id)
    logger.info('Tenant: %s', tenant.full_name)
    logger.info('Room numbers received: %s', room_numbers)

    # Check if automated messaging is enabled for this property
    try:
        settings = AutomatedMessageSettings.objects.get(property=prop, enabled=True)
    except AutomatedMessageSettings.DoesNotExist:
        logger.info('No automated message settings for property %s, skipping message generation', prop.id)
        return

    logger.info('Auto-generating messages for new tenant %s in property %s',
                tenant.full_name, prop.name)
    
    # Get the message template and schedule from settings
    message_template = settings.message_template
    message_days = settings.message_days or [0, 1, 2]  # Default: due date, 1 day before, 2 days before
    
    # Time to send (model stores 24-hour: send_hour 0-23, send_minute 0-59)
    send_hour = settings.send_hour if settings.send_hour is not None else 8
    send_minute = settings.send_minute if settings.send_minute is not None else 0
    
    today = timezone.now().date()
    
    # Get tenant info from layouts
    layouts = prop.layouts or {}
    
    for room_number in room_numbers:
        logger.info('Processing room_number: %s', room_number)
        # Find the room in layouts
        tenant_data = None
        room_data = None
        room_display = str(room_number)

        for variant_name, rooms in layouts.items():
            if not isinstance(rooms, list):
                continue
            for room in rooms:
                # Format room number for comparison
                box_number = str(room.get('number', ''))
                box_type = room.get('type', 'room')
                box_section = room.get('section', '')

                if box_type == 'commercial':
                    formatted = f"C{box_number}"
                elif box_section:
                    formatted = f"{box_section[0].upper()}{box_number}"
                else:
                    formatted = box_number

                if formatted == str(room_number):
                    room_data = room
                    tenant_data = room.get('tenant', {})
                    # Use FULL format for database storage (e.g., "upper4" not "U4")
                    # This matches the format used by generate_scheduled_automated_messages
                    room_display = f"{box_section}{box_number}" if box_section else str(box_number)
                    logger.info('Found room! formatted=%s, room_display=%s, tenant_data=%s', formatted, room_display, tenant_data)
                    break
            if room_data:
                break

        if not room_data or not tenant_data:
            logger.warning('Could not find room %s in layouts for new tenant', room_number)
            continue
        
        # Get tenant info
        tenant_name = tenant_data.get('full_name') or tenant.full_name
        tenant_id = tenant_data.get('tenant_id') or tenant_data.get('id') or tenant.tenant_id
        phone = tenant_data.get('phone') or tenant.phone
        tenant_email = tenant_data.get('email') or (tenant.email if tenant else '') or ''

        if not phone:
            logger.warning('No phone number for tenant %s, skipping message generation', tenant_name)
            continue
        
        normalized_phone = _normalize_phone(phone)
        if not normalized_phone:
            logger.warning('Invalid phone %s for tenant %s', phone, tenant_name)
            continue
        
        # Calculate due date - for NEW tenants (move-in this month), first rent is NEXT month
        preferred_day = room_data.get('preferred_payment_day') or tenant_data.get('preferred_payment_day') or 28
        
        # Get move-in date
        move_in_date = tenant_data.get('move_in')
        
        # Parse move_in date if it's a string
        if move_in_date and isinstance(move_in_date, str):
            try:
                from datetime import datetime as dt
                move_in_date = dt.strptime(move_in_date[:10], '%Y-%m-%d').date()
            except (ValueError, TypeError):
                move_in_date = today
        elif not move_in_date:
            move_in_date = today
        
        # For new tenants (move-in this month), first rent is due NEXT month
        # This is because rent is paid at the end of the month for that month
        import calendar
        
        if move_in_date.year == today.year and move_in_date.month == today.month:
            # Tenant just moved in this month - first rent due next month
            year = today.year
            month = today.month + 1
            if month > 12:
                month = 1
                year += 1
            
            # Get last day of the due month
            last_day = calendar.monthrange(year, month)[1]
            actual_day = min(int(preferred_day), last_day)
            
            try:
                from datetime import date
                due_date = date(year, month, actual_day)
            except ValueError:
                due_date = _calculate_next_due_date(preferred_day, today)
            
            logger.info('New tenant %s moved in this month - first rent due: %s', tenant_name, due_date)
        else:
            # Existing tenant - use normal calculation
            due_date = _calculate_next_due_date(preferred_day, today)

        if not due_date:
            logger.warning('Could not calculate due date for tenant %s', tenant_name)
            continue

        # Get monthly payment
        monthly_payment = float(room_data.get('payment') or 0)

        # Generate messages for BOTH current and next billing cycle
        # This ensures returning tenants always have upcoming messages
        due_dates_to_process = [due_date]
        logger.info('Primary due date for %s: %s (preferred_day=%s)', tenant_name, due_date, preferred_day)

        # Calculate next month's due date
        next_month = due_date.month + 1
        next_year = due_date.year
        if next_month > 12:
            next_month = 1
            next_year += 1
        last_day_next = calendar.monthrange(next_year, next_month)[1]
        next_due_day = min(int(preferred_day), last_day_next)
        try:
            from datetime import date as date_class
            next_due_date = date_class(next_year, next_month, next_due_day)
            due_dates_to_process.append(next_due_date)
            logger.info('Next due date for %s: %s', tenant_name, next_due_date)
        except ValueError:
            pass

        logger.info('Will process due dates: %s with message_days: %s', due_dates_to_process, message_days)
        for current_due_date in due_dates_to_process:
            # Generate messages for each scheduled day
            for days_before in message_days:
                send_date = current_due_date - timedelta(days=days_before)

                # Skip if send date is in the past
                if send_date < today:
                    continue

                # If send_date is today, skip if the send time has already passed
                # This prevents creating messages that the background processor
                # would immediately fire (e.g. new tenant added at 9 PM but send_hour is 8 AM)
                if send_date == today:
                    send_at_check = timezone.make_aware(
                        datetime.combine(send_date, datetime.min.time().replace(hour=send_hour, minute=send_minute))
                    )
                    if send_at_check <= timezone.now():
                        continue

                # Calculate days left and prepare message
                days_left = (current_due_date - send_date).days
                message_text = _replace_message_placeholders(
                    message_template,
                    tenant_data,
                    room_data,
                    days_left,
                    current_due_date
                )

                # Calculate send_at datetime
                send_at = timezone.make_aware(
                    datetime.combine(send_date, datetime.min.time().replace(hour=send_hour, minute=send_minute))
                )

                # Check if message already exists
                logger.info('Searching for existing message: property=%s, room=%s, due_date=%s, days_before=%s',
                           prop.id, room_display, current_due_date, days_before)
                existing = ScheduledAutomatedMessage.objects.filter(
                    property=prop,
                    room_number=room_display,
                    due_date=current_due_date,
                    days_before_due=days_before
                ).first()

                if existing:
                    logger.info('Found existing message ID=%s, status=%s', existing.id, existing.status)
                    # Update if needed
                    if existing.status == 'cancelled':
                        existing.status = 'pending'
                        existing.error_message = ''
                        existing.message = message_text
                        existing.send_at = send_at
                        existing.send_hour = send_hour
                        existing.send_minute = send_minute
                        existing.tenant_name = tenant_name
                        existing.tenant_layout_id = tenant_id
                        existing.phone_number = normalized_phone
                        existing.tenant_email = tenant_email
                        existing.sms_sent = False
                        existing.email_sent = False
                        existing.email_copy_sent = False
                        existing.save()
                        logger.info('Reactivated message ID=%s for tenant %s, room %s', existing.id, tenant_name, room_display)
                    else:
                        logger.info('Existing message ID=%s already has status=%s, skipping', existing.id, existing.status)
                    continue

                # Create new message
                logger.info('No existing message found, creating new one for room=%s, due_date=%s', room_display, current_due_date)
                new_msg = ScheduledAutomatedMessage.objects.create(
                    property=prop,
                    tenant_name=tenant_name,
                    tenant_layout_id=tenant_id,
                    room_number=room_display,
                    phone_number=normalized_phone,
                    tenant_email=tenant_email,
                    message=message_text,
                    send_at=send_at,
                    send_hour=send_hour,
                    send_minute=send_minute,
                    days_before_due=days_before,
                    due_date=current_due_date,
                    status='pending',
                    sms_sent=False,
                    email_sent=False,
                    email_copy_sent=False
                )
                logger.info('Created automated message ID=%s for tenant %s, room %s, %d days before %s',
                           new_msg.id, tenant_name, room_display, days_before, current_due_date)


def process_scheduled_automated_messages():
    """
    Process and send all due automated messages.
    Similar to process_scheduled_test_messages but for production automated messages.
    Also cleans up messages for removed tenants.

    Supports two notification channels:
    - SMS: Sends to tenant's phone (if sms_enabled in settings)
    - PWA Push: Sends to owner/manager devices (if pwa_notifications_enabled in settings)
    """
    from django.utils import timezone
    from .push_notifications import send_push_notification
    import logging

    logger = logging.getLogger(__name__)
    now = timezone.now()
    local_now = timezone.localtime(now)  # Convert to local timezone for logging

    # First, clean up messages for tenants that no longer exist in layouts
    cancelled_count = _cleanup_messages_for_removed_tenants()
    if cancelled_count > 0:
        logger.info('Cancelled %d automated messages for removed tenants', cancelled_count)

    # Get all pending messages that are due
    pending = ScheduledAutomatedMessage.objects.filter(
        status='pending',
        send_at__lte=now
    ).order_by('send_at')

    total_pending = ScheduledAutomatedMessage.objects.filter(status='pending').count()
    ready_count = pending.count()

    if total_pending > 0 or ready_count > 0:
        logger.info('Automated messages: %d total pending, %d ready to send (now=%s)',
                   total_pending, ready_count, local_now.strftime('%Y-%m-%d %H:%M:%S %Z'))

    sent_count = 0
    failed_count = 0
    pwa_notif_count = 0
    email_notif_count = 0
    email_copy_count = 0

    for msg in pending:
        # Get tenant name from stored field (tenant FK was removed)
        tenant_display_name = msg.tenant_name or 'Unknown'

        logger.info('Processing automated message id=%s for %s', msg.id, tenant_display_name)

        phone = msg.phone_number

        # Get property settings
        try:
            settings = msg.property.automated_message_settings
            sms_enabled = settings.sms_enabled if hasattr(settings, 'sms_enabled') else True
            pwa_enabled = settings.pwa_notifications_enabled if hasattr(settings, 'pwa_notifications_enabled') else True
            email_enabled = settings.email_enabled if hasattr(settings, 'email_enabled') else True
            email_copy_to_owner = settings.email_copy_to_owner if hasattr(settings, 'email_copy_to_owner') else True
            owner_email = settings.owner_email if hasattr(settings, 'owner_email') else ''
            email_subject_template = settings.email_subject_template if hasattr(settings, 'email_subject_template') else None
            message_template = settings.message_template if hasattr(settings, 'message_template') else None
        except AutomatedMessageSettings.DoesNotExist:
            sms_enabled = True
            pwa_enabled = True
            email_enabled = True
            email_copy_to_owner = True
            owner_email = ''
            email_subject_template = None
            message_template = None

        # Build due date notification message for owners
        days_before = msg.days_before_due
        if days_before == 0:
            due_text = 'TODAY'
        elif days_before == 1:
            due_text = 'tomorrow'
        else:
            due_text = f'in {days_before} days'

        # Send PWA push notification to owner/manager if enabled
        if pwa_enabled:
            logger.info('PWA notifications enabled for property %s, attempting to send...', msg.property.id)

            # Build notification title based on urgency
            if days_before == 0:
                notif_title = f'🔴 Due Today: {tenant_display_name}'
            elif days_before == 1:
                notif_title = f'🟠 Due Tomorrow: {tenant_display_name}'
            elif days_before == 2:
                notif_title = f'🟡 Due in 2 Days: {tenant_display_name}'
            else:
                notif_title = f'📅 Rent Reminder: {tenant_display_name}'

            notif_body = f'Room {msg.room_number} - Rent due {due_text} ({msg.due_date.strftime("%b %d")})'
            notif_data = {
                'type': 'due_date_reminder',
                'tenant_name': tenant_display_name,
                'room_number': msg.room_number,
                'due_date': msg.due_date.isoformat(),
                'days_before': days_before,
                'property_id': msg.property.id,
                'url': f'/properties/{msg.property.id}'
            }
            notif_tag = f'mpsan-due-{msg.room_number}-{msg.due_date.isoformat()}'

            # Collect all users to notify (owner + managers)
            users_to_notify = []

            # Add owner
            try:
                owner = msg.property.owner
                if owner and owner.user:
                    users_to_notify.append(('owner', owner.user))
                    logger.info('Will notify owner: %s', owner.user.username)
                else:
                    logger.info('Property %s has no owner or owner has no user', msg.property.id)
            except Exception as e:
                logger.warning('Error getting owner for property %s: %s', msg.property.id, e)

            # Add managers
            try:
                managers = msg.property.managers.all()
                for manager in managers:
                    if manager not in [u[1] for u in users_to_notify]:  # Avoid duplicates
                        users_to_notify.append(('manager', manager))
                        logger.info('Will notify manager: %s', manager.username)
            except Exception as e:
                logger.warning('Error getting managers for property %s: %s', msg.property.id, e)

            # Add settings creator as fallback
            try:
                settings_obj = msg.property.automated_message_settings
                if settings_obj.created_by and settings_obj.created_by not in [u[1] for u in users_to_notify]:
                    users_to_notify.append(('settings_creator', settings_obj.created_by))
                    logger.info('Will notify settings creator: %s', settings_obj.created_by.username)
            except Exception as e:
                logger.warning('Error getting settings creator for property %s: %s', msg.property.id, e)

            if not users_to_notify:
                logger.warning('No users to notify for property %s (no owner or managers)', msg.property.id)

            # Send to all collected users
            for role, user in users_to_notify:
                try:
                    success, fail = send_push_notification(
                        user,
                        notif_title,
                        notif_body,
                        data=notif_data,
                        tag=notif_tag
                    )
                    if success > 0:
                        pwa_notif_count += 1
                        logger.info('PWA notification sent to %s (%s) for %s (room %s)', role, user.username, tenant_display_name, msg.room_number)
                    else:
                        logger.info('PWA notification not sent to %s (%s) - no active subscriptions or send failed', role, user.username)
                except Exception as e:
                    logger.warning('Failed to send PWA notification to %s for message id=%s: %s', role, msg.id, e)
        else:
            logger.info('PWA notifications disabled for property %s', msg.property.id)

        # Track individual channel success
        sms_success = False
        email_success = False
        any_channel_failed = False
        error_messages = []

        # Send SMS to tenant if enabled
        if sms_enabled:
            if not phone:
                logger.warning('Automated message id=%s has invalid phone', msg.id)
                error_messages.append('Invalid phone number')
                any_channel_failed = True
            else:
                # Delay between SMS sends to avoid Android's multi-message prompt
                if sent_count > 0 or failed_count > 0:
                    import time
                    time.sleep(3)
                logger.info('Sending automated SMS id=%s to phone=%s', msg.id, phone)
                ok, err = _send_sms_to_phones(msg.message, [phone])

                if ok:
                    sms_success = True
                    msg.sms_sent = True
                    logger.info('Automated message id=%s SMS sent successfully to %s', msg.id, phone)
                    _log_message(phone, 'sms', 'automated', msg.message, 'sent',
                                 tenant_name=tenant_display_name,
                                 property_obj=msg.property,
                                 room_number=msg.room_number)
                else:
                    error_messages.append(f'SMS: {err or "Unknown error"}')
                    any_channel_failed = True
                    logger.warning('Automated message id=%s SMS send failed: %s', msg.id, err)
                    _log_message(phone, 'sms', 'automated', msg.message, 'failed',
                                 error_message=err or 'Unknown error',
                                 tenant_name=tenant_display_name,
                                 property_obj=msg.property,
                                 room_number=msg.room_number)

                    # Send push notification for SMS failure
                    try:
                        owner = msg.property.owner
                        if owner and owner.user:
                            send_push_notification(
                                owner.user,
                                'SMS Failed',
                                f'Failed to send to {tenant_display_name}: {err[:100] if err else "Unknown error"}',
                                data={'type': 'sms_failed', 'message_id': msg.id, 'phone': phone, 'error': err},
                                tag='mpsan-sms-failed'
                            )
                    except Exception:
                        pass

        # Send Email to tenant if enabled and tenant has email
        tenant_email = msg.tenant_email or ''
        if email_enabled and tenant_email:
            logger.info('Sending automated email id=%s to email=%s', msg.id, tenant_email)

            # Get payment amount from property layouts (room payment)
            payment_amount = 0
            try:
                layouts = msg.property.layouts or {}
                for variant_name, rooms in layouts.items():
                    if not isinstance(rooms, list):
                        continue
                    for room in rooms:
                        # Match room by full format (e.g., "upper1") or abbreviated
                        box_number = str(room.get('number', ''))
                        box_section = room.get('section', '')
                        room_full = f"{box_section}{box_number}" if box_section else box_number
                        if room_full == msg.room_number or box_number == msg.room_number:
                            payment_amount = float(room.get('payment', 0) or 0)
                            break
                    if payment_amount > 0:
                        break
            except Exception as e:
                logger.warning('Error getting payment amount for email: %s', e)
                payment_amount = 0

            # Determine owner email for CC
            cc_email = owner_email if email_copy_to_owner and owner_email else None

            email_ok, email_err = send_rent_reminder_email(
                tenant_email=tenant_email,
                tenant_name=tenant_display_name,
                room_number=msg.room_number,
                payment_amount=payment_amount,
                due_date=msg.due_date,
                days_left=days_before,
                property_name=msg.property.name,
                subject_template=email_subject_template,
                message_template=message_template,
                cc_owner_email=cc_email
            )

            if email_ok:
                email_success = True
                msg.email_sent = True
                email_notif_count += 1
                logger.info('Automated message id=%s email sent successfully to %s', msg.id, tenant_email)
                _log_message(tenant_email, 'email', 'automated', msg.message, 'sent',
                             tenant_name=tenant_display_name,
                             property_obj=msg.property,
                             room_number=msg.room_number,
                             subject='Rent Reminder')

                if cc_email:
                    msg.email_copy_sent = True
                    email_copy_count += 1
                    logger.info('Email copy sent to owner: %s', cc_email)
            else:
                error_messages.append(f'Email: {email_err or "Unknown error"}')
                any_channel_failed = True
                logger.warning('Automated message id=%s email send failed: %s', msg.id, email_err)
                _log_message(tenant_email, 'email', 'automated', msg.message, 'failed',
                             error_message=email_err or 'Unknown error',
                             tenant_name=tenant_display_name,
                             property_obj=msg.property,
                             room_number=msg.room_number,
                             subject='Rent Reminder')
        elif email_enabled and not tenant_email:
            logger.info('Automated message id=%s skipping email - no tenant email address', msg.id)

        # Send separate owner notification email if enabled and no CC was used
        if email_enabled and email_copy_to_owner and owner_email and not (email_success and msg.email_copy_sent):
            # Only send separate owner notification if email to tenant failed or wasn't sent
            # Get payment amount from property layouts (same as tenant email)
            owner_payment_amount = 0
            try:
                layouts = msg.property.layouts or {}
                for variant_name, rooms in layouts.items():
                    if not isinstance(rooms, list):
                        continue
                    for room in rooms:
                        box_number = str(room.get('number', ''))
                        box_section = room.get('section', '')
                        room_full = f"{box_section}{box_number}" if box_section else box_number
                        if room_full == msg.room_number or box_number == msg.room_number:
                            owner_payment_amount = float(room.get('payment', 0) or 0)
                            break
                    if owner_payment_amount > 0:
                        break
            except Exception as e:
                logger.warning('Error getting payment amount for owner email: %s', e)
                owner_payment_amount = 0

            owner_ok, owner_err = send_owner_notification_email(
                owner_email=owner_email,
                tenant_name=tenant_display_name,
                room_number=msg.room_number,
                payment_amount=owner_payment_amount,
                due_date=msg.due_date,
                days_left=days_before,
                property_name=msg.property.name
            )

            if owner_ok:
                msg.email_copy_sent = True
                email_copy_count += 1
                logger.info('Owner notification email sent to %s', owner_email)
            else:
                logger.warning('Failed to send owner notification email: %s', owner_err)

        # Determine overall message status
        msg.sent_at = now

        # Message is successful if any channel succeeded (SMS, Email, or PWA was sent)
        if sms_success or email_success or pwa_notif_count > 0:
            msg.status = 'sent'
            sent_count += 1
            if error_messages:
                msg.error_message = '; '.join(error_messages)
            logger.info('Automated message id=%s marked sent (sms=%s, email=%s)', msg.id, sms_success, email_success)
        elif not sms_enabled and not email_enabled:
            # Both SMS and email disabled, PWA was the only channel
            msg.status = 'sent'
            sent_count += 1
            logger.info('Automated message id=%s marked sent (PWA only)', msg.id)
        else:
            msg.status = 'failed'
            msg.error_message = '; '.join(error_messages) if error_messages else 'All notification channels failed'
            failed_count += 1
            logger.warning('Automated message id=%s failed: %s', msg.id, msg.error_message)

        msg.save()

    # After processing, regenerate messages for next billing cycle
    # This ensures tenants always have upcoming messages scheduled, even if sends failed
    try:
        _regenerate_upcoming_messages()
        if sent_count > 0:
            logger.info('Regenerated upcoming messages after sending %d messages', sent_count)
    except Exception as e:
        logger.exception('Error regenerating upcoming messages: %s', e)

    return {
        'total_pending': total_pending,
        'ready_count': ready_count,
        'sent_count': sent_count,
        'failed_count': failed_count,
        'pwa_notif_count': pwa_notif_count,
        'email_notif_count': email_notif_count,
        'email_copy_count': email_copy_count
    }


def _regenerate_upcoming_messages():
    """
    Ensure all active tenants have messages scheduled for upcoming billing cycles.
    Called after messages are sent to maintain continuous scheduling.
    """
    from django.utils import timezone
    from datetime import timedelta
    import calendar
    import logging

    logger = logging.getLogger(__name__)
    today = timezone.now().date()

    # Get all properties with automated messaging enabled
    settings_qs = AutomatedMessageSettings.objects.filter(enabled=True)

    for settings in settings_qs:
        try:
            prop = settings.property
            layouts = prop.layouts or {}
            if not isinstance(layouts, dict):
                continue

            message_days = settings.message_days or []
            if not message_days:
                continue

            send_hour = settings.send_hour if settings.send_hour is not None else 8
            send_minute = settings.send_minute if settings.send_minute is not None else 0
            message_template = settings.message_template

            # Iterate through all occupied rooms
            for variant_name, rooms in layouts.items():
                if not isinstance(rooms, list):
                    continue

                for room in rooms:
                    if room.get('status') != 'occupied':
                        continue

                    tenant_data = room.get('tenant', {})
                    if not tenant_data:
                        continue

                    # Get room info
                    box_number = str(room.get('number', ''))
                    box_section = room.get('section', '')
                    room_display = f"{box_section}{box_number}" if box_section else box_number

                    # Get tenant info
                    tenant_name = tenant_data.get('full_name', '')
                    tenant_id = tenant_data.get('tenant_id') or tenant_data.get('id', '')
                    phone = tenant_data.get('phone', '')
                    tenant_email = tenant_data.get('email', '')

                    # Skip inactive tenants (check DB is_active flag)
                    if tenant_id and not Tenant.objects.filter(pk=tenant_id, is_active=True).exists():
                        continue

                    if not phone:
                        continue

                    normalized_phone = _normalize_phone(phone)
                    if not normalized_phone:
                        continue

                    # Calculate next 2 due dates
                    preferred_day = room.get('preferred_payment_day') or tenant_data.get('preferred_payment_day') or 28

                    # Check if tenant moved in this month — first rent is due NEXT month
                    move_in_str = tenant_data.get('move_in')
                    move_in_parsed = None
                    if move_in_str and isinstance(move_in_str, str):
                        try:
                            from datetime import datetime as dt_parse
                            move_in_parsed = dt_parse.strptime(move_in_str[:10], '%Y-%m-%d').date()
                        except (ValueError, TypeError):
                            pass

                    if move_in_parsed and move_in_parsed.year == today.year and move_in_parsed.month == today.month:
                        # Tenant moved in this month — first rent due next month
                        regen_year = today.year
                        regen_month = today.month + 1
                        if regen_month > 12:
                            regen_month = 1
                            regen_year += 1
                        regen_last_day = calendar.monthrange(regen_year, regen_month)[1]
                        regen_actual_day = min(int(preferred_day), regen_last_day)
                        try:
                            from datetime import date as date_cls_regen
                            due_date = date_cls_regen(regen_year, regen_month, regen_actual_day)
                        except ValueError:
                            due_date = _calculate_next_due_date(preferred_day, today)
                    else:
                        due_date = _calculate_next_due_date(preferred_day, today)

                    if not due_date:
                        continue

                    # Calculate next month's due date
                    next_month = due_date.month + 1
                    next_year = due_date.year
                    if next_month > 12:
                        next_month = 1
                        next_year += 1
                    last_day = calendar.monthrange(next_year, next_month)[1]
                    next_due_day = min(int(preferred_day), last_day)
                    try:
                        from datetime import date as date_class
                        next_due_date = date_class(next_year, next_month, next_due_day)
                    except ValueError:
                        next_due_date = None

                    due_dates = [due_date]
                    if next_due_date:
                        due_dates.append(next_due_date)

                    # Check and create messages for each due date
                    for current_due_date in due_dates:
                        for days_before in message_days:
                            send_date = current_due_date - timedelta(days=days_before)

                            # Skip past dates
                            if send_date < today:
                                continue

                            # If send_date is today, skip if the send time has already passed
                            if send_date == today:
                                from datetime import datetime as dt_combine
                                send_at_check = timezone.make_aware(
                                    dt_combine.combine(send_date, dt_combine.min.time().replace(hour=send_hour, minute=send_minute))
                                )
                                if send_at_check <= timezone.now():
                                    continue

                            # Skip if a pending or sent message already exists
                            if ScheduledAutomatedMessage.objects.filter(
                                property=prop,
                                room_number=room_display,
                                due_date=current_due_date,
                                days_before_due=days_before,
                                status__in=['pending', 'sent']
                            ).exists():
                                continue

                            # Calculate message content
                            days_left = (current_due_date - send_date).days
                            message_text = _replace_message_placeholders(
                                message_template,
                                tenant_data,
                                room,
                                days_left,
                                current_due_date
                            )

                            # Calculate send_at datetime
                            from datetime import datetime
                            send_at = timezone.make_aware(
                                datetime.combine(send_date, datetime.min.time().replace(hour=send_hour, minute=send_minute))
                            )

                            # Use update_or_create to handle any existing cancelled/failed record
                            # for the same unique key (property, room, due_date, days_before_due)
                            ScheduledAutomatedMessage.objects.update_or_create(
                                property=prop,
                                room_number=room_display,
                                due_date=current_due_date,
                                days_before_due=days_before,
                                defaults=dict(
                                    tenant_name=tenant_name,
                                    tenant_layout_id=tenant_id,
                                    phone_number=normalized_phone,
                                    tenant_email=tenant_email or '',
                                    message=message_text,
                                    send_at=send_at,
                                    send_hour=send_hour,
                                    send_minute=send_minute,
                                    status='pending',
                                    sms_sent=False,
                                    email_sent=False,
                                    email_copy_sent=False,
                                    error_message='',
                                )
                            )
                            logger.info('Regenerated message for %s, room %s, %d days before %s',
                                       tenant_name, room_display, days_before, current_due_date)

        except Exception as e:
            logger.exception('Error regenerating messages for property %s: %s', settings.property_id, e)


class AutomatedMessageSettingsView(APIView):
    """
    View and manage automated message settings for a property.
    GET: Retrieve current settings
    POST: Create or update settings
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request, property_id):
        """Get automated message settings for a property."""
        try:
            prop = Property.objects.get(pk=property_id)
        except Property.DoesNotExist:
            return Response({'detail': 'Property not found.'}, status=status.HTTP_404_NOT_FOUND)
        
        try:
            settings = AutomatedMessageSettings.objects.get(property=prop)
            serializer = AutomatedMessageSettingsSerializer(settings)
            return Response(serializer.data)
        except AutomatedMessageSettings.DoesNotExist:
            # Return default settings
            return Response({
                'property': property_id,
                'enabled': True,
                'pwa_notifications_enabled': True,
                'sms_enabled': True,
                'email_enabled': True,
                'email_copy_to_owner': True,
                'owner_email': '',
                'email_subject_template': 'Rent Payment Reminder - [Room Number]',
                'message_template': 'Good Day [Tenant Name]! This is a reminder that your rent payment of ₱[Payment Amount] is due in [Days Left] days. Please settle on or before [Due Date]. Thank you!',
                'message_days': [7, 2, 0],
                'send_hour': 8,
                'send_minute': 0,
                'formatted_time': {'hour': 8, 'minute': 0, 'ampm': 'AM'}
            })
    
    def post(self, request, property_id):
        """Create or update automated message settings."""
        try:
            prop = Property.objects.get(pk=property_id)
        except Property.DoesNotExist:
            return Response({'detail': 'Property not found.'}, status=status.HTTP_404_NOT_FOUND)
        
        # Get or create settings
        settings, created = AutomatedMessageSettings.objects.get_or_create(
            property=prop,
            defaults={'created_by': request.user}
        )
        
        # Update created_by if not set (for existing settings that didn't have it)
        if not settings.created_by:
            settings.created_by = request.user
            settings.save(update_fields=['created_by'])

        # Update with provided data
        serializer = AutomatedMessageSettingsSerializer(settings, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            
            # Regenerate scheduled messages if settings changed
            if request.data.get('regenerate_messages', True):
                # Cancel existing pending messages for this property
                ScheduledAutomatedMessage.objects.filter(
                    property=prop,
                    status='pending'
                ).update(status='cancelled')
                
                # Generate new messages
                if settings.enabled:
                    stats = generate_scheduled_automated_messages(property_id=property_id)
                else:
                    stats = {'messages_created': 0, 'messages_skipped': 0}
            else:
                stats = None
            
            response_data = serializer.data
            if stats:
                response_data['generation_stats'] = stats
            
            return Response(response_data, status=status.HTTP_200_OK)
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ScheduledAutomatedMessagesView(APIView):
    """
    View and manage scheduled automated messages.
    GET: List scheduled messages (optionally filtered by property)
    POST: Manually trigger processing of due messages
    DELETE: Cancel pending messages
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        """List scheduled automated messages."""
        from django.utils import timezone
        
        property_id = request.query_params.get('property_id')
        status_filter = request.query_params.get('status', 'pending')
        limit = int(request.query_params.get('limit', 50))
        
        now = timezone.now()
        
        queryset = ScheduledAutomatedMessage.objects.all()
        
        if property_id:
            queryset = queryset.filter(property_id=property_id)
        
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        
        queryset = queryset.order_by('send_at')[:limit]
        
        serializer = ScheduledAutomatedMessageSerializer(queryset, many=True)
        
        # Get summary stats
        total_pending = ScheduledAutomatedMessage.objects.filter(status='pending').count()
        ready_to_send = ScheduledAutomatedMessage.objects.filter(status='pending', send_at__lte=now).count()
        
        return Response({
            'messages': serializer.data,
            'total_pending': total_pending,
            'ready_to_send': ready_to_send,
            'server_time': now.isoformat()
        })
    
    def post(self, request):
        """Manually trigger processing of due automated messages."""
        from django.utils import timezone
        
        now = timezone.now()
        
        # Option to regenerate messages first
        if request.data.get('regenerate', False):
            property_id = request.data.get('property_id')
            gen_stats = generate_scheduled_automated_messages(property_id=property_id)
        else:
            gen_stats = None
        
        # Process due messages
        ready_before = ScheduledAutomatedMessage.objects.filter(status='pending', send_at__lte=now).count()
        
        process_stats = process_scheduled_automated_messages()
        
        ready_after = ScheduledAutomatedMessage.objects.filter(status='pending', send_at__lte=now).count()
        
        response_data = {
            'detail': f"Processed {process_stats['sent_count']} message(s), {process_stats['failed_count']} failed.",
            'process_stats': process_stats,
            'ready_before': ready_before,
            'ready_after': ready_after,
            'server_time': now.isoformat()
        }
        
        if gen_stats:
            response_data['generation_stats'] = gen_stats
        
        return Response(response_data)
    
    def delete(self, request):
        """Cancel pending automated messages."""
        property_id = request.query_params.get('property_id')
        
        queryset = ScheduledAutomatedMessage.objects.filter(status='pending')
        
        if property_id:
            queryset = queryset.filter(property_id=property_id)
        
        count = queryset.count()
        queryset.update(status='cancelled')
        
        return Response({
            'detail': f'Cancelled {count} pending message(s).',
            'cancelled_count': count
        })


class GenerateAutomatedMessagesView(APIView):
    """
    Manually trigger generation of scheduled messages for a property.
    POST: Generate messages for all or specific property
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        """Generate scheduled automated messages."""
        property_id = request.data.get('property_id')
        
        # Optionally cancel existing pending messages first
        if request.data.get('cancel_existing', True):
            queryset = ScheduledAutomatedMessage.objects.filter(status='pending')
            if property_id:
                queryset = queryset.filter(property_id=property_id)
            cancelled = queryset.count()
            queryset.update(status='cancelled')
        else:
            cancelled = 0
        
        stats = generate_scheduled_automated_messages(property_id=property_id)
        stats['cancelled_previous'] = cancelled
        
        return Response({
            'detail': f"Generated {stats['messages_created']} message(s) for {stats['tenants_processed']} tenant(s).",
            'stats': stats
        })


class UpdateAutomatedMessageTimeView(APIView):
    """
    Update the send time for an individual scheduled automated message.
    PATCH: Update send_hour and send_minute for a specific message
    """
    permission_classes = [IsAuthenticated]

    def patch(self, request, message_id):
        """Update the send time for a specific automated message."""
        from django.utils import timezone
        from datetime import datetime

        try:
            message = ScheduledAutomatedMessage.objects.get(pk=message_id)
        except ScheduledAutomatedMessage.DoesNotExist:
            return Response({'detail': 'Message not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Only allow updating pending messages
        if message.status != 'pending':
            return Response(
                {'detail': f'Cannot update message with status "{message.status}". Only pending messages can be modified.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get new time values
        send_hour = request.data.get('send_hour')
        send_minute = request.data.get('send_minute')

        # Support 12-hour format input
        hour = request.data.get('hour')
        minute = request.data.get('minute')
        ampm = request.data.get('ampm')

        if hour is not None and ampm is not None:
            # Convert 12-hour to 24-hour format
            hour = int(hour)
            if ampm.upper() == 'PM' and hour != 12:
                hour += 12
            elif ampm.upper() == 'AM' and hour == 12:
                hour = 0
            send_hour = hour

        if minute is not None:
            send_minute = int(minute)

        if send_hour is None and send_minute is None:
            return Response(
                {'detail': 'No time values provided. Send send_hour/send_minute or hour/minute/ampm.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Validate values
        if send_hour is not None:
            send_hour = int(send_hour)
            if not (0 <= send_hour <= 23):
                return Response({'detail': 'send_hour must be between 0 and 23.'}, status=status.HTTP_400_BAD_REQUEST)
            message.send_hour = send_hour

        if send_minute is not None:
            send_minute = int(send_minute)
            if not (0 <= send_minute <= 59):
                return Response({'detail': 'send_minute must be between 0 and 59.'}, status=status.HTTP_400_BAD_REQUEST)
            message.send_minute = send_minute

        # Recalculate send_at based on the send_date and new time
        send_date = message.send_at.date()
        new_send_at = timezone.make_aware(
            datetime.combine(send_date, datetime.min.time().replace(
                hour=message.send_hour,
                minute=message.send_minute
            ))
        )
        message.send_at = new_send_at
        message.save()

        serializer = ScheduledAutomatedMessageSerializer(message)
        return Response(serializer.data)


class TenantMessageScheduleView(APIView):
    """
    Manage per-tenant message schedules.
    GET: List all tenant schedules for a property, or get one by room_number
    POST: Create or update a tenant schedule
    DELETE: Remove custom schedule (revert to property defaults)
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        """List tenant schedules, optionally filtered by property or room."""
        property_id = request.query_params.get('property_id')
        room_number = request.query_params.get('room_number')

        queryset = TenantMessageSchedule.objects.all()

        if property_id:
            queryset = queryset.filter(property_id=property_id)

        if room_number:
            queryset = queryset.filter(room_number=room_number)

        # If requesting a specific room, return single object
        if property_id and room_number:
            schedule = queryset.first()
            if schedule:
                serializer = TenantMessageScheduleSerializer(schedule)
                return Response(serializer.data)
            else:
                return Response({'detail': 'No custom schedule for this tenant.'}, status=status.HTTP_404_NOT_FOUND)

        serializer = TenantMessageScheduleSerializer(queryset, many=True)
        return Response({'schedules': serializer.data})

    def post(self, request):
        """Create or update a tenant schedule."""
        property_id = request.data.get('property')
        room_number = request.data.get('room_number')

        if not property_id or not room_number:
            return Response(
                {'detail': 'property and room_number are required.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get or create the schedule
        schedule, created = TenantMessageSchedule.objects.get_or_create(
            property_id=property_id,
            room_number=room_number,
            defaults={'use_custom_schedule': True}
        )

        serializer = TenantMessageScheduleSerializer(schedule, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK if not created else status.HTTP_201_CREATED)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request):
        """Delete a tenant schedule (revert to property defaults)."""
        property_id = request.query_params.get('property_id')
        room_number = request.query_params.get('room_number')

        if not property_id or not room_number:
            return Response(
                {'detail': 'property_id and room_number are required.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        deleted, _ = TenantMessageSchedule.objects.filter(
            property_id=property_id,
            room_number=room_number
        ).delete()

        if deleted:
            return Response({'detail': 'Custom schedule removed. Tenant will use property defaults.'})
        else:
            return Response({'detail': 'No custom schedule found for this tenant.'}, status=status.HTTP_404_NOT_FOUND)


class TenantScheduleListView(APIView):
    """
    Get all active tenants with their schedule info for a property.
    This combines tenant data from layouts with their custom schedules.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, property_id):
        """Get all tenants and their schedules for a property."""
        try:
            prop = Property.objects.get(pk=property_id)
        except Property.DoesNotExist:
            return Response({'detail': 'Property not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Get property default settings
        try:
            settings = prop.automated_message_settings
            default_days = settings.message_days or [2, 1, 0]
            default_hour = settings.send_hour or 9
            default_minute = settings.send_minute or 0
        except AutomatedMessageSettings.DoesNotExist:
            default_days = [2, 1, 0]
            default_hour = 9
            default_minute = 0

        # Get all custom schedules for this property
        custom_schedules = {
            s.room_number: s
            for s in TenantMessageSchedule.objects.filter(property=prop)
        }

        # Build tenant list from layouts
        tenants = []
        layouts = prop.layouts or {}

        for variant_name, rooms in layouts.items():
            if not isinstance(rooms, list):
                continue
            for room in rooms:
                if not isinstance(room, dict):
                    continue
                if room.get('status') != 'occupied':
                    continue

                tenant_data = room.get('tenant', {})
                if not tenant_data:
                    continue

                # Build room display name
                number = str(room.get('number', ''))
                section = room.get('section', '')
                room_type = room.get('type', 'room')

                if room_type == 'commercial':
                    room_display = f"C{number}"
                elif section:
                    room_display = f"{section}{number}"
                else:
                    room_display = number

                # Get custom schedule if exists
                custom = custom_schedules.get(room_display)

                # Build send time display
                if custom and custom.use_custom_schedule:
                    hour = custom.send_hour
                    minute = custom.send_minute
                    days = custom.message_days or default_days
                    has_custom = True
                else:
                    hour = default_hour
                    minute = default_minute
                    days = default_days
                    has_custom = False

                ampm = 'AM' if hour < 12 else 'PM'
                display_hour = hour if hour <= 12 else hour - 12
                if display_hour == 0:
                    display_hour = 12
                time_display = f"{display_hour}:{minute:02d} {ampm}"

                tenants.append({
                    'room_number': room_display,
                    'tenant_name': tenant_data.get('full_name') or 'Unknown',
                    'tenant_id': tenant_data.get('tenant_id') or tenant_data.get('id'),
                    'phone': tenant_data.get('phone', ''),
                    'email': tenant_data.get('email', ''),
                    'message_days': days,
                    'send_hour': hour,
                    'send_minute': minute,
                    'send_time_display': time_display,
                    'has_custom_schedule': has_custom,
                    'schedule_id': custom.id if custom else None
                })

        return Response({
            'property_id': prop.id,
            'property_name': prop.name,
            'default_message_days': default_days,
            'default_send_hour': default_hour,
            'default_send_minute': default_minute,
            'tenants': tenants
        })


class MLPredictNotificationTimeView(APIView):
    """
    Use ML model to predict optimal notification time for a tenant.
    POST body: { "property_id": 1, "room_number": "upper4", "tenant_layout_id": 12345 }
    Returns: { "optimal_hour": 14, "confidence": 0.85, "recommended": true }
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        """Predict optimal notification hour for a tenant using ML model."""
        import os

        property_id = request.data.get('property_id')
        room_number = request.data.get('room_number')
        tenant_layout_id = request.data.get('tenant_layout_id')
        
        if not all([property_id, room_number, tenant_layout_id]):
            return Response(
                {'detail': 'property_id, room_number, and tenant_layout_id are required.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            # Import ML model
            from api.ml.train_notification_model import NotificationTimingModel
            
            # Load the trained model
            model_path = os.path.join(settings.BASE_DIR, 'api', 'ml', 'models', 'latest_model.pkl')
            
            if not os.path.exists(model_path):
                return Response(
                    {'detail': 'ML model not found. Please train the model first.'},
                    status=status.HTTP_404_NOT_FOUND
                )
            
            model = NotificationTimingModel.load_model(model_path)
            
            # Extract tenant features from database
            # For now, use default features since we don't have payment history
            # In production, you'd extract from ScheduledAutomatedMessage history
            
            tenant_features = self._get_tenant_features(property_id, room_number, tenant_layout_id)
            
            # Predict optimal hour
            optimal_hours, confidence = model.predict_optimal_hour(tenant_features)
            optimal_hour = int(optimal_hours[0])
            confidence_score = float(confidence[0])
            
            # Determine if we should use this prediction
            recommended = confidence_score > 0.5
            
            return Response({
                'optimal_hour': optimal_hour,
                'confidence': confidence_score,
                'recommended': recommended,
                'message': f"ML model recommends sending at {optimal_hour}:00 with {confidence_score:.1%} confidence."
            })
            
        except ImportError as e:
            return Response(
                {'detail': f'ML model not available: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        except Exception as e:
            return Response(
                {'detail': f'Error predicting notification time: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    def _get_tenant_features(self, property_id, room_number, tenant_layout_id):
        """
        Build ML feature vector using real transaction history from layout JSON,
        matching the logic in the update_ml_schedules management command.
        Falls back to neutral defaults when fewer than 3 transactions exist.
        """
        import pandas as pd
        import numpy as np
        from datetime import datetime

        monthly_rent = 10000
        room_obj = None

        try:
            prop = Property.objects.get(pk=property_id)
            layouts = prop.layouts or {}
            for variant, rooms in layouts.items():
                if isinstance(rooms, list):
                    for room in rooms:
                        if isinstance(room, dict) and self._get_room_display(room) == room_number:
                            room_obj = room
                            tenant_data = room.get('tenant') or {}
                            monthly_rent = float(
                                room.get('payment') or
                                tenant_data.get('payment_amount') or
                                10000
                            )
                            break
        except Exception:
            pass

        # Collect (timestamp, hour, weekday) tuples for recency weighting
        parsed = []
        if room_obj:
            for tx in room_obj.get('transactions') or []:
                ts = tx.get('timestamp') or tx.get('paid_date')
                if not ts:
                    continue
                try:
                    dt = datetime.fromisoformat(str(ts))
                    parsed.append((dt, dt.hour, dt.weekday()))
                except (ValueError, TypeError):
                    pass

        if len(parsed) >= 3:
            # Sort newest first, apply exponential decay weights
            parsed.sort(key=lambda x: x[0], reverse=True)
            decay = 0.9
            weights = np.array([decay ** i for i in range(len(parsed))])
            hours = np.array([h for _, h, _ in parsed])
            days = np.array([d for _, _, d in parsed])
            payment_hour_mean = float(np.average(hours, weights=weights))
            payment_hour_std = float(np.sqrt(np.average((hours - payment_hour_mean) ** 2, weights=weights)))
            payment_day_mean = float(np.average(days, weights=weights))
        else:
            payment_hour_mean = 9.0
            payment_hour_std = 2.0
            payment_day_mean = 3.0

        now = datetime.now()
        return pd.DataFrame([{
            'tenant_id': tenant_layout_id,
            'room_number': room_number,
            'property_id': property_id,
            'profile_type': 'unknown',
            'profile_type_encoded': 0,
            'payment_hour_mean': payment_hour_mean,
            'payment_hour_std': payment_hour_std,
            'payment_day_of_week_mean': payment_day_mean,
            'days_from_due_date_mean': 0.0,
            'days_from_due_date_std': 1.0,
            'is_on_time_mean': 0.75,
            'is_early_mean': 0.25,
            'is_late_mean': 0.0,
            'hours_notification_to_payment_mean': 24.0,
            'days_before_due': 2,
            'preferred_payment_day': 5,
            'warning_flag': False,
            'monthly_rent': monthly_rent,
            'month_of_year': now.month,
            'quarter': (now.month - 1) // 3 + 1,
        }])

    def _get_room_display(self, room):
        """Generate room display name from room data."""
        number = str(room.get('number', ''))
        section = room.get('section', '')
        room_type = room.get('type', 'room')

        if room_type == 'commercial':
            return f"C{number}"
        elif section:
            return f"{section}{number}"
        else:
            return number


class MLBatchUpdateSchedulesView(APIView):
    """
    Use ML model to batch update all tenant schedules for a property.
    POST body: { "property_id": 1, "min_confidence": 0.5 }
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        """Batch update all tenant schedules using ML predictions."""
        import os
        import pandas as pd
        
        property_id = request.data.get('property_id')
        min_confidence = float(request.data.get('min_confidence', 0.5))
        
        if not property_id:
            return Response(
                {'detail': 'property_id is required.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            # Get property
            prop = Property.objects.get(pk=property_id)
        except Property.DoesNotExist:
            return Response(
                {'detail': 'Property not found.'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        try:
            # Import ML model
            from api.ml.train_notification_model import NotificationTimingModel
            
            # Load the trained model
            model_path = os.path.join(settings.BASE_DIR, 'api', 'ml', 'models', 'latest_model.pkl')
            
            if not os.path.exists(model_path):
                return Response(
                    {'detail': 'ML model not found. Please train the model first.'},
                    status=status.HTTP_404_NOT_FOUND
                )
            
            model = NotificationTimingModel.load_model(model_path)
            
            # Process all tenants
            updated_count = 0
            skipped_count = 0
            results = []
            
            layouts = prop.layouts or {}
            
            for variant_name, rooms in layouts.items():
                if not isinstance(rooms, list):
                    continue
                    
                for room in rooms:
                    if not isinstance(room, dict):
                        continue
                    if room.get('status') != 'occupied':
                        continue
                    
                    tenant_data = room.get('tenant', {})
                    if not tenant_data:
                        continue
                    
                    # Get room info
                    room_number = self._get_room_display(room)
                    tenant_layout_id = tenant_data.get('id') or tenant_data.get('tenant_id')
                    tenant_name = tenant_data.get('full_name', 'Unknown')
                    
                    # Get tenant features from real transaction history
                    features = self._get_tenant_features(property_id, room_number, tenant_layout_id, room)
                    
                    # Predict
                    optimal_hours, confidence = model.predict_optimal_hour(features)
                    optimal_hour = int(optimal_hours[0])
                    confidence_score = float(confidence[0])
                    
                    # Only update if confidence meets threshold
                    if confidence_score >= min_confidence:
                        # Update or create schedule
                        schedule, created = TenantMessageSchedule.objects.get_or_create(
                            property=prop,
                            room_number=room_number,
                            defaults={
                                'tenant_name': tenant_name,
                                'send_hour': optimal_hour,
                                'use_custom_schedule': True
                            }
                        )
                        
                        if not created:
                            schedule.send_hour = optimal_hour
                            schedule.use_custom_schedule = True
                            schedule.tenant_name = tenant_name
                            schedule.save()
                        
                        updated_count += 1
                        results.append({
                            'room_number': room_number,
                            'tenant_name': tenant_name,
                            'optimal_hour': optimal_hour,
                            'confidence': confidence_score,
                            'updated': True
                        })
                    else:
                        skipped_count += 1
                        results.append({
                            'room_number': room_number,
                            'tenant_name': tenant_name,
                            'optimal_hour': optimal_hour,
                            'confidence': confidence_score,
                            'updated': False,
                            'reason': f'Confidence {confidence_score:.1%} below threshold {min_confidence:.1%}'
                        })
            
            return Response({
                'property_id': property_id,
                'property_name': prop.name,
                'updated': updated_count,
                'skipped': skipped_count,
                'min_confidence': min_confidence,
                'results': results
            })
            
        except ImportError as e:
            return Response(
                {'detail': f'ML model not available: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        except Exception as e:
            return Response(
                {'detail': f'Error batch updating schedules: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    def _get_tenant_features(self, property_id, room_number, tenant_layout_id, room):
        """Build ML feature vector using real transaction history from the room dict.
        Uses recency-weighted averages so recent payments count more.
        Falls back to neutral defaults when fewer than 3 transactions exist."""
        import pandas as pd
        import numpy as np
        from datetime import datetime

        tenant_data = room.get('tenant') or {}
        monthly_rent = float(
            room.get('payment') or tenant_data.get('payment_amount') or 10000
        )

        # Collect (timestamp, hour, weekday) tuples for recency weighting
        parsed = []
        for tx in room.get('transactions') or []:
            ts = tx.get('timestamp') or tx.get('paid_date')
            if not ts:
                continue
            try:
                dt = datetime.fromisoformat(str(ts))
                parsed.append((dt, dt.hour, dt.weekday()))
            except (ValueError, TypeError):
                pass

        if len(parsed) >= 3:
            # Sort newest first, apply exponential decay weights
            parsed.sort(key=lambda x: x[0], reverse=True)
            decay = 0.9
            weights = np.array([decay ** i for i in range(len(parsed))])
            hours = np.array([h for _, h, _ in parsed])
            days = np.array([d for _, _, d in parsed])
            payment_hour_mean = float(np.average(hours, weights=weights))
            payment_hour_std = float(np.sqrt(np.average((hours - payment_hour_mean) ** 2, weights=weights)))
            payment_day_mean = float(np.average(days, weights=weights))
        else:
            payment_hour_mean = 9.0
            payment_hour_std = 2.0
            payment_day_mean = 3.0

        now = datetime.now()
        return pd.DataFrame([{
            'tenant_id': tenant_layout_id,
            'room_number': room_number,
            'property_id': property_id,
            'profile_type': 'unknown',
            'profile_type_encoded': 0,
            'payment_hour_mean': payment_hour_mean,
            'payment_hour_std': payment_hour_std,
            'payment_day_of_week_mean': payment_day_mean,
            'days_from_due_date_mean': 0.0,
            'days_from_due_date_std': 1.0,
            'is_on_time_mean': 0.75,
            'is_early_mean': 0.25,
            'is_late_mean': 0.0,
            'hours_notification_to_payment_mean': 24.0,
            'days_before_due': 2,
            'preferred_payment_day': 5,
            'warning_flag': False,
            'monthly_rent': monthly_rent,
            'month_of_year': now.month,
            'quarter': (now.month - 1) // 3 + 1,
        }])
    
    def _get_room_display(self, room):
        """Generate room display name from room data."""
        number = str(room.get('number', ''))
        section = room.get('section', '')
        room_type = room.get('type', 'room')
        
        if room_type == 'commercial':
            return f"C{number}"
        elif section:
            return f"{section}{number}"
        else:
            return number

