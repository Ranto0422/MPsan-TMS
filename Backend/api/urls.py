from django.urls import path

from .views.auth import (
    UserCreateView, change_password_view,
    active_sessions_view, sessions_count_view, revoke_session_view, logout_all_sessions_view,
    security_alerts_view, security_alerts_count_view, acknowledge_alert_view,
    check_activity_view, lockout_status_view, unlock_account_view,
    combined_activity_log_view,
    request_password_reset_view, verify_reset_code_only_view, verify_reset_code_and_change_password_view,
)
from .views.users import (
    UserListView, UserDetailView, AdminUserListCreateView, CurrentUserView,
)
from .views.tenants import (
    TenantListCreateView, TenantDetailView, TenantTransferView, TenantRoomsView,
    TenantReceivablesView, TenantReceivableMarkReceivedView,
    FormerTenantSearchView, CheckDNRView, FormerTenantDetailsView, TenantReactivateView,
)
from .views.properties import (
    AdminPropertyListCreateView, PropertyListCreateView, PropertyDetailView,
    restore_property_view, PropertyLayoutView, PropertyRoomsView, PropertyRoomStatusView,
)
from .views.csv_operations import (
    TenantCSVImportView, TenantCSVTemplateView, TenantCSVExportView,
    PaymentCSVExportView, PaymentCSVImportView, PaymentCSVTemplateView,
)
from .views.payments import (
    TenantPaymentView, SendPaymentConfirmationView, TenantBatchPaymentView,
)
from .views.messaging import (
    SendMessageView, ScheduleTestMessageView, SMSGatewayDiagnosticView,
    ScheduledMessagesStatusView,
    AutomatedMessageSettingsView, ScheduledAutomatedMessagesView,
    GenerateAutomatedMessagesView, UpdateAutomatedMessageTimeView,
    TenantMessageScheduleView, TenantScheduleListView,
    MLPredictNotificationTimeView, MLBatchUpdateSchedulesView,
)
from .views.ml_forecast import OccupancyForecastView
from .views.documents import (
    TenantDocumentListCreateView, TenantDocumentUploadView, TenantDocumentDetailView,
)
from .views.push_notifications import (
    PushSubscriptionView, PushNotificationTestView,
    MessageLogListView, message_log_failed_count_view,
)
from .views.audit_logs import AuditLogListView, AuditLogDetailView
from .views.crud import (
    UnitListCreateView, UnitDetailView,
    OwnerListCreateView, OwnerDetailView,
    SectionListCreateView, SectionDetailView,
    LeaseListCreateView, LeaseDetailView,
    ApplianceListCreateView, ApplianceDetailView,
    NotificationListCreateView, NotificationDetailView,
    PaymentListCreateView, PaymentDetailView,
    NotificationLogListCreateView, NotificationLogDetailView,
    OtherOccupantListCreateView, OtherOccupantDetailView,
)

urlpatterns = [
    path('users/change-password/', change_password_view, name='change-password'),
    path('users/register/', UserCreateView.as_view(), name='user-register'),
    path('users/', UserListView.as_view(), name='user-list'),
    path('admin/users/', AdminUserListCreateView.as_view(), name='admin-user-list-create'),
    path('users/<int:pk>/', UserDetailView.as_view(), name='user-detail'),
    path('me/', CurrentUserView.as_view(), name='current-user'),
    path('admin/properties/', AdminPropertyListCreateView.as_view(), name='admin-property-list-create'),
    # Tenant management endpoints
    path('tenants/', TenantListCreateView.as_view(), name='tenant-list-create'),
    path('tenants/<int:pk>/', TenantDetailView.as_view(), name='tenant-detail'),
    path('tenants/<int:pk>/transfer/', TenantTransferView.as_view(), name='tenant-transfer'),
    path('tenants/<int:pk>/payment/', TenantPaymentView.as_view(), name='tenant-payment'),
    path('tenants/<int:pk>/batch-payment/', TenantBatchPaymentView.as_view(), name='tenant-batch-payment'),
    path('tenants/<int:pk>/send-payment-confirmation/', SendPaymentConfirmationView.as_view(), name='send-payment-confirmation'),
    path('tenants/<int:pk>/rooms/', TenantRoomsView.as_view(), name='tenant-rooms'),
    path('tenants/import-csv/', TenantCSVImportView.as_view(), name='tenant-csv-import'),
    path('tenants/import-csv-template/', TenantCSVTemplateView.as_view(), name='tenant-csv-template'),
    path('tenants/search-former/', FormerTenantSearchView.as_view(), name='former-tenant-search'),
    path('tenants/check-dnr/', CheckDNRView.as_view(), name='check-dnr'),
    path('tenants/<int:pk>/former-details/', FormerTenantDetailsView.as_view(), name='former-tenant-details'),
    path('tenants/<int:pk>/reactivate/', TenantReactivateView.as_view(), name='tenant-reactivate'),
    path('tenants/<int:pk>/receivables/', TenantReceivablesView.as_view(), name='tenant-receivables'),
    path('tenants/<int:pk>/receivables/<str:receivable_id>/received/', TenantReceivableMarkReceivedView.as_view(), name='tenant-receivable-mark-received'),
    # Tenant document uploads
    path('tenants/<int:pk>/documents/', TenantDocumentListCreateView.as_view(), name='tenant-document-list-create'),
    path('tenants/<int:pk>/documents/upload/', TenantDocumentUploadView.as_view(), name='tenant-document-upload'),
    path('tenants/<int:pk>/documents/<int:doc_id>/', TenantDocumentDetailView.as_view(), name='tenant-document-detail'),

    path('properties/', PropertyListCreateView.as_view(), name='property-list-create'),
    path('properties/<int:pk>/', PropertyDetailView.as_view(), name='property-detail'),
    path('properties/<int:pk>/restore/', restore_property_view, name='property-restore'),
    path('properties/<int:pk>/layouts/', PropertyLayoutView.as_view(), name='property-layouts'),
    path('properties/<int:pk>/export-tenants/', TenantCSVExportView.as_view(), name='export-tenants'),
    path('properties/<int:pk>/export-payments/', PaymentCSVExportView.as_view(), name='export-payments'),
    path('payments/import-csv/', PaymentCSVImportView.as_view(), name='payment-csv-import'),
    path('payments/import-csv-template/', PaymentCSVTemplateView.as_view(), name='payment-csv-template'),
    path('properties/<int:pk>/rooms/', PropertyRoomsView.as_view(), name='property-rooms'),
    path('properties/<int:pk>/rooms/<str:room_number>/status/', PropertyRoomStatusView.as_view(), name='property-room-status'),
    path('messages/send/', SendMessageView.as_view(), name='messages-send'),
    path('messages/schedule-test/', ScheduleTestMessageView.as_view(), name='messages-schedule-test'),
    path('messages/diagnostic/', SMSGatewayDiagnosticView.as_view(), name='messages-diagnostic'),
    path('messages/scheduled/', ScheduledMessagesStatusView.as_view(), name='messages-scheduled'),
    # Automated messaging endpoints
    path('messages/automated-settings/<int:property_id>/', AutomatedMessageSettingsView.as_view(), name='automated-message-settings'),
    path('messages/automated/', ScheduledAutomatedMessagesView.as_view(), name='scheduled-automated-messages'),
    path('messages/automated/<int:message_id>/time/', UpdateAutomatedMessageTimeView.as_view(), name='update-automated-message-time'),
    path('messages/generate-automated/', GenerateAutomatedMessagesView.as_view(), name='generate-automated-messages'),
    # Per-tenant message schedules
    path('messages/tenant-schedules/', TenantMessageScheduleView.as_view(), name='tenant-message-schedules'),
    path('messages/tenant-schedules/<int:property_id>/', TenantScheduleListView.as_view(), name='tenant-schedule-list'),
    # ML-powered notification timing
    path('ml/predict-notification-time/', MLPredictNotificationTimeView.as_view(), name='ml-predict-notification-time'),
    path('ml/batch-update-schedules/', MLBatchUpdateSchedulesView.as_view(), name='ml-batch-update-schedules'),
    # ML-powered occupancy forecast
    path('ml/occupancy-forecast/<int:property_id>/', OccupancyForecastView.as_view(), name='ml-occupancy-forecast'),
    # Push Notifications (PWA)
    path('push/subscribe/', PushSubscriptionView.as_view(), name='push-subscribe'),
    path('push/test/', PushNotificationTestView.as_view(), name='push-test'),

    path('units/', UnitListCreateView.as_view(), name='unit-list-create'),
    path('units/<int:pk>/', UnitDetailView.as_view(), name='unit-detail'),
    # Owners
    path('owners/', OwnerListCreateView.as_view(), name='owner-list-create'),
    path('owners/<int:pk>/', OwnerDetailView.as_view(), name='owner-detail'),
    # Sections
    path('sections/', SectionListCreateView.as_view(), name='section-list-create'),
    path('sections/<int:pk>/', SectionDetailView.as_view(), name='section-detail'),
    # Leases
    path('leases/', LeaseListCreateView.as_view(), name='lease-list-create'),
    path('leases/<int:pk>/', LeaseDetailView.as_view(), name='lease-detail'),
    # Appliances
    path('appliances/', ApplianceListCreateView.as_view(), name='appliance-list-create'),
    path('appliances/<int:pk>/', ApplianceDetailView.as_view(), name='appliance-detail'),
    # Notifications
    path('notifications/', NotificationListCreateView.as_view(), name='notification-list-create'),
    path('notifications/<int:pk>/', NotificationDetailView.as_view(), name='notification-detail'),
    # Payments
    path('payments/', PaymentListCreateView.as_view(), name='payment-list-create'),
    path('payments/<int:pk>/', PaymentDetailView.as_view(), name='payment-detail'),
    # Notification logs (tenant -> notification records)
    path('notification-logs/', NotificationLogListCreateView.as_view(), name='notification-log-list-create'),
    path('notification-logs/<int:pk>/', NotificationLogDetailView.as_view(), name='notification-log-detail'),
    # Other occupants (people living in the unit besides the main tenant)
    path('other-occupants/', OtherOccupantListCreateView.as_view(), name='other-occupant-list-create'),
    path('other-occupants/<int:pk>/', OtherOccupantDetailView.as_view(), name='other-occupant-detail'),
    # Audit logs
    path('audit-logs/', AuditLogListView.as_view(), name='audit-log-list'),
    path('audit-logs/<int:pk>/', AuditLogDetailView.as_view(), name='audit-log-detail'),

    # Session management & security (Long-lived PWA authentication)
    path('sessions/', active_sessions_view, name='active-sessions'),
    path('sessions/count/', sessions_count_view, name='sessions-count'),
    path('sessions/revoke/', revoke_session_view, name='revoke-session'),
    path('sessions/logout-all/', logout_all_sessions_view, name='logout-all-sessions'),
    path('security-alerts/', security_alerts_view, name='security-alerts'),
    path('security-alerts/count/', security_alerts_count_view, name='security-alerts-count'),
    path('security-alerts/acknowledge/', acknowledge_alert_view, name='acknowledge-alert'),
    path('check-activity/', check_activity_view, name='check-activity'),
    path('lockout/status/', lockout_status_view, name='lockout-status'),
    path('lockout/unlock/', unlock_account_view, name='unlock-account'),
    path('activity-log/combined/', combined_activity_log_view, name='combined-activity-log'),

    # Message logs
    path('message-logs/', MessageLogListView.as_view(), name='message-log-list'),
    path('message-logs/failed-count/', message_log_failed_count_view, name='message-log-failed-count'),

    # Password reset
    path('password-reset/request/', request_password_reset_view, name='password-reset-request'),
    path('password-reset/verify-code/', verify_reset_code_only_view, name='password-reset-verify-code'),
    path('password-reset/change-password/', verify_reset_code_and_change_password_view, name='password-reset-change-password'),
]
