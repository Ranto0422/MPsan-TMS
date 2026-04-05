import sys
import threading
import time
import logging
from django.apps import AppConfig

logger = logging.getLogger(__name__)

_background_thread_started = False
_last_ml_update_date = None
_last_ml_retrain_date = None


def _run_scheduled_test_sender():
    """Background thread: every 30 seconds, process scheduled test messages."""
    global _last_ml_update_date, _last_ml_retrain_date
    logger.info('Background scheduled message sender thread STARTED')
    while True:
        time.sleep(30)
        try:
            from .views.messaging import process_scheduled_test_messages
            logger.debug('Checking for scheduled test messages...')
            process_scheduled_test_messages()
        except Exception:
            logger.exception('Scheduled test message sender error')

        # Run ML schedule update once per day
        try:
            from django.utils import timezone
            today = timezone.now().date()
            if _last_ml_update_date != today:
                _last_ml_update_date = today
                logger.info('Running daily ML schedule update...')
                from django.core.management import call_command
                call_command('update_ml_schedules', all_properties=True, verbosity=0)
                logger.info('Daily ML schedule update complete')
        except Exception:
            logger.exception('Daily ML schedule update error')

        # Retrain the ML model on real data once per week (every Sunday)
        try:
            from django.utils import timezone
            today = timezone.now().date()
            if today.weekday() == 6 and _last_ml_retrain_date != today:
                _last_ml_retrain_date = today
                logger.info('Running weekly ML model retrain from real payment data...')
                from django.core.management import call_command
                call_command('retrain_ml_model', verbosity=0)
                logger.info('Weekly ML model retrain complete')
        except Exception:
            logger.exception('Weekly ML model retrain error')


class ApiConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'api'

    def ready(self):
        try:
            from . import signals  # noqa: F401
        except Exception:
            logger.exception('Failed to register API signals')

        global _background_thread_started
        # Start background thread for scheduled test messages only when not migrating
        # Avoid starting multiple times (Django can call ready() multiple times)
        if _background_thread_started:
            return
        if 'migrate' not in sys.argv and 'makemigrations' not in sys.argv:
            try:
                thread = threading.Thread(target=_run_scheduled_test_sender, daemon=True)
                thread.start()
                _background_thread_started = True
                logger.info('Scheduled message sender background thread launched')
            except Exception:
                logger.exception('Failed to start background thread')
