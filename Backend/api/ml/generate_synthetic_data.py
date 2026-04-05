"""
Synthetic Data Generator for Adaptive Notification Timing ML Model

Generates realistic payment and notification data to train the ML model
that predicts optimal notification send times based on tenant behavior.
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import random
import json


class TenantBehaviorProfile:
    """Defines different tenant payment behavior patterns"""
    
    def __init__(self, profile_type):
        self.profile_type = profile_type
        self.set_behavior_params()
    
    def set_behavior_params(self):
        """Set behavior parameters based on profile type"""
        profiles = {
            'early_morning_person': {
                'preferred_hours': [6, 7, 8, 9],
                'hour_weights': [0.1, 0.3, 0.4, 0.2],
                'days_before_due_mean': 2.5,
                'days_before_due_std': 1.2,
                'response_delay_hours_mean': 8,
                'response_delay_hours_std': 4,
                'on_time_rate': 0.85,
                'preferred_days': [1, 2, 3, 4, 5],  # Weekdays
            },
            'afternoon_person': {
                'preferred_hours': [12, 13, 14, 15, 16],
                'hour_weights': [0.15, 0.25, 0.3, 0.2, 0.1],
                'days_before_due_mean': 1.0,
                'days_before_due_std': 1.5,
                'response_delay_hours_mean': 12,
                'response_delay_hours_std': 6,
                'on_time_rate': 0.75,
                'preferred_days': [1, 2, 3, 4, 5],
            },
            'evening_person': {
                'preferred_hours': [18, 19, 20, 21, 22],
                'hour_weights': [0.15, 0.25, 0.3, 0.2, 0.1],
                'days_before_due_mean': 0.5,
                'days_before_due_std': 2.0,
                'response_delay_hours_mean': 16,
                'response_delay_hours_std': 8,
                'on_time_rate': 0.65,
                'preferred_days': [0, 1, 2, 3, 4, 5, 6],  # All days
            },
            'late_night_person': {
                'preferred_hours': [22, 23, 0, 1],
                'hour_weights': [0.2, 0.3, 0.3, 0.2],
                'days_before_due_mean': -0.5,  # Often pays late
                'days_before_due_std': 2.5,
                'response_delay_hours_mean': 24,
                'response_delay_hours_std': 12,
                'on_time_rate': 0.50,
                'preferred_days': [5, 6, 0],  # Weekends and Monday
            },
            'weekend_payer': {
                'preferred_hours': [10, 11, 12, 13, 14, 15],
                'hour_weights': [0.1, 0.2, 0.25, 0.25, 0.15, 0.05],
                'days_before_due_mean': 1.5,
                'days_before_due_std': 1.8,
                'response_delay_hours_mean': 48,  # Waits for weekend
                'response_delay_hours_std': 24,
                'on_time_rate': 0.70,
                'preferred_days': [5, 6],  # Weekends only
            },
            'inconsistent_payer': {
                'preferred_hours': list(range(8, 22)),
                'hour_weights': None,  # Uniform distribution
                'days_before_due_mean': 0.0,
                'days_before_due_std': 3.5,
                'response_delay_hours_mean': 36,
                'response_delay_hours_std': 48,
                'on_time_rate': 0.55,
                'preferred_days': list(range(7)),  # Any day
            },
            'prompt_payer': {
                'preferred_hours': [9, 10, 11],
                'hour_weights': [0.3, 0.5, 0.2],
                'days_before_due_mean': 3.5,
                'days_before_due_std': 0.8,
                'response_delay_hours_mean': 4,
                'response_delay_hours_std': 2,
                'on_time_rate': 0.95,
                'preferred_days': [1, 2, 3, 4, 5],
            },
        }
        
        params = profiles.get(self.profile_type, profiles['inconsistent_payer'])
        for key, value in params.items():
            setattr(self, key, value)
    
    def generate_payment_hour(self):
        """Generate payment hour based on profile preferences"""
        if self.hour_weights:
            return np.random.choice(self.preferred_hours, p=self.hour_weights)
        else:
            return np.random.choice(self.preferred_hours)
    
    def generate_payment_minute(self):
        """Generate payment minute (0-59)"""
        # Cluster around common minutes (0, 15, 30, 45)
        clusters = [0, 15, 30, 45]
        base = np.random.choice(clusters, p=[0.4, 0.2, 0.2, 0.2])
        return max(0, min(59, int(np.random.normal(base, 5))))
    
    def generate_days_before_due(self):
        """Generate how many days before due date tenant pays"""
        days = np.random.normal(self.days_before_due_mean, self.days_before_due_std)
        return int(days)
    
    def calculate_response_delay(self, notification_hour, payment_hour):
        """Calculate realistic delay between notification and payment"""
        base_delay = np.random.normal(
            self.response_delay_hours_mean,
            self.response_delay_hours_std
        )
        
        # Adjust based on notification timing alignment with preferences
        hour_diff = abs(notification_hour - np.mean(self.preferred_hours))
        if hour_diff > 6:
            base_delay *= 1.5  # Takes longer if notification sent at non-preferred time
        
        return max(1, base_delay)  # At least 1 hour delay


class SyntheticDataGenerator:
    """Generate synthetic dataset for ML model training"""
    
    def __init__(self, n_tenants=100, n_months=12, seed=42):
        self.n_tenants = n_tenants
        self.n_months = n_months
        self.seed = seed
        np.random.seed(seed)
        random.seed(seed)
        
        # Profile distribution (realistic mix)
        self.profile_types = [
            'early_morning_person',
            'afternoon_person',
            'evening_person',
            'late_night_person',
            'weekend_payer',
            'inconsistent_payer',
            'prompt_payer',
        ]
        self.profile_weights = [0.15, 0.18, 0.20, 0.22, 0.10, 0.10, 0.05]
        
    def generate_tenant_profiles(self):
        """Generate tenant profiles with behavior patterns"""
        tenants = []
        for i in range(self.n_tenants):
            profile_type = np.random.choice(self.profile_types, p=self.profile_weights)
            profile = TenantBehaviorProfile(profile_type)
            
            tenants.append({
                'tenant_id': i + 1,
                'room_number': f"Room_{(i % 50) + 1}",
                'property_id': (i % 5) + 1,  # 5 properties
                'profile_type': profile_type,
                'profile': profile,
                'warning_flag': random.random() < 0.15,  # 15% have warnings
                'preferred_payment_day': random.randint(1, 28),
                'monthly_rent': round(random.uniform(5000, 15000), 2),
            })
        
        return tenants
    
    def generate_notification_schedule(self):
        """Generate different notification timing strategies to test"""
        strategies = [
            {'send_hour': 8, 'send_minute': 0, 'days_before': [7, 3, 0]},
            {'send_hour': 9, 'send_minute': 0, 'days_before': [5, 2, 0]},
            {'send_hour': 12, 'send_minute': 0, 'days_before': [7, 3, 1, 0]},
            {'send_hour': 18, 'send_minute': 0, 'days_before': [7, 3, 0]},
            {'send_hour': 20, 'send_minute': 0, 'days_before': [5, 1, 0]},
            {'send_hour': 10, 'send_minute': 30, 'days_before': [7, 3, 0]},
        ]
        return strategies
    
    def generate_dataset(self):
        """Generate complete synthetic dataset"""
        print("Generating tenant profiles...")
        tenants = self.generate_tenant_profiles()
        
        print("Generating notification strategies...")
        notification_strategies = self.generate_notification_schedule()
        
        print("Generating payment records...")
        records = []
        
        # Starting date for data generation
        start_date = datetime(2024, 1, 1)
        
        for tenant in tenants:
            profile = tenant['profile']
            
            # Each tenant has n_months of payment history
            for month in range(self.n_months):
                # Due date (e.g., 5th of each month)
                due_date = start_date + timedelta(days=30 * month + tenant['preferred_payment_day'])
                
                # Randomly assign notification strategy
                strategy = random.choice(notification_strategies)
                
                # Determine when tenant actually pays
                days_before_due = profile.generate_days_before_due()
                payment_date_day = due_date + timedelta(days=-days_before_due)
                
                # Generate payment time
                payment_hour = profile.generate_payment_hour()
                payment_minute = profile.generate_payment_minute()
                payment_datetime = payment_date_day.replace(
                    hour=payment_hour,
                    minute=payment_minute,
                    second=0
                )
                
                # Determine payment status
                is_on_time = payment_datetime <= due_date
                is_early = payment_datetime < due_date - timedelta(days=1)
                is_late = payment_datetime > due_date
                
                if random.random() < profile.on_time_rate:
                    if is_late:
                        # Force on-time if profile says usually on-time
                        payment_datetime = due_date - timedelta(hours=random.randint(2, 24))
                        payment_hour = payment_datetime.hour
                        payment_minute = payment_datetime.minute
                
                # Generate notifications sent for this payment cycle
                for days_before in strategy['days_before']:
                    notification_date = due_date - timedelta(days=days_before)
                    notification_datetime = notification_date.replace(
                        hour=strategy['send_hour'],
                        minute=strategy['send_minute'],
                        second=0
                    )
                    
                    # Only include notifications sent before payment
                    if notification_datetime < payment_datetime:
                        # Calculate time between notification and payment
                        time_diff = (payment_datetime - notification_datetime).total_seconds() / 3600  # hours
                        
                        # Was this notification effective? (led to payment within 48 hours)
                        notification_effective = time_diff <= 48
                        
                        record = {
                            # Tenant info
                            'tenant_id': tenant['tenant_id'],
                            'room_number': tenant['room_number'],
                            'property_id': tenant['property_id'],
                            'profile_type': tenant['profile_type'],
                            'warning_flag': tenant['warning_flag'],
                            'preferred_payment_day': tenant['preferred_payment_day'],
                            'monthly_rent': tenant['monthly_rent'],
                            
                            # Payment info
                            'due_date': due_date.strftime('%Y-%m-%d'),
                            'payment_date': payment_datetime.strftime('%Y-%m-%d'),
                            'payment_datetime': payment_datetime.strftime('%Y-%m-%d %H:%M:%S'),
                            'payment_hour': payment_hour,
                            'payment_minute': payment_minute,
                            'payment_day_of_week': payment_datetime.weekday(),
                            'payment_day_of_month': payment_datetime.day,
                            'days_from_due_date': (payment_datetime.date() - due_date.date()).days,
                            'payment_amount': tenant['monthly_rent'],
                            'is_on_time': is_on_time,
                            'is_early': is_early,
                            'is_late': is_late,
                            
                            # Notification info
                            'notification_datetime': notification_datetime.strftime('%Y-%m-%d %H:%M:%S'),
                            'notification_hour': strategy['send_hour'],
                            'notification_minute': strategy['send_minute'],
                            'notification_day_of_week': notification_datetime.weekday(),
                            'days_before_due': days_before,
                            
                            # Interaction features
                            'hours_notification_to_payment': round(time_diff, 2),
                            'notification_effective': notification_effective,
                            'notification_payment_same_day': notification_datetime.date() == payment_datetime.date(),
                            
                            # Temporal features
                            'month_of_year': due_date.month,
                            'is_weekend_payment': payment_datetime.weekday() >= 5,
                            'is_weekend_notification': notification_datetime.weekday() >= 5,
                            'quarter': (due_date.month - 1) // 3 + 1,
                        }
                        
                        records.append(record)
        
        df = pd.DataFrame(records)
        
        # Add aggregated features per tenant
        df = self._add_aggregated_features(df)
        
        print(f"\nGenerated {len(df)} records for {self.n_tenants} tenants over {self.n_months} months")
        print(f"Profile distribution:")
        print(df.groupby('profile_type')['tenant_id'].nunique())
        
        return df
    
    def _add_aggregated_features(self, df):
        """Add aggregated features based on historical behavior"""
        
        # Calculate tenant-level aggregations
        tenant_agg = df.groupby('tenant_id').agg({
            'payment_hour': ['mean', 'std'],
            'payment_day_of_week': 'mean',
            'days_from_due_date': ['mean', 'std'],
            'is_on_time': 'mean',
            'is_early': 'mean',
            'is_late': 'mean',
            'hours_notification_to_payment': ['mean', 'min', 'max'],
        }).reset_index()
        
        # Flatten column names
        tenant_agg.columns = ['_'.join(col).strip('_') for col in tenant_agg.columns.values]
        tenant_agg.rename(columns={'tenant_id': 'tenant_id'}, inplace=True)
        
        # Merge back to main dataframe
        df = df.merge(
            tenant_agg,
            on='tenant_id',
            how='left',
            suffixes=('', '_tenant_avg')
        )
        
        return df
    
    def generate_and_save(self, output_path='synthetic_notification_data.csv'):
        """Generate dataset and save to CSV"""
        df = self.generate_dataset()
        
        # Save to CSV
        df.to_csv(output_path, index=False)
        print(f"\nDataset saved to: {output_path}")
        
        # Print summary statistics
        print("\n=== DATASET SUMMARY ===")
        print(f"Total records: {len(df)}")
        print(f"Date range: {df['payment_date'].min()} to {df['payment_date'].max()}")
        print(f"\nPayment timing distribution:")
        print(f"  On-time rate: {df['is_on_time'].mean():.2%}")
        print(f"  Early payment rate: {df['is_early'].mean():.2%}")
        print(f"  Late payment rate: {df['is_late'].mean():.2%}")
        print(f"\nPayment hour distribution:")
        print(df['payment_hour'].value_counts().sort_index().head(10))
        print(f"\nNotification effectiveness:")
        print(f"  Effective notifications (led to payment within 48h): {df['notification_effective'].mean():.2%}")
        print(f"\nAverage hours from notification to payment: {df['hours_notification_to_payment'].mean():.1f}")
        
        return df


def main():
    """Main execution function"""
    print("=" * 60)
    print("ADAPTIVE NOTIFICATION TIMING - SYNTHETIC DATA GENERATOR")
    print("=" * 60)
    
    # Configure generation parameters
    generator = SyntheticDataGenerator(
        n_tenants=100,  # Number of unique tenants
        n_months=12,    # Months of history per tenant
        seed=42         # Random seed for reproducibility
    )
    
    # Generate and save dataset
    df = generator.generate_and_save('synthetic_notification_data.csv')
    
    print("\n" + "=" * 60)
    print("GENERATION COMPLETE!")
    print("=" * 60)
    print("\nYou can now use this dataset to train your ML model.")
    print("Features available for training:")
    print("  - Temporal: payment_hour, payment_day_of_week, month_of_year")
    print("  - Notification: notification_hour, days_before_due")
    print("  - Behavior: profile_type, tenant averages")
    print("  - Target: hours_notification_to_payment, notification_effective")
    
    return df


if __name__ == '__main__':
    df = main()
