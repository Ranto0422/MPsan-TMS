from django.contrib.auth.models import User
from rest_framework import serializers
from rest_framework.validators import UniqueValidator
import logging
from .models import Tenant, Property, Unit, Owner, Lease, Appliance, Notification, Payment, NotificationLog, OtherOccupant, AuditLog
from .models import Section
from .models import AutomatedMessageSettings, ScheduledAutomatedMessage, TenantMessageSchedule
from .models import TenantDocument, MessageLog
from django.conf import settings


class UserSerializer(serializers.ModelSerializer):
    # make role default read-only, but we'll toggle it in __init__
    # read role from the related UserProfile (if present)
    role = serializers.CharField(source='userprofile.role', read_only=True)
    is_superuser = serializers.BooleanField(read_only=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get('request')
        # allow admins (superuser / staff / custom profile role 'admin') to write role
        if request and getattr(request, 'user', None) and request.user.is_authenticated:
            is_admin = request.user.is_superuser or getattr(request.user, 'is_staff', False)
            # if you use a UserProfile with role, adjust the check below
            user_profile = getattr(request.user, 'userprofile', None)
            if not is_admin and user_profile:
                is_admin = getattr(user_profile, 'role', None) == 'admin'
            if is_admin:
                self.fields['role'].read_only = False


    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'password', 'role', 'is_superuser']
        extra_kwargs = {'password': {'write_only': True}}

    def validate_email(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("Email is required.")
        value = value.strip()
        qs = User.objects.filter(email__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate_password(self, value):
        if len(value) < 6:
            raise serializers.ValidationError("Password must be at least 6 characters.")
        has_letter = any(c.isalpha() for c in value)
        has_number = any(c.isdigit() for c in value)
        if not has_letter or not has_number:
            raise serializers.ValidationError("Password must contain at least one letter and one number.")
        return value

    def create(self, validated_data):
        role = self.context.get('role')
        user = User.objects.create_user(**validated_data)
        if role:
            # create or update profile
            profile = getattr(user, 'userprofile', None)
            if profile:
                profile.role = role
                profile.save()
            else:
                from .models import UserProfile
                UserProfile.objects.create(user=user, role=role)
        return user


class TenantSerializer(serializers.ModelSerializer):
    # expose both `tenant_id` and legacy `id` (mapped to tenant_id) for backward compatibility
    id = serializers.IntegerField(source='tenant_id', read_only=True)
    full_name = serializers.CharField(required=True, max_length=100)
    # accept date_of_occupancy from frontend and map to move_in field
    date_of_occupancy = serializers.DateField(source='move_in', required=False, allow_null=True)
    # accept payment_day from frontend and map to preferred_payment_day field
    payment_day = serializers.IntegerField(source='preferred_payment_day', required=False, allow_null=True)
    # expose date_removed as alias for move_out
    date_removed = serializers.DateField(source='move_out', required=False, allow_null=True, read_only=True)

    class Meta:
        model = Tenant
        fields = ['tenant_id', 'id', 'full_name', 'business_name', 'email', 'phone', 'home_location', 'work_place', 'warning_flag', 'id_photo_url', 'move_in', 'move_out', 'date_removed', 'preferred_payment_day', 'payment_day', 'is_active', 'last_room', 'last_property_id', 'last_payment', 'released_rooms', 'receivables', 'notes', 'blacklisted', 'blacklist_reason', 'created_at', 'updated_at', 'created_by', 'date_of_occupancy']
        read_only_fields = ['tenant_id', 'id', 'created_at', 'updated_at', 'created_by', 'date_removed']
        extra_kwargs = {
            'email': {'validators': [], 'required': False, 'allow_blank': True, 'allow_null': True},
            'phone': {'validators': []},
        }
    
    def _get_owner_property_ids(self):
        """Get all property IDs belonging to the same owner as the selected property.

        When property_id is in the request data, find all properties owned by the
        same owner. Used for scoping uniqueness checks — a phone/email is only
        considered duplicate if it already exists on a tenant within the same
        owner's properties.
        Returns a list of property IDs, or None if no property scoping is possible.
        """
        request = self.context.get('request')
        if not request:
            return None

        property_id = request.data.get('property_id') if hasattr(request, 'data') else None
        if property_id:
            try:
                prop = Property.objects.select_related('owner').get(pk=property_id)
                if prop.owner:
                    return list(
                        Property.objects.filter(owner=prop.owner).values_list('id', flat=True)
                    )
            except (Property.DoesNotExist, ValueError):
                pass

        return None

    def validate_email(self, value):
        """Ensure email is unique per owner when provided. Email is optional."""
        if value is None or (isinstance(value, str) and not value.strip()):
            return None
        value = value.strip()
        if self.instance and self.instance.email == value:
            return value
        # Scope uniqueness to the property owner — same email can exist under different owners
        owner_prop_ids = self._get_owner_property_ids()
        qs = Tenant.objects.filter(email=value)
        if owner_prop_ids is not None:
            qs = qs.filter(last_property_id__in=owner_prop_ids)
        if qs.exists():
            raise serializers.ValidationError("A tenant with this email already exists.")
        return value

    def validate_phone(self, value):
        """Ensure phone is unique per owner. Phone is required."""
        if value is None or (isinstance(value, str) and not value.strip()):
            raise serializers.ValidationError("Phone number is required.")
        value = value.strip()
        if self.instance and self.instance.phone == value:
            return value
        # Scope uniqueness to the property owner — same phone can exist under different owners
        owner_prop_ids = self._get_owner_property_ids()
        qs = Tenant.objects.filter(phone=value)
        if owner_prop_ids is not None:
            qs = qs.filter(last_property_id__in=owner_prop_ids)
        if qs.exists():
            raise serializers.ValidationError("A tenant with this phone already exists.")
        return value


class OwnerSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Owner
        fields = ['user_id', 'full_name', 'email', 'phone']
        read_only_fields = ['user_id']


class PropertySerializer(serializers.ModelSerializer):
    # owner is optional at API level; model allows null for migration/backfill
    owner = serializers.PrimaryKeyRelatedField(queryset=Owner.objects.all(), required=False, allow_null=True)
    # accept `owner_user` (a Django user id) from clients that send the user id
    # instead of the Owner pk (Owner.pk == user.id, but frontend may send 'owner_user')
    owner_user = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    owner_detail = OwnerSerializer(source='owner', read_only=True)
    owners = serializers.SerializerMethodField(read_only=True)
    owners_detail = serializers.SerializerMethodField(read_only=True)
    managers = serializers.PrimaryKeyRelatedField(queryset=User.objects.all(), many=True, required=False)
    managers_detail = UserSerializer(source='managers', many=True, read_only=True)
    layouts = serializers.JSONField(required=False)

    def validate(self, data):
        # Ensure manager list doesn't include the owner user
        managers = data.get('managers', None)
        owner = data.get('owner', None) if 'owner' in data else (self.instance.owner if self.instance else None)
        if managers and owner:
            owner_user = owner.user if hasattr(owner, 'user') else None
            manager_user_ids = {getattr(m, 'id', m) for m in managers}
            if owner_user and owner_user.id in manager_user_ids:
                raise serializers.ValidationError({'managers': 'The owner cannot also be a manager for the same property.'})
        return data

    def create(self, validated_data):
        owner_user_id = validated_data.pop('owner_user', None)
        # admin UI may POST an `owners` array (e.g., owners: [10]) — accept that as owner id
        if not owner_user_id:
            try:
                owners_field = self.initial_data.get('owners') if hasattr(self, 'initial_data') else None
            except Exception:
                owners_field = None
            if owners_field:
                if isinstance(owners_field, (list, tuple)) and len(owners_field) > 0:
                    owner_user_id = owners_field[0]
                else:
                    owner_user_id = owners_field
        # coerce to int when possible
        try:
            if owner_user_id is not None:
                owner_user_id = int(owner_user_id)
        except Exception:
            logging.getLogger(__name__).warning('Could not coerce owner_user_id to int: %s', owner_user_id)
        if owner_user_id and not validated_data.get('owner'):
            owner_obj = None
            try:
                owner_obj = Owner.objects.filter(pk=owner_user_id).first()
            except Exception:
                owner_obj = None
            if not owner_obj:
                try:
                    owner_obj = Owner.objects.filter(user_id=owner_user_id).first()
                except Exception:
                    owner_obj = None
            if owner_obj:
                validated_data['owner'] = owner_obj
            else:
                # try to create an Owner record from the existing User if possible
                try:
                    user = User.objects.filter(pk=owner_user_id).first()
                    if user:
                        owner_obj = Owner.objects.create(user=user, full_name=getattr(user, 'get_full_name', lambda: '')() or user.username, email=user.email or '', phone='')
                        validated_data['owner'] = owner_obj
                        logging.getLogger(__name__).info('PropertySerializer.create: created Owner for user id=%s', owner_user_id)
                    else:
                        logging.getLogger(__name__).info('PropertySerializer.create: owner not found for id=%s (initial_data owners=%s)', owner_user_id, getattr(self, 'initial_data', None))
                except Exception:
                    logging.getLogger(__name__).exception('PropertySerializer.create: error creating Owner for user id=%s', owner_user_id)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        owner_user_id = validated_data.pop('owner_user', None)
        # accept admin `owners` array in initial_data as fallback
        if not owner_user_id:
            try:
                owners_field = self.initial_data.get('owners') if hasattr(self, 'initial_data') else None
            except Exception:
                owners_field = None
            if owners_field:
                if isinstance(owners_field, (list, tuple)) and len(owners_field) > 0:
                    owner_user_id = owners_field[0]
                else:
                    owner_user_id = owners_field
        # coerce to int when possible
        try:
            if owner_user_id is not None:
                owner_user_id = int(owner_user_id)
        except Exception:
            logging.getLogger(__name__).warning('Could not coerce owner_user_id to int: %s', owner_user_id)
        if owner_user_id and not validated_data.get('owner'):
            owner_obj = None
            try:
                owner_obj = Owner.objects.filter(pk=owner_user_id).first()
            except Exception:
                owner_obj = None
            if not owner_obj:
                try:
                    owner_obj = Owner.objects.filter(user_id=owner_user_id).first()
                except Exception:
                    owner_obj = None
            if owner_obj:
                validated_data['owner'] = owner_obj
            else:
                # try to create an Owner record from the existing User if possible
                try:
                    user = User.objects.filter(pk=owner_user_id).first()
                    if user:
                        owner_obj = Owner.objects.create(user=user, full_name=getattr(user, 'get_full_name', lambda: '')() or user.username, email=user.email or '', phone='')
                        validated_data['owner'] = owner_obj
                        logging.getLogger(__name__).info('PropertySerializer.update: created Owner for user id=%s', owner_user_id)
                    else:
                        logging.getLogger(__name__).info('PropertySerializer.update: owner not found for id=%s (initial_data owners=%s)', owner_user_id, getattr(self, 'initial_data', None))
                except Exception:
                    logging.getLogger(__name__).exception('PropertySerializer.update: error creating Owner for user id=%s', owner_user_id)
        return super().update(instance, validated_data)

    class Meta:
        model = Property
        fields = ['id', 'tenant', 'name', 'address', 'city', 'state', 'postal_code', 'floors', 'owner', 'owners', 'owners_detail', 'owner_user', 'owner_detail', 'managers', 'managers_detail', 'layouts', 'created_at', 'is_archived', 'archived_at']
        read_only_fields = ['id', 'created_at', 'is_archived', 'archived_at']

    def get_owners(self, obj):
        # return a list for compatibility with the admin UI which expects `owners` array
        if getattr(obj, 'owner', None):
            try:
                return [getattr(obj.owner, 'user_id', getattr(getattr(obj.owner, 'user', None), 'id', None))]
            except Exception:
                return []
        return []

    def get_owners_detail(self, obj):
        # return owner object in an array for frontend compatibility
        if getattr(obj, 'owner', None):
            try:
                ser = OwnerSerializer(obj.owner)
                return [ser.data]
            except Exception:
                return []
        return []


class UnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = Unit
        fields = [
            'unit_id', 'property', 'section', 'unit_no', 'room_no', 'status', 'floor', 'bedrooms', 'bathrooms',
            'square_feet', 'monthly_rent', 'occupied', 'occupant', 'created_at'
        ]
        read_only_fields = ['unit_id', 'created_at']


class SectionSerializer(serializers.ModelSerializer):
    section_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Section
        fields = ['section_id', 'name']
        read_only_fields = ['section_id']


class LeaseSerializer(serializers.ModelSerializer):
    lease_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Lease
        fields = [
            'lease_id', 'tenant', 'unit', 'move_in', 'move_out', 'preferred_payment_date',
            'rent_amount', 'deposit_amount', 'advance_amount', 'contract_url', 'status', 'created_at'
        ]
        read_only_fields = ['lease_id', 'created_at']


class ApplianceSerializer(serializers.ModelSerializer):
    appliance_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Appliance
        fields = ['appliance_id', 'tenant', 'name', 'surcharge_amount', 'notes', 'created_at']
        read_only_fields = ['appliance_id', 'created_at']


class NotificationSerializer(serializers.ModelSerializer):
    notification_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Notification
        fields = ['notification_id', 'tenant', 'lease', 'channel', 'message', 'scheduled_at', 'sent_at', 'status', 'created_at']
        read_only_fields = ['notification_id', 'created_at']


class PaymentSerializer(serializers.ModelSerializer):
    payment_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Payment
        fields = ['payment_id', 'lease', 'due_date', 'payment_date', 'amount', 'status', 'recorded_by', 'created_at']
        read_only_fields = ['payment_id', 'created_at']


class NotificationLogSerializer(serializers.ModelSerializer):
    log_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = NotificationLog
        fields = ['log_id', 'tenant', 'notification', 'logged_at']
        read_only_fields = ['log_id', 'logged_at']


class OtherOccupantSerializer(serializers.ModelSerializer):
    occupant_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = OtherOccupant
        fields = ['occupant_id', 'lease', 'full_name', 'relationship', 'id_photo_url', 'created_at']
        read_only_fields = ['occupant_id', 'created_at']


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = ['log_id', 'timestamp', 'severity', 'event', 'user', 'ip_address', 'details', 'user_ref']
        read_only_fields = ['log_id', 'timestamp']


class MessageLogSerializer(serializers.ModelSerializer):
    property_name = serializers.SerializerMethodField()
    sent_by_username = serializers.SerializerMethodField()

    class Meta:
        model = MessageLog
        fields = [
            'id', 'property', 'property_name', 'tenant_name', 'tenant_id',
            'recipient', 'channel', 'message_type', 'subject', 'message',
            'status', 'error_message', 'room_number', 'sent_by',
            'sent_by_username', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def get_property_name(self, obj):
        return obj.property.name if obj.property else ''

    def get_sent_by_username(self, obj):
        return obj.sent_by.username if obj.sent_by else 'System'


class AutomatedMessageSettingsSerializer(serializers.ModelSerializer):
    # Accept frontend field names (hour, minute, ampm) and convert to 24-hour format
    hour = serializers.IntegerField(write_only=True, required=False)
    minute = serializers.IntegerField(write_only=True, required=False)
    ampm = serializers.CharField(write_only=True, required=False)
    
    # Return formatted time for frontend
    formatted_time = serializers.SerializerMethodField()
    
    class Meta:
        model = AutomatedMessageSettings
        fields = [
            'id', 'property', 'enabled', 'pwa_notifications_enabled', 'sms_enabled',
            'email_enabled', 'email_copy_to_owner', 'owner_email', 'email_subject_template',
            'message_template', 'message_days',
            'send_hour', 'send_minute', 'hour', 'minute', 'ampm', 'formatted_time',
            'payment_email_enabled', 'tenant_payment_email_enabled',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']
    
    def get_formatted_time(self, obj):
        """Return time in 12-hour format for frontend."""
        hour = obj.send_hour
        minute = obj.send_minute
        ampm = 'AM'
        if hour >= 12:
            ampm = 'PM'
            if hour > 12:
                hour -= 12
        if hour == 0:
            hour = 12
        return {
            'hour': hour,
            'minute': minute,
            'ampm': ampm
        }
    
    def validate(self, data):
        # Convert 12-hour to 24-hour format if provided
        hour = data.pop('hour', None)
        minute = data.pop('minute', None)
        ampm = data.pop('ampm', None)
        
        if hour is not None and ampm is not None:
            # Convert to 24-hour format
            if ampm.upper() == 'PM' and hour != 12:
                hour += 12
            elif ampm.upper() == 'AM' and hour == 12:
                hour = 0
            data['send_hour'] = hour
        
        if minute is not None:
            data['send_minute'] = minute
        
        return data


class ScheduledAutomatedMessageSerializer(serializers.ModelSerializer):
    """Serializer for scheduled automated messages.

    Note: No tenant FK - tenant data comes from layouts JSON and is stored directly.
    """
    property_name = serializers.CharField(source='property.name', read_only=True)
    # Computed field showing send time in 12-hour format for display
    send_time_display = serializers.SerializerMethodField()

    class Meta:
        model = ScheduledAutomatedMessage
        fields = [
            'id', 'property', 'property_name', 'tenant_name', 'tenant_layout_id',
            'room_number', 'phone_number', 'tenant_email', 'message', 'send_at',
            'send_hour', 'send_minute', 'send_time_display',
            'days_before_due', 'due_date', 'status', 'sent_at', 'error_message',
            'sms_sent', 'email_sent', 'email_copy_sent', 'created_at'
        ]
        read_only_fields = ['id', 'created_at', 'send_time_display']

    def get_send_time_display(self, obj):
        """Return send time in 12-hour format (e.g., '9:00 AM')."""
        hour = obj.send_hour or 9
        minute = obj.send_minute or 0
        ampm = 'AM' if hour < 12 else 'PM'
        display_hour = hour if hour <= 12 else hour - 12
        if display_hour == 0:
            display_hour = 12
        return f"{display_hour}:{minute:02d} {ampm}"


class TenantMessageScheduleSerializer(serializers.ModelSerializer):
    """Serializer for per-tenant message schedule settings."""
    property_name = serializers.CharField(source='property.name', read_only=True)
    send_time_display = serializers.SerializerMethodField()
    # Accept 12-hour format input
    hour = serializers.IntegerField(write_only=True, required=False)
    minute = serializers.IntegerField(write_only=True, required=False)
    ampm = serializers.CharField(write_only=True, required=False)

    class Meta:
        model = TenantMessageSchedule
        fields = [
            'id', 'property', 'property_name', 'room_number', 'tenant_name',
            'message_days', 'send_hour', 'send_minute', 'send_time_display',
            'use_custom_schedule', 'created_at', 'updated_at',
            # Write-only for 12-hour input
            'hour', 'minute', 'ampm'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'send_time_display', 'property_name']

    def get_send_time_display(self, obj):
        """Return send time in 12-hour format (e.g., '9:00 AM')."""
        hour = obj.send_hour or 9
        minute = obj.send_minute or 0
        ampm = 'AM' if hour < 12 else 'PM'
        display_hour = hour if hour <= 12 else hour - 12
        if display_hour == 0:
            display_hour = 12
        return f"{display_hour}:{minute:02d} {ampm}"

    def validate(self, data):
        # Convert 12-hour to 24-hour format if provided
        hour = data.pop('hour', None)
        minute = data.pop('minute', None)
        ampm = data.pop('ampm', None)

        if hour is not None and ampm is not None:
            hour = int(hour)
            if ampm.upper() == 'PM' and hour != 12:
                hour += 12
            elif ampm.upper() == 'AM' and hour == 12:
                hour = 0
            data['send_hour'] = hour

        if minute is not None:
            data['send_minute'] = int(minute)

        return data


class TenantDocumentSerializer(serializers.ModelSerializer):
    """Serializer for tenant documents (ID photos, contracts, etc.)."""
    document_id = serializers.IntegerField(read_only=True)
    tenant_name = serializers.CharField(source='tenant.full_name', read_only=True)
    document_type_display = serializers.CharField(source='get_document_type_display', read_only=True)
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = TenantDocument
        fields = [
            'document_id', 'tenant', 'tenant_name', 'document_type', 'document_type_display',
            'file', 'file_url', 'original_filename', 'file_size', 'mime_type',
            'description', 'extracted_data', 'is_primary_id', 'created_at', 'created_by'
        ]
        read_only_fields = ['document_id', 'file_url', 'created_at', 'created_by', 'file_size', 'mime_type', 'original_filename']

    def get_file_url(self, obj):
        """Return the URL to access the file."""
        if obj.file:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.file.url)
            return obj.file.url
        return None

    def validate_file(self, value):
        """Validate file size and type."""
        max_size = getattr(settings, 'MAX_UPLOAD_SIZE', 10 * 1024 * 1024)  # 10MB default
        allowed_types = getattr(settings, 'ALLOWED_DOCUMENT_TYPES', [
            'application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'
        ])

        if value.size > max_size:
            raise serializers.ValidationError(
                f"File size ({value.size / 1024 / 1024:.1f}MB) exceeds maximum allowed size ({max_size / 1024 / 1024:.0f}MB)."
            )

        if value.content_type not in allowed_types:
            raise serializers.ValidationError(
                f"File type '{value.content_type}' is not allowed. Allowed types: {', '.join(allowed_types)}"
            )

        return value


class TenantDocumentUploadSerializer(serializers.Serializer):
    """Serializer for bulk document upload."""
    files = serializers.ListField(
        child=serializers.FileField(),
        allow_empty=False,
        help_text='List of files to upload'
    )
    document_type = serializers.ChoiceField(
        choices=TenantDocument.DOCUMENT_TYPE_CHOICES,
        default='other'
    )
    description = serializers.CharField(required=False, allow_blank=True, max_length=255)
    is_primary_id = serializers.BooleanField(required=False, default=False)

    def validate_files(self, value):
        """Validate all files in the list."""
        max_size = getattr(settings, 'MAX_UPLOAD_SIZE', 10 * 1024 * 1024)
        allowed_types = getattr(settings, 'ALLOWED_DOCUMENT_TYPES', [
            'application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'image/bmp', 'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ])

        for file in value:
            if file.size > max_size:
                raise serializers.ValidationError(
                    f"File '{file.name}' ({file.size / 1024 / 1024:.1f}MB) exceeds maximum allowed size ({max_size / 1024 / 1024:.0f}MB)."
                )
            if file.content_type not in allowed_types:
                raise serializers.ValidationError(
                    f"File '{file.name}' has type '{file.content_type}' which is not allowed."
                )

        return value





# Long-lived PWA Authentication Serializer
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from django.utils import timezone
from datetime import timedelta
from .models import UserSession, FailedLoginAttempt, SecurityAlert, AuditLog, TwoFactorCode, TrustedDevice
from django.contrib.auth import get_user_model

User = get_user_model()


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Custom token serializer that:
    1. Tracks login sessions
    2. Enforces rate limiting
    3. Detects IP changes
    4. Creates security alerts
    """
    # Accept email instead of username
    email = serializers.EmailField(write_only=True, required=False)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Make username field optional so clients may POST only email
        username_field = getattr(self, 'username_field', 'username')
        if username_field in self.fields:
            self.fields[username_field].required = False
        # Add optional fields for device tracking
        self.fields['device_name'] = serializers.CharField(required=False, allow_blank=True)
        self.fields['device_fingerprint'] = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        # Get request context
        request = self.context.get('request')
        ip_address = self.get_client_ip(request)
        user_agent = request.META.get('HTTP_USER_AGENT', '')

        # Handle email-based login
        email = attrs.get('email')
        if email:
            # Map email to username for authentication
            User = get_user_model()
            try:
                user_obj = User.objects.get(email=email)
                attrs['username'] = user_obj.username
            except User.DoesNotExist:
                from rest_framework.exceptions import AuthenticationFailed
                raise AuthenticationFailed('No account found with this email.')
        else:
            email = attrs.get('username')

        # Check for account lockout
        if self.is_locked_out(email, ip_address):
            lockout_until = self.get_lockout_time(email, ip_address)
            minutes_left = int((lockout_until - timezone.now()).total_seconds() / 60)
            raise serializers.ValidationError(
                f"Account locked due to too many failed attempts. "
                f"Use 'Forgot password?' to reset your password and unlock your account, "
                f"or try again in {max(1, minutes_left)} minutes."
            )

        # Attempt authentication
        try:
            data = super().validate(attrs)
        except Exception:
            # Record failed attempt
            self.record_failed_attempt(email, ip_address, user_agent)

            # Count recent attempts and tell user how many are left
            max_attempts = getattr(settings, 'FAILED_LOGIN_ATTEMPTS', 5)
            two_hours_ago = timezone.now() - timedelta(hours=2)
            recent_attempts = FailedLoginAttempt.objects.filter(
                email=email,
                ip_address=ip_address,
                attempted_at__gte=two_hours_ago
            ).count()
            remaining = max(0, max_attempts - recent_attempts)

            if remaining <= 0:
                lockout_hours = getattr(settings, 'FAILED_LOGIN_LOCKOUT_HOURS', 2)
                raise serializers.ValidationError(
                    f"Account locked due to too many failed attempts. "
                    f"Use 'Forgot password?' to reset your password and unlock your account, "
                    f"or try again in {int(lockout_hours * 60)} minutes."
                )
            raise serializers.ValidationError(
                f"Invalid email or password. {remaining} attempt{'s' if remaining != 1 else ''} remaining before account is locked."
            )

        # Authentication successful - clear failed attempts
        FailedLoginAttempt.objects.filter(
            email=email,
            ip_address=ip_address
        ).delete()

        # Get user and device info
        user = self.user
        device_name = attrs.get('device_name', '')
        device_fingerprint = attrs.get('device_fingerprint', '')

        # --- 2FA Check: require verification if device not trusted ---
        is_trusted = False
        if device_fingerprint:
            is_trusted = TrustedDevice.objects.filter(
                user=user,
                device_fingerprint=device_fingerprint,
                trusted_until__gt=timezone.now()
            ).exists()

        if not is_trusted:
            import random
            from django.core import signing

            # Generate 6-digit code
            code = f'{random.randint(0, 999999):06d}'

            # Save code (expires in 10 minutes)
            TwoFactorCode.objects.create(
                user=user,
                code=code,
                ip_address=ip_address,
                expires_at=timezone.now() + timedelta(minutes=10),
            )

            # Send code via email
            try:
                from .email_service import send_two_factor_email
                send_two_factor_email(user.email, code, expiry_minutes=10)
            except Exception:
                pass  # Code is saved, user can request resend if email fails

            # Create a temp token (signed, expires in 10 min)
            temp_token = signing.dumps({
                'user_id': user.pk,
                'email': user.email,
                'ip': ip_address,
            })

            # Mask email for display: j***n@email.com
            local, domain = user.email.split('@')
            if len(local) > 2:
                masked_email = f"{local[0]}{'*' * (len(local) - 2)}{local[-1]}@{domain}"
            else:
                masked_email = f"{'*' * len(local)}@{domain}"

            # Return 2FA required response (no tokens)
            return {
                'two_factor_required': True,
                'two_factor_email': masked_email,
                'temp_token': temp_token,
            }

        # Get JTI from refresh token
        refresh = RefreshToken(data['refresh'])
        jti = str(refresh['jti'])
        expires_at = timezone.now() + timedelta(days=30)  # Match REFRESH_TOKEN_LIFETIME

        # Check for IP change (existing sessions with different IP)
        self.check_ip_change(user, ip_address)

        # Create session record
        session = UserSession.objects.create(
            user=user,
            jti=jti,
            device_name=device_name,
            device_fingerprint=device_fingerprint,
            ip_address=ip_address,
            user_agent=user_agent,
            expires_at=expires_at,
            is_active=True
        )

        # Add session_id to both access and refresh tokens as custom claim
        from rest_framework_simplejwt.tokens import AccessToken
        access = AccessToken(data['access'])
        access['session_id'] = session.session_id
        refresh['session_id'] = session.session_id

        # Update the tokens in the response
        data['access'] = str(access)
        data['refresh'] = str(refresh)

        # Add session info to response
        data['session_id'] = session.session_id

        # Log successful login in AuditLog
        AuditLog.objects.create(
            event='User Login',
            user=user.email,
            user_ref=user,
            ip_address=ip_address,
            severity='info',
            details=f'Successful login from {ip_address} using {device_name or "Unknown device"}'
        )

        return data

    def get_client_ip(self, request):
        """Extract client IP address."""
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            return x_forwarded_for.split(',')[0].strip()
        return request.META.get('REMOTE_ADDR', '')

    def is_locked_out(self, email, ip_address):
        """Check if email/IP is currently locked out."""
        now = timezone.now()
        lockout = FailedLoginAttempt.objects.filter(
            email=email,
            ip_address=ip_address,
            is_locked_out=True,
            lockout_until__gt=now
        ).first()
        return lockout is not None

    def get_lockout_time(self, email, ip_address):
        """Get lockout expiration time."""
        lockout = FailedLoginAttempt.objects.filter(
            email=email,
            ip_address=ip_address,
            is_locked_out=True
        ).order_by('-lockout_until').first()
        return lockout.lockout_until if lockout else timezone.now()

    def record_failed_attempt(self, email, ip_address, user_agent):
        """Record failed login attempt and apply lockout if needed."""
        from django.conf import settings

        # Create failed attempt record
        FailedLoginAttempt.objects.create(
            email=email,
            ip_address=ip_address,
            user_agent=user_agent
        )

        # Count recent attempts (last 2 hours)
        two_hours_ago = timezone.now() - timedelta(hours=2)
        recent_attempts = FailedLoginAttempt.objects.filter(
            email=email,
            ip_address=ip_address,
            attempted_at__gte=two_hours_ago
        ).count()

        # Apply lockout if threshold exceeded
        max_attempts = getattr(settings, 'FAILED_LOGIN_ATTEMPTS', 5)
        if recent_attempts >= max_attempts:
            lockout_hours = getattr(settings, 'FAILED_LOGIN_LOCKOUT_HOURS', 2)
            lockout_until = timezone.now() + timedelta(hours=lockout_hours)

            FailedLoginAttempt.objects.create(
                email=email,
                ip_address=ip_address,
                user_agent=user_agent,
                is_locked_out=True,
                lockout_until=lockout_until
            )

            # Create security alert, audit log, and send lockout email
            try:
                user = User.objects.get(email=email)
                SecurityAlert.objects.create(
                    user=user,
                    alert_type='account_lockout',
                    severity='warning',
                    ip_address=ip_address,
                    description=f'Account locked after {recent_attempts} failed login attempts from {ip_address}',
                    metadata={'attempts': recent_attempts, 'lockout_until': lockout_until.isoformat()}
                )

                # Log in audit log
                AuditLog.objects.create(
                    event='Account Lockout',
                    user=email,
                    user_ref=user,
                    ip_address=ip_address,
                    severity='warning',
                    details=f'Account locked after {recent_attempts} failed login attempts from {ip_address}.'
                )

                # Send lockout notification email
                from .email_service import send_lockout_email
                lockout_minutes = int(lockout_hours * 60)
                success, error = send_lockout_email(email, recent_attempts, lockout_minutes)
                if not success:
                    import logging
                    logging.getLogger(__name__).warning('Failed to send lockout email to %s: %s', email, error)

            except User.DoesNotExist:
                pass

    def check_ip_change(self, user, current_ip):
        """Detect IP address changes and create security alerts."""
        # Get user's previous sessions
        previous_sessions = UserSession.objects.filter(
            user=user,
            is_active=True
        ).exclude(ip_address=current_ip).values_list('ip_address', flat=True).distinct()

        if previous_sessions.exists():
            # IP address changed - create alert
            previous_ips = list(previous_sessions)
            SecurityAlert.objects.create(
                user=user,
                alert_type='ip_change',
                severity='info',
                ip_address=current_ip,
                description=f'Login from new IP address: {current_ip}. Previous IPs: {", ".join(previous_ips)}',
                metadata={
                    'current_ip': current_ip,
                    'previous_ips': previous_ips
                }
            )



class CustomTokenRefreshSerializer(serializers.Serializer):
    """
    Custom token refresh serializer that preserves session_id claim.
    """
    refresh = serializers.CharField()

    def validate(self, attrs):
        from rest_framework_simplejwt.tokens import RefreshToken
        from rest_framework_simplejwt.exceptions import TokenError

        refresh = attrs.get('refresh')
        if not refresh:
            raise serializers.ValidationError('Refresh token is required')

        try:
            refresh_token = RefreshToken(refresh)

            # Get session_id from refresh token
            session_id = refresh_token.get('session_id')

            # Generate new access token
            access_token = refresh_token.access_token

            # Add session_id to new access token
            if session_id:
                access_token['session_id'] = session_id

            # If token rotation is enabled, create new refresh token
            from django.conf import settings
            simple_jwt_settings = getattr(settings, 'SIMPLE_JWT', {})

            if simple_jwt_settings.get('ROTATE_REFRESH_TOKENS', False):
                # Create new refresh token with same user
                from django.contrib.auth import get_user_model
                User = get_user_model()
                user = User.objects.get(id=refresh_token.payload['user_id'])
                new_refresh = RefreshToken.for_user(user)

                # Copy session_id to new refresh token
                if session_id:
                    new_refresh['session_id'] = session_id

                # Blacklist old refresh token if configured
                if simple_jwt_settings.get('BLACKLIST_AFTER_ROTATION', False):
                    try:
                        refresh_token.blacklist()
                    except AttributeError:
                        pass

                return {
                    'access': str(access_token),
                    'refresh': str(new_refresh)
                }

            return {
                'access': str(access_token),
                'refresh': refresh
            }

        except TokenError as e:
            raise serializers.ValidationError(str(e))
