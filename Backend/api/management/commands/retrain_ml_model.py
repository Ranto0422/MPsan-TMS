"""
Django management command to retrain the ML notification timing model
using real tenant payment data from Property.layouts, mixed with synthetic data.

As real data accumulates, the synthetic mix ratio shrinks until the model is
trained entirely on real payment history.

Usage:
    py manage.py retrain_ml_model
    py manage.py retrain_ml_model --min-real-tenants 3
    py manage.py retrain_ml_model --dry-run
"""

import os
from datetime import datetime

import numpy as np
import pandas as pd
from django.conf import settings
from django.core.management.base import BaseCommand

from api.models import Property


class Command(BaseCommand):
    help = 'Retrain the ML notification timing model using real payment data mixed with synthetic data'

    def add_arguments(self, parser):
        parser.add_argument(
            '--min-real-tenants', type=int, default=1,
            help='Minimum number of real tenants with enough history before retraining (default: 1)'
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Show what would be used for training without actually retraining'
        )

    def handle(self, *args, **options):
        min_real_tenants = options['min_real_tenants']
        dry_run = options['dry_run']

        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN — no model will be saved'))

        # ------------------------------------------------------------------
        # Step 1: Extract real training rows from Property.layouts
        # ------------------------------------------------------------------
        self.stdout.write('Extracting real payment data from properties...')
        real_rows = self._extract_real_data()
        n_real = len(real_rows)
        # Count unique tenants for the log message
        real_tenant_ids = set(r.get('tenant_id', 0) for r in real_rows)
        self.stdout.write(self.style.SUCCESS(
            f'  Real training rows: {n_real} (from {len(real_tenant_ids)} tenant(s))'
        ))

        if n_real < min_real_tenants:
            self.stdout.write(self.style.WARNING(
                f'Only {n_real} real row(s) found (need {min_real_tenants}). Skipping retrain.'
            ))
            return

        # ------------------------------------------------------------------
        # Step 2: Load synthetic data and determine mix ratio
        # ------------------------------------------------------------------
        synthetic_path = os.path.join(
            settings.BASE_DIR, 'api', 'ml', 'synthetic_notification_data.csv'
        )

        if n_real >= 500:
            mix_label = '100% real'
            df_train = pd.DataFrame(real_rows)
        elif n_real >= 200:
            mix_label = '85% real / 15% synthetic'
            df_train = self._mix(real_rows, synthetic_path, real_weight=0.85)
        elif n_real >= 50:
            mix_label = '60% real / 40% synthetic'
            df_train = self._mix(real_rows, synthetic_path, real_weight=0.60)
        else:
            mix_label = '30% real / 70% synthetic'
            df_train = self._mix(real_rows, synthetic_path, real_weight=0.30)

        self.stdout.write(f'  Mix strategy: {mix_label}')
        self.stdout.write(f'  Total training rows: {len(df_train)}')

        if dry_run:
            self.stdout.write(self.style.SUCCESS('Dry run complete — no changes made.'))
            return

        # ------------------------------------------------------------------
        # Step 3: Retrain
        # ------------------------------------------------------------------
        self.stdout.write('\nRetraining model...')
        try:
            from api.ml.train_notification_model import NotificationTimingModel

            model = NotificationTimingModel()
            metadata = model.train(df_train, target_col='payment_hour')

            model_dir = os.path.join(settings.BASE_DIR, 'api', 'ml', 'models')
            model.save_model(model_dir)

            mae = metadata['performance_metrics']['test_mae']
            r2 = metadata['performance_metrics']['test_r2']
            self.stdout.write(self.style.SUCCESS(
                f'\nModel retrained successfully!'
                f'\n  Samples used:  {len(df_train)}'
                f'\n  Real rows:     {n_real}'
                f'\n  Mix:           {mix_label}'
                f'\n  Test MAE:      {mae:.2f} hours'
                f'\n  Test R²:       {r2:.4f}'
            ))
        except Exception as e:
            self.stderr.write(self.style.ERROR(f'Retrain failed: {e}'))
            raise

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _extract_real_data(self):
        """
        Build one training row PER TRANSACTION from real payment history.
        Each row uses the actual transaction's payment_hour as the target,
        with tenant-level aggregated stats as features (matching synthetic
        data format).  Requires >= 3 rent transactions per tenant.
        """
        import calendar
        from datetime import date as date_cls

        rows = []

        for prop in Property.objects.all():
            layouts = prop.layouts or {}
            if not isinstance(layouts, dict):
                continue

            for variant_name, rooms in layouts.items():
                if not isinstance(rooms, list):
                    continue

                for room in rooms:
                    if not isinstance(room, dict):
                        continue
                    if room.get('status') != 'occupied':
                        continue

                    tenant_data = room.get('tenant') or {}
                    if not tenant_data:
                        continue

                    room_number = str(room.get('number', ''))
                    section = room.get('section', '')
                    room_display = f'{section}{room_number}' if section else room_number
                    monthly_rent = float(
                        room.get('payment') or tenant_data.get('payment_amount') or 10000
                    )
                    preferred_day = int(
                        room.get('preferred_payment_day') or
                        tenant_data.get('preferred_payment_day') or 5
                    )

                    # Only look at rent transactions
                    transactions = [
                        tx for tx in (room.get('transactions') or [])
                        if tx.get('payment_type') in ('rent', None, '') and
                        (tx.get('timestamp') or tx.get('paid_date'))
                    ]

                    if len(transactions) < 3:
                        continue

                    # ----- First pass: parse all transactions for aggregates -----
                    parsed_txs = []  # list of (dt, is_late, days_from_due)
                    for tx in transactions:
                        ts = tx.get('timestamp') or tx.get('paid_date')
                        try:
                            dt = datetime.fromisoformat(str(ts))
                        except (ValueError, TypeError):
                            continue

                        is_late = 1 if tx.get('is_late') else 0

                        days_from_due = 0.0
                        paid_date_str = tx.get('date') or str(ts)[:10]
                        try:
                            paid_date = datetime.fromisoformat(paid_date_str).date()
                            last_day = calendar.monthrange(paid_date.year, paid_date.month)[1]
                            due_day = min(preferred_day, last_day)
                            due_date = date_cls(paid_date.year, paid_date.month, due_day)
                            days_from_due = float((due_date - paid_date).days)
                        except Exception:
                            pass

                        parsed_txs.append((dt, is_late, days_from_due))

                    if len(parsed_txs) < 3:
                        continue

                    # ----- Compute tenant-level aggregates (recency-weighted) -----
                    # Sort newest first, apply exponential decay
                    parsed_txs.sort(key=lambda x: x[0], reverse=True)
                    decay = 0.9
                    weights = np.array([decay ** i for i in range(len(parsed_txs))])

                    all_hours = np.array([dt.hour for dt, _, _ in parsed_txs])
                    all_weekdays = np.array([dt.weekday() for dt, _, _ in parsed_txs])
                    all_late = np.array([late for _, late, _ in parsed_txs], dtype=float)
                    all_days_from_due = np.array([d for _, _, d in parsed_txs])

                    payment_hour_mean = float(np.average(all_hours, weights=weights))
                    payment_hour_std = float(np.sqrt(np.average((all_hours - payment_hour_mean) ** 2, weights=weights)))
                    payment_day_mean = float(np.average(all_weekdays, weights=weights))
                    is_late_mean = float(np.average(all_late, weights=weights))
                    is_on_time_mean = 1.0 - is_late_mean
                    days_from_due_mean = float(np.average(all_days_from_due, weights=weights))
                    days_from_due_std = float(np.sqrt(np.average((all_days_from_due - days_from_due_mean) ** 2, weights=weights))) if len(all_days_from_due) > 1 else 1.0

                    tenant_id = tenant_data.get('tenant_id') or tenant_data.get('id', 0)

                    # ----- Second pass: one training row per transaction -----
                    for dt, is_late, days_from_due in parsed_txs:
                        payment_hour = dt.hour
                        # Estimate a notification hour (2h before payment)
                        notif_hour = max(0, payment_hour - 2)
                        hours_to_payment = max(1.0, float(payment_hour - notif_hour))

                        rows.append({
                            # Target
                            'payment_hour': payment_hour,
                            # Per-transaction features
                            'payment_day_of_week': dt.weekday(),
                            'days_from_due_date': days_from_due,
                            'is_on_time': 1 - is_late,
                            'is_early': 1 if days_from_due > 1 else 0,
                            'is_late': is_late,
                            'notification_hour': notif_hour,
                            'hours_notification_to_payment': hours_to_payment,
                            'days_before_due': max(0, int(days_from_due)),
                            'month_of_year': dt.month,
                            'quarter': (dt.month - 1) // 3 + 1,
                            # Tenant-level aggregated features
                            'tenant_id': tenant_id,
                            'room_number': room_display,
                            'property_id': prop.id,
                            'profile_type': 'real',
                            'profile_type_encoded': 0,
                            'payment_hour_mean': payment_hour_mean,
                            'payment_hour_std': payment_hour_std,
                            'payment_day_of_week_mean': payment_day_mean,
                            'days_from_due_date_mean': days_from_due_mean,
                            'days_from_due_date_std': days_from_due_std,
                            'is_on_time_mean': is_on_time_mean,
                            'is_early_mean': max(0.0, is_on_time_mean - 0.1),
                            'is_late_mean': is_late_mean,
                            'hours_notification_to_payment_mean': 24.0,
                            # Room / tenant context
                            'preferred_payment_day': preferred_day,
                            'warning_flag': False,
                            'monthly_rent': monthly_rent,
                        })

        return rows

    def _mix(self, real_rows, synthetic_path, real_weight):
        """Mix real rows with synthetic data at the given real_weight ratio."""
        df_real = pd.DataFrame(real_rows)

        if not os.path.exists(synthetic_path):
            self.stdout.write(self.style.WARNING(
                f'Synthetic data not found at {synthetic_path} — using real data only'
            ))
            return df_real

        df_syn = pd.read_csv(synthetic_path)

        # How many synthetic rows to sample to achieve the desired ratio
        n_real = len(df_real)
        if real_weight >= 1.0:
            return df_real

        # n_real / total = real_weight  →  total = n_real / real_weight
        total_target = int(n_real / real_weight)
        n_syn = total_target - n_real
        n_syn = min(n_syn, len(df_syn))

        df_syn_sample = df_syn.sample(n=n_syn, random_state=42) if n_syn > 0 else df_syn.iloc[0:0]

        # Align columns — keep only columns that exist in both
        common_cols = list(set(df_real.columns) & set(df_syn_sample.columns))
        return pd.concat(
            [df_real[common_cols], df_syn_sample[common_cols]],
            ignore_index=True
        )
