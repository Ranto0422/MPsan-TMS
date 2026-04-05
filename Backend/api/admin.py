from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from .models import (
	Tenant,
	Property,
	Unit,
	Owner,
	Section,
	Lease,
	Appliance,
	Payment,
	Notification,
	NotificationLog,
	OtherOccupant,
	UserProfile,
	ScheduledTestMessage,
)

User = get_user_model()


@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
	list_display = ('tenant_id', 'full_name', 'email', 'phone', 'created_at')
	search_fields = ('full_name', 'email', 'phone')
	readonly_fields = ('tenant_id', 'created_at')
	fields = (
		'full_name',
		'email',
		'phone',
		'home_location',
		'work_place',
		'warning_flag',
		'id_photo_url',
		'created_by',
		'created_at',
	)
	autocomplete_fields = ('created_by',)


@admin.register(Property)
class PropertyAdmin(admin.ModelAdmin):
	list_display = ('id', 'name', 'owner_display', 'managers_list', 'address')
	search_fields = ('name', 'address', 'city', 'postal_code')
	readonly_fields = ('id',)
	fields = (
		'name',
		'address',
		'city',
		'state',
		'postal_code',
		'owner',
		'managers',
		'tenant',
		'layouts',
		'created_at',
	)
	filter_horizontal = ('managers',)
	# Use dropdown/select for owner to ensure the value is posted from the form
	# (remove 'owner' from autocomplete_fields so admin renders a select)
	autocomplete_fields = ('tenant',)

	def save_model(self, request, obj, form, change):
		# If owner wasn't set by the form widget but a user id was provided
		# (some admin widgets or custom frontends may post user id), try to
		# resolve and set the Owner instance so the property is associated.
		if not getattr(obj, 'owner', None):
			# check common POST keys that could carry owner information
			owner_user_id = None
			try:
				owner_user_id = request.POST.get('owner') or request.POST.get('owner_user') or request.POST.get('owner_user_id')
			except Exception:
				owner_user_id = None
			if owner_user_id:
				try:
					# Owner PK is typically the user's id (OneToOneField primary_key)
					owner_obj = Owner.objects.filter(pk=int(owner_user_id)).first()
					if not owner_obj:
						owner_obj = Owner.objects.filter(user_id=int(owner_user_id)).first()
					if owner_obj:
						obj.owner = owner_obj
				except Exception:
					pass
		return super().save_model(request, obj, form, change)

	def owner_display(self, obj):
		return str(obj.owner) if getattr(obj, 'owner', None) else ''
	owner_display.short_description = 'Owner'

	def managers_list(self, obj):
		return ", ".join([u.username for u in obj.managers.all()])
	managers_list.short_description = 'Managers'


@admin.register(Section)
class SectionAdmin(admin.ModelAdmin):
	list_display = ('section_id', 'name')
	search_fields = ('name',)
	readonly_fields = ('section_id',)
	fields = ('name',)


@admin.register(Unit)
class UnitAdmin(admin.ModelAdmin):
	list_display = ('unit_id', 'property', 'unit_no', 'room_no', 'status', 'occupied', 'monthly_rent')
	search_fields = ('unit_no', 'room_no')
	readonly_fields = ('unit_id', 'created_at')
	fields = (
		'property',
		'section',
		'unit_no',
		'room_no',
		'status',
		'floor',
		'bedrooms',
		'bathrooms',
		'square_feet',
		'monthly_rent',
		'occupied',
		'occupant',
		'created_at',
	)
	autocomplete_fields = ('property', 'section', 'occupant')


@admin.register(Lease)
class LeaseAdmin(admin.ModelAdmin):
	list_display = ('lease_id', 'tenant', 'unit', 'move_in', 'move_out', 'status', 'rent_amount')
	search_fields = ('lease_id', 'tenant__full_name')
	readonly_fields = ('lease_id', 'created_at')
	fields = (
		'tenant',
		'unit',
		'move_in',
		'move_out',
		'preferred_payment_date',
		'rent_amount',
		'deposit_amount',
		'advance_amount',
		'contract_url',
		'status',
		'created_at',
	)
	autocomplete_fields = ('tenant', 'unit')


@admin.register(Appliance)
class ApplianceAdmin(admin.ModelAdmin):
	list_display = ('appliance_id', 'tenant', 'name', 'surcharge_amount', 'created_at')
	readonly_fields = ('appliance_id', 'created_at')
	fields = ('tenant', 'name', 'surcharge_amount', 'notes', 'created_at')
	autocomplete_fields = ('tenant',)


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
	list_display = ('notification_id', 'tenant', 'lease', 'channel', 'status', 'scheduled_at', 'sent_at')
	search_fields = ('notification_id', 'channel', 'message')
	readonly_fields = ('notification_id', 'created_at')
	fields = ('tenant', 'lease', 'channel', 'message', 'scheduled_at', 'sent_at', 'status', 'created_at')
	autocomplete_fields = ('tenant', 'lease')


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
	list_display = ('payment_id', 'lease', 'due_date', 'payment_date', 'amount', 'status', 'recorded_by')
	readonly_fields = ('payment_id', 'created_at')
	fields = ('lease', 'due_date', 'payment_date', 'amount', 'status', 'recorded_by', 'created_at')
	autocomplete_fields = ('lease', 'recorded_by')


@admin.register(NotificationLog)
class NotificationLogAdmin(admin.ModelAdmin):
	list_display = ('log_id', 'notification', 'tenant', 'logged_at')
	readonly_fields = ('log_id', 'logged_at')
	fields = ('notification', 'tenant', 'logged_at')
	autocomplete_fields = ('notification', 'tenant')


@admin.register(OtherOccupant)
class OtherOccupantAdmin(admin.ModelAdmin):
	list_display = ('occupant_id', 'lease', 'full_name', 'relationship', 'created_at')
	readonly_fields = ('occupant_id', 'created_at')
	fields = ('lease', 'full_name', 'relationship', 'id_photo_url', 'created_at')
	autocomplete_fields = ('lease',)


# Expose Owner and UserProfile so admin can create accounts and owner records easily
@admin.register(Owner)
class OwnerAdmin(admin.ModelAdmin):
	list_display = ('user', 'full_name', 'email', 'phone')
	fields = ('user', 'full_name', 'email', 'phone')
	autocomplete_fields = ('user',)
	search_fields = ('full_name', 'email', 'phone', 'user__username')
	list_select_related = ('user',)


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
	list_display = ('user', 'role')
	fields = ('user', 'role')
	autocomplete_fields = ('user',)


# Integrate Owner/UserProfile into the Django User admin for convenience
from django.contrib.auth.models import User as DjangoUser
from django.contrib import admin as django_admin
from django.utils.translation import gettext_lazy as _


class OwnerInline(admin.StackedInline):
	model = Owner
	can_delete = False
	fk_name = 'user'
	verbose_name = 'Owner details'


class UserProfileInline(admin.StackedInline):
	model = UserProfile
	can_delete = False
	fk_name = 'user'


class CustomUserAdmin(DjangoUserAdmin):
	inlines = (UserProfileInline, OwnerInline)


@admin.register(ScheduledTestMessage)
class ScheduledTestMessageAdmin(admin.ModelAdmin):
	list_display = ('id', 'phone_number', 'send_at', 'sent', 'sent_at', 'created_at')
	list_filter = ('sent',)
	readonly_fields = ('created_at', 'sent_at')
	ordering = ('-send_at',)


# Re-register User admin
try:
	django_admin.site.unregister(DjangoUser)
except Exception:
	pass
django_admin.site.register(DjangoUser, CustomUserAdmin)
