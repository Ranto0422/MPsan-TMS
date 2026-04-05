from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Optional

import pandas as pd
from django.conf import settings

from api.models import Property, Tenant
from api.views.utils import _iter_layout_boxes, _normalize_room_for_compare, format_room_display


CSV_COLUMNS = ["Tenant ID", "Property ID", "Move-In Date", "Move-Out Date", "Section", "Room"]


@dataclass
class RoomResolution:
    section: str
    room: str


def occupancy_csv_path() -> str:
    return os.path.join(settings.BASE_DIR, "api", "ml", "occupancy_training_data.csv")


def _room_label(room_number: str) -> str:
    room_number = str(room_number).strip()
    if not room_number:
        return "Room Unknown"
    if room_number.lower().startswith("room "):
        return room_number
    return f"Room {room_number}"


def _resolve_property_id(tenant: Tenant) -> Optional[int]:
    if tenant.last_property_id:
        return int(tenant.last_property_id)

    prop_id = (
        Property.objects.filter(tenant_id=tenant.tenant_id)
        .order_by("-id")
        .values_list("id", flat=True)
        .first()
    )
    return int(prop_id) if prop_id else None


def _resolve_section_and_room(tenant: Tenant, property_id: int) -> RoomResolution:
    raw_room = (tenant.last_room or "").strip()
    normalized_raw = _normalize_room_for_compare(raw_room)

    try:
        prop = Property.objects.only("id", "layouts").get(pk=property_id)
    except Property.DoesNotExist:
        return RoomResolution(section="Unknown", room=_room_label(raw_room or "Unknown"))

    layouts = prop.layouts or {}
    candidates = []
    for box, _variant in _iter_layout_boxes(layouts):
        room_number = str(box.get("number", "")).strip()
        room_type = box.get("type", "room")
        section = str(box.get("section", "")).strip()
        formatted = format_room_display(room_number, room_type, section)
        normalized_number = _normalize_room_for_compare(room_number)
        normalized_formatted = _normalize_room_for_compare(formatted)

        candidates.append((section, room_number, normalized_number, normalized_formatted))

        if normalized_raw and normalized_formatted == normalized_raw:
            return RoomResolution(section=section or "Unknown", room=_room_label(room_number or raw_room))

        if normalized_raw and normalized_number == normalized_raw:
            return RoomResolution(section=section or "Unknown", room=_room_label(room_number or raw_room))

    if normalized_raw:
        parsed = re.match(r"^([A-Za-z]+)\s*[-_]?\s*(\d+)$", raw_room)
        if parsed:
            prefix = parsed.group(1)[0].upper()
            digits = parsed.group(2)
            for section, room_number, _norm_number, _norm_formatted in candidates:
                if section and section[0].upper() == prefix and str(room_number).strip() == digits:
                    return RoomResolution(section=section, room=_room_label(room_number))

    return RoomResolution(section="Unknown", room=_room_label(raw_room or "Unknown"))


def upsert_occupancy_row_from_tenant(tenant: Tenant) -> bool:
    property_id = _resolve_property_id(tenant)
    if not property_id:
        return False

    move_in = tenant.move_in or tenant.created_at.date()
    move_out = tenant.move_out
    if move_out and move_in > move_out:
        move_in = move_out

    resolved = _resolve_section_and_room(tenant, property_id)

    row = {
        "Tenant ID": int(tenant.tenant_id),
        "Property ID": int(property_id),
        "Move-In Date": move_in.isoformat(),
        "Move-Out Date": move_out.isoformat() if move_out else "",
        "Section": resolved.section,
        "Room": resolved.room,
    }

    csv_path = occupancy_csv_path()
    os.makedirs(os.path.dirname(csv_path), exist_ok=True)

    if os.path.exists(csv_path):
        df = pd.read_csv(csv_path)
    else:
        df = pd.DataFrame(columns=CSV_COLUMNS)

    for column in CSV_COLUMNS:
        if column not in df.columns:
            df[column] = ""

    has_tenant_id = "Tenant ID" in df.columns
    if has_tenant_id:
        mask = df["Tenant ID"].astype(str) == str(row["Tenant ID"])
    else:
        mask = (
            (df["Property ID"].astype(str) == str(row["Property ID"]))
            & (df["Move-In Date"].astype(str) == row["Move-In Date"])
            & (df["Move-Out Date"].astype(str) == row["Move-Out Date"])
            & (df["Section"].astype(str) == row["Section"])
            & (df["Room"].astype(str) == row["Room"])
        )

    if mask.any():
        idx = df.index[mask][0]
        changed = False
        for key, value in row.items():
            current = str(df.at[idx, key]) if key in df.columns else ""
            if current != str(value):
                df.at[idx, key] = value
                changed = True
        if changed:
            df = df[CSV_COLUMNS]
            df.to_csv(csv_path, index=False)
            return True
        return False

    df = pd.concat([df[CSV_COLUMNS], pd.DataFrame([row])], ignore_index=True)
    df.to_csv(csv_path, index=False)
    return True


def backfill_property_tenants(property_id: int) -> int:
    """Ensure all tenants for a property have rows in the ML training CSV.
    Scans both occupied rooms in layouts AND the Tenant DB table.
    Returns the number of rows added/updated."""
    import logging
    logger = logging.getLogger(__name__)

    try:
        prop = Property.objects.only("id", "layouts").get(pk=property_id)
    except Property.DoesNotExist:
        return 0

    layouts = prop.layouts or {}
    added = 0
    seen_ids = set()

    # 1) Scan occupied rooms in layouts
    for box, _variant in _iter_layout_boxes(layouts):
        tenant_data = box.get("tenant")
        if not tenant_data or box.get("status") != "occupied":
            continue

        tid = tenant_data.get("tenant_id") or tenant_data.get("id")
        if not tid:
            continue
        seen_ids.add(int(tid))

        try:
            tenant = Tenant.objects.get(tenant_id=tid)
        except Tenant.DoesNotExist:
            continue

        room_display = format_room_display(
            str(box.get("number", "")),
            box.get("type", "room"),
            box.get("section"),
        )
        changed = False
        if not tenant.last_property_id:
            tenant.last_property_id = property_id
            changed = True
        if not tenant.last_room:
            tenant.last_room = room_display
            changed = True
        if changed:
            tenant.save()
        if upsert_occupancy_row_from_tenant(tenant):
            added += 1

    # 2) Also backfill tenants from DB that have last_property_id set
    #    (includes inactive tenants with move_out who aren't in layouts)
    db_tenants = Tenant.objects.filter(last_property_id=property_id).exclude(
        tenant_id__in=seen_ids
    )
    for tenant in db_tenants:
        if upsert_occupancy_row_from_tenant(tenant):
            added += 1

    logger.info("ML backfill for property_id=%s: %d rows added/updated", property_id, added)
    return added
