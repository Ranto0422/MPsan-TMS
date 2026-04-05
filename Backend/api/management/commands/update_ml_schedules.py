"""
Django management command to update tenant notification schedules using ML predictions.

Runs at most once per tenant per day. Will also re-run if a new payment transaction
has been recorded since the last ML update (ml_last_updated is set to None on payment).

Usage:
    py manage.py update_ml_schedules --property-id 1
    py manage.py update_ml_schedules --all-properties
    py manage.py update_ml_schedules --property-id 1 --min-confidence 0.7
    py manage.py update_ml_schedules --property-id 1 --dry-run
    py manage.py update_ml_schedules --all-properties --force   # skip daily throttle
"""

from datetime import datetime

import numpy as np
import pandas as pd
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from api.models import Property, TenantMessageSchedule

import os


class Command(BaseCommand):
    help = 'Update tenant notification schedules using ML model predictions (max once per day per tenant)'

    def add_arguments(self, parser):
        parser.add_argument('--property-id', type=int, help='Specific property ID to update')
        parser.add_argument('--all-properties', action='store_true', help='Update all properties')
        parser.add_argument('--min-confidence', type=float, default=0.5,
                            help='Minimum confidence threshold (0.0-1.0, default: 0.5)')
        parser.add_argument('--dry-run', action='store_true',
                            help='Show predictions without updating database')
        parser.add_argument('--force', action='store_true',
                            help='Ignore the once-per-day throttle and update all tenants')

    def handle(self, *args, **options):
        try:
            from api.ml.train_notification_model import NotificationTimingModel

            model_path = os.path.join(settings.BASE_DIR, 'api', 'ml', 'models', 'latest_model.pkl')
            if not os.path.exists(model_path):
                raise CommandError(
                    'ML model not found. Train it first: cd Backend/api/ml && py run_all.py'
                )

            self.stdout.write(self.style.SUCCESS('Loading ML model...'))
            model = NotificationTimingModel.load_model(model_path)

            min_confidence = options['min_confidence']
            dry_run = options['dry_run']
            force = options['force']

            if dry_run:
                self.stdout.write(self.style.WARNING('DRY RUN MODE - No changes will be saved'))
            if force:
                self.stdout.write(self.style.WARNING('FORCE MODE - Daily throttle bypassed'))

            if options['all_properties']:
                properties = list(Property.objects.all())
            elif options['property_id']:
                properties = [Property.objects.get(pk=options['property_id'])]
            else:
                raise CommandError('Please specify --property-id or --all-properties')

            total_updated = 0
            total_skipped = 0
            total_throttled = 0

            for prop in properties:
                self.stdout.write(f'\n{"="*60}')
                self.stdout.write(f'Processing: {prop.name} (ID: {prop.id})')
                self.stdout.write('='*60)

                updated, skipped, throttled = self._update_property(
                    prop, model, min_confidence, dry_run, force
                )
                total_updated += updated
                total_skipped += skipped
                total_throttled += throttled

            self.stdout.write(f'\n{"="*60}')
            self.stdout.write('SUMMARY')
            self.stdout.write('='*60)
            self.stdout.write(f'Updated   : {self.style.SUCCESS(str(total_updated))}')
            self.stdout.write(f'Low conf  : {self.style.WARNING(str(total_skipped))}')
            self.stdout.write(f'Throttled : {total_throttled} (already updated today, no new payments)')
            self.stdout.write(f'Confidence: {min_confidence:.1%}')
            if dry_run:
                self.stdout.write(self.style.WARNING('DRY RUN - No changes were saved'))

        except ImportError as e:
            raise CommandError(f'ML model not available: {str(e)}')
        except Exception as e:
            raise CommandError(f'Error: {str(e)}')

    # ------------------------------------------------------------------
    # Per-property processing
    # ------------------------------------------------------------------

    def _update_property(self, prop, model, min_confidence, dry_run, force):
        updated_count = 0
        skipped_count = 0
        throttled_count = 0

        layouts = prop.layouts or {}
        today = timezone.now().date()

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

                room_number = self._get_room_display(room)
                tenant_layout_id = tenant_data.get('id') or tenant_data.get('tenant_id')
                tenant_name = tenant_data.get('full_name') or tenant_data.get('name') or 'Unknown'
                monthly_rent = float(room.get('payment') or tenant_data.get('payment_amount') or 10000)

                # ---- Daily throttle check ----
                if not force:
                    try:
                        existing = TenantMessageSchedule.objects.get(
                            property=prop, room_number=room_number
                        )
                        if existing.ml_last_updated:
                            last_date = existing.ml_last_updated.date()
                            if last_date >= today:
                                # Only skip if there are no new transactions since last update
                                latest_tx = self._get_latest_transaction_time(room)
                                if latest_tx is None or latest_tx <= existing.ml_last_updated:
                                    self.stdout.write(
                                        f'  ~ {room_number:12} | {tenant_name:20} | '
                                        f'Already updated today, no new payments — skipping'
                                    )
                                    throttled_count += 1
                                    continue
                    except TenantMessageSchedule.DoesNotExist:
                        pass  # No existing schedule — proceed

                # ---- Feature extraction from real transactions ----
                features = self._get_tenant_features(prop.id, room, room_number, tenant_layout_id, monthly_rent)

                # ---- ML prediction ----
                optimal_hours, confidence = model.predict_optimal_hour(features)
                optimal_hour = int(optimal_hours[0])
                confidence_score = float(confidence[0])

                if confidence_score >= min_confidence:
                    status_icon = '[OK]'
                    status_color = self.style.SUCCESS
                else:
                    status_icon = '[LO]'
                    status_color = self.style.WARNING

                self.stdout.write(
                    f'{status_icon} {room_number:12} | {tenant_name:20} | '
                    f'Hour: {optimal_hour:02d}:00 | Confidence: {status_color(f"{confidence_score:.1%}")}'
                )

                if confidence_score >= min_confidence:
                    if not dry_run:
                        now = timezone.now()
                        schedule, created = TenantMessageSchedule.objects.get_or_create(
                            property=prop,
                            room_number=room_number,
                            defaults={
                                'tenant_name': tenant_name,
                                'send_hour': optimal_hour,
                                'use_custom_schedule': True,
                                'ml_last_updated': now,
                            }
                        )
                        if not created:
                            schedule.send_hour = optimal_hour
                            schedule.use_custom_schedule = True
                            schedule.tenant_name = tenant_name
                            schedule.ml_last_updated = now
                            schedule.save()
                    updated_count += 1
                else:
                    skipped_count += 1

        return updated_count, skipped_count, throttled_count

    # ------------------------------------------------------------------
    # Feature extraction from real layout transactions
    # ------------------------------------------------------------------

    def _get_tenant_features(self, property_id, room, room_number, tenant_layout_id, monthly_rent):
        """
        Build ML feature vector for a tenant.
        Uses recency-weighted payment timestamps (>=3 records).
        Falls back to sensible defaults for new tenants with little history.
        """
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

    def _get_latest_transaction_time(self, room):
        """
        Return the most recent payment timestamp from a room's transactions, as an
        aware datetime, or None if no transactions exist.
        """
        latest = None
        for tx in room.get('transactions') or []:
            ts = tx.get('timestamp') or tx.get('paid_date')
            if not ts:
                continue
            try:
                dt = datetime.fromisoformat(str(ts))
                if dt.tzinfo is None:
                    dt = timezone.make_aware(dt)
                if latest is None or dt > latest:
                    latest = dt
            except (ValueError, TypeError):
                pass
        return latest

    def _get_room_display(self, room):
        """Generate room display name from room dict."""
        number = str(room.get('number', ''))
        section = room.get('section', '')
        room_type = room.get('type', 'room')

        if room_type == 'commercial':
            return f'C{number}'
        elif section:
            return f'{section}{number}'
        else:
            return number
