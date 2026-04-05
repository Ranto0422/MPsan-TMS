from django.core.management.base import BaseCommand
from django.db.models import Count
from api.models import Unit


class Command(BaseCommand):
    help = 'Clean up duplicate Unit records, keeping only the most recent one for each property/unit_no combination'

    def handle(self, *args, **options):
        self.stdout.write(self.style.WARNING('Searching for duplicate Unit records...'))
        
        # Find duplicates
        duplicates = Unit.objects.values('property_id', 'unit_no').annotate(
            count=Count('unit_id')
        ).filter(count__gt=1)
        
        if not duplicates:
            self.stdout.write(self.style.SUCCESS('No duplicate Unit records found!'))
            return
        
        self.stdout.write(self.style.WARNING(f'Found {len(duplicates)} duplicate sets'))
        
        total_deleted = 0
        for dup in duplicates:
            # Get all units with this property_id and unit_no
            units = Unit.objects.filter(
                property_id=dup['property_id'],
                unit_no=dup['unit_no']
            ).order_by('-unit_id')
            
            count = units.count()
            self.stdout.write(
                f"Property {dup['property_id']}, Unit {dup['unit_no']}: "
                f"Found {count} records, keeping most recent (ID: {units.first().unit_id})"
            )
            
            # Delete all but the first (most recent)
            deleted_units = list(units[1:])
            deleted_count = len(deleted_units)
            units[1:].delete()
            
            total_deleted += deleted_count
            
            for unit in deleted_units:
                self.stdout.write(f"  - Deleted Unit ID: {unit.unit_id}")
        
        self.stdout.write(
            self.style.SUCCESS(
                f'\nSuccessfully deleted {total_deleted} duplicate Unit records!'
            )
        )
