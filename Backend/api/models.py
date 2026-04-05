from django.db import models
from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver


class Tenant(models.Model):
	# primary key named tenant_id per schema
	tenant_id = models.AutoField(primary_key=True)
	full_name = models.CharField(max_length=100)
	business_name = models.CharField(max_length=200, blank=True, help_text='Business name for commercial tenants')
	email = models.CharField(max_length=100, blank=True, null=True)
	phone = models.CharField(max_length=25)
	home_location = models.CharField(max_length=255, blank=True)
	work_place = models.CharField(max_length=255, blank=True)
	warning_flag = models.BooleanField(default=False)
	id_photo_url = models.CharField(max_length=255, blank=True)
	move_in = models.DateField(null=True, blank=True)
	move_out = models.DateField(null=True, blank=True, help_text='Date tenant moved out or was removed')
	preferred_payment_day = models.IntegerField(null=True, blank=True, help_text='Preferred day of month for payment (1-31)')
	is_active = models.BooleanField(default=True)
	# Fields to preserve data after tenant is removed from room
	last_room = models.CharField(max_length=50, blank=True, help_text='Last room number tenant occupied')
	last_property_id = models.IntegerField(null=True, blank=True, help_text='Last property ID tenant occupied')
	last_payment = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, help_text='Last monthly payment amount')
	notes = models.TextField(blank=True, help_text='Rich text notes about the tenant (violations, remarks, etc.)')
	# Blacklist status - if True, tenant should not be rented to again
	blacklisted = models.BooleanField(default=False, help_text='If True, do not rent to this tenant again')
	blacklist_reason = models.TextField(blank=True, help_text='Reason for blacklisting the tenant')
	# Rooms released from batch rent (single-room removal); list of formatted room display names e.g. ["M3", "5"]
	released_rooms = models.JSONField(default=list, blank=True, help_text='Rooms no longer rented by this tenant (batch single-room release)')
	# Receivables: tenant owes owner (e.g. repairs owner paid first). List of { id, amount, reason, date, received, received_at }
	receivables = models.JSONField(default=list, blank=True, help_text='Amounts tenant owes owner (reimbursements); each: id, amount, reason, date, received, received_at')
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)
	created_by = models.ForeignKey(
		settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
	)

	def __str__(self):
		return self.full_name


class Property(models.Model):
	tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='properties', null=True, blank=True)
	# single owner reference (nullable for migration compatibility)
	owner = models.ForeignKey('Owner', on_delete=models.CASCADE, related_name='properties', null=True, blank=True)
	# legacy managers relation remains
	managers = models.ManyToManyField(
		settings.AUTH_USER_MODEL, blank=True, related_name='managed_properties'
	)
	name = models.CharField(max_length=150)
	address = models.CharField(max_length=255)
	city = models.CharField(max_length=100, blank=True)
	state = models.CharField(max_length=100, blank=True)
	postal_code = models.CharField(max_length=20, blank=True)
	created_at = models.DateTimeField(auto_now_add=True)
	# Number of floors in the building (used for occupancy map display)
	floors = models.PositiveIntegerField(default=1, help_text='Number of floors in the building')
	# persisted occupancy/layouts stored as JSON: { variant: [boxes...] }
	layouts = models.JSONField(default=dict, blank=True)
	# Archiving: soft-delete buildings instead of permanently removing data
	is_archived = models.BooleanField(default=False, help_text='Whether this building is archived')
	archived_at = models.DateTimeField(null=True, blank=True, help_text='When the building was archived')
	archived_by = models.ForeignKey(
		settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
		null=True, blank=True, related_name='archived_properties',
		help_text='User who archived this building'
	)

	def __str__(self):
		return f"{self.name} ({self.address})" if self.address else self.name


class Section(models.Model):
	section_id = models.AutoField(primary_key=True)
	name = models.CharField(max_length=100)

	def __str__(self):
		return self.name


class Unit(models.Model):
	# Primary key named `unit_id` per schema requirement
	unit_id = models.AutoField(primary_key=True)
	property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name='units')
	# sections allow grouping units (e.g., building wing / block)
	section = models.ForeignKey(Section, on_delete=models.CASCADE, related_name='units', null=True, blank=True)
	unit_no = models.CharField(max_length=50)
	room_no = models.CharField(max_length=50, blank=True)
	status = models.CharField(max_length=50, default='available')
	floor = models.IntegerField(blank=True, null=True)
	bedrooms = models.IntegerField(default=1)
	bathrooms = models.DecimalField(max_digits=4, decimal_places=1, default=1.0)
	square_feet = models.IntegerField(blank=True, null=True)
	monthly_rent = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
	occupied = models.BooleanField(default=False)
	occupant = models.ForeignKey(Tenant, on_delete=models.SET_NULL, null=True, blank=True, related_name='occupied_units')
	created_at = models.DateTimeField(auto_now_add=True)

	class Meta:
		unique_together = (('property', 'unit_no'),)

	def __str__(self):
		return f"{self.property.name} - {self.unit_no}"


class Lease(models.Model):
	"""Lease / contract record linking a Tenant to a Unit."""
	lease_id = models.AutoField(primary_key=True)
	tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='leases')
	unit = models.ForeignKey(Unit, on_delete=models.CASCADE, related_name='leases')
	move_in = models.DateField()
	move_out = models.DateField(null=True, blank=True)
	preferred_payment_date = models.DateField()
	rent_amount = models.DecimalField(max_digits=10, decimal_places=2)
	deposit_amount = models.DecimalField(max_digits=10, decimal_places=2)
	advance_amount = models.DecimalField(max_digits=10, decimal_places=2)
	contract_url = models.CharField(max_length=255)
	status = models.CharField(max_length=50)
	created_at = models.DateTimeField(auto_now_add=True)

	def __str__(self):
		return f"Lease {self.lease_id} - {getattr(self.tenant, 'full_name', getattr(self.tenant, 'name', ''))} @ {self.unit.unit_no}"


class Appliance(models.Model):
	"""Track appliances used by tenants which may incur extra surcharges (e.g., high-consumption devices)."""
	appliance_id = models.AutoField(primary_key=True)
	tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='appliances', to_field='tenant_id')
	name = models.CharField(max_length=100)
	surcharge_amount = models.DecimalField(max_digits=10, decimal_places=2)
	notes = models.TextField(blank=True)
	created_at = models.DateTimeField(auto_now_add=True)

	def __str__(self):
		return f"{self.name} ({getattr(self.tenant, 'full_name', getattr(self.tenant, 'name', ''))})"


class Notification(models.Model):
	"""Scheduled or sent notifications related to tenants and leases."""
	notification_id = models.AutoField(primary_key=True)
	tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='notifications')
	lease = models.ForeignKey(Lease, on_delete=models.CASCADE, related_name='notifications')
	channel = models.CharField(max_length=50)
	message = models.TextField()
	scheduled_at = models.DateTimeField()
	sent_at = models.DateTimeField(null=True, blank=True)
	status = models.CharField(max_length=50)
	created_at = models.DateTimeField(auto_now_add=True)

	def __str__(self):
		return f"Notification {self.notification_id} to {getattr(self.tenant, 'full_name', getattr(self.tenant, 'name', ''))}"


class NotificationLog(models.Model):
	"""Log entries recording that a particular Notification was sent to a Tenant.

	Note: Django doesn't support composite primary keys; we use an AutoField `log_id`
	and store FK references to `tenant` and `notification`.
	"""
	log_id = models.AutoField(primary_key=True)
	tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='notification_logs')
	notification = models.ForeignKey(Notification, on_delete=models.CASCADE, related_name='logs')
	logged_at = models.DateTimeField(auto_now_add=True)

	def __str__(self):
		return f"NotificationLog {self.log_id} - Notification {getattr(self.notification, 'notification_id', '')} -> Tenant {getattr(self.tenant, 'tenant_id', '')}"


class OtherOccupant(models.Model):
	"""Represent other occupants in a leased unit alongside the main tenant."""
	occupant_id = models.AutoField(primary_key=True)
	lease = models.ForeignKey(Lease, on_delete=models.CASCADE, related_name='other_occupants')
	full_name = models.CharField(max_length=100)
	relationship = models.CharField(max_length=100)
	id_photo_url = models.CharField(max_length=255)
	created_at = models.DateTimeField(auto_now_add=True)

	def __str__(self):
		return f"OtherOccupant {self.occupant_id} - {self.full_name} ({self.relationship})"


class Payment(models.Model):
	"""Payments associated with a Lease."""
	payment_id = models.AutoField(primary_key=True)
	lease = models.ForeignKey(Lease, on_delete=models.CASCADE, related_name='payments')
	# due date for the payment
	due_date = models.DateField()
	# actual payment timestamp (optional until payment recorded)
	payment_date = models.DateTimeField(null=True, blank=True)
	amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
	status = models.CharField(max_length=50)
	# recorded_by references the system user (owner/manager) who confirmed the payment
	recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='recorded_payments')
	created_at = models.DateTimeField(auto_now_add=True)

	def __str__(self):
		return f"Payment {self.payment_id} - Lease {getattr(self.lease, 'lease_id', '')} - {self.amount} ({self.status})"


class UserProfile(models.Model):
	ROLE_CHOICES = (
		('admin', 'Admin'),
		('owner', 'Owner'),
		('manager', 'Manager'),
	)
	user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='userprofile')
	role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='owner')

	def __str__(self):
		return f"{self.user.username} ({self.role})"


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_user_profile(sender, instance, created, **kwargs):
	if created:
		# if superuser, make admin role
		role = 'admin' if instance.is_superuser else 'owner'
		UserProfile.objects.create(user=instance, role=role)


class UserSession(models.Model):
	"""Track active user sessions across multiple devices for long-lived PWA authentication."""
	session_id = models.AutoField(primary_key=True)
	user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='sessions')

	# Session identification
	jti = models.CharField(max_length=255, unique=True, help_text='JWT Token ID (jti claim)')
	device_name = models.CharField(max_length=200, blank=True, help_text='Browser/Device name')
	device_fingerprint = models.CharField(max_length=255, blank=True, help_text='Device signature')

	# Network info
	ip_address = models.GenericIPAddressField()
	user_agent = models.TextField(blank=True)

	# Session lifecycle
	created_at = models.DateTimeField(auto_now_add=True, help_text='Login time')
	last_activity = models.DateTimeField(auto_now=True, help_text='Last API request time')
	expires_at = models.DateTimeField(help_text='Refresh token expiration')

	# Status
	is_active = models.BooleanField(default=True)
	logout_at = models.DateTimeField(null=True, blank=True, help_text='Manual logout time')

	class Meta:
		db_table = 'user_sessions'
		ordering = ['-last_activity']
		indexes = [
			models.Index(fields=['user', 'is_active']),
			models.Index(fields=['jti']),
		]

	def __str__(self):
		return f"{self.user.email} - {self.device_name or 'Unknown'} ({self.ip_address})"


class FailedLoginAttempt(models.Model):
	"""Track failed login attempts for rate limiting and security monitoring."""
	attempt_id = models.AutoField(primary_key=True)

	# Attempt details
	email = models.EmailField(help_text='Email used in login attempt')
	ip_address = models.GenericIPAddressField()
	user_agent = models.TextField(blank=True)

	# Timestamp
	attempted_at = models.DateTimeField(auto_now_add=True)

	# Lockout info
	is_locked_out = models.BooleanField(default=False)
	lockout_until = models.DateTimeField(null=True, blank=True)

	class Meta:
		db_table = 'failed_login_attempts'
		ordering = ['-attempted_at']
		indexes = [
			models.Index(fields=['email', 'ip_address']),
			models.Index(fields=['lockout_until']),
		]

	def __str__(self):
		return f"{self.email} from {self.ip_address} at {self.attempted_at}"


class SecurityAlert(models.Model):
	"""Log security-related events for audit and monitoring."""
	alert_id = models.AutoField(primary_key=True)
	user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='security_alerts', null=True, blank=True)

	# Alert details
	alert_type = models.CharField(max_length=50, choices=[
		('ip_change', 'IP Address Change'),
		('new_device', 'New Device Login'),
		('failed_login', 'Failed Login Attempts'),
		('account_lockout', 'Account Lockout'),
		('suspicious_activity', 'Suspicious Activity'),
		('session_revoked', 'Session Revoked'),
	])
	severity = models.CharField(max_length=20, choices=[
		('info', 'Info'),
		('warning', 'Warning'),
		('critical', 'Critical'),
	], default='info')

	# Context
	ip_address = models.GenericIPAddressField(null=True, blank=True)
	description = models.TextField()
	metadata = models.JSONField(default=dict, blank=True, help_text='Additional context')

	# Timestamps
	created_at = models.DateTimeField(auto_now_add=True)

	# Status
	acknowledged = models.BooleanField(default=False)
	acknowledged_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='acknowledged_alerts')
	acknowledged_at = models.DateTimeField(null=True, blank=True)

	class Meta:
		db_table = 'security_alerts'
		ordering = ['-created_at']
		indexes = [
			models.Index(fields=['user', 'alert_type']),
			models.Index(fields=['severity', 'acknowledged']),
		]

	def __str__(self):
		return f"{self.alert_type} - {self.user.email if self.user else 'Unknown'} ({self.severity})"


class PasswordResetCode(models.Model):
	"""Store password reset verification codes."""
	reset_id = models.AutoField(primary_key=True)
	user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='password_resets')

	# Verification code
	code = models.CharField(max_length=6, help_text='6-digit verification code')

	# Tracking
	email = models.EmailField(help_text='Email address where code was sent')
	ip_address = models.GenericIPAddressField(null=True, blank=True, help_text='IP that requested reset')

	# Timestamps
	created_at = models.DateTimeField(auto_now_add=True)
	expires_at = models.DateTimeField(help_text='When code expires')

	# Status
	is_used = models.BooleanField(default=False, help_text='Whether code has been used')
	used_at = models.DateTimeField(null=True, blank=True, help_text='When code was used')

	class Meta:
		db_table = 'password_reset_codes'
		ordering = ['-created_at']
		indexes = [
			models.Index(fields=['user', 'code']),
			models.Index(fields=['expires_at', 'is_used']),
		]

	def __str__(self):
		return f"Reset code for {self.email} - {'Used' if self.is_used else 'Active'}"


class TwoFactorCode(models.Model):
	"""Store 2FA verification codes sent via email during login."""
	user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='two_factor_codes')
	code = models.CharField(max_length=6, help_text='6-digit verification code')
	ip_address = models.GenericIPAddressField(null=True, blank=True)
	created_at = models.DateTimeField(auto_now_add=True)
	expires_at = models.DateTimeField(help_text='When code expires')
	is_used = models.BooleanField(default=False)

	class Meta:
		db_table = 'two_factor_codes'
		ordering = ['-created_at']
		indexes = [
			models.Index(fields=['user', 'code']),
			models.Index(fields=['expires_at', 'is_used']),
		]

	def __str__(self):
		return f"2FA code for {self.user.email} - {'Used' if self.is_used else 'Active'}"


class TrustedDevice(models.Model):
	"""Track devices that have passed 2FA and are trusted for 30 days."""
	user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='trusted_devices')
	device_fingerprint = models.CharField(max_length=255)
	trusted_until = models.DateTimeField()
	created_at = models.DateTimeField(auto_now_add=True)

	class Meta:
		db_table = 'trusted_devices'
		indexes = [
			models.Index(fields=['user', 'device_fingerprint']),
			models.Index(fields=['trusted_until']),
		]

	def __str__(self):
		return f"Trusted device for {self.user.email} until {self.trusted_until}"


class Owner(models.Model):
	"""Owner records for properties.

	user: maps to the Django auth user (primary key equals auth user id).
	full_name, email, phone: required contact fields.
	"""
	user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, primary_key=True, related_name='owner')
	full_name = models.CharField(max_length=100)
	email = models.EmailField(max_length=100)
	phone = models.CharField(max_length=25)

	def __str__(self):
		return f"{self.full_name} <{self.email}>"


class AuditLog(models.Model):
	"""Audit log for tracking system activities and security events."""
	SEVERITY_CHOICES = (
		('info', 'Info'),
		('warning', 'Warning'),
		('critical', 'Critical'),
	)
	
	log_id = models.AutoField(primary_key=True)
	timestamp = models.DateTimeField(auto_now_add=True)
	severity = models.CharField(max_length=20, choices=SEVERITY_CHOICES, default='info')
	event = models.CharField(max_length=100)
	user = models.CharField(max_length=255, blank=True)
	ip_address = models.GenericIPAddressField(null=True, blank=True)
	details = models.TextField(blank=True)
	user_ref = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='audit_logs')
	property_ref = models.ForeignKey('Property', on_delete=models.SET_NULL, null=True, blank=True, related_name='audit_logs')
	
	class Meta:
		ordering = ['-timestamp']
	
	def __str__(self):
		return f"{self.timestamp} - {self.event} - {self.user}"


class ScheduledTestMessage(models.Model):
	"""Temporary model for testing automated messaging: send at a specific time today to a phone/email."""
	send_at = models.DateTimeField(help_text='When to send the test message')
	message = models.TextField()
	phone_number = models.CharField(max_length=25, blank=True, default='')
	email = models.EmailField(blank=True, default='', help_text='Email to receive the test message')
	sent = models.BooleanField(default=False)
	sent_at = models.DateTimeField(null=True, blank=True)
	created_at = models.DateTimeField(auto_now_add=True)
	created_by = models.ForeignKey(
		settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='scheduled_test_messages'
	)

	class Meta:
		ordering = ['send_at']

	def __str__(self):
		return f"Scheduled {self.send_at} -> {self.phone_number} (sent={self.sent})"


class PushSubscription(models.Model):
	"""Store browser push notification subscriptions for PWA."""
	user = models.ForeignKey(
		settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='push_subscriptions'
	)
	endpoint = models.TextField(unique=True, help_text='Push service endpoint URL')
	p256dh = models.TextField(help_text='Client public key for encryption')
	auth = models.TextField(help_text='Client auth secret')
	user_agent = models.CharField(max_length=500, blank=True, help_text='Browser user agent')
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)
	is_active = models.BooleanField(default=True)

	class Meta:
		ordering = ['-created_at']
		verbose_name = 'Push Subscription'
		verbose_name_plural = 'Push Subscriptions'

	def __str__(self):
		return f"Push sub for {self.user.username} ({self.endpoint[:50]}...)"


class AutomatedMessageSettings(models.Model):
	"""Settings for automated SMS/Email reminders for a property."""
	property = models.OneToOneField(Property, on_delete=models.CASCADE, related_name='automated_message_settings')
	enabled = models.BooleanField(default=True, help_text='Whether automated messaging is enabled')
	# PWA push notification settings for owners/managers
	pwa_notifications_enabled = models.BooleanField(default=True, help_text='Send PWA push notifications to owner/manager for due date reminders')
	sms_enabled = models.BooleanField(default=True, help_text='Send SMS to tenants for due date reminders')
	# Email notification settings
	email_enabled = models.BooleanField(default=True, help_text='Send email to tenants (who have email) for due date reminders')
	email_copy_to_owner = models.BooleanField(default=True, help_text='Send copy of tenant notification emails to owner/manager')
	owner_email = models.EmailField(blank=True, help_text='Owner/manager email to receive notification copies')
	email_subject_template = models.CharField(
		max_length=200,
		default='Rent Payment Reminder - Due in [Days Left] days',
		help_text='Email subject template with placeholders'
	)
	message_template = models.TextField(
		default='Good Day [Tenant Name]! This is a reminder that your rent payment of ₱[Payment Amount] is due in [Days Left] days. Please settle on or before [Due Date]. Thank you!',
		help_text='Message template with placeholders like [Tenant Name], [Payment Amount], etc.'
	)
	# Days before due date to send messages (stored as JSON array, e.g., [7, 3, 0])
	message_days = models.JSONField(
		default=list,
		help_text='List of days before due date to send reminders (e.g., [7, 3, 0] for 7 days, 3 days, and on due date)'
	)
	# Time to send messages (24-hour format)
	send_hour = models.PositiveIntegerField(default=8, help_text='Hour to send messages (0-23)')
	send_minute = models.PositiveIntegerField(default=0, help_text='Minute to send messages (0-59)')
	payment_email_enabled = models.BooleanField(default=True, help_text='Send email to owner when payment is recorded')
	tenant_payment_email_enabled = models.BooleanField(default=True, help_text='Send payment confirmation email to tenant')
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)
	created_by = models.ForeignKey(
		settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='created_message_settings'
	)

	class Meta:
		verbose_name = 'Automated Message Settings'
		verbose_name_plural = 'Automated Message Settings'

	def __str__(self):
		return f"Message settings for {self.property.name}"


class TenantMessageSchedule(models.Model):
	"""Per-tenant schedule settings for automated messages.

	Overrides property-level defaults when set. Allows each tenant to have
	their own reminder schedule and send time (for ML-based adaptive timing).

	Identified by property + room_number since tenant data comes from layouts JSON.
	"""
	property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name='tenant_schedules')
	room_number = models.CharField(max_length=50, help_text='Room number (e.g., upper4, middle2)')
	tenant_name = models.CharField(max_length=100, blank=True, help_text='Cached tenant name for display')

	# Schedule settings (override property defaults)
	message_days = models.JSONField(
		default=list,
		blank=True,
		help_text='Days before due date to send reminders (e.g., [2, 1, 0]). Empty = use property default.'
	)
	send_hour = models.PositiveIntegerField(default=9, help_text='Hour to send messages (0-23)')
	send_minute = models.PositiveIntegerField(default=0, help_text='Minute to send messages (0-59)')

	# Whether to use custom schedule or property defaults
	use_custom_schedule = models.BooleanField(default=False, help_text='If True, use this schedule instead of property defaults')

	# ML tracking: when the ML model last updated this schedule (used to throttle daily re-runs)
	ml_last_updated = models.DateTimeField(null=True, blank=True, help_text='When ML last updated this tenant schedule. Null = never updated or invalidated by new payment.')

	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		verbose_name = 'Tenant Message Schedule'
		verbose_name_plural = 'Tenant Message Schedules'
		unique_together = (('property', 'room_number'),)

	def __str__(self):
		return f"Schedule for {self.tenant_name or self.room_number} @ {self.property.name}"

	def get_send_time_display(self):
		"""Return send time in 12-hour format."""
		hour = self.send_hour
		ampm = 'AM' if hour < 12 else 'PM'
		display_hour = hour if hour <= 12 else hour - 12
		if display_hour == 0:
			display_hour = 12
		return f"{display_hour}:{self.send_minute:02d} {ampm}"


class ScheduledAutomatedMessage(models.Model):
	"""Scheduled automated messages for tenants based on their payment due dates.

	Note: Tenant data is stored directly (not as FK) because tenant info comes from
	Property.layouts JSON, not the api_tenant table. This avoids FK constraint issues.
	"""
	STATUS_CHOICES = (
		('pending', 'Pending'),
		('sent', 'Sent'),
		('failed', 'Failed'),
		('cancelled', 'Cancelled'),
	)

	property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name='scheduled_automated_messages')
	# Store tenant info directly from layouts JSON (no FK to avoid constraint issues)
	tenant_name = models.CharField(max_length=100, help_text='Tenant name from layout data')
	tenant_layout_id = models.BigIntegerField(help_text='Tenant ID from layout data')
	room_number = models.CharField(max_length=50, help_text='Room number for this message')
	phone_number = models.CharField(max_length=25)
	tenant_email = models.EmailField(blank=True, help_text='Tenant email for email notifications')
	message = models.TextField(help_text='The actual message with placeholders replaced')
	send_at = models.DateTimeField(help_text='When to send the message')
	# Per-message send time (allows adaptive timing per tenant)
	send_hour = models.PositiveIntegerField(default=9, help_text='Hour to send message (0-23), allows per-tenant timing')
	send_minute = models.PositiveIntegerField(default=0, help_text='Minute to send message (0-59)')
	days_before_due = models.IntegerField(help_text='Number of days before due date this message is for')
	due_date = models.DateField(help_text='The payment due date this message relates to')
	status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
	sent_at = models.DateTimeField(null=True, blank=True)
	# Track which notification channels were used
	sms_sent = models.BooleanField(default=False, help_text='Whether SMS was sent')
	email_sent = models.BooleanField(default=False, help_text='Whether email was sent to tenant')
	email_copy_sent = models.BooleanField(default=False, help_text='Whether email copy was sent to owner')
	error_message = models.TextField(blank=True, help_text='Error message if send failed')
	created_at = models.DateTimeField(auto_now_add=True)
	
	class Meta:
		ordering = ['send_at']
		# Unique per room + due_date + days_before (no tenant FK)
		unique_together = (('property', 'room_number', 'due_date', 'days_before_due'),)
		verbose_name = 'Scheduled Automated Message'
		verbose_name_plural = 'Scheduled Automated Messages'

	def __str__(self):
		return f"Message for {self.tenant_name} - {self.days_before_due} days before {self.due_date}"


def tenant_document_path(instance, filename):
	"""Generate file path for tenant documents: media/tenants/{tenant_id}/{doc_type}/{filename}"""
	import os
	import uuid
	ext = os.path.splitext(filename)[1].lower()
	# Use UUID to avoid filename conflicts
	unique_name = f"{uuid.uuid4().hex}{ext}"
	return f"tenants/{instance.tenant.tenant_id}/{instance.document_type}/{unique_name}"


class TenantDocument(models.Model):
	"""Store documents for tenants (ID photos, contracts, other documents).

	Supports both local filesystem storage (default) and S3 storage for production.
	File path: media/tenants/{tenant_id}/{doc_type}/{uuid}.{ext}
	"""
	DOCUMENT_TYPE_CHOICES = (
		('id_photo', 'ID Photo'),
		('contract', 'Contract'),
		('proof_of_billing', 'Proof of Billing'),
		('authorization', 'Authorization Letter'),
		('other', 'Other Document'),
	)

	document_id = models.AutoField(primary_key=True)
	tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='documents', to_field='tenant_id')
	document_type = models.CharField(max_length=50, choices=DOCUMENT_TYPE_CHOICES, default='other')
	file = models.FileField(upload_to=tenant_document_path)
	original_filename = models.CharField(max_length=255, help_text='Original filename when uploaded')
	file_size = models.PositiveIntegerField(help_text='File size in bytes')
	mime_type = models.CharField(max_length=100, help_text='MIME type of the file')
	description = models.CharField(max_length=255, blank=True, help_text='Optional description of the document')
	# For AI-extracted data (OCR results, etc.)
	extracted_data = models.JSONField(default=dict, blank=True, help_text='AI-extracted data from document (OCR, etc.)')
	is_primary_id = models.BooleanField(default=False, help_text='If True, this is the primary ID photo for the tenant')
	created_at = models.DateTimeField(auto_now_add=True)
	created_by = models.ForeignKey(
		settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='uploaded_documents'
	)

	class Meta:
		ordering = ['-created_at']
		verbose_name = 'Tenant Document'
		verbose_name_plural = 'Tenant Documents'

	def __str__(self):
		return f"{self.get_document_type_display()} - {self.original_filename} ({self.tenant.full_name})"

	def delete(self, *args, **kwargs):
		# Delete the file from storage when the model instance is deleted
		if self.file:
			self.file.delete(save=False)
		super().delete(*args, **kwargs)


class MessageLog(models.Model):
	"""Comprehensive log of every message sent through the system (SMS, email, push).

	Tracks manual messages, mass messages, automated reminders, payment confirmations,
	and any other outbound communication. Records delivery status so failures are visible.
	"""
	CHANNEL_CHOICES = (
		('sms', 'SMS'),
		('email', 'Email'),
		('push', 'Push Notification'),
	)
	STATUS_CHOICES = (
		('sent', 'Sent'),
		('failed', 'Failed'),
	)
	MESSAGE_TYPE_CHOICES = (
		('manual', 'Manual'),
		('mass', 'Mass Message'),
		('automated', 'Automated Reminder'),
		('payment_confirmation', 'Payment Confirmation'),
		('test', 'Test Message'),
	)

	property = models.ForeignKey(Property, on_delete=models.SET_NULL, null=True, blank=True, related_name='message_logs')
	tenant_name = models.CharField(max_length=100, blank=True, help_text='Recipient name')
	tenant_id = models.IntegerField(null=True, blank=True, help_text='Tenant ID if applicable')
	recipient = models.CharField(max_length=255, help_text='Phone number or email address')
	channel = models.CharField(max_length=10, choices=CHANNEL_CHOICES)
	message_type = models.CharField(max_length=25, choices=MESSAGE_TYPE_CHOICES, default='manual')
	subject = models.CharField(max_length=255, blank=True, help_text='Email subject if applicable')
	message = models.TextField(help_text='Message body or summary')
	status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='sent')
	error_message = models.TextField(blank=True, help_text='Error details if failed')
	room_number = models.CharField(max_length=50, blank=True)
	sent_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='sent_messages')
	created_at = models.DateTimeField(auto_now_add=True)

	class Meta:
		db_table = 'message_logs'
		ordering = ['-created_at']
		indexes = [
			models.Index(fields=['property', '-created_at']),
			models.Index(fields=['status']),
			models.Index(fields=['message_type']),
			models.Index(fields=['channel']),
		]

	def __str__(self):
		return f"[{self.status}] {self.channel} {self.message_type} to {self.recipient} at {self.created_at}"