"""
Django Integration Examples for Adaptive Notification Timing ML Model

This module shows how to integrate the ML model with the Django application
to predict optimal notification send times for tenants.
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from django.db.models import Avg, StdDev, Count, Q
from django.utils import timezone

# Import your models
# from api.models import (
#     Property, ScheduledAutomatedMessage, TenantMessageSchedule
# )

from api.ml.train_notification_model import NotificationTimingModel


class TenantBehaviorAnalyzer:
    """
    Analyzes tenant payment behavior from database and prepares features for ML model
    """
    
    def __init__(self):
        self.model = None
    
    def load_model(self, model_path='api/ml/models/latest_model.pkl'):
        """Load the trained ML model"""
        self.model = NotificationTimingModel.load_model(model_path)
        return self.model
    
    def extract_tenant_features(self, property_id, room_number, tenant_layout_id):
        """
        Extract features for a specific tenant from the database
        
        Args:
            property_id: Property ID
            room_number: Room number
            tenant_layout_id: Tenant ID from layouts JSON
        
        Returns:
            DataFrame with tenant features ready for prediction
        """
        from api.models import ScheduledAutomatedMessage, Property
        
        # Get all historical scheduled messages for this tenant
        messages = ScheduledAutomatedMessage.objects.filter(
            property_id=property_id,
            room_number=room_number,
            tenant_layout_id=tenant_layout_id,
            sent_at__isnull=False  # Only sent messages
        ).order_by('sent_at')
        
        if messages.count() < 3:
            # Not enough history, return default features
            return self._get_default_features(property_id, room_number)
        
        # Extract payment patterns from message data
        payment_data = []
        
        for msg in messages:
            # Infer payment time from message sent_at and due_date
            # This is an approximation since we don't track exact payment times
            # In real implementation, you'd track payment timestamps
            
            # Assume payment happened on average X hours after last notification
            # For now, we'll use heuristics
            estimated_payment_time = msg.sent_at + timedelta(hours=24)
            
            payment_data.append({
                'payment_hour': estimated_payment_time.hour,
                'payment_minute': estimated_payment_time.minute,
                'payment_day_of_week': estimated_payment_time.weekday(),
                'payment_day_of_month': estimated_payment_time.day,
                'notification_hour': msg.send_hour,
                'days_before_due': msg.days_before_due,
                'due_date': msg.due_date,
                'sent_at': msg.sent_at,
            })
        
        if not payment_data:
            return self._get_default_features(property_id, room_number)
        
        # Calculate aggregated features
        df = pd.DataFrame(payment_data)
        
        features = {
            'tenant_id': tenant_layout_id,
            'room_number': room_number,
            'property_id': property_id,
            'profile_type': 'unknown',  # Will be encoded
            'profile_type_encoded': 0,
            
            # Aggregated payment behavior
            'payment_hour_mean': df['payment_hour'].mean(),
            'payment_hour_std': df['payment_hour'].std() if len(df) > 1 else 0,
            'payment_day_of_week_mean': df['payment_day_of_week'].mean(),
            
            # Calculate days from due date (estimated)
            'days_from_due_date_mean': 0,  # Would need actual payment dates
            'days_from_due_date_std': 0,
            
            # Payment reliability (based on message frequency)
            'is_on_time_mean': 0.75,  # Default assumption
            'is_early_mean': 0.25,
            'is_late_mean': 0.0,
            
            # Notification response patterns
            'hours_notification_to_payment_mean': 24,  # Default 24h response
            
            # Current context
            'days_before_due': 3,  # Default
            'preferred_payment_day': 5,  # Default
            'warning_flag': False,
            'monthly_rent': 10000,  # Default
            
            # Temporal
            'month_of_year': datetime.now().month,
            'quarter': (datetime.now().month - 1) // 3 + 1,
        }
        
        return pd.DataFrame([features])
    
    def extract_features_from_payment_data(self, property_id, room_number):
        """
        Alternative: Extract features if you add Payment tracking with timestamps
        
        This is the IDEAL implementation once you track actual payment times
        """
        # This would query a Payment model with actual payment timestamps
        # For now, this is a template for future implementation
        
        # Example query (when Payment model has payment_datetime field):
        # payments = Payment.objects.filter(
        #     lease__unit__property_id=property_id,
        #     lease__unit__room_no=room_number,
        #     payment_date__isnull=False
        # ).select_related('lease__unit')
        
        # Extract payment times and calculate features
        # return calculated_features
        
        pass
    
    def _get_default_features(self, property_id, room_number):
        """Get default features for tenants without history"""
        return pd.DataFrame([{
            'tenant_id': 0,
            'room_number': room_number,
            'property_id': property_id,
            'profile_type': 'unknown',
            'profile_type_encoded': 0,
            'payment_hour_mean': 12.0,  # Default to noon
            'payment_hour_std': 4.0,
            'payment_day_of_week_mean': 2.0,  # Default to Wednesday
            'days_from_due_date_mean': 0.0,
            'days_from_due_date_std': 1.0,
            'is_on_time_mean': 0.7,
            'is_early_mean': 0.2,
            'is_late_mean': 0.1,
            'hours_notification_to_payment_mean': 24.0,
            'days_before_due': 3,
            'preferred_payment_day': 5,
            'warning_flag': False,
            'monthly_rent': 10000,
            'month_of_year': datetime.now().month,
            'quarter': (datetime.now().month - 1) // 3 + 1,
        }])
    
    def predict_optimal_notification_time(self, property_id, room_number, tenant_layout_id):
        """
        Predict the optimal notification send time for a tenant
        
        Returns:
            dict with optimal_hour, optimal_minute, and confidence
        """
        if self.model is None:
            raise ValueError("Model not loaded. Call load_model() first.")
        
        # Extract features
        features = self.extract_tenant_features(property_id, room_number, tenant_layout_id)
        
        # Predict
        optimal_hours, confidence = self.model.predict_optimal_hour(features)
        
        return {
            'optimal_hour': int(optimal_hours[0]),
            'optimal_minute': 0,  # Default to top of hour
            'confidence': float(confidence[0]),
            'recommended': confidence[0] > 0.6,  # High confidence threshold
        }
    
    def update_tenant_schedule(self, property_id, room_number, tenant_layout_id, tenant_name=''):
        """
        Update tenant's notification schedule based on ML prediction
        
        Only updates if prediction confidence is high enough
        """
        from api.models import TenantMessageSchedule
        
        # Get prediction
        prediction = self.predict_optimal_notification_time(
            property_id, room_number, tenant_layout_id
        )
        
        if not prediction['recommended']:
            print(f"Skipping {room_number}: Low confidence ({prediction['confidence']:.2%})")
            return None
        
        # Get or create schedule
        schedule, created = TenantMessageSchedule.objects.get_or_create(
            property_id=property_id,
            room_number=room_number,
            defaults={
                'tenant_name': tenant_name,
                'send_hour': prediction['optimal_hour'],
                'send_minute': prediction['optimal_minute'],
                'use_custom_schedule': True,
            }
        )
        
        if not created:
            # Update existing schedule
            schedule.send_hour = prediction['optimal_hour']
            schedule.send_minute = prediction['optimal_minute']
            schedule.use_custom_schedule = True
            schedule.save()
        
        print(f"✓ Updated {room_number}: Optimal time {prediction['optimal_hour']}:00 "
              f"(confidence: {prediction['confidence']:.2%})")
        
        return schedule
    
    def batch_update_all_tenants(self, property_id):
        """
        Update notification schedules for all tenants in a property
        using ML predictions
        """
        from api.models import Property
        
        property = Property.objects.get(pk=property_id)
        layouts = property.layouts
        
        updated_count = 0
        skipped_count = 0
        
        print(f"\nUpdating notification schedules for: {property.name}")
        print("=" * 60)
        
        # Iterate through all layout variants
        for variant, boxes in layouts.items():
            for box in boxes:
                if box.get('type') == 'tenant' and box.get('tenant'):
                    tenant = box['tenant']
                    room_number = box.get('room', 'unknown')
                    tenant_layout_id = tenant.get('id', 0)
                    tenant_name = tenant.get('name', '')
                    
                    try:
                        schedule = self.update_tenant_schedule(
                            property_id,
                            room_number,
                            tenant_layout_id,
                            tenant_name
                        )
                        
                        if schedule:
                            updated_count += 1
                        else:
                            skipped_count += 1
                    
                    except Exception as e:
                        print(f"✗ Error updating {room_number}: {str(e)}")
                        skipped_count += 1
        
        print("\n" + "=" * 60)
        print(f"Updated: {updated_count} | Skipped: {skipped_count}")
        print("=" * 60)
        
        return {'updated': updated_count, 'skipped': skipped_count}


# ============================================================================
# EXAMPLE USAGE FUNCTIONS
# ============================================================================

def example_predict_for_tenant():
    """Example: Predict optimal notification time for a specific tenant"""
    
    analyzer = TenantBehaviorAnalyzer()
    analyzer.load_model()
    
    # Predict for a tenant
    result = analyzer.predict_optimal_notification_time(
        property_id=1,
        room_number='Room_5',
        tenant_layout_id=12345
    )
    
    print(f"Optimal notification time: {result['optimal_hour']}:00")
    print(f"Confidence: {result['confidence']:.2%}")
    print(f"Recommended: {result['recommended']}")


def example_update_property_schedules():
    """Example: Update all tenant schedules for a property"""
    
    analyzer = TenantBehaviorAnalyzer()
    analyzer.load_model()
    
    # Update all tenants in property 1
    results = analyzer.batch_update_all_tenants(property_id=1)
    
    print(f"\nCompleted! Updated {results['updated']} tenant schedules.")


def example_export_real_data_for_retraining():
    """
    Example: Export real data from database to retrain the model
    
    Use this after collecting several months of real data
    """
    from api.models import ScheduledAutomatedMessage
    
    # Get all sent messages with payment context
    messages = ScheduledAutomatedMessage.objects.filter(
        sent_at__isnull=False,
        status='sent'
    ).values(
        'property_id',
        'room_number',
        'tenant_layout_id',
        'tenant_name',
        'send_hour',
        'send_minute',
        'days_before_due',
        'due_date',
        'sent_at',
    )
    
    df = pd.DataFrame(messages)
    
    # Add derived features (would need actual payment timestamps)
    # For now, save raw data
    df.to_csv('real_notification_data.csv', index=False)
    
    print(f"Exported {len(df)} notification records to real_notification_data.csv")
    print("Next step: Merge with actual payment data and retrain model")


def example_a_b_testing():
    """
    Example: A/B test ML predictions vs fixed schedule
    
    Randomly assign 50% tenants to ML schedule, 50% to fixed schedule
    Track effectiveness over 1-2 months
    """
    from api.models import Property, TenantMessageSchedule
    
    analyzer = TenantBehaviorAnalyzer()
    analyzer.load_model()
    
    property_id = 1
    property = Property.objects.get(pk=property_id)
    layouts = property.layouts
    
    for variant, boxes in layouts.items():
        for box in boxes:
            if box.get('type') == 'tenant' and box.get('tenant'):
                tenant = box['tenant']
                room_number = box.get('room', 'unknown')
                
                # Randomly assign to control or treatment group
                use_ml = np.random.random() < 0.5
                
                schedule, _ = TenantMessageSchedule.objects.get_or_create(
                    property_id=property_id,
                    room_number=room_number
                )
                
                if use_ml:
                    # Treatment: ML predicted time
                    prediction = analyzer.predict_optimal_notification_time(
                        property_id, room_number, tenant['id']
                    )
                    schedule.send_hour = prediction['optimal_hour']
                    schedule.use_custom_schedule = True
                    print(f"ML: {room_number} -> {prediction['optimal_hour']}:00")
                else:
                    # Control: Fixed time (property default)
                    schedule.send_hour = 9
                    schedule.use_custom_schedule = False
                    print(f"Control: {room_number} -> 9:00 (fixed)")
                
                schedule.save()
    
    print("\nA/B test setup complete. Monitor effectiveness over next 1-2 months.")


# ============================================================================
# DJANGO MANAGEMENT COMMAND (Optional)
# ============================================================================

"""
To create a management command, save this in:
api/management/commands/update_notification_schedules.py

from django.core.management.base import BaseCommand
from api.ml.use_model_example import TenantBehaviorAnalyzer

class Command(BaseCommand):
    help = 'Update tenant notification schedules using ML predictions'
    
    def add_arguments(self, parser):
        parser.add_argument('--property-id', type=int, help='Specific property ID')
    
    def handle(self, *args, **options):
        analyzer = TenantBehaviorAnalyzer()
        analyzer.load_model()
        
        if options['property_id']:
            results = analyzer.batch_update_all_tenants(options['property_id'])
        else:
            # Update all properties
            from api.models import Property
            for property in Property.objects.all():
                results = analyzer.batch_update_all_tenants(property.pk)
        
        self.stdout.write(
            self.style.SUCCESS(f'Successfully updated {results["updated"]} schedules')
        )

# Usage:
# py manage.py update_notification_schedules
# py manage.py update_notification_schedules --property-id 1
"""


if __name__ == '__main__':
    print("Adaptive Notification Timing - Usage Examples")
    print("=" * 60)
    print("\nAvailable examples:")
    print("1. example_predict_for_tenant()")
    print("2. example_update_property_schedules()")
    print("3. example_export_real_data_for_retraining()")
    print("4. example_a_b_testing()")
    print("\nUncomment the function you want to run.")
    
    # Uncomment to run:
    # example_predict_for_tenant()
    # example_update_property_schedules()
