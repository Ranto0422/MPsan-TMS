from rest_framework import generics
from rest_framework.permissions import IsAuthenticated

from ..models import Unit, Owner, Lease, Appliance, Notification, Payment, NotificationLog, OtherOccupant
from ..models import Section
from ..serializers import (
    UnitSerializer, OwnerSerializer, SectionSerializer, LeaseSerializer,
    ApplianceSerializer, NotificationSerializer, PaymentSerializer,
    NotificationLogSerializer, OtherOccupantSerializer,
)
from ..permissions import IsAdminRole

class UnitListCreateView(generics.ListCreateAPIView):
    queryset = Unit.objects.all()
    serializer_class = UnitSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        serializer.save()


class UnitDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Unit.objects.all()
    serializer_class = UnitSerializer
    permission_classes = [IsAuthenticated]


class OwnerListCreateView(generics.ListCreateAPIView):
    queryset = Owner.objects.all()
    serializer_class = OwnerSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]

    def perform_create(self, serializer):
        serializer.save()


class OwnerDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Owner.objects.all()
    serializer_class = OwnerSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]


class SectionListCreateView(generics.ListCreateAPIView):
    queryset = Section.objects.all()
    serializer_class = SectionSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]

    def perform_create(self, serializer):
        serializer.save()


class SectionDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Section.objects.all()
    serializer_class = SectionSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]


class LeaseListCreateView(generics.ListCreateAPIView):
    queryset = Lease.objects.all()
    serializer_class = LeaseSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        serializer.save()


class LeaseDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Lease.objects.all()
    serializer_class = LeaseSerializer
    permission_classes = [IsAuthenticated]


class ApplianceListCreateView(generics.ListCreateAPIView):
    queryset = Appliance.objects.all()
    serializer_class = ApplianceSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        serializer.save()


class ApplianceDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Appliance.objects.all()
    serializer_class = ApplianceSerializer
    permission_classes = [IsAuthenticated]


class NotificationListCreateView(generics.ListCreateAPIView):
    queryset = Notification.objects.all()
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        serializer.save()


class NotificationDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Notification.objects.all()
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]


class PaymentListCreateView(generics.ListCreateAPIView):
    queryset = Payment.objects.all()
    serializer_class = PaymentSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        # recorded_by should be the authenticated user performing the record
        serializer.save(recorded_by=self.request.user)


class PaymentDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Payment.objects.all()
    serializer_class = PaymentSerializer
    permission_classes = [IsAuthenticated]


class NotificationLogListCreateView(generics.ListCreateAPIView):
    queryset = Notification.objects.none()
    serializer_class = NotificationLogSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        # allow filtering by tenant or notification via query params
        qs = NotificationLog.objects.all()
        tenant_id = self.request.query_params.get('tenant_id')
        notification_id = self.request.query_params.get('notification_id')
        if tenant_id:
            qs = qs.filter(tenant_id=tenant_id)
        if notification_id:
            qs = qs.filter(notification_id=notification_id)
        return qs.order_by('-logged_at')

    def perform_create(self, serializer):
        serializer.save()


class NotificationLogDetailView(generics.RetrieveDestroyAPIView):
    queryset = NotificationLog.objects.all()
    serializer_class = NotificationLogSerializer
    permission_classes = [IsAuthenticated]


class OtherOccupantListCreateView(generics.ListCreateAPIView):
    queryset = OtherOccupant.objects.all()
    serializer_class = OtherOccupantSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        lease_id = self.request.query_params.get('lease_id')
        if lease_id:
            qs = qs.filter(lease_id=lease_id)
        return qs.order_by('-created_at')

    def perform_create(self, serializer):
        serializer.save()


class OtherOccupantDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = OtherOccupant.objects.all()
    serializer_class = OtherOccupantSerializer
    permission_classes = [IsAuthenticated]
