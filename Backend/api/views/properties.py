import copy
import logging
import re

from django.db import transaction as db_transaction
from django.utils import timezone
from rest_framework import generics, serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import Property, AuditLog
from ..permissions import IsAdminRole
from ..serializers import PropertySerializer
from .utils import (
    get_client_ip,
    format_room_display,
    _normalize_room_for_compare,
    _iter_layout_boxes,
    _enrich_layouts_with_receivables,
)


class AdminPropertyListCreateView(generics.ListCreateAPIView):
    serializer_class = PropertySerializer
    permission_classes = [IsAuthenticated, IsAdminRole]

    def get_queryset(self):
        include_archived = self.request.query_params.get('include_archived', '').lower() == 'true'
        if include_archived:
            return Property.objects.all().order_by('id')
        return Property.objects.filter(is_archived=False).order_by('id')

    def create(self, request, *args, **kwargs):
        # Log incoming payload to help debug missing owner field from the client
        try:
            logging.getLogger(__name__).info('AdminPropertyListCreateView POST data: %s', request.data)
        except Exception:
            pass
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        property = serializer.save()

        # Log building creation in audit log
        try:
            AuditLog.objects.create(
                severity='info',
                event='Building Created',
                user=self.request.user.username if self.request.user.is_authenticated else 'Anonymous',
                ip_address=get_client_ip(self.request),
                details=f'Created building: {property.name} (ID: {property.id}) at {property.address}, {property.city}',
                user_ref=self.request.user if self.request.user.is_authenticated else None,
                property_ref=property
            )
        except Exception:
            logging.getLogger(__name__).exception('Failed to create audit log for building creation')


class PropertyRoomsView(APIView):
    """Return a simple list of unit identifiers for a given property.

    Query params:
    - floor: Filter by specific floor number
    - detailed: If 'true', return objects with room name and floor info instead of just strings
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk, format=None):
        try:
            prop = Property.objects.get(pk=pk)
            layouts = prop.layouts or {}
            # Use dict to deduplicate by room number
            rooms_dict = {}  # key: formatted_room, value: {name, floor}

            # Get query params
            floor_filter = request.query_params.get('floor')
            if floor_filter:
                try:
                    floor_filter = int(floor_filter)
                except (ValueError, TypeError):
                    floor_filter = None

            detailed = request.query_params.get('detailed', '').lower() == 'true'

            # Extract all room numbers from layouts (with section prefixes)
            if isinstance(layouts, dict):
                for var, arr in layouts.items():
                    if isinstance(arr, list):
                        for box in arr:
                            room_num = box.get('number')
                            room_status = box.get('status', 'available')
                            room_floor = box.get('floor', 1)

                            # Filter by floor if specified
                            if floor_filter is not None and room_floor != floor_filter:
                                continue

                            if room_num and room_status == 'available':
                                # Format room with section prefix using the helper function
                                room_type = box.get('type', 'room')
                                section = box.get('section')
                                formatted_room = format_room_display(room_num, room_type, section)

                                # Use formatted room as key to avoid overwriting different rooms with same number
                                # e.g., M1 and R1 are different rooms even though both have number=1
                                rooms_dict[formatted_room] = {
                                    'name': formatted_room,
                                    'floor': room_floor
                                }

            # Convert to list and sort
            rooms_list = list(rooms_dict.values())

            # Sort rooms naturally (F1, F2, M1, M2, R1, R2, etc.)
            def natural_sort_key(room_obj):
                room = room_obj['name'] if isinstance(room_obj, dict) else room_obj
                # Extract prefix and number
                match = re.match(r'^([A-Z]*)(\d+)$', str(room))
                if match:
                    prefix, num = match.groups()
                    return (prefix, int(num))
                return (room, 0)

            rooms_list.sort(key=natural_sort_key)

            # Return detailed info or just room names based on query param
            if detailed:
                return Response(rooms_list)
            else:
                return Response([r['name'] for r in rooms_list])
        except Property.DoesNotExist:
            return Response([], status=status.HTTP_404_NOT_FOUND)


class PropertyListCreateView(generics.ListCreateAPIView):
    queryset = Property.objects.all()
    serializer_class = PropertySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        # Check if archived buildings are explicitly requested
        include_archived = self.request.query_params.get('include_archived', '').lower() == 'true'
        base_qs = Property.objects.all() if include_archived else Property.objects.filter(is_archived=False)

        # superusers/staff/admins see all
        is_admin_user = user.is_superuser or getattr(user, 'is_staff', False) or (getattr(getattr(user, 'userprofile', None), 'role', None) == 'admin')
        if is_admin_user:
            return base_qs.order_by('id')

        # owners see only properties they own
        role = getattr(getattr(user, 'userprofile', None), 'role', None)
        if role == 'owner':
            return base_qs.filter(owner__user=user).order_by('id')

        # managers see properties they manage
        if role == 'manager':
            return base_qs.filter(managers=user).order_by('id')

        # default: no properties
        return Property.objects.none()

    def perform_create(self, serializer):
        serializer.save()


class PropertyDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Property.objects.all()
    serializer_class = PropertySerializer
    permission_classes = [IsAuthenticated, IsAdminRole]

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        property_name = instance.name
        property_address = instance.address
        property_city = instance.city
        property_id = instance.id

        # Block archiving if building has active tenants
        layouts = instance.layouts or {}
        active_tenants = []
        for box, _ in _iter_layout_boxes(layouts):
            tenant_data = box.get('tenant') if isinstance(box.get('tenant'), dict) else None
            if tenant_data and (tenant_data.get('tenant_id') or tenant_data.get('id')):
                active_tenants.append(tenant_data.get('full_name', 'Unknown'))
        if active_tenants:
            return Response({
                'detail': f'Cannot archive this building — it has {len(active_tenants)} active tenant(s). Remove all tenants first.',
                'active_tenants': active_tenants
            }, status=status.HTTP_400_BAD_REQUEST)

        # Archive instead of hard delete — preserve all building data
        instance.is_archived = True
        instance.archived_at = timezone.now()
        instance.archived_by = request.user
        instance.save(update_fields=['is_archived', 'archived_at', 'archived_by'])

        # Log building archival in audit log
        try:
            AuditLog.objects.create(
                severity='info',
                event='Building Archived',
                user=request.user.username if request.user.is_authenticated else 'Anonymous',
                ip_address=get_client_ip(request),
                details=f'Archived building: {property_name} (ID: {property_id}) at {property_address}, {property_city}',
                user_ref=request.user if request.user.is_authenticated else None,
                property_ref=instance
            )
        except Exception:
            logging.getLogger(__name__).exception('Failed to create audit log for building archival')

        return Response({'detail': f'Building "{property_name}" has been archived.'}, status=status.HTTP_200_OK)

    def perform_update(self, serializer):
        instance = serializer.instance
        old_owner = instance.owner
        old_managers = list(instance.managers.all())

        # Save the updated instance
        updated_instance = serializer.save()

        new_owner = updated_instance.owner
        new_managers = list(updated_instance.managers.all())

        # Track owner changes
        if old_owner != new_owner:
            if old_owner and not new_owner:
                # Owner deassigned
                try:
                    AuditLog.objects.create(
                        severity='info',
                        event='Owner Deassigned',
                        user=self.request.user.username if self.request.user.is_authenticated else 'Anonymous',
                        ip_address=get_client_ip(self.request),
                        details=f'Deassigned owner {old_owner.user.username if old_owner and old_owner.user else "Unknown"} (ID: {old_owner.user.id if old_owner and old_owner.user else "N/A"}) from building {updated_instance.name} (ID: {updated_instance.id})',
                        user_ref=self.request.user if self.request.user.is_authenticated else None,
                        property_ref=updated_instance
                    )
                except Exception:
                    logging.getLogger(__name__).exception('Failed to create audit log for owner deassignment')
            elif not old_owner and new_owner:
                # Owner assigned
                try:
                    AuditLog.objects.create(
                        severity='info',
                        event='Owner Assigned',
                        user=self.request.user.username if self.request.user.is_authenticated else 'Anonymous',
                        ip_address=get_client_ip(self.request),
                        details=f'Assigned owner {new_owner.user.username if new_owner and new_owner.user else "Unknown"} (ID: {new_owner.user.id if new_owner and new_owner.user else "N/A"}) to building {updated_instance.name} (ID: {updated_instance.id})',
                        user_ref=self.request.user if self.request.user.is_authenticated else None,
                        property_ref=updated_instance
                    )
                except Exception:
                    logging.getLogger(__name__).exception('Failed to create audit log for owner assignment')
            elif old_owner and new_owner and old_owner.pk != new_owner.pk:
                # Owner changed
                try:
                    AuditLog.objects.create(
                        severity='info',
                        event='Owner Changed',
                        user=self.request.user.username if self.request.user.is_authenticated else 'Anonymous',
                        ip_address=get_client_ip(self.request),
                        details=f'Changed owner from {old_owner.user.username if old_owner and old_owner.user else "Unknown"} (ID: {old_owner.user.id if old_owner and old_owner.user else "N/A"}) to {new_owner.user.username if new_owner and new_owner.user else "Unknown"} (ID: {new_owner.user.id if new_owner and new_owner.user else "N/A"}) for building {updated_instance.name} (ID: {updated_instance.id})',
                        user_ref=self.request.user if self.request.user.is_authenticated else None,
                        property_ref=updated_instance
                    )
                except Exception:
                    logging.getLogger(__name__).exception('Failed to create audit log for owner change')

        # Track manager changes
        old_manager_ids = {m.id for m in old_managers}
        new_manager_ids = {m.id for m in new_managers}

        # Managers added
        added_managers = [m for m in new_managers if m.id not in old_manager_ids]
        for manager in added_managers:
            try:
                AuditLog.objects.create(
                    severity='info',
                    event='Manager Assigned',
                    user=self.request.user.username if self.request.user.is_authenticated else 'Anonymous',
                    ip_address=get_client_ip(self.request),
                    details=f'Assigned manager {manager.username} (ID: {manager.id}) to building {updated_instance.name} (ID: {updated_instance.id})',
                    user_ref=self.request.user if self.request.user.is_authenticated else None,
                    property_ref=updated_instance
                )
            except Exception:
                logging.getLogger(__name__).exception('Failed to create audit log for manager assignment')

        # Managers removed
        removed_managers = [m for m in old_managers if m.id not in new_manager_ids]
        for manager in removed_managers:
            try:
                AuditLog.objects.create(
                    severity='info',
                    event='Manager Deassigned',
                    user=self.request.user.username if self.request.user.is_authenticated else 'Anonymous',
                    ip_address=get_client_ip(self.request),
                    details=f'Deassigned manager {manager.username} (ID: {manager.id}) from building {updated_instance.name} (ID: {updated_instance.id})',
                    user_ref=self.request.user if self.request.user.is_authenticated else None,
                    property_ref=updated_instance
                )
            except Exception:
                logging.getLogger(__name__).exception('Failed to create audit log for manager deassignment')


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsAdminRole])
def restore_property_view(request, pk):
    """Restore an archived building back to active status."""
    try:
        prop = Property.objects.get(pk=pk)
    except Property.DoesNotExist:
        return Response({'error': 'Building not found.'}, status=status.HTTP_404_NOT_FOUND)

    if not prop.is_archived:
        return Response({'error': 'Building is not archived.'}, status=status.HTTP_400_BAD_REQUEST)

    prop.is_archived = False
    prop.archived_at = None
    prop.archived_by = None
    prop.save(update_fields=['is_archived', 'archived_at', 'archived_by'])

    try:
        AuditLog.objects.create(
            severity='info',
            event='Building Restored',
            user=request.user.username,
            ip_address=get_client_ip(request),
            details=f'Restored building: {prop.name} (ID: {prop.id}) at {prop.address}, {prop.city}',
            user_ref=request.user,
            property_ref=prop
        )
    except Exception:
        logging.getLogger(__name__).exception('Failed to create audit log for building restoration')

    return Response({'detail': f'Building "{prop.name}" has been restored.', 'property': PropertySerializer(prop).data}, status=status.HTTP_200_OK)


class PropertyLayoutSerializer(serializers.ModelSerializer):
    layouts = serializers.JSONField(required=False)

    class Meta:
        model = Property
        fields = ['layouts']


class PropertyLayoutView(generics.RetrieveUpdateAPIView):
    """GET/PUT the `layouts` JSON for a property. Only owners/managers/admins may modify."""
    queryset = Property.objects.all()
    serializer_class = PropertyLayoutSerializer
    permission_classes = [IsAuthenticated]

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance)
        data = serializer.data
        layouts = data.get('layouts')
        if layouts:
            data = dict(data)
            data['layouts'] = _enrich_layouts_with_receivables(copy.deepcopy(layouts))
        return Response(data)

    def check_object_permissions(self, request, obj):
        # allow admins/staff
        user = request.user
        is_admin_user = user.is_superuser or getattr(user, 'is_staff', False) or (getattr(getattr(user, 'userprofile', None), 'role', None) == 'admin')
        if is_admin_user:
            return
        # owners/managers allowed
        role = getattr(getattr(user, 'userprofile', None), 'role', None)
        if role == 'owner' and getattr(obj, 'owner', None) and getattr(getattr(obj, 'owner'), 'user', None) == user:
            return
        if role == 'manager' and obj.managers.filter(pk=user.pk).exists():
            return
        from rest_framework.exceptions import PermissionDenied

        raise PermissionDenied('Permission denied for property layouts.')

    def perform_update(self, serializer):
        # Save with row lock to prevent concurrent layout modifications
        with db_transaction.atomic():
            instance = Property.objects.select_for_update().get(pk=serializer.instance.pk)
            instance.layouts = serializer.validated_data.get('layouts', instance.layouts)
            instance.save()

        # broadcast the updated layouts to websocket group for this property
        try:
            from asgiref.sync import async_to_sync
            from channels.layers import get_channel_layer

            channel_layer = get_channel_layer()
            group_name = f'property_{instance.pk}'
            async_to_sync(channel_layer.group_send)(
                group_name,
                {
                    'type': 'layouts.update',
                    'layouts': instance.layouts,
                }
            )
        except Exception:
            # don't block save on websocket errors
            pass


class PropertyRoomStatusView(APIView):
    """Update the status of a specific room in a property's layouts."""
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk, room_number):
        try:
            property_obj = Property.objects.get(pk=pk)
        except Property.DoesNotExist:
            return Response({'error': 'Property not found'}, status=status.HTTP_404_NOT_FOUND)

        new_status = request.data.get('status')
        floor_number = request.data.get('floor')  # Get floor from request
        # Use None as sentinel to distinguish "not provided" from "empty string"
        section = request.data.get('section') if 'section' in request.data else None
        room_type = request.data.get('type') if 'type' in request.data else None

        if new_status not in ['available', 'occupied', 'maintenance']:
            return Response({'error': 'Invalid status. Must be: available, occupied, or maintenance'}, status=status.HTTP_400_BAD_REQUEST)

        # Update the room status in layouts
        layouts = property_obj.layouts or {}
        updated = False

        if isinstance(layouts, dict):
            for var, arr in layouts.items():
                if not isinstance(arr, list):
                    continue
                for b in arr:
                    # Match room number, floor, AND section/type to uniquely identify the room
                    # This prevents marking room M4 when user meant R4 (same number, different section)
                    room_floor = b.get('floor', 1)
                    room_section = b.get('section', '')
                    room_type_in_layout = b.get('type', 'room')

                    # Check if room number matches
                    number_matches = str(b.get('number')) == str(room_number)
                    # Check if floor matches (or floor not specified)
                    floor_matches = floor_number is None or room_floor == floor_number
                    # Check if section matches - if section is provided (even empty string), must match exactly
                    section_matches = section is None or (room_section or '') == (section or '')
                    # Check if type matches - if type is provided, must match exactly
                    type_matches = room_type is None or room_type_in_layout == room_type

                    if number_matches and floor_matches and section_matches and type_matches:
                        b['status'] = new_status
                        updated = True
                        logging.getLogger(__name__).info('Updated room %s (floor %s, section %s) status to %s in property %s', room_number, room_floor, room_section, new_status, pk)

        if not updated:
            return Response({'error': 'Room not found in property layouts'}, status=status.HTTP_404_NOT_FOUND)

        property_obj.layouts = layouts
        property_obj.save()

        # Log the status change
        try:
            # Find the room data to get type and section for proper display
            display_type = room_type or 'room'
            display_section = section or ''
            for var, arr in layouts.items():
                if isinstance(arr, list):
                    for b in arr:
                        b_floor = b.get('floor', 1)
                        b_section = b.get('section', '')
                        b_type = b.get('type', 'room')
                        number_matches = str(b.get('number')) == str(room_number)
                        floor_matches = floor_number is None or b_floor == floor_number
                        section_matches = section is None or (b_section or '') == (section or '')
                        type_matches = room_type is None or b_type == room_type
                        if number_matches and floor_matches and section_matches and type_matches:
                            display_type = b_type
                            display_section = b_section
                            break
            room_display = format_room_display(room_number, display_type, display_section)
            AuditLog.objects.create(
                severity='info',
                event='Room Status Changed',
                user=request.user.username if request.user.is_authenticated else 'Anonymous',
                ip_address=get_client_ip(request),
                details=f'Changed Room {room_display} status to "{new_status}" at {property_obj.name}',
                user_ref=request.user if request.user.is_authenticated else None,
                property_ref=property_obj
            )
        except Exception:
            logging.getLogger(__name__).exception('Failed to create audit log for room status change')

        # Broadcast layout update
        try:
            from asgiref.sync import async_to_sync
            from channels.layers import get_channel_layer
            channel_layer = get_channel_layer()
            group_name = f'property_{pk}'
            async_to_sync(channel_layer.group_send)(
                group_name,
                {'type': 'layouts.update', 'layouts': property_obj.layouts}
            )
        except Exception:
            pass

        return Response({'message': 'Room status updated successfully', 'status': new_status}, status=status.HTTP_200_OK)
