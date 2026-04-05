import copy
import logging

from django.db import transaction as db_transaction
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import (
    Tenant, Property, AuditLog,
)
from .utils import get_client_ip, format_room_display, _normalize_room_for_compare, _iter_layout_boxes


class TenantPaymentView(generics.GenericAPIView):
    """Record a payment from a tenant."""
    permission_classes = [IsAuthenticated]

    @db_transaction.atomic
    def post(self, request, pk):
        try:
            tenant = Tenant.objects.get(pk=pk)
        except Tenant.DoesNotExist:
            return Response({'error': 'Tenant not found'}, status=status.HTTP_404_NOT_FOUND)

        property_id = request.data.get('property_id')
        room_number = request.data.get('room_number')
        amount = request.data.get('amount')
        payment_date = request.data.get('payment_date')
        payment_time = request.data.get('payment_time')  # "HH:MM" string, optional
        notes = request.data.get('notes', '')
        is_late = request.data.get('is_late', False)
        receipt_number = request.data.get('receipt_number', '')
        payment_method = request.data.get('payment_method', 'cash')
        payment_type = request.data.get('payment_type', 'rent')
        payment_status = request.data.get('payment_status', 'full')
        remaining_balance = request.data.get('remaining_balance', 0) or 0
        is_balance_payment = request.data.get('is_balance_payment', False)
        for_month = request.data.get('for_month')  # e.g. "2026-01" — which month this rent payment covers
        try:
            remaining_balance = float(remaining_balance)
        except (ValueError, TypeError):
            remaining_balance = 0
        late_fee = request.data.get('late_fee')
        try:
            late_fee = float(late_fee) if late_fee is not None else 0
        except (ValueError, TypeError):
            late_fee = 0
        if late_fee < 0:
            late_fee = 0

        if not all([property_id, room_number, amount, payment_date]):
            return Response(
                {'error': 'property_id, room_number, amount, and payment_date are required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            amount = float(amount)
            if amount <= 0:
                return Response({'error': 'Amount must be positive'}, status=status.HTTP_400_BAD_REQUEST)
        except (ValueError, TypeError):
            return Response({'error': 'Invalid amount'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            prop = Property.objects.select_for_update().get(pk=property_id)
        except Property.DoesNotExist:
            return Response({'error': 'Property not found'}, status=status.HTTP_404_NOT_FOUND)

        layouts = prop.layouts or {}
        updated = False

        # Create transaction record
        from datetime import datetime
        # Build timestamp: use the manually entered date+time if provided, else now
        if payment_date and payment_time:
            try:
                payment_timestamp = datetime.fromisoformat(f'{payment_date}T{payment_time}:00').isoformat()
            except (ValueError, TypeError):
                payment_timestamp = datetime.now().isoformat()
        else:
            payment_timestamp = datetime.now().isoformat()
        transaction = {
            'date': payment_date,
            'amount': f'{amount:,.2f}',
            'name': tenant.full_name,
            'notes': notes,
            'tenant_id': tenant.tenant_id,
            'tenant_name': tenant.full_name,
            'timestamp': payment_timestamp,
            'is_late': is_late,
            'status': 'late' if is_late else 'paid',
            'receipt_number': receipt_number if receipt_number else None,
            'method': payment_method,
            'payment_type': payment_type,
            'payment_status': payment_status if payment_type == 'rent' else 'full',
            'remaining_balance': remaining_balance if payment_type == 'rent' and payment_status == 'partial' else 0,
            'for_month': for_month if payment_type == 'rent' and for_month else None,
        }

        # Add transaction to room's history in layouts
        room_data = None
        room_number_norm = _normalize_room_for_compare(room_number)
        for b, _ in _iter_layout_boxes(layouts):
            box_number = str(b.get('number', ''))
            box_type = b.get('type', 'room')
            box_section = b.get('section')
            formatted_box = format_room_display(box_number, box_type, box_section)
            if _normalize_room_for_compare(formatted_box) != room_number_norm:
                continue
            tenant_data = b.get('tenant')
            if not tenant_data or str(tenant_data.get('tenant_id') or tenant_data.get('id') or '') != str(tenant.tenant_id):
                continue
            room_data = {'type': box_type, 'section': box_section}
            if 'transactions' not in b:
                b['transactions'] = []
            b['transactions'].insert(0, transaction)
            if late_fee > 0 and payment_type == 'rent':
                late_fee_transaction = {
                    'date': payment_date,
                    'amount': f'{late_fee:,.2f}',
                    'name': tenant.full_name,
                    'notes': f'Late payment fee (₱50/day)',
                    'tenant_id': tenant.tenant_id,
                    'tenant_name': tenant.full_name,
                    'timestamp': datetime.now().isoformat(),
                    'is_late': True,
                    'status': 'paid',
                    'receipt_number': receipt_number if receipt_number else None,
                    'method': payment_method,
                    'payment_type': 'late_fee'
                }
                b['transactions'].insert(0, late_fee_transaction)
            # Auto-update initial payment status when owner confirms advance or deposit
            if payment_type == 'advance':
                b['tenant']['advance_paid'] = True
                b['tenant']['advance_amount'] = float(amount)
            elif payment_type == 'deposit':
                b['tenant']['deposit_paid'] = True
                b['tenant']['deposit_amount'] = float(amount)
            updated = True
            logging.getLogger(__name__).info('Added payment transaction to room %s', room_number)
            break

        if updated:
            prop.layouts = layouts
            prop.save()

            # Invalidate ML schedule cache so next update_ml_schedules run refreshes this tenant
            try:
                from api.models import TenantMessageSchedule
                room_display_for_ml = format_room_display(room_number, room_data.get('type', 'room'), room_data.get('section'))
                TenantMessageSchedule.objects.filter(
                    property=prop,
                    room_number=room_display_for_ml
                ).update(ml_last_updated=None)
            except Exception:
                pass  # Non-critical — don't let this break the payment flow

            # Log payment in audit log
            try:
                room_display = format_room_display(room_number, room_data.get('type', 'room'), room_data.get('section'))
                receipt_info = f' Receipt: {receipt_number}.' if receipt_number else ''
                if is_balance_payment and not is_late:
                    # Balance payment (paying off remaining rent) — distinct event for activity logs
                    if remaining_balance <= 0:
                        details = f'Balance payment of ₱{amount:,.2f} received from {tenant.full_name} (ID: {tenant.tenant_id}) for Room {room_display} at {prop.name}. Monthly rent paid in full.'
                    else:
                        details = f'Balance payment of ₱{amount:,.2f} received from {tenant.full_name} (ID: {tenant.tenant_id}) for Room {room_display} at {prop.name}. Remaining balance: ₱{remaining_balance:,.2f}.'
                    AuditLog.objects.create(
                        severity='info',
                        event='Balance Payment Received',
                        user=request.user.username if request.user.is_authenticated else 'Anonymous',
                        ip_address=get_client_ip(request),
                        details=details,
                        user_ref=request.user if request.user.is_authenticated else None,
                        property_ref=prop
                    )
                elif is_late:
                    # Log late payment with warning severity
                    base_msg = f'LATE PAYMENT of ₱{amount:,.2f} received from {tenant.full_name} (ID: {tenant.tenant_id}) for Room {room_display} at {prop.name}.{receipt_info}'
                    AuditLog.objects.create(
                        severity='warning',
                        event='Late Payment Received',
                        user=request.user.username if request.user.is_authenticated else 'Anonymous',
                        ip_address=get_client_ip(request),
                        details=f'{base_msg} {notes}' if notes else base_msg,
                        user_ref=request.user if request.user.is_authenticated else None,
                        property_ref=prop
                    )
                else:
                    base_msg = f'Payment of ₱{amount:,.2f} received from {tenant.full_name} (ID: {tenant.tenant_id}) for Room {room_display} at {prop.name}.{receipt_info}'
                    AuditLog.objects.create(
                        severity='info',
                        event='Payment Received',
                        user=request.user.username if request.user.is_authenticated else 'Anonymous',
                        ip_address=get_client_ip(request),
                        details=f'{base_msg} {notes}' if notes else base_msg,
                        user_ref=request.user if request.user.is_authenticated else None,
                        property_ref=prop
                    )
            except Exception:
                logging.getLogger(__name__).exception('Failed to create audit log for payment')

            # Broadcast layout update
            try:
                from asgiref.sync import async_to_sync
                from channels.layers import get_channel_layer
                channel_layer = get_channel_layer()
                group_name = f'property_{prop.id}'
                async_to_sync(channel_layer.group_send)(
                    group_name,
                    {'type': 'layouts.update', 'layouts': prop.layouts}
                )
                logging.getLogger(__name__).info('Broadcast layout update for property %s after payment', prop.id)
            except Exception:
                logging.getLogger(__name__).exception('Error broadcasting layout update')

            return Response({'message': 'Payment recorded successfully', 'transaction': transaction}, status=status.HTTP_200_OK)
        else:
            return Response({'error': 'Tenant not found in specified room'}, status=status.HTTP_400_BAD_REQUEST)


class SendPaymentConfirmationView(generics.GenericAPIView):
    """Send payment confirmation to tenant (and owner if email) after payment is recorded."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        from .messaging import _log_message, _send_sms_to_phones

        channel = (request.data.get('channel') or 'email').lower()
        tenant_id = pk
        try:
            tenant = Tenant.objects.get(pk=tenant_id)
        except Tenant.DoesNotExist:
            return Response({'error': 'Tenant not found'}, status=status.HTTP_404_NOT_FOUND)

        amount = request.data.get('amount', 0)
        payment_method = request.data.get('payment_method', 'cash')
        payment_date = request.data.get('payment_date', '')
        room_number = request.data.get('room_number', '')
        property_id = request.data.get('property_id')
        payment_type = request.data.get('payment_type', 'rent')
        remaining_balance = request.data.get('remaining_balance', 0)
        receipt_number = request.data.get('receipt_number', '')

        prop = None
        if property_id:
            try:
                prop = Property.objects.get(pk=property_id)
            except Property.DoesNotExist:
                pass

        property_name = prop.name if prop else 'Property'

        if channel == 'email':
            tenant_email = getattr(tenant, 'email', None)
            if not tenant_email:
                return Response({'error': 'Tenant has no email on file'}, status=status.HTTP_400_BAD_REQUEST)

            from ..email_service import send_tenant_payment_confirmation_email, send_payment_received_email

            # Send to tenant
            success_t, err_t = send_tenant_payment_confirmation_email(
                tenant_email=tenant_email,
                tenant_name=tenant.full_name,
                room_number=room_number,
                amount_paid=amount,
                payment_method=payment_method,
                payment_date=payment_date,
                property_name=property_name,
                payment_type=payment_type,
                remaining_balance=remaining_balance,
                receipt_number=receipt_number or None,
            )
            _log_message(tenant_email, 'email', 'payment_confirmation',
                         f'Payment confirmation: {amount} for Room {room_number}',
                         'sent' if success_t else 'failed',
                         error_message=err_t or '',
                         tenant_name=tenant.full_name, tenant_id=tenant.pk,
                         property_obj=prop, room_number=room_number,
                         sent_by=request.user,
                         subject='Payment Confirmation')

            # Also send to owner
            owner_sent = False
            if prop and prop.owner and prop.owner.email:
                success_o, _err_o = send_payment_received_email(
                    owner_email=prop.owner.email,
                    tenant_name=tenant.full_name,
                    room_number=room_number,
                    amount_paid=amount,
                    payment_method=payment_method,
                    payment_date=payment_date,
                    property_name=property_name,
                    payment_type=payment_type,
                    remaining_balance=remaining_balance,
                    receipt_number=receipt_number or None,
                )
                owner_sent = success_o
                _log_message(prop.owner.email, 'email', 'payment_confirmation',
                             f'Payment received: {tenant.full_name} paid {amount} for Room {room_number}',
                             'sent' if success_o else 'failed',
                             error_message=_err_o or '',
                             tenant_name=tenant.full_name, tenant_id=tenant.pk,
                             property_obj=prop, room_number=room_number,
                             sent_by=request.user,
                             subject='Payment Received')

            if not success_t:
                return Response({'error': f'Failed to send email: {err_t}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            parts = ['Email sent to tenant']
            if owner_sent:
                parts.append('owner')
            return Response({'detail': ' & '.join(parts) + ' successfully!'})

        elif channel in ('sms', 'both'):
            phone = getattr(tenant, 'phone', None) or getattr(tenant, 'phone_number', None)

            try:
                amount_val = float(amount)
                amount_str = f'₱{amount_val:,.2f}'
            except (ValueError, TypeError):
                amount_str = f'₱{amount}'

            sms_sent = False
            sms_detail = ''
            if phone:
                sms_text = f'Hi {tenant.full_name}! Your payment of {amount_str} for Room {room_number} has been received. Thank you!'
                sms_sent, sms_detail = _send_sms_to_phones(sms_text, [phone])
                _log_message(phone, 'sms', 'payment_confirmation', sms_text,
                             'sent' if sms_sent else 'failed',
                             error_message=sms_detail if not sms_sent else '',
                             tenant_name=tenant.full_name, tenant_id=tenant.pk,
                             property_obj=prop, room_number=room_number,
                             sent_by=request.user)

            email_sent = False
            owner_sent = False
            if channel == 'both':
                tenant_email = getattr(tenant, 'email', None)
                if tenant_email:
                    from ..email_service import send_tenant_payment_confirmation_email, send_payment_received_email
                    email_sent, _e_err = send_tenant_payment_confirmation_email(
                        tenant_email=tenant_email,
                        tenant_name=tenant.full_name,
                        room_number=room_number,
                        amount_paid=amount,
                        payment_method=payment_method,
                        payment_date=payment_date,
                        property_name=property_name,
                        payment_type=payment_type,
                        remaining_balance=remaining_balance,
                        receipt_number=receipt_number or None,
                    )
                    _log_message(tenant_email, 'email', 'payment_confirmation',
                                 f'Payment confirmation: {amount} for Room {room_number}',
                                 'sent' if email_sent else 'failed',
                                 error_message=_e_err or '' if not email_sent else '',
                                 tenant_name=tenant.full_name, tenant_id=tenant.pk,
                                 property_obj=prop, room_number=room_number,
                                 sent_by=request.user,
                                 subject='Payment Confirmation')
                    if prop and prop.owner and prop.owner.email:
                        owner_sent, _o_err = send_payment_received_email(
                            owner_email=prop.owner.email,
                            tenant_name=tenant.full_name,
                            room_number=room_number,
                            amount_paid=amount,
                            payment_method=payment_method,
                            payment_date=payment_date,
                            property_name=property_name,
                            payment_type=payment_type,
                            remaining_balance=remaining_balance,
                            receipt_number=receipt_number or None,
                        )
                        _log_message(prop.owner.email, 'email', 'payment_confirmation',
                                     f'Payment received: {tenant.full_name} paid {amount} for Room {room_number}',
                                     'sent' if owner_sent else 'failed',
                                     error_message=_o_err or '' if not owner_sent else '',
                                     tenant_name=tenant.full_name, tenant_id=tenant.pk,
                                     property_obj=prop, room_number=room_number,
                                     sent_by=request.user,
                                     subject='Payment Received')

            if channel == 'sms':
                if not phone:
                    return Response({'error': 'Tenant has no phone number on file'}, status=status.HTTP_400_BAD_REQUEST)
                if not sms_sent:
                    return Response({'error': f'Failed to send SMS: {sms_detail}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
                return Response({'detail': 'SMS confirmation sent to tenant!'})

            # channel == 'both'
            parts = []
            if sms_sent:
                parts.append('SMS sent to tenant')
            if email_sent:
                parts.append('Email sent to tenant')
            if owner_sent:
                parts.append('owner')
            if not parts:
                return Response({'error': 'Failed to send — no phone or email on file'}, status=status.HTTP_400_BAD_REQUEST)
            return Response({'detail': ' & '.join(parts) + ' successfully!'})

        else:
            return Response({'error': 'Invalid channel. Use "sms", "email", or "both".'}, status=status.HTTP_400_BAD_REQUEST)


class TenantBatchPaymentView(generics.GenericAPIView):
    """Record payments for a tenant across multiple rooms (batch). Each item goes to that room's history."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            tenant = Tenant.objects.get(pk=pk)
        except Tenant.DoesNotExist:
            return Response({'error': 'Tenant not found'}, status=status.HTTP_404_NOT_FOUND)

        payments = request.data.get('payments')
        if not payments or not isinstance(payments, list):
            return Response(
                {'error': 'payments array is required (list of { property_id, room_number, amount })'},
                status=status.HTTP_400_BAD_REQUEST
            )

        shared_date = request.data.get('payment_date')
        shared_time = request.data.get('payment_time')  # "HH:MM" string, optional
        shared_method = request.data.get('payment_method', 'cash')
        shared_notes = request.data.get('notes', '')
        shared_is_late = request.data.get('is_late', False)
        shared_receipt = request.data.get('receipt_number', '')
        payment_type = request.data.get('payment_type', 'rent')
        payment_status = request.data.get('payment_status', 'full')
        remaining_balance = request.data.get('remaining_balance', 0) or 0
        for_month = request.data.get('for_month')  # e.g. "2026-01"
        late_fee = request.data.get('late_fee')
        try:
            late_fee = float(late_fee) if late_fee is not None else 0
        except (ValueError, TypeError):
            late_fee = 0
        if late_fee < 0:
            late_fee = 0

        if not shared_date:
            return Response({'error': 'payment_date is required'}, status=status.HTTP_400_BAD_REQUEST)

        from datetime import datetime
        results = []
        properties_updated = {}  # prop_id -> (prop, layouts) so we save/broadcast once per property

        late_fee_added = False
        for item in payments:
            property_id = item.get('property_id')
            room_number = item.get('room_number')
            amount = item.get('amount')

            if property_id is None or not room_number:
                results.append({'room_number': room_number or '?', 'ok': False, 'error': 'property_id and room_number required'})
                continue
            try:
                amount = float(amount)
                if amount <= 0:
                    results.append({'room_number': room_number, 'ok': False, 'error': 'Amount must be positive'})
                    continue
            except (ValueError, TypeError):
                results.append({'room_number': room_number, 'ok': False, 'error': 'Invalid amount'})
                continue

            try:
                prop = Property.objects.get(pk=property_id)
            except Property.DoesNotExist:
                results.append({'room_number': room_number, 'ok': False, 'error': 'Property not found'})
                continue

            if prop.id not in properties_updated:
                # Shallow copy: we modify boxes in place (same list refs as prop.layouts); at save we assign a deep copy so Django persists
                properties_updated[prop.id] = [prop, (prop.layouts or {}).copy()]
            _, layouts = properties_updated[prop.id]
            if not isinstance(layouts, dict):
                layouts = layouts if isinstance(layouts, dict) else {}

            # Build timestamp from user-supplied date+time, fall back to now
            if shared_date and shared_time:
                try:
                    batch_timestamp = datetime.fromisoformat(f'{shared_date}T{shared_time}:00').isoformat()
                except (ValueError, TypeError):
                    batch_timestamp = datetime.now().isoformat()
            else:
                batch_timestamp = datetime.now().isoformat()

            # New transaction dict per room so each room has its own record
            transaction = {
                'date': shared_date,
                'amount': f'{amount:,.2f}',
                'name': tenant.full_name,
                'notes': shared_notes,
                'tenant_id': tenant.tenant_id,
                'tenant_name': tenant.full_name,
                'timestamp': batch_timestamp,
                'is_late': shared_is_late,
                'status': 'late' if shared_is_late else 'paid',
                'receipt_number': shared_receipt if shared_receipt else None,
                'method': shared_method,
                'payment_type': payment_type,
                'payment_status': payment_status if payment_type == 'rent' else 'full',
                'remaining_balance': float(remaining_balance) if payment_type == 'rent' and payment_status == 'partial' else 0,
                'for_month': for_month if payment_type == 'rent' and for_month else None,
            }

            room_data = None
            updated = False
            tenant_id_str = str(tenant.tenant_id)
            room_number_norm = _normalize_room_for_compare(room_number)
            for b, _ in _iter_layout_boxes(layouts):
                box_number = str(b.get('number', ''))
                box_type = b.get('type', 'room')
                box_section = b.get('section')
                formatted_box = format_room_display(box_number, box_type, box_section)
                box_norm = _normalize_room_for_compare(formatted_box)
                if box_norm != room_number_norm:
                    continue
                tenant_data = b.get('tenant')
                if not tenant_data:
                    continue
                tid = tenant_data.get('tenant_id') or tenant_data.get('id')
                if str(tid) != tenant_id_str:
                    continue
                room_data = {'type': box_type, 'section': box_section}
                if 'transactions' not in b:
                    b['transactions'] = []
                b['transactions'].insert(0, transaction)
                if late_fee > 0 and payment_type == 'rent' and not late_fee_added:
                    late_fee_transaction = {
                        'date': shared_date,
                        'amount': f'{late_fee:,.2f}',
                        'name': tenant.full_name,
                        'notes': 'Late payment fee (₱50/day)',
                        'tenant_id': tenant.tenant_id,
                        'tenant_name': tenant.full_name,
                        'timestamp': batch_timestamp,
                        'is_late': True,
                        'status': 'paid',
                        'receipt_number': shared_receipt if shared_receipt else None,
                        'method': shared_method,
                        'payment_type': 'late_fee'
                    }
                    b['transactions'].insert(0, late_fee_transaction)
                    late_fee_added = True
                # Auto-update initial payment status when owner confirms advance or deposit
                if payment_type == 'advance':
                    b['tenant']['advance_paid'] = True
                    b['tenant']['advance_amount'] = float(amount)
                elif payment_type == 'deposit':
                    b['tenant']['deposit_paid'] = True
                    b['tenant']['deposit_amount'] = float(amount)
                updated = True
                break

            if updated and room_data:
                results.append({'room_number': room_number, 'ok': True})
                try:
                    room_display = format_room_display(room_number, room_data.get('type', 'room'), room_data.get('section'))
                    receipt_info = f' Receipt: {shared_receipt}.' if shared_receipt else ''
                    base_msg = f'Payment of ₱{amount:,.2f} from {tenant.full_name} (ID: {tenant.tenant_id}) for Room {room_display} at {prop.name}.{receipt_info}'
                    AuditLog.objects.create(
                        severity='warning' if shared_is_late else 'info',
                        event='Late Payment Received' if shared_is_late else 'Payment Received',
                        user=request.user.username if request.user.is_authenticated else 'Anonymous',
                        ip_address=get_client_ip(request),
                        details=f'{base_msg} {shared_notes}'.strip() if shared_notes else base_msg,
                        user_ref=request.user if request.user.is_authenticated else None,
                        property_ref=prop
                    )
                except Exception:
                    logging.getLogger(__name__).exception('Failed to create audit log for batch payment room %s', room_number)
            else:
                results.append({'room_number': room_number, 'ok': False, 'error': 'Tenant not found in specified room'})

        # Persist and broadcast: assign deep copy so Django sees a new value and persists all room updates
        for prop_id, (_, layouts) in properties_updated.items():
          with db_transaction.atomic():
            prop = Property.objects.select_for_update().get(pk=prop_id)
            prop.layouts = copy.deepcopy(layouts)
            prop.save()
            # Invalidate ML schedule cache for rooms that received payments
            try:
                from api.models import TenantMessageSchedule
                updated_rooms = [r['room_number'] for r in results if r.get('ok') and r.get('prop_id', prop_id) == prop_id]
                if updated_rooms:
                    TenantMessageSchedule.objects.filter(
                        property=prop,
                        room_number__in=updated_rooms
                    ).update(ml_last_updated=None)
            except Exception:
                pass  # Non-critical
            try:
                from asgiref.sync import async_to_sync
                from channels.layers import get_channel_layer
                channel_layer = get_channel_layer()
                group_name = f'property_{prop.id}'
                async_to_sync(channel_layer.group_send)(
                    group_name,
                    {'type': 'layouts.update', 'layouts': prop.layouts}
                )
                logging.getLogger(__name__).info('Broadcast layout update for property %s after batch payment', prop.id)
            except Exception:
                logging.getLogger(__name__).exception('Error broadcasting layout update for property %s', prop.id)

        all_ok = all(r.get('ok') for r in results)
        return Response(
            {'message': 'Batch payment processed', 'results': results},
            status=status.HTTP_200_OK if all_ok else status.HTTP_207_MULTI_STATUS
        )
