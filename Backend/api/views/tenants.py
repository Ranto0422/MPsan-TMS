import copy
import logging
import traceback
import uuid
from datetime import datetime, timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.db import transaction as db_transaction
from django.utils import timezone
from rest_framework import generics, serializers, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import (
    Tenant, Property, Unit, Owner, Lease, Appliance, Notification, Payment,
    AuditLog, NotificationLog, OtherOccupant, Section,
)
from ..serializers import TenantSerializer, PropertySerializer
from ..permissions import IsAdminRole
from .utils import get_client_ip, format_room_display, _normalize_room_for_compare, _iter_layout_boxes


class TenantPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 200


class TenantListCreateView(generics.ListCreateAPIView):
    queryset = Tenant.objects.all()
    serializer_class = TenantSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = TenantPagination

    def _get_owner_scoped_queryset(self, user):
        """Return a queryset scoped to tenants visible to this user (owner/manager/admin)."""
        from django.db.models import Q
        is_admin = user.is_superuser or getattr(user, 'is_staff', False) or (getattr(getattr(user, 'userprofile', None), 'role', None) == 'admin')
        if is_admin:
            return Tenant.objects.all()
        role = getattr(getattr(user, 'userprofile', None), 'role', None)
        if role == 'manager':
            # Managers see tenants they created + tenants created by owners of properties they manage
            owner_users = User.objects.filter(
                owner__properties__managers=user
            ).distinct()
            return Tenant.objects.filter(Q(created_by=user) | Q(created_by__in=owner_users))
        # Owners (and others) see only tenants they created
        return Tenant.objects.filter(created_by=user)

    def get_queryset(self):
        queryset = self._get_owner_scoped_queryset(self.request.user).order_by('-created_at')

        # Filter by status (active/inactive)
        status = self.request.query_params.get('status', '').strip().lower()
        if status == 'active':
            queryset = queryset.filter(is_active=True)
        elif status == 'inactive':
            queryset = queryset.filter(is_active=False)

        # Filter by property (for inactive tenants scoped to a building)
        property_id = self.request.query_params.get('property_id', '').strip()
        if property_id and property_id.isdigit():
            queryset = queryset.filter(last_property_id=int(property_id))

        # Search by tenant_id, email, phone, or name
        search = self.request.query_params.get('search', '').strip()
        if search:
            from django.db.models import Q
            search_filter = Q(email__icontains=search) | Q(phone__icontains=search) | Q(full_name__icontains=search)

            # Also search by tenant_id if query is numeric
            if search.isdigit():
                search_filter |= Q(tenant_id=int(search))

            queryset = queryset.filter(search_filter)

        return queryset

    def create(self, request, *args, **kwargs):
        # validate room exists for provided property before creating tenant
        prop_id = request.data.get('property_id')
        # accept multiple possible field names from the frontend during migration
        room_number = request.data.get('room_number') or request.data.get('room_no') or request.data.get('unit_no')
        # room_number maps to Unit.unit_no in the new schema
        # Note: do not block tenant creation if Unit row is missing during migration.
        # We'll attempt to assign to a Unit in `perform_create`; if no Unit exists
        # we'll update `Property.layouts` and create a Unit record when possible.

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def perform_create(self, serializer):
        # create tenant and optionally assign to a Unit when property_id and room_number are provided
        # Ensure a non-null `tenant_id` is provided for DBs where the column
        # is non-nullable (migration may have altered the column).
        tenant_kwargs = {}
        try:
            import datetime
            year = datetime.date.today().year
            base = year * 10000
            # find current max for this year
            max_id = Tenant.objects.filter(tenant_id__gte=base, tenant_id__lt=base+10000).order_by('-tenant_id').values_list('tenant_id', flat=True).first()
            if max_id:
                seq = (int(max_id) % 10000) + 1
            else:
                seq = 1
            tenant_id_val = base + seq
            tenant_kwargs['tenant_id'] = tenant_id_val
        except Exception:
            logging.getLogger(__name__).exception('Failed to generate tenant_id; proceeding without explicit id')

        tenant = serializer.save(created_by=self.request.user, **tenant_kwargs)

        try:
            prop_id = self.request.data.get('property_id')
            # Support batch room assignment - get room_numbers array or single room
            room_numbers = self.request.data.get('room_numbers', [])
            if not room_numbers:
                # Fallback to single room field names for backwards compatibility
                single_room = self.request.data.get('room_number') or self.request.data.get('room_no') or self.request.data.get('unit_no')
                if single_room:
                    room_numbers = [single_room]

            # Prepare audit log details with room and property information
            audit_details = f'Created tenant: {tenant.full_name} (ID: {tenant.tenant_id})'
            prop_obj = None
            if prop_id and room_numbers:
                try:
                    prop_obj = Property.objects.get(pk=prop_id)
                    rooms_str = ', '.join(str(r) for r in room_numbers)
                    if len(room_numbers) > 1:
                        audit_details = f'Created tenant: {tenant.full_name} (ID: {tenant.tenant_id}) in Rooms {rooms_str} at {prop_obj.name} (batch rent)'
                    else:
                        audit_details = f'Created tenant: {tenant.full_name} (ID: {tenant.tenant_id}) in Room {rooms_str} at {prop_obj.name}'
                except Property.DoesNotExist:
                    rooms_str = ', '.join(str(r) for r in room_numbers)
                    audit_details = f'Created tenant: {tenant.full_name} (ID: {tenant.tenant_id}) in Room(s) {rooms_str}'

            # Log tenant creation with room and property details
            try:
                AuditLog.objects.create(
                    severity='info',
                    event='Tenant Created',
                    user=self.request.user.username if self.request.user.is_authenticated else 'Anonymous',
                    ip_address=get_client_ip(self.request),
                    details=audit_details,
                    user_ref=self.request.user if self.request.user.is_authenticated else None,
                    property_ref=prop_obj
                )
            except Exception:
                logging.getLogger(__name__).exception('Failed to create audit log for tenant creation')

            if prop_id and room_numbers:
                # First, update the property's saved layouts so the map shows occupancy.
                try:
                    prop = Property.objects.get(pk=prop_id)
                    logging.getLogger(__name__).info('Updating layouts for property %s, rooms %s', prop.id, room_numbers)
                    layouts = prop.layouts or {}
                    updated_count = 0

                    # Iterate over all rooms to assign
                    for room_number in room_numbers:
                        if isinstance(layouts, dict):
                            for var, arr in layouts.items():
                                if not isinstance(arr, list):
                                    continue
                                for b in arr:
                                    # Format this box's room number with section prefix to compare
                                    box_number = str(b.get('number', ''))
                                    box_type = b.get('type', 'room')
                                    box_section = b.get('section')
                                    formatted_box = format_room_display(box_number, box_type, box_section)

                                    # Compare formatted room names (e.g., "M1" == "M1")
                                    if formatted_box == str(room_number):
                                        logging.getLogger(__name__).info('Found matching room %s (raw: %s)', formatted_box, box_number)
                                        b['status'] = 'occupied'
                                        b['occupancy'] = int(self.request.data.get('occupants') or b.get('occupancy') or 1)
                                        b['payment'] = self.request.data.get('payment') or b.get('payment')

                                        # Store preferred payment day in layouts
                                        payment_day = self.request.data.get('payment_day')
                                        if payment_day:
                                            b['preferred_payment_day'] = int(payment_day)

                                        # Store appliances in layouts (from the new array format)
                                        appliances_data = self.request.data.get('appliances', [])
                                        if isinstance(appliances_data, list):
                                            b['appliances'] = appliances_data

                                        # Get other_occupants from request data
                                        other_occupants_data = self.request.data.get('other_occupants', [])
                                        if not isinstance(other_occupants_data, list):
                                            other_occupants_data = []

                                        # Get advance and deposit payment info
                                        advance_paid = self.request.data.get('advance_paid', False)
                                        advance_amount = self.request.data.get('advance_amount', 0)
                                        deposit_paid = self.request.data.get('deposit_paid', False)
                                        deposit_amount = self.request.data.get('deposit_amount', 0)
                                        include_surcharge_in_deposits = self.request.data.get('include_appliance_surcharge_in_deposits', True)  # Default True for backward compatibility

                                        b['tenant'] = {
                                            'tenant_id': getattr(tenant, 'tenant_id', getattr(tenant, 'id', None)),
                                            'id': getattr(tenant, 'tenant_id', getattr(tenant, 'id', None)),
                                            'full_name': getattr(tenant, 'full_name', getattr(tenant, 'name', None)),
                                            'business_name': getattr(tenant, 'business_name', ''),
                                            'email': getattr(tenant, 'email', None),
                                            'phone': getattr(tenant, 'phone', None),
                                            'created_at': tenant.created_at.isoformat() if hasattr(tenant, 'created_at') and tenant.created_at else None,
                                            'move_in': tenant.move_in.isoformat() if hasattr(tenant, 'move_in') and tenant.move_in else None,
                                            'other_occupants': other_occupants_data,
                                            # Initial payment tracking
                                            'advance_paid': advance_paid,
                                            'advance_amount': float(advance_amount) if advance_amount else 0,
                                            'deposit_paid': deposit_paid,
                                            'deposit_amount': float(deposit_amount) if deposit_amount else 0,
                                            'include_appliance_surcharge_in_deposits': include_surcharge_in_deposits,
                                        }

                                        # Initialize transactions array if not exists
                                        if 'transactions' not in b:
                                            b['transactions'] = []

                                        # Add advance and deposit to transaction history
                                        import datetime
                                        move_in_date = self.request.data.get('date_of_occupancy') or datetime.date.today().isoformat()
                                        advance_payment_date = self.request.data.get('advance_payment_date') or move_in_date
                                        deposit_payment_date = self.request.data.get('deposit_payment_date') or move_in_date
                                        tenant_name = getattr(tenant, 'full_name', getattr(tenant, 'name', 'Tenant'))
                                        tenant_id_val = getattr(tenant, 'tenant_id', getattr(tenant, 'id', None))

                                        if advance_paid and advance_amount:
                                            advance_transaction = {
                                                'date': advance_payment_date,
                                                'amount': f'{float(advance_amount):,.2f}',
                                                'name': tenant_name,
                                                'notes': 'Initial advance payment (1 month)',
                                                'tenant_id': tenant_id_val,
                                                'tenant_name': tenant_name,
                                                'room_no': formatted_box,
                                                'timestamp': f'{advance_payment_date}T00:00:00' if advance_payment_date != move_in_date else datetime.datetime.now().isoformat(),
                                                'is_late': False,
                                                'status': 'paid',
                                                'payment_type': 'advance',
                                                'method': 'cash'
                                            }
                                            b['transactions'].insert(0, advance_transaction)

                                        if deposit_paid and deposit_amount:
                                            deposit_transaction = {
                                                'date': deposit_payment_date,
                                                'amount': f'{float(deposit_amount):,.2f}',
                                                'name': tenant_name,
                                                'notes': 'Initial deposit payment (1 month)',
                                                'tenant_id': tenant_id_val,
                                                'tenant_name': tenant_name,
                                                'room_no': formatted_box,
                                                'timestamp': f'{deposit_payment_date}T00:00:00' if deposit_payment_date != move_in_date else datetime.datetime.now().isoformat(),
                                                'is_late': False,
                                                'status': 'paid',
                                                'payment_type': 'deposit',
                                                'method': 'cash'
                                            }
                                            b['transactions'].insert(0, deposit_transaction)

                                        updated_count += 1
                                        break

                    if updated_count > 0:
                        prop.layouts = layouts
                        prop.save()
                        logging.getLogger(__name__).info('Successfully updated layouts for property %s (%d rooms)', prop.id, updated_count)

                        # Create Appliance records in the database (only once per tenant, not per room)
                        appliances_data = self.request.data.get('appliances', [])
                        if isinstance(appliances_data, list):
                            for appl in appliances_data:
                                if isinstance(appl, dict) and appl.get('name'):
                                    try:
                                        Appliance.objects.create(
                                            tenant=tenant,
                                            name=appl.get('name', ''),
                                            surcharge_amount=Decimal(str(appl.get('surcharge_amount', 0))),
                                            notes=appl.get('notes', '')
                                        )
                                        logging.getLogger(__name__).info('Created appliance %s for tenant %s', appl.get('name'), tenant.tenant_id)
                                    except Exception as e:
                                        logging.getLogger(__name__).warning('Failed to create appliance: %s', str(e))

                        try:
                            from asgiref.sync import async_to_sync
                            from channels.layers import get_channel_layer
                            channel_layer = get_channel_layer()
                            group_name = f'property_{prop.id}'
                            async_to_sync(channel_layer.group_send)(
                                group_name,
                                {'type': 'layouts.update', 'layouts': prop.layouts}
                            )
                        except Exception:
                            pass

                        # Auto-generate automated messages for the new tenant
                        try:
                            from .messaging import _generate_messages_for_new_tenant
                            _generate_messages_for_new_tenant(prop, tenant, room_numbers)
                        except Exception as e:
                            logging.getLogger(__name__).warning('Failed to auto-generate messages for new tenant: %s', e)

                except Property.DoesNotExist:
                    logging.getLogger(__name__).warning('Property %s does not exist; cannot update layouts', prop_id)

                # Then try to assign or create Units for future queries (secondary, layouts are source of truth).
                # This is best-effort and should not block tenant creation.
                for room_number in room_numbers:
                    try:
                        from django.db import IntegrityError
                        # Create/update Unit WITHOUT occupant first (avoids FK timing issues)
                        unit_defaults = {
                            'occupied': True,
                        }
                        payment = self.request.data.get('payment')
                        if payment:
                            try:
                                unit_defaults['monthly_rent'] = Decimal(str(payment))
                            except Exception:
                                pass

                        try:
                            unit, created = Unit.objects.update_or_create(
                                property_id=prop_id,
                                unit_no=room_number,
                                defaults=unit_defaults
                            )
                            if created:
                                logging.getLogger(__name__).info('Created Unit for property=%s unit_no=%s', prop_id, room_number)
                            else:
                                logging.getLogger(__name__).info('Updated Unit for property=%s unit_no=%s', prop_id, room_number)

                            # Now try to set occupant using direct SQL to bypass Django's FK check timing
                            from django.db import connection
                            with connection.cursor() as cursor:
                                cursor.execute(
                                    'UPDATE api_unit SET occupant_id = %s WHERE property_id = %s AND unit_no = %s',
                                    [tenant.tenant_id, prop_id, room_number]
                                )
                            logging.getLogger(__name__).info('Set occupant for Unit property=%s unit_no=%s', prop_id, room_number)
                        except IntegrityError as e:
                            logging.getLogger(__name__).debug('Unit operation for property=%s unit_no=%s: %s', prop_id, room_number, str(e))
                    except Exception:
                        logging.getLogger(__name__).debug('Unit creation skipped for property=%s unit_no=%s', prop_id, room_number)
        except Exception:
            # don't block tenant creation on assignment errors
            pass


class TenantDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Tenant.objects.all()
    serializer_class = TenantSerializer
    permission_classes = [IsAuthenticated]

    def update(self, request, *args, **kwargs):
        """Override update to add optimistic concurrency check."""
        instance = self.get_object()

        # If client sent updated_at, verify it matches DB to detect concurrent edits
        client_updated_at = request.data.get('updated_at')
        if client_updated_at and instance.updated_at:
            from django.utils.dateparse import parse_datetime
            from datetime import timedelta

            parsed = parse_datetime(str(client_updated_at))
            if parsed is not None:
                if parsed.tzinfo is None:
                    parsed = timezone.make_aware(parsed)

                if abs(instance.updated_at - parsed) > timedelta(seconds=1):
                    serializer = self.get_serializer(instance)
                    return Response(
                        {
                            'error': 'conflict',
                            'message': 'This tenant was modified by another user. Please close and reopen to see the latest data.',
                            'current_data': serializer.data,
                        },
                        status=status.HTTP_409_CONFLICT,
                    )

        return super().update(request, *args, **kwargs)

    def perform_update(self, serializer):
        """Update tenant and refresh property layouts with new tenant data."""
        old_data = {}
        instance = self.get_object()
        # Capture old values for audit log
        old_data['full_name'] = instance.full_name
        old_data['email'] = instance.email
        old_data['phone'] = instance.phone

        # Capture old appliances for comparison
        old_appliances = list(Appliance.objects.filter(tenant=instance).values_list('name', flat=True))

        tenant = serializer.save()

        # Check for appliance changes
        new_appliances_data = self.request.data.get('appliances', None)
        new_appliance_names = []
        if new_appliances_data and isinstance(new_appliances_data, list):
            new_appliance_names = [a.get('name', '') for a in new_appliances_data if isinstance(a, dict)]

        # Log tenant update with changes
        try:
            changes = []
            if old_data['full_name'] != tenant.full_name:
                changes.append(f"Name: {old_data['full_name']} → {tenant.full_name}")
            if old_data['email'] != tenant.email:
                changes.append(f"Email: {old_data['email']} → {tenant.email}")
            if old_data['phone'] != tenant.phone:
                changes.append(f"Phone: {old_data['phone']} → {tenant.phone}")

            # Check for appliance changes
            if new_appliances_data is not None:
                added_appliances = [a for a in new_appliance_names if a and a not in old_appliances]
                removed_appliances = [a for a in old_appliances if a and a not in new_appliance_names]

                if added_appliances:
                    changes.append(f"Added appliances: {', '.join(added_appliances)}")
                if removed_appliances:
                    changes.append(f"Removed appliances: {', '.join(removed_appliances)}")

            details = f"Updated tenant: {tenant.full_name} (ID: {tenant.tenant_id})"
            if changes:
                details += f". Changes: {'; '.join(changes)}"

            # Find which property this tenant belongs to
            tenant_property = None
            try:
                for prop in Property.objects.all():
                    layouts = prop.layouts or {}
                    if isinstance(layouts, dict):
                        for var, arr in layouts.items():
                            if isinstance(arr, list):
                                for b in arr:
                                    tenant_data = b.get('tenant')
                                    if tenant_data and (tenant_data.get('tenant_id') == tenant.tenant_id or tenant_data.get('id') == tenant.tenant_id):
                                        tenant_property = prop
                                        break
                            if tenant_property:
                                break
                    if tenant_property:
                        break
            except Exception:
                pass

            AuditLog.objects.create(
                severity='info',
                event='Tenant Updated',
                user=self.request.user.username if self.request.user.is_authenticated else 'Anonymous',
                ip_address=get_client_ip(self.request),
                details=details,
                user_ref=self.request.user if self.request.user.is_authenticated else None,
                property_ref=tenant_property
            )
        except Exception:
            logging.getLogger(__name__).exception('Failed to create audit log for tenant update')

        logging.getLogger(__name__).info('Updating layouts for edited tenant %s', tenant.tenant_id)

        # Search all properties for this tenant in their layouts
        properties = list(Property.objects.values_list('pk', flat=True))
        for prop_pk in properties:
            try:
              with db_transaction.atomic():
                prop = Property.objects.select_for_update().get(pk=prop_pk)
                layouts = prop.layouts or {}
                updated = False

                if isinstance(layouts, dict):
                    for var, arr in layouts.items():
                        if not isinstance(arr, list):
                            continue
                        for b in arr:
                            # Check if this box has this tenant
                            tenant_data = b.get('tenant')
                            if tenant_data and (tenant_data.get('tenant_id') == tenant.tenant_id or tenant_data.get('id') == tenant.tenant_id):
                                # Update tenant info in layouts
                                logging.getLogger(__name__).info('Updating tenant in room %s of property %s', b.get('number'), prop.id)

                                # Get other_occupants from request data
                                other_occupants_data = self.request.data.get('other_occupants', [])
                                if not isinstance(other_occupants_data, list):
                                    other_occupants_data = []

                                # Preserve initial payment status (advance/deposit) from existing box or request
                                old_tenant = b.get('tenant') or {}
                                advance_paid = self.request.data.get('advance_paid')
                                if advance_paid is None:
                                    advance_paid = old_tenant.get('advance_paid', False)
                                advance_amount = self.request.data.get('advance_amount')
                                if advance_amount is None:
                                    advance_amount = old_tenant.get('advance_amount')
                                deposit_paid = self.request.data.get('deposit_paid')
                                if deposit_paid is None:
                                    deposit_paid = old_tenant.get('deposit_paid', False)
                                deposit_amount = self.request.data.get('deposit_amount')
                                if deposit_amount is None:
                                    deposit_amount = old_tenant.get('deposit_amount')

                                b['tenant'] = {
                                    'tenant_id': tenant.tenant_id,
                                    'id': tenant.tenant_id,
                                    'full_name': tenant.full_name,
                                    'email': tenant.email,
                                    'phone': tenant.phone,
                                    'created_at': tenant.created_at.isoformat() if tenant.created_at else None,
                                    'move_in': tenant.move_in.isoformat() if tenant.move_in else None,
                                    'date_of_occupancy': tenant.move_in.isoformat() if tenant.move_in else None,
                                    'other_occupants': other_occupants_data,
                                    'advance_paid': advance_paid,
                                    'advance_amount': float(advance_amount) if advance_amount is not None else None,
                                    'deposit_paid': deposit_paid,
                                    'deposit_amount': float(deposit_amount) if deposit_amount is not None else None,
                                }

                                # Track if appliances or payment changed (for efficient updates)
                                appliances_changed = False
                                payment_changed = False

                                # Update preferred payment day in layouts if provided and changed
                                payment_day = self.request.data.get('payment_day')
                                if payment_day is not None:
                                    try:
                                        new_payment_day = int(payment_day) if payment_day else None
                                        if b.get('preferred_payment_day') != new_payment_day:
                                            b['preferred_payment_day'] = new_payment_day
                                            logging.getLogger(__name__).info('Updated preferred_payment_day for tenant %s to %s', tenant.tenant_id, payment_day)
                                    except (ValueError, TypeError):
                                        logging.getLogger(__name__).warning('Invalid payment_day value: %s', payment_day)

                                # Check if appliances changed before updating
                                appliances_data = self.request.data.get('appliances', None)
                                if appliances_data is not None and isinstance(appliances_data, list):
                                    old_appliances = b.get('appliances', [])
                                    # Compare appliances by sorting and comparing JSON representations
                                    def normalize_appliances(apps):
                                        return sorted([{'name': a.get('name', ''), 'surcharge_amount': float(a.get('surcharge_amount') or a.get('surcharge') or 0)} for a in apps if isinstance(a, dict)], key=lambda x: x['name'])

                                    if normalize_appliances(old_appliances) != normalize_appliances(appliances_data):
                                        appliances_changed = True
                                        b['appliances'] = appliances_data
                                        # Update Appliance model records - delete old and create new
                                        try:
                                            Appliance.objects.filter(tenant=tenant).delete()
                                            for appl in appliances_data:
                                                if isinstance(appl, dict) and appl.get('name'):
                                                    Appliance.objects.create(
                                                        tenant=tenant,
                                                        name=appl.get('name', ''),
                                                        surcharge_amount=Decimal(str(appl.get('surcharge_amount', 0))),
                                                        notes=appl.get('notes', '')
                                                    )
                                        except Exception as e:
                                            logging.getLogger(__name__).warning('Failed to update appliance records: %s', str(e))
                                        logging.getLogger(__name__).info('Updated appliances for tenant %s', tenant.tenant_id)

                                # Check if base payment changed
                                base_payment_input = self.request.data.get('payment')
                                if base_payment_input is not None:
                                    try:
                                        new_base_payment = Decimal(str(base_payment_input))
                                        # Extract current base payment from box
                                        current_total = b.get('payment', 0)
                                        current_surcharge = Decimal('0')
                                        current_appliances = b.get('appliances', [])
                                        if isinstance(current_appliances, list):
                                            for appl in current_appliances:
                                                if isinstance(appl, dict):
                                                    surcharge = appl.get('surcharge_amount') or appl.get('surcharge') or 0
                                                    try:
                                                        current_surcharge += Decimal(str(surcharge))
                                                    except:
                                                        pass
                                        current_base_payment = Decimal(str(current_total)) - current_surcharge

                                        if abs(new_base_payment - current_base_payment) > Decimal('0.01'):  # Tolerance for floating point
                                            payment_changed = True
                                    except:
                                        pass

                                # Only recalculate payment if appliances or payment changed
                                if appliances_changed or payment_changed:
                                    # Get base payment from request data (sent from frontend) or keep existing
                                    base_payment = self.request.data.get('payment')
                                    if base_payment is None:
                                        # If not provided in request, try to extract from current box payment minus surcharges
                                        current_total = b.get('payment', 0)
                                        current_surcharge = Decimal('0')
                                        current_appliances = b.get('appliances', [])
                                        if isinstance(current_appliances, list):
                                            for appl in current_appliances:
                                                if isinstance(appl, dict):
                                                    surcharge = appl.get('surcharge_amount') or appl.get('surcharge') or 0
                                                    try:
                                                        current_surcharge += Decimal(str(surcharge))
                                                    except:
                                                        pass
                                        try:
                                            base_payment = Decimal(str(current_total)) - current_surcharge
                                        except:
                                            base_payment = Decimal('0')
                                    else:
                                        try:
                                            base_payment = Decimal(str(base_payment))
                                        except:
                                            base_payment = Decimal('0')

                                    # Calculate appliance surcharge total from current appliances in box
                                    current_appliances = b.get('appliances', [])
                                    appliance_surcharge_total = Decimal('0')
                                    if isinstance(current_appliances, list):
                                        for appl in current_appliances:
                                            if isinstance(appl, dict):
                                                surcharge = appl.get('surcharge_amount') or appl.get('surcharge') or 0
                                                try:
                                                    appliance_surcharge_total += Decimal(str(surcharge))
                                                except:
                                                    pass

                                    # Total payment = base payment + appliance surcharges
                                    total_payment = float(base_payment + appliance_surcharge_total)
                                    b['payment'] = total_payment

                                    # IMPORTANT: Also update the Tenant model's payment field to keep it in sync
                                    # Store only the base payment in the Tenant model (surcharges are stored separately in Appliances)
                                    tenant.payment = float(base_payment)
                                    tenant.save()

                                    logging.getLogger(__name__).info('Updated payment for tenant %s: base=%s, surcharge=%s, total=%s',
                                                                     tenant.tenant_id, base_payment, appliance_surcharge_total, total_payment)

                                updated = True

                if updated:
                    prop.layouts = layouts
                    prop.save()
                    logging.getLogger(__name__).info('Saved updated layouts for property %s', prop.id)

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
                        logging.getLogger(__name__).info('Broadcast layout update for property %s', prop.id)
                    except Exception as e:
                        logging.getLogger(__name__).exception('Error broadcasting layout update')
            except Exception:
                logging.getLogger(__name__).exception('Error updating layouts for property %s', prop.id)

    def perform_destroy(self, instance):
        """Soft delete: mark tenant as inactive and remove from property layouts."""
        from datetime import date, datetime
        import json

        # Parse request body for refund amounts and optional single-room removal (batch rent)
        deposit_refund = 0
        advance_refund = 0
        remove_property_id = None
        remove_room_number = None
        try:
            if self.request.body:
                body_data = json.loads(self.request.body)
                deposit_refund = float(body_data.get('deposit_refund', 0) or 0)
                advance_refund = float(body_data.get('advance_refund', 0) or 0)
                remove_property_id = body_data.get('property_id')
                remove_room_number = body_data.get('room_number')
                if remove_property_id is not None:
                    remove_property_id = int(remove_property_id)
        except (json.JSONDecodeError, ValueError, TypeError):
            pass

        single_room_removal = remove_property_id is not None and remove_room_number is not None

        # First, find tenant's current room(s) and count how many they occupy (for single-room vs full removal)
        room_info = []
        properties = Property.objects.all()
        boxes_with_tenant = []  # list of (prop, b) for boxes that have this tenant

        for prop in properties:
            try:
                layouts = prop.layouts or {}
                if isinstance(layouts, dict):
                    for var, arr in layouts.items():
                        if not isinstance(arr, list):
                            continue
                        for b in arr:
                            tenant_data = b.get('tenant')
                            if tenant_data and (tenant_data.get('tenant_id') == instance.tenant_id or tenant_data.get('id') == instance.tenant_id):
                                boxes_with_tenant.append((prop, b))
                                room_info.append({
                                    'property': prop.name if prop.name else f'Property {prop.id}',
                                    'room': b.get('number')
                                })
                                if not instance.last_room:
                                    instance.last_room = str(b.get('number', ''))
                                    instance.last_property_id = prop.id
                                    instance.last_payment = b.get('payment') if b.get('payment') else None
            except Exception as e:
                logging.getLogger(__name__).exception('Error finding tenant room info: %s', e)

        # Single-room removal: only clear the one room; mark inactive only if that was the last room
        if single_room_removal:
            try:
                prop = Property.objects.get(pk=remove_property_id)
            except Property.DoesNotExist:
                logging.getLogger(__name__).warning('Single-room removal: property_id=%s not found; falling back to full removal', remove_property_id)
                single_room_removal = False

        if single_room_removal:
            layouts = prop.layouts or {}
            updated = False
            if isinstance(layouts, dict):
                for var, arr in layouts.items():
                    if not isinstance(arr, list):
                        continue
                    for b in arr:
                        tenant_data = b.get('tenant')
                        if not tenant_data or (tenant_data.get('tenant_id') != instance.tenant_id and tenant_data.get('id') != instance.tenant_id):
                            continue
                        box_number = str(b.get('number', ''))
                        box_type = b.get('type', 'room')
                        box_section = b.get('section', '')
                        formatted_box = format_room_display(box_number, box_type, box_section)
                        if formatted_box != str(remove_room_number):
                            continue
                        # This is the box to clear
                        room_section = b.get('section', '')
                        room_number = b.get('number', '')
                        formatted_room = format_room_display(str(room_number), b.get('type', 'room'), room_section)
                        if 'transactions' not in b:
                            b['transactions'] = []
                        today_str = date.today().strftime('%Y-%m-%d')
                        if deposit_refund > 0:
                            deposit_refund_transaction = {
                                'date': today_str, 'amount': f'-{float(deposit_refund):,.2f}', 'name': instance.full_name,
                                'notes': 'Deposit refund (room released)', 'tenant_id': instance.tenant_id,
                                'tenant_name': instance.full_name, 'room_no': formatted_room,
                                'timestamp': datetime.now().isoformat(), 'is_late': False, 'status': 'refund',
                                'payment_type': 'deposit_refund', 'method': 'cash'
                            }
                            b['transactions'].insert(0, deposit_refund_transaction)
                        if advance_refund > 0:
                            advance_refund_transaction = {
                                'date': today_str, 'amount': f'-{float(advance_refund):,.2f}', 'name': instance.full_name,
                                'notes': 'Advance refund (room released)', 'tenant_id': instance.tenant_id,
                                'tenant_name': instance.full_name, 'room_no': formatted_room,
                                'timestamp': datetime.now().isoformat(), 'is_late': False, 'status': 'refund',
                                'payment_type': 'advance_refund', 'method': 'cash'
                            }
                            b['transactions'].insert(0, advance_refund_transaction)
                        b['status'] = 'available'
                        b['tenant'] = None
                        b['occupancy'] = 0
                        updated = True
                        logging.getLogger(__name__).info('Removed tenant %s from single room %s at property %s', instance.tenant_id, formatted_room, prop.id)
                        break
                    if updated:
                        break
            if updated:
                prop.layouts = layouts
                prop.save()
                try:
                    from asgiref.sync import async_to_sync
                    from channels.layers import get_channel_layer
                    channel_layer = get_channel_layer()
                    async_to_sync(channel_layer.group_send)(
                        f'property_{prop.id}',
                        {'type': 'layouts.update', 'layouts': prop.layouts}
                    )
                except Exception:
                    pass
                # If tenant has no other rooms left, mark inactive (we had N boxes, cleared one, so N-1 remain)
                remaining = len(boxes_with_tenant) - 1
                if remaining <= 0:
                    instance.last_room = str(remove_room_number)
                    instance.last_property_id = prop.id
                    instance.is_active = False
                    if not instance.move_out:
                        instance.move_out = date.today()
                    instance.save()
                    try:
                        occupied_units = Unit.objects.filter(occupant_id=instance.tenant_id)
                        for unit in occupied_units:
                            unit.occupant = None
                            unit.occupied = False
                            unit.save(update_fields=['occupant', 'occupied'])
                    except Exception:
                        logging.getLogger(__name__).exception('Error clearing Unit records for tenant %s', instance.tenant_id)
                    details = f"Removed tenant: {instance.full_name} (ID: {instance.tenant_id}) from Room {remove_room_number} at {prop.name}. Last room - tenant marked inactive."
                else:
                    # Record this room as released so tenant profile can show it (no longer renting but did)
                    if hasattr(instance, 'released_rooms'):
                        released_list = list(instance.released_rooms) if instance.released_rooms else []
                        if remove_room_number not in released_list:
                            released_list.append(str(remove_room_number))
                        instance.released_rooms = released_list
                        instance.save(update_fields=['released_rooms'])
                    details = f"Removed tenant: {instance.full_name} (ID: {instance.tenant_id}) from Room {remove_room_number} at {prop.name}. Tenant still has {remaining} other room(s)."
                try:
                    AuditLog.objects.create(
                        severity='warning', event='Tenant Removed (from room)',
                        user=self.request.user.username if self.request.user.is_authenticated else 'Anonymous',
                        ip_address=get_client_ip(self.request), details=details,
                        user_ref=self.request.user if self.request.user.is_authenticated else None,
                        property_ref=prop
                    )
                except Exception:
                    pass
            else:
                # Single-room removal requested but room not found (wrong property or room identifier)
                from rest_framework.exceptions import ValidationError
                raise ValidationError(
                    {'detail': f'Tenant not found in room {remove_room_number} at this property, or room identifier does not match.'}
                )
            return  # Done with single-room removal

        # Full removal: mark tenant inactive and remove from all properties
        instance.is_active = False
        if not instance.move_out:  # Only set if not already set
            instance.move_out = date.today()
        instance.save()

        logging.getLogger(__name__).info('Removing tenant %s from layouts (preserving last_room=%s, last_payment=%s)',
                                        instance.tenant_id, instance.last_room, instance.last_payment)

        try:
            tenant_property = None
            if room_info:
                room_details = ', '.join([f"Room {r['room']} at {r['property']}" for r in room_info])
                details = f"Removed tenant: {instance.full_name} (ID: {instance.tenant_id}) from {room_details}. Soft delete - record preserved."
                for prop in properties:
                    layouts = prop.layouts or {}
                    if isinstance(layouts, dict):
                        for var, arr in layouts.items():
                            if isinstance(arr, list):
                                for b in arr:
                                    tenant_data = b.get('tenant')
                                    if tenant_data and (tenant_data.get('tenant_id') == instance.tenant_id or tenant_data.get('id') == instance.tenant_id):
                                        tenant_property = prop
                                        break
                            if tenant_property:
                                break
                    if tenant_property:
                        break
            else:
                details = f"Removed tenant: {instance.full_name} (ID: {instance.tenant_id}). Soft delete - record preserved."

            audit_log = AuditLog.objects.create(
                severity='warning',
                event='Tenant Removed',
                user=self.request.user.username if self.request.user.is_authenticated else 'Anonymous',
                ip_address=get_client_ip(self.request),
                details=details,
                user_ref=self.request.user if self.request.user.is_authenticated else None,
                property_ref=tenant_property
            )
            logging.getLogger(__name__).info('Created audit log entry for tenant removal (log_id=%s, property=%s)', audit_log.log_id, tenant_property.id if tenant_property else 'None')
        except Exception:
            logging.getLogger(__name__).exception('Failed to create audit log for tenant removal')

        # Now remove tenant from all properties
        for prop in properties:
            try:
                layouts = prop.layouts or {}
                updated = False

                if isinstance(layouts, dict):
                    for var, arr in layouts.items():
                        if not isinstance(arr, list):
                            continue
                        for b in arr:
                            # Check if this box has this tenant
                            tenant_data = b.get('tenant')
                            if tenant_data and (tenant_data.get('tenant_id') == instance.tenant_id or tenant_data.get('id') == instance.tenant_id):
                                # Format room number for transaction records
                                room_section = b.get('section', '')
                                room_number = b.get('number', '')
                                if room_section:
                                    formatted_room = f"{room_section[0].upper()}{room_number}"
                                else:
                                    formatted_room = str(room_number)

                                # Record refund transactions before removing tenant
                                if 'transactions' not in b:
                                    b['transactions'] = []

                                today_str = date.today().strftime('%Y-%m-%d')

                                if deposit_refund > 0:
                                    deposit_refund_transaction = {
                                        'date': today_str,
                                        'amount': f'-{float(deposit_refund):,.2f}',
                                        'name': instance.full_name,
                                        'notes': 'Deposit refund upon move-out',
                                        'tenant_id': instance.tenant_id,
                                        'tenant_name': instance.full_name,
                                        'room_no': formatted_room,
                                        'timestamp': datetime.now().isoformat(),
                                        'is_late': False,
                                        'status': 'refund',
                                        'payment_type': 'deposit_refund',
                                        'method': 'cash'
                                    }
                                    b['transactions'].insert(0, deposit_refund_transaction)
                                    logging.getLogger(__name__).info('Recorded deposit refund of %s for tenant %s', deposit_refund, instance.tenant_id)

                                if advance_refund > 0:
                                    advance_refund_transaction = {
                                        'date': today_str,
                                        'amount': f'-{float(advance_refund):,.2f}',
                                        'name': instance.full_name,
                                        'notes': 'Advance refund upon move-out',
                                        'tenant_id': instance.tenant_id,
                                        'tenant_name': instance.full_name,
                                        'room_no': formatted_room,
                                        'timestamp': datetime.now().isoformat(),
                                        'is_late': False,
                                        'status': 'refund',
                                        'payment_type': 'advance_refund',
                                        'method': 'cash'
                                    }
                                    b['transactions'].insert(0, advance_refund_transaction)
                                    logging.getLogger(__name__).info('Recorded advance refund of %s for tenant %s', advance_refund, instance.tenant_id)

                                # Clear tenant and mark room as available
                                logging.getLogger(__name__).info('Removing tenant from room %s of property %s', b.get('number'), prop.id)
                                b['status'] = 'available'
                                b['tenant'] = None
                                b['occupancy'] = 0
                                updated = True

                if updated:
                    prop.layouts = layouts
                    prop.save()
                    logging.getLogger(__name__).info('Saved updated layouts for property %s after tenant removal', prop.id)

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
                        logging.getLogger(__name__).info('Broadcast layout update for property %s after tenant removal', prop.id)
                    except Exception as e:
                        logging.getLogger(__name__).exception('Error broadcasting layout update')
            except Exception:
                logging.getLogger(__name__).exception('Error updating layouts for property %s during tenant removal', prop.id)

        # Also clear any Unit records (for consistency, though layouts are the source of truth)
        try:
            occupied_units = Unit.objects.filter(occupant_id=instance.tenant_id)
            for unit in occupied_units:
                unit.occupant = None
                unit.occupied = False
                unit.save(update_fields=['occupant', 'occupied'])
                logging.getLogger(__name__).info('Cleared Unit record for property=%s unit_no=%s', unit.property_id, unit.unit_no)
        except Exception:
            logging.getLogger(__name__).exception('Error clearing Unit records for tenant %s', instance.tenant_id)


class TenantTransferView(generics.GenericAPIView):
    """Transfer a tenant from one room to another."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            tenant = Tenant.objects.get(pk=pk)
        except Tenant.DoesNotExist:
            return Response({'error': 'Tenant not found'}, status=status.HTTP_404_NOT_FOUND)

        property_id = request.data.get('property_id')
        from_room = request.data.get('from_room')
        to_room = request.data.get('to_room')

        logging.getLogger(__name__).info('Transfer request: tenant=%s, property=%s, from=%s, to=%s', pk, property_id, from_room, to_room)

        if not all([property_id, from_room, to_room]):
            return Response(
                {'error': 'property_id, from_room, and to_room are required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            prop = Property.objects.get(pk=property_id)
        except Property.DoesNotExist:
            return Response({'error': 'Property not found'}, status=status.HTTP_404_NOT_FOUND)

        layouts = prop.layouts or {}

        # Helper to format box room name for comparison
        def get_formatted_room(b):
            box_number = str(b.get('number', ''))
            box_type = b.get('type', 'room')
            box_section = b.get('section')
            return format_room_display(box_number, box_type, box_section)

        # Check if destination room is unoccupied (compare using formatted names)
        to_room_occupied = False
        to_room_found = False
        to_room_box = None

        if isinstance(layouts, dict):
            for var, arr in layouts.items():
                if not isinstance(arr, list):
                    continue
                for b in arr:
                    formatted = get_formatted_room(b)
                    if formatted == str(to_room):
                        to_room_found = True
                        to_room_box = b
                        if b.get('status') != 'available':
                            to_room_occupied = True
                        break
                if to_room_found:
                    break

        if not to_room_found:
            logging.getLogger(__name__).warning('Room %s not found in property %s layouts', to_room, property_id)
            return Response({'error': f'Room {to_room} not found'}, status=status.HTTP_404_NOT_FOUND)

        if to_room_occupied:
            return Response(
                {'error': f'Room {to_room} is not available'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Transfer tenant: remove from old room, add to new room
        # Do this in two passes to ensure we collect data before trying to add to new room
        updated = False
        from_room_data = None
        from_room_box = None

        # First pass: Remove tenant from old room and collect data (compare using formatted names)
        if isinstance(layouts, dict):
            for var, arr in layouts.items():
                if not isinstance(arr, list):
                    continue
                for b in arr:
                    formatted = get_formatted_room(b)
                    if formatted == str(from_room):
                        tenant_data = b.get('tenant')
                        if tenant_data and (tenant_data.get('tenant_id') == tenant.tenant_id or tenant_data.get('id') == tenant.tenant_id):
                            from_room_box = b
                            from_room_data = {
                                'payment': b.get('payment'),
                                'occupancy': b.get('occupancy', 1),
                                'type': b.get('type', 'room'),
                                'section': b.get('section'),
                                'appliances': b.get('appliances', []),  # Transfer appliances
                                'preferred_payment_day': b.get('preferred_payment_day'),  # Transfer preferred payment day
                                'other_occupants': tenant_data.get('other_occupants', []),  # Transfer other occupants
                                'advance_paid': tenant_data.get('advance_paid', False),
                                'advance_amount': tenant_data.get('advance_amount'),
                                'deposit_paid': tenant_data.get('deposit_paid', False),
                                'deposit_amount': tenant_data.get('deposit_amount'),
                            }
                            b['status'] = 'available'
                            b['tenant'] = None
                            b['occupancy'] = 0
                            b['appliances'] = []  # Clear appliances from old room
                            b['preferred_payment_day'] = None  # Clear preferred payment day from old room
                            updated = True
                            logging.getLogger(__name__).info('Removed tenant from room %s', from_room)
                            break
                if from_room_data:
                    break

        # Second pass: Add tenant to new room (compare using formatted names)
        tenant_added = False
        to_room_data = None
        if from_room_data and isinstance(layouts, dict):
            for var, arr in layouts.items():
                if not isinstance(arr, list):
                    continue
                for b in arr:
                    formatted = get_formatted_room(b)
                    if formatted == str(to_room):
                        # Collect room data before updating
                        to_room_data = {
                            'type': b.get('type', 'room'),
                            'section': b.get('section')
                        }
                        b['status'] = 'occupied'
                        b['occupancy'] = from_room_data['occupancy']
                        b['payment'] = from_room_data['payment']
                        b['appliances'] = from_room_data.get('appliances', [])  # Transfer appliances to new room
                        b['preferred_payment_day'] = from_room_data.get('preferred_payment_day')  # Transfer preferred payment day to new room
                        b['tenant'] = {
                            'tenant_id': tenant.tenant_id,
                            'id': tenant.tenant_id,
                            'full_name': tenant.full_name,
                            'email': tenant.email,
                            'phone': tenant.phone,
                            'created_at': tenant.created_at.isoformat() if tenant.created_at else None,
                            'move_in': tenant.move_in.isoformat() if tenant.move_in else None,
                            'other_occupants': from_room_data.get('other_occupants', []),  # Transfer other occupants
                            'advance_paid': from_room_data.get('advance_paid', False),
                            'advance_amount': from_room_data.get('advance_amount'),
                            'deposit_paid': from_room_data.get('deposit_paid', False),
                            'deposit_amount': from_room_data.get('deposit_amount'),
                        }
                        logging.getLogger(__name__).info('Added tenant to room %s', to_room)
                        tenant_added = True
                        break
                if tenant_added:
                    break

        if updated and from_room_data and tenant_added:
            prop.layouts = layouts
            prop.save()

            # Log tenant transfer
            try:
                from_display = format_room_display(from_room, from_room_data.get('type', 'room'), from_room_data.get('section'))
                to_display = format_room_display(to_room, to_room_data.get('type', 'room'), to_room_data.get('section'))
                AuditLog.objects.create(
                    severity='info',
                    event='Tenant Transferred',
                    user=request.user.username if request.user.is_authenticated else 'Anonymous',
                    ip_address=get_client_ip(request),
                    details=f'Transferred tenant: {tenant.full_name} (ID: {tenant.tenant_id}) from Room {from_display} to Room {to_display} at {prop.name}',
                    user_ref=request.user if request.user.is_authenticated else None,
                    property_ref=prop
                )
            except Exception:
                logging.getLogger(__name__).exception('Failed to create audit log for tenant transfer')

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
                logging.getLogger(__name__).info('Broadcast layout update for property %s after tenant transfer', prop.id)
            except Exception:
                logging.getLogger(__name__).exception('Error broadcasting layout update')

            return Response({'message': 'Tenant transferred successfully'}, status=status.HTTP_200_OK)
        else:
            return Response({'error': 'Failed to transfer tenant'}, status=status.HTTP_400_BAD_REQUEST)


class TenantRoomsView(generics.GenericAPIView):
    """GET list of rooms the tenant currently occupies (from all properties' layouts). Used for batch payment."""
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            tenant = Tenant.objects.get(pk=pk)
        except Tenant.DoesNotExist:
            return Response({'error': 'Tenant not found'}, status=status.HTTP_404_NOT_FOUND)

        seen = set()  # (property_id, room_number) to avoid duplicate rooms across variants
        rooms = []
        for prop in Property.objects.all():
            layouts = prop.layouts or {}
            if not isinstance(layouts, dict):
                continue
            for var, arr in layouts.items():
                if not isinstance(arr, list):
                    continue
                for b in arr:
                    tenant_data = b.get('tenant')
                    if not tenant_data:
                        continue
                    tid = tenant_data.get('tenant_id') or tenant_data.get('id')
                    if str(tid) != str(tenant.tenant_id):
                        continue
                    box_number = str(b.get('number', ''))
                    box_type = b.get('type', 'room')
                    box_section = b.get('section')
                    room_display = format_room_display(box_number, box_type, box_section)
                    key = (prop.id, room_display)
                    if key in seen:
                        break
                    seen.add(key)
                    payment = b.get('payment')
                    rooms.append({
                        'property_id': prop.id,
                        'property_name': prop.name,
                        'room_number': room_display,
                        'payment': float(payment) if payment is not None else None
                    })
                    break
                else:
                    continue
                break

        return Response({'rooms': rooms}, status=status.HTTP_200_OK)


class TenantReceivablesView(generics.GenericAPIView):
    """Add a receivable (tenant owes owner, e.g. for repairs owner paid first)."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            tenant = Tenant.objects.get(pk=pk)
        except Tenant.DoesNotExist:
            return Response({'error': 'Tenant not found'}, status=status.HTTP_404_NOT_FOUND)
        amount = request.data.get('amount')
        reason = (request.data.get('reason') or '').strip() or 'Reimbursement'
        try:
            amount = float(amount)
            if amount <= 0:
                return Response({'error': 'Amount must be positive'}, status=status.HTTP_400_BAD_REQUEST)
        except (TypeError, ValueError):
            return Response({'error': 'Invalid amount'}, status=status.HTTP_400_BAD_REQUEST)
        receivables = list(tenant.receivables) if getattr(tenant, 'receivables', None) else []
        rec_id = str(uuid.uuid4())
        today = datetime.now().strftime('%Y-%m-%d')
        receivables.append({
            'id': rec_id,
            'amount': amount,
            'reason': reason,
            'date': today,
            'received': False,
            'received_at': None
        })
        tenant.receivables = receivables
        tenant.save(update_fields=['receivables'])
        # Activity log: Receivable Added
        tenant_property = None
        try:
            for prop in Property.objects.all():
                layouts = prop.layouts or {}
                if isinstance(layouts, dict):
                    for var, arr in layouts.items():
                        if isinstance(arr, list):
                            for b in arr:
                                tenant_data = b.get('tenant')
                                if tenant_data and (tenant_data.get('tenant_id') == tenant.tenant_id or tenant_data.get('id') == tenant.tenant_id):
                                    tenant_property = prop
                                    break
                        if tenant_property:
                            break
                if tenant_property:
                    break
        except Exception:
            pass
        try:
            amount_str = f'\u20b1{amount}' if amount is not None else '\u2014'
            AuditLog.objects.create(
                severity='info',
                event='Receivable Added',
                user=request.user.username if request.user.is_authenticated else 'Anonymous',
                ip_address=get_client_ip(request),
                details=f"Receivable added for {tenant.full_name} (ID: {tenant.tenant_id}) \u2014 {amount_str} for {reason}.",
                user_ref=request.user if request.user.is_authenticated else None,
                property_ref=tenant_property
            )
        except Exception:
            logging.getLogger(__name__).exception('Failed to create audit log for receivable added')
        return Response({'message': 'Receivable added', 'receivable': {'id': rec_id, 'amount': amount, 'reason': reason, 'date': today, 'received': False}}, status=status.HTTP_201_CREATED)


class TenantReceivableMarkReceivedView(generics.GenericAPIView):
    """Mark a receivable as received (tenant paid owner back)."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk, receivable_id):
        try:
            tenant = Tenant.objects.get(pk=pk)
        except Tenant.DoesNotExist:
            return Response({'error': 'Tenant not found'}, status=status.HTTP_404_NOT_FOUND)
        receivables = list(tenant.receivables) if getattr(tenant, 'receivables', None) else []
        found = False
        rec_amount = rec_reason = None
        for r in receivables:
            if str(r.get('id')) == str(receivable_id):
                rec_amount = r.get('amount')
                rec_reason = r.get('reason') or 'Reimbursement'
                r['received'] = True
                r['received_at'] = datetime.now().strftime('%Y-%m-%dT%H:%M:%S')
                found = True
                break
        if not found:
            return Response({'error': 'Receivable not found'}, status=status.HTTP_404_NOT_FOUND)
        tenant.receivables = receivables
        tenant.save(update_fields=['receivables'])
        # Activity log: Reimbursement Received
        tenant_property = None
        try:
            for prop in Property.objects.all():
                layouts = prop.layouts or {}
                if isinstance(layouts, dict):
                    for var, arr in layouts.items():
                        if isinstance(arr, list):
                            for b in arr:
                                tenant_data = b.get('tenant')
                                if tenant_data and (tenant_data.get('tenant_id') == tenant.tenant_id or tenant_data.get('id') == tenant.tenant_id):
                                    tenant_property = prop
                                    break
                        if tenant_property:
                            break
                if tenant_property:
                    break
        except Exception:
            pass
        try:
            amount_str = f'\u20b1{rec_amount}' if rec_amount is not None else '\u2014'
            AuditLog.objects.create(
                severity='info',
                event='Reimbursement Received',
                user=request.user.username if request.user.is_authenticated else 'Anonymous',
                ip_address=get_client_ip(request),
                details=f"Reimbursement received: {tenant.full_name} (ID: {tenant.tenant_id}) \u2014 {amount_str} for {rec_reason or 'Reimbursement'}.",
                user_ref=request.user if request.user.is_authenticated else None,
                property_ref=tenant_property
            )
        except Exception:
            logging.getLogger(__name__).exception('Failed to create audit log for reimbursement received')
        return Response({'message': 'Receivable marked as received'}, status=status.HTTP_200_OK)


def _get_former_tenant_appliances(tenant):
    """Get appliances for a former tenant: from Appliance model, or fallback from last room layout, or from released_rooms scan."""
    appliances_list = []
    for appl in tenant.appliances.all():
        appliances_list.append({
            'appliance_id': appl.appliance_id,
            'name': appl.name,
            'surcharge_amount': float(appl.surcharge_amount) if appl.surcharge_amount else 0,
            'notes': appl.notes or '',
        })
    if not appliances_list and tenant.last_property_id:
        try:
            prop = Property.objects.get(pk=tenant.last_property_id)
            layouts = prop.layouts or {}
            last_room = (tenant.last_room or '').strip()
            last_room_norm = _normalize_room_for_compare(last_room) if last_room else ''
            if last_room_norm or last_room:
                for b, _ in _iter_layout_boxes(layouts):
                    box_number = str(b.get('number', ''))
                    box_type = b.get('type', 'room')
                    box_section = b.get('section', '')
                    formatted = format_room_display(box_number, box_type, box_section)
                    formatted_norm = _normalize_room_for_compare(formatted)
                    if not box_number and not formatted:
                        continue
                    if box_number == last_room or (last_room_norm and formatted_norm == last_room_norm):
                        box_appliances = b.get('appliances') or []
                        if isinstance(box_appliances, list):
                            for a in box_appliances:
                                if isinstance(a, dict) and a.get('name'):
                                    appliances_list.append({
                                        'appliance_id': a.get('appliance_id'),
                                        'name': a.get('name', ''),
                                        'surcharge_amount': float(a.get('surcharge_amount') or a.get('surcharge') or 0),
                                        'notes': a.get('notes', '') or '',
                                    })
                        break
        except (Property.DoesNotExist, ValueError, TypeError):
            pass
    # Fallback: no last_property_id or no match — scan all properties for a room in released_rooms or last_room
    if not appliances_list:
        released = getattr(tenant, 'released_rooms', None) or []
        released_set = {_normalize_room_for_compare(str(r)) for r in released if r is not None}
        released_set.update(str(r) for r in released if r is not None)
        last_room = (tenant.last_room or '').strip()
        if last_room:
            released_set.add(_normalize_room_for_compare(last_room))
            released_set.add(last_room)
        for prop in Property.objects.all():
            if not released_set:
                break
            try:
                layouts = prop.layouts or {}
                for b, _ in _iter_layout_boxes(layouts):
                    box_number = str(b.get('number', ''))
                    box_type = b.get('type', 'room')
                    box_section = b.get('section', '')
                    formatted = format_room_display(box_number, box_type, box_section)
                    formatted_norm = _normalize_room_for_compare(formatted)
                    if box_number in released_set or formatted in released_set or formatted_norm in released_set:
                        box_appliances = b.get('appliances') or []
                        if isinstance(box_appliances, list) and box_appliances:
                            for a in box_appliances:
                                if isinstance(a, dict) and a.get('name'):
                                    appliances_list.append({
                                        'appliance_id': a.get('appliance_id'),
                                        'name': a.get('name', ''),
                                        'surcharge_amount': float(a.get('surcharge_amount') or a.get('surcharge') or 0),
                                        'notes': a.get('notes', '') or '',
                                    })
                            if appliances_list:
                                try:
                                    tenant.last_room = box_number
                                    tenant.last_property_id = prop.id
                                    tenant.save(update_fields=['last_room', 'last_property_id'])
                                except Exception:
                                    pass
                                break
                    if appliances_list:
                        break
            except (ValueError, TypeError):
                continue
    return appliances_list


class FormerTenantSearchView(generics.GenericAPIView):
    """Search for inactive (former) tenants by tenant_id, email, phone, or name for re-registration."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        query = request.query_params.get('q', '').strip()

        if not query or len(query) < 2:
            return Response({'results': []}, status=status.HTTP_200_OK)

        # Search inactive tenants by tenant_id, email, phone, or name
        from django.db.models import Q

        search_filter = Q(email__icontains=query) | Q(phone__icontains=query) | Q(full_name__icontains=query)
        if query.isdigit():
            search_filter |= Q(tenant_id=int(query))

        # When property_id is provided, scope to that property's owner
        property_id = request.query_params.get('property_id', '').strip()
        user = request.user
        is_admin = user.is_superuser or getattr(user, 'is_staff', False) or (getattr(getattr(user, 'userprofile', None), 'role', None) == 'admin')
        role = getattr(getattr(user, 'userprofile', None), 'role', None)

        base_qs = Tenant.objects.filter(is_active=False)

        if property_id and property_id.isdigit():
            # Scope to the owner of the selected property — show former tenants
            # whose last_property belongs to the same owner
            try:
                prop = Property.objects.select_related('owner').get(pk=int(property_id))
                if prop.owner:
                    # All property IDs belonging to this owner
                    owner_property_ids = list(
                        Property.objects.filter(owner=prop.owner).values_list('id', flat=True)
                    )
                    base_qs = base_qs.filter(last_property_id__in=owner_property_ids)
                else:
                    base_qs = base_qs.filter(created_by=user)
            except Property.DoesNotExist:
                base_qs = base_qs.filter(created_by=user)
        elif is_admin:
            pass  # admin sees all
        elif role == 'manager':
            owner_users = User.objects.filter(owner__properties__managers=user).distinct()
            base_qs = base_qs.filter(Q(created_by=user) | Q(created_by__in=owner_users))
        else:
            base_qs = base_qs.filter(created_by=user)

        former_tenants = base_qs.filter(search_filter).order_by('-move_out', '-created_at')[:10]

        # Build a map of property_id -> owner name for DNR owner display
        dnr_prop_ids = set(t.last_property_id for t in former_tenants if t.blacklisted and t.last_property_id)
        owner_name_by_prop = {}
        if dnr_prop_ids:
            for prop in Property.objects.filter(pk__in=dnr_prop_ids).select_related('owner'):
                if prop.owner:
                    owner_name_by_prop[prop.pk] = prop.owner.full_name

        results = []
        for tenant in former_tenants:
            appliances_list = _get_former_tenant_appliances(tenant)
            other_occupants_list = []
            last_lease = tenant.leases.order_by('-move_in').first()
            if last_lease:
                for occ in last_lease.other_occupants.all():
                    other_occupants_list.append({
                        'occupant_id': occ.occupant_id,
                        'full_name': occ.full_name,
                        'relationship': occ.relationship or '',
                    })
            results.append({
                'tenant_id': tenant.tenant_id,
                'full_name': tenant.full_name,
                'email': tenant.email,
                'phone': tenant.phone,
                'last_room': tenant.last_room,
                'last_property_id': tenant.last_property_id,
                'last_payment': float(tenant.last_payment) if tenant.last_payment else None,
                'move_out': tenant.move_out.isoformat() if tenant.move_out else None,
                'blacklisted': tenant.blacklisted,
                'blacklist_reason': tenant.blacklist_reason if tenant.blacklisted else None,
                'dnr_owner_name': owner_name_by_prop.get(tenant.last_property_id) if tenant.blacklisted else None,
                'home_location': tenant.home_location,
                'work_place': tenant.work_place,
                'appliances': appliances_list,
                'other_occupants': other_occupants_list,
            })

        return Response({'results': results}, status=status.HTTP_200_OK)


class CheckDNRView(generics.GenericAPIView):
    """Check if a phone or email matches any blacklisted (DNR) tenant across all owners."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        phone = request.query_params.get('phone', '').strip()
        email = request.query_params.get('email', '').strip()
        property_id = request.query_params.get('property_id', '').strip()

        if not phone and not email:
            return Response({'matches': []}, status=status.HTTP_200_OK)

        from django.db.models import Q
        dnr_filter = Q(blacklisted=True, is_active=False)
        contact_filter = Q()
        if phone:
            contact_filter |= Q(phone__iexact=phone)
        if email:
            contact_filter |= Q(email__iexact=email)

        dnr_tenants = Tenant.objects.filter(dnr_filter & contact_filter)

        # Determine the current property's owner
        current_owner_id = None
        if property_id and property_id.isdigit():
            try:
                prop = Property.objects.select_related('owner').get(pk=int(property_id))
                if prop.owner:
                    current_owner_id = prop.owner.pk
            except Property.DoesNotExist:
                pass

        # Build property->owner map
        prop_ids = set(t.last_property_id for t in dnr_tenants if t.last_property_id)
        owner_by_prop = {}
        if prop_ids:
            for p in Property.objects.filter(pk__in=prop_ids).select_related('owner'):
                if p.owner:
                    owner_by_prop[p.pk] = p.owner

        matches = []
        for tenant in dnr_tenants:
            owner = owner_by_prop.get(tenant.last_property_id)
            is_same_owner = owner and current_owner_id and owner.pk == current_owner_id
            matched_field = 'phone' if (phone and tenant.phone and tenant.phone.lower() == phone.lower()) else 'email'
            matches.append({
                'owner_name': owner.full_name if owner else 'Unknown',
                'matched_field': matched_field,
                'matched_value': phone if matched_field == 'phone' else email,
                'same_owner': is_same_owner,
                'blacklist_reason': tenant.blacklist_reason or '',
            })

        return Response({'matches': matches}, status=status.HTTP_200_OK)


class FormerTenantDetailsView(generics.GenericAPIView):
    """GET full details for a former (inactive) tenant including appliances — for re-registration form."""
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            tenant = Tenant.objects.get(pk=pk)
        except Tenant.DoesNotExist:
            return Response({'error': 'Tenant not found'}, status=status.HTTP_404_NOT_FOUND)
        if tenant.is_active:
            return Response({'error': 'Tenant is active; use tenant detail endpoint'}, status=status.HTTP_400_BAD_REQUEST)
        appliances_list = _get_former_tenant_appliances(tenant)
        # Persist appliances from layout so next time they load from DB (e.g. former tenant 20260039)
        if appliances_list and tenant.appliances.count() == 0:
            try:
                for a in appliances_list:
                    name = (a.get('name') or '').strip()
                    if name:
                        surcharge = a.get('surcharge_amount') or a.get('surcharge') or 0
                        Appliance.objects.create(
                            tenant=tenant,
                            name=name,
                            surcharge_amount=Decimal(str(float(surcharge))),
                            notes=(a.get('notes') or '')[:500],
                        )
            except Exception:
                logging.getLogger(__name__).exception('Failed to persist former tenant appliances to Appliance model')
        other_occupants_list = []
        last_lease = tenant.leases.order_by('-move_in').first()
        if last_lease:
            for occ in last_lease.other_occupants.all():
                other_occupants_list.append({
                    'occupant_id': occ.occupant_id,
                    'full_name': occ.full_name,
                    'relationship': occ.relationship or '',
                })
        data = {
            'tenant_id': tenant.tenant_id,
            'full_name': tenant.full_name,
            'email': tenant.email,
            'phone': tenant.phone,
            'last_room': tenant.last_room,
            'last_property_id': tenant.last_property_id,
            'last_payment': float(tenant.last_payment) if tenant.last_payment else None,
            'move_out': tenant.move_out.isoformat() if tenant.move_out else None,
            'blacklisted': tenant.blacklisted,
            'blacklist_reason': tenant.blacklist_reason if tenant.blacklisted else None,
            'home_location': tenant.home_location,
            'work_place': tenant.work_place,
            'appliances': appliances_list,
            'other_occupants': other_occupants_list,
        }
        return Response(data, status=status.HTTP_200_OK)


class TenantReactivateView(generics.GenericAPIView):
    """Reactivate a former tenant and assign them to one or more rooms (batch support)."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            tenant = Tenant.objects.get(pk=pk)
        except Tenant.DoesNotExist:
            return Response({'error': 'Tenant not found'}, status=status.HTTP_404_NOT_FOUND)

        if tenant.is_active:
            return Response({'error': 'Tenant is already active'}, status=status.HTTP_400_BAD_REQUEST)

        if tenant.blacklisted:
            force = request.data.get('force_dnr', False)
            if not force:
                return Response({
                    'error': 'Cannot reactivate blacklisted tenant',
                    'blacklist_reason': tenant.blacklist_reason
                }, status=status.HTTP_400_BAD_REQUEST)
            # Owner chose to override DNR — clear blacklist status
            tenant.blacklisted = False
            tenant.blacklist_reason = ''
            tenant.save(update_fields=['blacklisted', 'blacklist_reason'])

        property_id = request.data.get('property_id')
        # Support both single room_number and batch room_numbers array
        room_numbers = request.data.get('room_numbers', [])
        if not room_numbers:
            single_room = request.data.get('room_number') or request.data.get('room_no') or request.data.get('unit_no')
            if single_room:
                room_numbers = [single_room]

        payment = request.data.get('payment')
        payment_day = request.data.get('payment_day')
        appliances = request.data.get('appliances', [])
        other_occupants = request.data.get('other_occupants', [])
        date_of_occupancy = request.data.get('date_of_occupancy')
        # Get advance and deposit payment info
        advance_paid = request.data.get('advance_paid', False)
        advance_amount = request.data.get('advance_amount', 0)
        deposit_paid = request.data.get('deposit_paid', False)
        deposit_amount = request.data.get('deposit_amount', 0)
        include_surcharge_in_deposits = request.data.get('include_appliance_surcharge_in_deposits', True)

        if not property_id or not room_numbers:
            return Response(
                {'error': 'property_id and at least one room_number are required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            prop = Property.objects.get(pk=property_id)
        except Property.DoesNotExist:
            return Response({'error': 'Property not found'}, status=status.HTTP_404_NOT_FOUND)

        # Check if all rooms are available
        layouts = prop.layouts or {}
        unavailable_rooms = []
        not_found_rooms = []

        for room_number in room_numbers:
            room_found = False
            room_available = False

            if isinstance(layouts, dict):
                for var, arr in layouts.items():
                    if not isinstance(arr, list):
                        continue
                    for b in arr:
                        box_number = str(b.get('number', ''))
                        box_type = b.get('type', 'room')
                        box_section = b.get('section')
                        formatted_box = format_room_display(box_number, box_type, box_section)

                        if formatted_box == str(room_number):
                            room_found = True
                            if b.get('status') == 'available':
                                room_available = True
                            break
                    if room_found:
                        break

            if not room_found:
                not_found_rooms.append(room_number)
            elif not room_available:
                unavailable_rooms.append(room_number)

        if not_found_rooms:
            return Response({'error': f'Rooms not found: {", ".join(not_found_rooms)}'}, status=status.HTTP_404_NOT_FOUND)

        if unavailable_rooms:
            return Response({'error': f'Rooms not available: {", ".join(unavailable_rooms)}'}, status=status.HTTP_400_BAD_REQUEST)

        # Reactivate tenant
        from datetime import date
        tenant.is_active = True
        tenant.move_out = None  # Clear move-out date
        if date_of_occupancy:
            try:
                tenant.move_in = date.fromisoformat(date_of_occupancy)
            except ValueError:
                tenant.move_in = date.today()
        else:
            tenant.move_in = date.today()

        if payment_day:
            tenant.preferred_payment_day = int(payment_day)

        tenant.save()

        # Update property layouts to add tenant to all selected rooms
        updated_rooms = []
        if isinstance(layouts, dict):
            for room_number in room_numbers:
                for var, arr in layouts.items():
                    if not isinstance(arr, list):
                        continue
                    for b in arr:
                        box_number = str(b.get('number', ''))
                        box_type = b.get('type', 'room')
                        box_section = b.get('section')
                        formatted_box = format_room_display(box_number, box_type, box_section)

                        if formatted_box == str(room_number):
                            b['status'] = 'occupied'
                            b['occupancy'] = 1 + len(other_occupants) if other_occupants else 1
                            if payment:
                                b['payment'] = payment
                            if payment_day:
                                b['preferred_payment_day'] = int(payment_day)
                            # Always set room appliances from request (including empty [] when user adds none)
                            b['appliances'] = appliances if isinstance(appliances, list) else []
                            b['tenant'] = {
                                'tenant_id': tenant.tenant_id,
                                'id': tenant.tenant_id,
                                'full_name': tenant.full_name,
                                'email': tenant.email,
                                'phone': tenant.phone,
                                'created_at': tenant.created_at.isoformat() if tenant.created_at else None,
                                'move_in': tenant.move_in.isoformat() if tenant.move_in else None,
                                'other_occupants': other_occupants,
                                # Initial payment tracking
                                'advance_paid': advance_paid,
                                'advance_amount': float(advance_amount) if advance_amount else 0,
                                'deposit_paid': deposit_paid,
                                'deposit_amount': float(deposit_amount) if deposit_amount else 0,
                                'include_appliance_surcharge_in_deposits': include_surcharge_in_deposits,
                            }

                            # Initialize transactions array if not exists
                            if 'transactions' not in b:
                                b['transactions'] = []

                            # Add advance and deposit to transaction history
                            import datetime
                            move_in_date = date_of_occupancy or datetime.date.today().isoformat()
                            advance_payment_date = request.data.get('advance_payment_date') or move_in_date
                            deposit_payment_date = request.data.get('deposit_payment_date') or move_in_date

                            if advance_paid and advance_amount:
                                advance_transaction = {
                                    'date': advance_payment_date,
                                    'amount': f'{float(advance_amount):,.2f}',
                                    'name': tenant.full_name,
                                    'notes': 'Initial advance payment (1 month)',
                                    'tenant_id': tenant.tenant_id,
                                    'tenant_name': tenant.full_name,
                                    'room_no': formatted_box,
                                    'timestamp': f'{advance_payment_date}T00:00:00' if advance_payment_date != move_in_date else datetime.datetime.now().isoformat(),
                                    'is_late': False,
                                    'status': 'paid',
                                    'payment_type': 'advance',
                                    'method': 'cash'
                                }
                                b['transactions'].insert(0, advance_transaction)

                            if deposit_paid and deposit_amount:
                                deposit_transaction = {
                                    'date': deposit_payment_date,
                                    'amount': f'{float(deposit_amount):,.2f}',
                                    'name': tenant.full_name,
                                    'notes': 'Initial deposit payment (1 month)',
                                    'tenant_id': tenant.tenant_id,
                                    'tenant_name': tenant.full_name,
                                    'room_no': formatted_box,
                                    'timestamp': f'{deposit_payment_date}T00:00:00' if deposit_payment_date != move_in_date else datetime.datetime.now().isoformat(),
                                    'is_late': False,
                                    'status': 'paid',
                                    'payment_type': 'deposit',
                                    'method': 'cash'
                                }
                                b['transactions'].insert(0, deposit_transaction)

                            updated_rooms.append(formatted_box)
                            break

        if updated_rooms:
            prop.layouts = layouts
            prop.save()

            # Replace tenant's Appliance records with submitted list (including empty when user adds none)
            try:
                Appliance.objects.filter(tenant=tenant).delete()
            except Exception:
                pass
            if isinstance(appliances, list):
                for appl in appliances:
                    if isinstance(appl, dict) and appl.get('name'):
                        try:
                            Appliance.objects.create(
                                tenant=tenant,
                                name=appl.get('name', ''),
                                surcharge_amount=Decimal(str(appl.get('surcharge_amount', 0))),
                                notes=appl.get('notes', '')
                            )
                        except Exception as e:
                            logging.getLogger(__name__).warning('Failed to create appliance: %s', str(e))

            # Log tenant reactivation
            rooms_str = ', '.join(updated_rooms)
            try:
                AuditLog.objects.create(
                    severity='info',
                    event='Tenant Reactivated',
                    user=request.user.username if request.user.is_authenticated else 'Anonymous',
                    ip_address=get_client_ip(request),
                    details=f'Reactivated returning tenant: {tenant.full_name} (ID: {tenant.tenant_id}) in Room(s) {rooms_str} at {prop.name}',
                    user_ref=request.user if request.user.is_authenticated else None,
                    property_ref=prop
                )
            except Exception:
                logging.getLogger(__name__).exception('Failed to create audit log for tenant reactivation')

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
            except Exception:
                logging.getLogger(__name__).exception('Error broadcasting layout update')

            # Generate automated messages for the reactivated tenant
            try:
                from .messaging import _generate_messages_for_new_tenant
                logging.getLogger(__name__).info('Calling _generate_messages_for_new_tenant with updated_rooms=%s', updated_rooms)
                _generate_messages_for_new_tenant(prop, tenant, updated_rooms)
                logging.getLogger(__name__).info('Completed generating automated messages for reactivated tenant %s', tenant.full_name)
            except Exception:
                logging.getLogger(__name__).exception('Failed to generate automated messages for reactivated tenant')

            # Return the tenant data in the same format as TenantSerializer
            return Response({
                'tenant_id': tenant.tenant_id,
                'full_name': tenant.full_name,
                'email': tenant.email,
                'phone': tenant.phone,
                'is_active': tenant.is_active,
                'move_in': tenant.move_in.isoformat() if tenant.move_in else None,
                'rooms_assigned': updated_rooms,
                'message': f'Tenant reactivated successfully in {len(updated_rooms)} room(s)'
            }, status=status.HTTP_200_OK)
        else:
            return Response({'error': 'Failed to update rooms'}, status=status.HTTP_400_BAD_REQUEST)
