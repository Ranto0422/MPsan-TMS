import logging

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from api.ml.occupancy_data_pipeline import upsert_occupancy_row_from_tenant
from api.models import Tenant


logger = logging.getLogger(__name__)


def _invalidate_occupancy_model(tenant):
    """Delete the cached model for the tenant's property so the next
    forecast request triggers a fresh retrain with the latest data."""
    try:
        from api.ml.occupancy_data_pipeline import _resolve_property_id
        from api.ml.occupancy_forecast import MODEL_DIR
        import os

        property_id = _resolve_property_id(tenant)
        if not property_id:
            return
        model_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "ml",
            MODEL_DIR,
            f"occupancy_model_property_{property_id}.pkl",
        )
        if os.path.exists(model_path):
            os.remove(model_path)
            logger.info(
                "Invalidated cached occupancy model for property_id=%s",
                property_id,
            )
    except Exception:
        logger.debug(
            "Could not invalidate occupancy model for tenant_id=%s",
            tenant.tenant_id,
            exc_info=True,
        )


@receiver(post_save, sender=Tenant)
def export_occupancy_row_on_tenant_save(sender, instance, created, **kwargs):

    def _export_after_commit():
        try:
            added = upsert_occupancy_row_from_tenant(instance)
            if added:
                logger.info(
                    "Upserted occupancy training row for tenant_id=%s move_out=%s",
                    instance.tenant_id,
                    instance.move_out,
                )
                # Data changed — invalidate cached model so next request retrains
                _invalidate_occupancy_model(instance)
        except Exception:
            logger.exception(
                "Failed to export occupancy training row for tenant_id=%s",
                instance.tenant_id,
            )

    transaction.on_commit(_export_after_commit)
