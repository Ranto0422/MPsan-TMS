import csv
import io
import logging
import datetime
import os
import re
import time

from django.conf import settings
from django.http import HttpResponse
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from ..models import Tenant, Property, AuditLog
from ..permissions import IsAdminRole
from .utils import get_client_ip, format_room_display, _normalize_room_for_compare, _iter_layout_boxes


class TenantCSVTemplateView(generics.GenericAPIView):
    """Download a blank CSV template for tenant import."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        import csv
        import io
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="tenant_import_template.csv"'
        writer = csv.writer(response)
        writer.writerow([
            'tenant_id', 'full_name', 'phone', 'email', 'room_number', 'payment',
            'move_in', 'move_out', 'home_location', 'work_place', 'business_name',
            'advance_paid', 'deposit_paid', 'advance_amount', 'deposit_amount',
            'notes', 'blacklisted', 'blacklist_reason', 'warning_flag',
            'preferred_payment_day',
        ])
        writer.writerow([
            '', 'Juan Dela Cruz', '09171234567', 'juan@email.com', 'M1', '5000',
            '2025-01-15', '', 'Manila', 'Makati Corp', '',
            'yes', 'yes', '5000', '5000',
            '', 'no', '', 'no',
            '15',
        ])
        return response


class TenantCSVImportView(generics.GenericAPIView):
    """Bulk import tenants from a CSV file. If tenant_id is provided and exists, UPDATE; otherwise CREATE new."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        import csv
        import io
        import datetime

        csv_file = request.FILES.get('file')
        property_id = request.data.get('property_id')

        if not csv_file:
            return Response({'error': 'No CSV file provided'}, status=status.HTTP_400_BAD_REQUEST)
        if not property_id:
            return Response({'error': 'property_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            prop = Property.objects.get(pk=property_id)
        except Property.DoesNotExist:
            return Response({'error': 'Property not found'}, status=status.HTTP_404_NOT_FOUND)

        # Read and decode CSV
        try:
            raw = csv_file.read()
            try:
                content = raw.decode('utf-8-sig')
            except UnicodeDecodeError:
                content = raw.decode('latin-1')
            reader = csv.DictReader(io.StringIO(content))
            rows = list(reader)
        except Exception as e:
            return Response({'error': f'Failed to parse CSV: {str(e)}'}, status=status.HTTP_400_BAD_REQUEST)

        if not rows:
            return Response({'error': 'CSV file is empty'}, status=status.HTTP_400_BAD_REQUEST)

        logger = logging.getLogger(__name__)
        imported = 0
        updated = 0
        errors = []
        layouts = prop.layouts or {}

        def _parse_bool(val):
            return val.lower() in ('yes', 'true', '1', 'y') if val else False

        def _parse_date(val):
            if not val:
                return None
            try:
                return datetime.date.fromisoformat(val)
            except ValueError:
                for fmt in ('%m/%d/%Y', '%d/%m/%Y', '%m-%d-%Y'):
                    try:
                        return datetime.datetime.strptime(val, fmt).date()
                    except ValueError:
                        pass
            return None

        def _find_room_box(room_number):
            """Find a room box in layouts by display name. Returns (box, variant_key) or (None, None)."""
            for vk, arr in layouts.items():
                if not isinstance(arr, list):
                    continue
                for b in arr:
                    box_number = str(b.get('number', ''))
                    box_type = b.get('type', 'room')
                    box_section = b.get('section')
                    formatted_box = format_room_display(box_number, box_type, box_section)
                    if _normalize_room_for_compare(formatted_box) == _normalize_room_for_compare(room_number):
                        return b, vk
            return None, None

        def _find_box_by_tenant_id(tid):
            """Find a room box that has this tenant_id currently assigned."""
            tid_str = str(tid)
            for _, arr in layouts.items():
                if not isinstance(arr, list):
                    continue
                for b in arr:
                    t = b.get('tenant')
                    if t and str(t.get('tenant_id') or t.get('id', '')) == tid_str:
                        return b
            return None

        def _create_room_box(room_display, row_idx):
            """Auto-create a room box from a display name like 'B24', 'C5', 'M1', or '7'.
            Returns (box, variant_key) or (None, None) if unparseable."""
            m = re.match(r'^([A-Za-z]?)(\d+)$', room_display.strip())
            if not m:
                return None, None
            prefix = m.group(1).upper()
            number = m.group(2)

            # Determine type and section
            if prefix == 'C':
                room_type = 'commercial'
                section = None
            elif prefix:
                room_type = 'room'
                # Try to match section name from existing boxes
                section = None
                for _, arr in layouts.items():
                    if not isinstance(arr, list):
                        continue
                    for b in arr:
                        s = b.get('section', '')
                        if s and s[0].upper() == prefix:
                            section = s
                            break
                    if section:
                        break
                if not section:
                    section = prefix  # Use the letter itself as section name
            else:
                room_type = 'room'
                section = None

            # Pick variant to add to (use 'default' or first available)
            variant_key = 'default'
            if variant_key not in layouts:
                for vk, val in layouts.items():
                    if isinstance(val, list):
                        variant_key = vk
                        break
                else:
                    layouts['default'] = []

            if variant_key not in layouts:
                layouts[variant_key] = []

            # Auto-position based on existing box count
            existing = layouts[variant_key]
            box_idx = len(existing)
            cols = 8
            step_x = 50
            step_y = 75
            x = (box_idx % cols) * step_x
            y = (box_idx // cols) * step_y

            new_box = {
                'id': int(time.time() * 1000) + row_idx,
                'x': x, 'y': y,
                'w': 50 if room_type == 'commercial' else 25,
                'h': 50,
                'type': room_type,
                'number': number,
                'section': section,
                'status': 'available',
                'floor': 1,
                'rotation': 0,
                'occupancy': 0,
                'capacity': 1,
            }
            layouts[variant_key].append(new_box)
            return new_box, variant_key

        imported_tenants = []  # Track all imported/updated Tenant objects for ML pipeline

        for idx, row in enumerate(rows, start=2):  # row 2 = first data row (after header)
            # Normalize keys (strip whitespace, lowercase)
            row = {k.strip().lower().replace(' ', '_'): (v.strip() if v else '') for k, v in row.items() if k}

            existing_tenant_id = row.get('tenant_id', '')
            use_provided_tid = None  # Set when tenant_id is provided but doesn't exist yet
            full_name = row.get('full_name', '')
            phone = row.get('phone', '')
            room_number = row.get('room_number', '')
            payment = row.get('payment', '')

            # --- UPDATE MODE: tenant_id is provided ---
            if existing_tenant_id:
                try:
                    tid = int(existing_tenant_id)
                except (ValueError, TypeError):
                    errors.append({'row': idx, 'error': f'Invalid tenant_id: {existing_tenant_id}'})
                    continue

                try:
                    tenant = Tenant.objects.get(tenant_id=tid)
                except Tenant.DoesNotExist:
                    # tenant_id provided but doesn't exist — fall through to CREATE with this ID
                    use_provided_tid = tid

                if use_provided_tid is None:
                    # Update DB model fields (only if value is non-empty in CSV)
                    if full_name:
                        tenant.full_name = full_name
                    if phone:
                        tenant.phone = phone
                    if row.get('email', ''):
                        tenant.email = row['email']
                    if row.get('home_location', ''):
                        tenant.home_location = row['home_location']
                    if row.get('work_place', ''):
                        tenant.work_place = row['work_place']
                    if row.get('business_name', ''):
                        tenant.business_name = row['business_name']
                    move_in_str = row.get('move_in', '') or row.get('date_of_occupancy', '')
                    move_in_date = _parse_date(move_in_str)
                    if move_in_date:
                        tenant.move_in = move_in_date
                    move_out_str = row.get('move_out', '')
                    move_out_date = _parse_date(move_out_str)
                    if move_out_date:
                        tenant.move_out = move_out_date
                    if row.get('notes', ''):
                        tenant.notes = row['notes']
                    if row.get('blacklisted', ''):
                        tenant.blacklisted = _parse_bool(row['blacklisted'])
                    if row.get('blacklist_reason', ''):
                        tenant.blacklist_reason = row['blacklist_reason']
                    if row.get('warning_flag', ''):
                        tenant.warning_flag = _parse_bool(row['warning_flag'])
                    if row.get('preferred_payment_day', ''):
                        try:
                            tenant.preferred_payment_day = int(row['preferred_payment_day'])
                        except (ValueError, TypeError):
                            pass

                    # Ensure ML pipeline can resolve this tenant's property/room
                    if not tenant.last_property_id:
                        tenant.last_property_id = prop.id
                    if room_number and not tenant.last_room:
                        tenant.last_room = room_number

                    try:
                        tenant.save()
                    except Exception as e:
                        errors.append({'row': idx, 'error': f'Failed to update tenant {tid}: {str(e)}'})
                        continue

                    # Update layouts JSON if tenant is currently assigned to a room
                    box = _find_box_by_tenant_id(tid)
                    if box and box.get('tenant'):
                        t = box['tenant']
                        t['full_name'] = tenant.full_name
                        t['phone'] = tenant.phone
                        t['email'] = tenant.email
                        t['business_name'] = tenant.business_name or ''
                        t['move_in'] = tenant.move_in.isoformat() if tenant.move_in else t.get('move_in')
                        if row.get('advance_paid', ''):
                            t['advance_paid'] = _parse_bool(row['advance_paid'])
                        if row.get('deposit_paid', ''):
                            t['deposit_paid'] = _parse_bool(row['deposit_paid'])
                        if row.get('advance_amount', ''):
                            try:
                                t['advance_amount'] = float(row['advance_amount'].replace(',', ''))
                            except (ValueError, TypeError):
                                pass
                        if row.get('deposit_amount', ''):
                            try:
                                t['deposit_amount'] = float(row['deposit_amount'].replace(',', ''))
                            except (ValueError, TypeError):
                                pass
                        if row.get('preferred_payment_day', ''):
                            try:
                                t['preferred_payment_day'] = int(row['preferred_payment_day'])
                                box['preferred_payment_day'] = int(row['preferred_payment_day'])
                            except (ValueError, TypeError):
                                pass
                        if payment:
                            try:
                                box['payment'] = float(payment.replace(',', ''))
                            except (ValueError, TypeError):
                                pass

                    updated += 1
                    imported_tenants.append(tenant)
                    logger.info('CSV import: updated tenant %s (ID: %s)', tenant.full_name, tenant.tenant_id)
                    continue

            # --- CREATE MODE: no tenant_id provided, or tenant_id not found in DB ---
            # Validate required fields for new tenants
            missing = []
            if not full_name:
                missing.append('full_name')
            if not phone:
                missing.append('phone')
            if not room_number:
                missing.append('room_number')
            if not payment:
                missing.append('payment')
            if missing:
                errors.append({'row': idx, 'error': f'Missing required fields: {", ".join(missing)}'})
                continue

            try:
                payment_val = float(payment.replace(',', ''))
            except (ValueError, TypeError):
                errors.append({'row': idx, 'error': f'Invalid payment amount: {payment}'})
                continue

            # Check if room exists (auto-create if not) and is vacant
            target_box, _ = _find_room_box(room_number)
            if target_box is None:
                target_box, _ = _create_room_box(room_number, idx)
                if target_box is None:
                    errors.append({'row': idx, 'error': f'Could not parse room number: {room_number}'})
                    continue

            # Determine if this is a historical (past) tenant based on move_out date
            move_out_str_check = row.get('move_out', '')
            move_out_check = _parse_date(move_out_str_check)
            is_historical = move_out_check and move_out_check < datetime.date.today()

            # Only enforce occupancy check for current/active tenants, not historical ones
            if not is_historical and target_box.get('status') == 'occupied' and target_box.get('tenant'):
                errors.append({'row': idx, 'error': f'Room {room_number} is already occupied'})
                continue

            # Parse optional fields
            email = row.get('email', '')
            move_in_str = row.get('move_in', '') or row.get('date_of_occupancy', '')
            home_location = row.get('home_location', '')
            work_place = row.get('work_place', '')
            business_name = row.get('business_name', '')
            advance_paid = _parse_bool(row.get('advance_paid', ''))
            deposit_paid = _parse_bool(row.get('deposit_paid', ''))
            notes = row.get('notes', '')
            blacklisted = _parse_bool(row.get('blacklisted', ''))
            blacklist_reason = row.get('blacklist_reason', '')
            warning_flag = _parse_bool(row.get('warning_flag', ''))

            move_in_date = _parse_date(move_in_str)
            move_out_str = row.get('move_out', '')
            move_out_date = _parse_date(move_out_str)

            preferred_payment_day = None
            if row.get('preferred_payment_day', ''):
                try:
                    preferred_payment_day = int(row['preferred_payment_day'])
                except (ValueError, TypeError):
                    pass

            advance_amount = payment_val
            if row.get('advance_amount', ''):
                try:
                    advance_amount = float(row['advance_amount'].replace(',', ''))
                except (ValueError, TypeError):
                    pass

            deposit_amount = payment_val
            if row.get('deposit_amount', ''):
                try:
                    deposit_amount = float(row['deposit_amount'].replace(',', ''))
                except (ValueError, TypeError):
                    pass

            # Use provided tenant_id or auto-generate one
            if use_provided_tid:
                tenant_id_val = use_provided_tid
            else:
                year = datetime.date.today().year
                base = year * 10000
                max_id = Tenant.objects.filter(tenant_id__gte=base, tenant_id__lt=base+10000).order_by('-tenant_id').values_list('tenant_id', flat=True).first()
                seq = ((int(max_id) % 10000) + 1) if max_id else 1
                tenant_id_val = base + seq

            try:
                tenant = Tenant.objects.create(
                    tenant_id=tenant_id_val,
                    full_name=full_name,
                    phone=phone,
                    email=email or None,
                    home_location=home_location,
                    work_place=work_place,
                    business_name=business_name,
                    move_in=move_in_date or datetime.date.today(),
                    move_out=move_out_date,
                    is_active=not bool(move_out_date),
                    created_by=request.user,
                    notes=notes,
                    blacklisted=blacklisted,
                    blacklist_reason=blacklist_reason,
                    warning_flag=warning_flag,
                    preferred_payment_day=preferred_payment_day,
                    last_property_id=prop.id,
                    last_room=room_number,
                )
            except Exception as e:
                errors.append({'row': idx, 'error': f'Failed to create tenant: {str(e)}'})
                continue

            # Assign tenant to room in layouts (only if tenant is still active)
            if not move_out_date:
                formatted_room = format_room_display(str(target_box.get('number', '')), target_box.get('type', 'room'), target_box.get('section'))
                target_box['status'] = 'occupied'
                target_box['payment'] = payment_val
                if preferred_payment_day:
                    target_box['preferred_payment_day'] = preferred_payment_day
                target_box['tenant'] = {
                    'tenant_id': tenant.tenant_id,
                    'id': tenant.tenant_id,
                    'full_name': tenant.full_name,
                    'business_name': tenant.business_name or '',
                    'email': tenant.email,
                    'phone': tenant.phone,
                    'created_at': tenant.created_at.isoformat() if tenant.created_at else None,
                    'move_in': tenant.move_in.isoformat() if tenant.move_in else None,
                    'other_occupants': [],
                    'advance_paid': advance_paid,
                    'advance_amount': advance_amount if advance_paid else 0,
                    'deposit_paid': deposit_paid,
                    'deposit_amount': deposit_amount if deposit_paid else 0,
                }
                if preferred_payment_day:
                    target_box['tenant']['preferred_payment_day'] = preferred_payment_day
                if 'transactions' not in target_box:
                    target_box['transactions'] = []

                # Add advance/deposit transactions if paid
                move_in_iso = tenant.move_in.isoformat() if tenant.move_in else datetime.date.today().isoformat()
                if advance_paid:
                    target_box['transactions'].insert(0, {
                        'date': move_in_iso,
                        'amount': f'{advance_amount:,.2f}',
                        'name': tenant.full_name,
                        'notes': 'Initial advance payment (1 month)',
                        'tenant_id': tenant.tenant_id,
                        'tenant_name': tenant.full_name,
                        'room_no': formatted_room,
                        'timestamp': datetime.datetime.now().isoformat(),
                        'is_late': False,
                        'status': 'paid',
                        'payment_type': 'advance',
                        'method': 'cash',
                    })
                if deposit_paid:
                    target_box['transactions'].insert(0, {
                        'date': move_in_iso,
                        'amount': f'{deposit_amount:,.2f}',
                        'name': tenant.full_name,
                        'notes': 'Initial deposit payment (1 month)',
                        'tenant_id': tenant.tenant_id,
                        'tenant_name': tenant.full_name,
                        'room_no': formatted_room,
                        'timestamp': datetime.datetime.now().isoformat(),
                        'is_late': False,
                        'status': 'paid',
                        'payment_type': 'deposit',
                        'method': 'cash',
                    })

            imported += 1
            imported_tenants.append(tenant)
            logger.info('CSV import: created tenant %s (ID: %s) in room %s', tenant.full_name, tenant.tenant_id, room_number)

        # Save layouts if any changes were made
        changes = imported + updated
        if changes > 0:
            prop.layouts = layouts
            prop.save(update_fields=['layouts'])

            # Broadcast layout update via WebSocket
            try:
                from channels.layers import get_channel_layer
                from asgiref.sync import async_to_sync
                channel_layer = get_channel_layer()
                group_name = f'property_{prop.id}'
                async_to_sync(channel_layer.group_send)(
                    group_name,
                    {'type': 'layouts.update', 'layouts': prop.layouts}
                )
            except Exception:
                pass

            # Backfill ML training data for all tenants in this property
            try:
                from api.ml.occupancy_data_pipeline import backfill_property_tenants
                backfill_property_tenants(prop.id)
            except Exception:
                logger.debug("ML backfill failed for property %s", prop.id, exc_info=True)

            # Explicitly sync ALL imported/updated tenants to the occupancy
            # training CSV.  backfill_property_tenants only covers currently-
            # occupied rooms and misses tenants with move_out dates.  The
            # post_save signal fires before prop.save(), so room resolution
            # against layouts may fail.  This loop runs AFTER layouts are
            # persisted, ensuring accurate section/room resolution.
            try:
                from api.ml.occupancy_data_pipeline import upsert_occupancy_row_from_tenant
                ml_synced = 0
                for t in imported_tenants:
                    try:
                        if upsert_occupancy_row_from_tenant(t):
                            ml_synced += 1
                    except Exception:
                        logger.debug("ML upsert failed for tenant %s", t.tenant_id, exc_info=True)
                if ml_synced:
                    logger.info("ML pipeline: synced %d tenant(s) to occupancy CSV for property %s", ml_synced, prop.id)
            except Exception:
                logger.debug("ML tenant sync failed for property %s", prop.id, exc_info=True)

            # Invalidate cached occupancy model so the next forecast request
            # retrains with the freshly-updated training data.
            try:
                from api.ml.occupancy_forecast import MODEL_DIR
                model_file = os.path.join(
                    os.path.dirname(os.path.abspath(__file__)),
                    '..', 'ml', MODEL_DIR,
                    f'occupancy_model_property_{prop.id}.pkl',
                )
                if os.path.exists(model_file):
                    os.remove(model_file)
                    logger.info("Invalidated cached occupancy model for property %s after CSV import", prop.id)
            except Exception:
                logger.debug("Could not invalidate occupancy model for property %s", prop.id, exc_info=True)

            # Audit log
            try:
                details_parts = []
                if imported:
                    details_parts.append(f'imported {imported} new tenant(s)')
                if updated:
                    details_parts.append(f'updated {updated} existing tenant(s)')
                AuditLog.objects.create(
                    severity='info',
                    event='CSV Tenant Import',
                    user=request.user.username,
                    ip_address=get_client_ip(request),
                    details=f'{" and ".join(details_parts)} from CSV into {prop.name}',
                    user_ref=request.user,
                    property_ref=prop,
                )
            except Exception:
                pass

        return Response({
            'imported': imported,
            'updated': updated,
            'errors': errors,
            'total_rows': len(rows),
        })


class TenantCSVExportView(generics.GenericAPIView):
    """Export tenant list as CSV or Excel with all fields (importable back)."""
    permission_classes = [IsAuthenticated]

    HEADERS = [
        'tenant_id', 'full_name', 'phone', 'email', 'room_number', 'payment',
        'move_in', 'move_out', 'home_location', 'work_place', 'business_name',
        'advance_paid', 'deposit_paid', 'advance_amount', 'deposit_amount',
        'notes', 'blacklisted', 'blacklist_reason', 'warning_flag',
        'preferred_payment_day', 'status',
    ]

    def get(self, request, pk):
        import csv
        try:
            prop = Property.objects.get(pk=pk)
        except Property.DoesNotExist:
            return Response({'error': 'Property not found'}, status=status.HTTP_404_NOT_FOUND)

        layouts = prop.layouts or {}
        tenants_data = []
        layout_tenant_ids = set()

        for _var, arr in layouts.items():
            if not isinstance(arr, list):
                continue
            for b in arr:
                if b.get('status') != 'occupied' or not b.get('tenant'):
                    continue
                t = b['tenant']
                tid = t.get('tenant_id') or t.get('id', '')
                if tid:
                    layout_tenant_ids.add(int(tid) if str(tid).isdigit() else tid)
                room_display = format_room_display(str(b.get('number', '')), b.get('type', 'room'), b.get('section'))

                # Fetch extra fields from the Tenant DB model if available
                db_tenant = None
                if tid:
                    try:
                        db_tenant = Tenant.objects.filter(tenant_id=tid).first()
                    except Exception:
                        pass

                tenants_data.append({
                    'tenant_id': tid,
                    'full_name': t.get('full_name') or t.get('name', ''),
                    'phone': t.get('phone', ''),
                    'email': t.get('email', ''),
                    'room_number': room_display,
                    'payment': b.get('payment', ''),
                    'move_in': t.get('move_in') or t.get('date_of_occupancy', ''),
                    'move_out': str(db_tenant.move_out) if db_tenant and db_tenant.move_out else '',
                    'home_location': (db_tenant.home_location if db_tenant else '') or '',
                    'work_place': (db_tenant.work_place if db_tenant else '') or '',
                    'business_name': t.get('business_name', '') or (db_tenant.business_name if db_tenant else '') or '',
                    'advance_paid': 'yes' if t.get('advance_paid') else 'no',
                    'deposit_paid': 'yes' if t.get('deposit_paid') else 'no',
                    'advance_amount': t.get('advance_amount', ''),
                    'deposit_amount': t.get('deposit_amount', ''),
                    'notes': (db_tenant.notes if db_tenant else '') or '',
                    'blacklisted': 'yes' if (db_tenant.blacklisted if db_tenant else t.get('blacklisted', False)) else 'no',
                    'blacklist_reason': (db_tenant.blacklist_reason if db_tenant else '') or '',
                    'warning_flag': 'yes' if (db_tenant.warning_flag if db_tenant else t.get('warning_flag', False)) else 'no',
                    'preferred_payment_day': t.get('preferred_payment_day', '') or (db_tenant.preferred_payment_day if db_tenant else '') or '',
                    'status': 'active',
                })

        # Include inactive/previous tenants from the Tenant table
        inactive_tenants = Tenant.objects.filter(
            last_property_id=pk,
            is_active=False
        ).exclude(tenant_id__in=layout_tenant_ids)

        # Also check ML training CSV for tenants associated with this property
        # (catches tenants whose last_property_id wasn't set)
        seen_inactive_ids = set(t.tenant_id for t in inactive_tenants)
        csv_path = os.path.join(settings.BASE_DIR, 'api', 'ml', 'occupancy_training_data.csv')
        if os.path.exists(csv_path):
            try:
                import pandas as pd
                train_df = pd.read_csv(csv_path)
                csv_tids = train_df[train_df['Property ID'] == pk]['Tenant ID'].dropna().astype(int).tolist()
                extra_tids = set(csv_tids) - layout_tenant_ids - seen_inactive_ids
                if extra_tids:
                    extra_tenants = Tenant.objects.filter(tenant_id__in=extra_tids, is_active=False)
                    inactive_tenants = list(inactive_tenants) + list(extra_tenants)
            except Exception:
                pass

        for t in inactive_tenants:
            if t.tenant_id in layout_tenant_ids:
                continue
            tenants_data.append({
                'tenant_id': t.tenant_id,
                'full_name': t.full_name or '',
                'phone': t.phone or '',
                'email': t.email or '',
                'room_number': t.last_room or '',
                'payment': str(t.last_payment) if t.last_payment else '',
                'move_in': str(t.move_in) if t.move_in else '',
                'move_out': str(t.move_out) if t.move_out else '',
                'home_location': t.home_location or '',
                'work_place': t.work_place or '',
                'business_name': t.business_name or '',
                'advance_paid': '',
                'deposit_paid': '',
                'advance_amount': '',
                'deposit_amount': '',
                'notes': t.notes or '',
                'blacklisted': 'yes' if t.blacklisted else 'no',
                'blacklist_reason': t.blacklist_reason or '',
                'warning_flag': 'yes' if t.warning_flag else 'no',
                'preferred_payment_day': str(t.preferred_payment_day) if t.preferred_payment_day else '',
                'status': 'inactive',
            })

        fmt = request.query_params.get('format', 'csv').lower()

        if fmt == 'xlsx':
            try:
                import openpyxl
                from io import BytesIO
                wb = openpyxl.Workbook()
                ws = wb.active
                ws.title = 'Tenants'
                ws.append(self.HEADERS)
                for row in tenants_data:
                    ws.append([row.get(h, '') for h in self.HEADERS])
                buf = BytesIO()
                wb.save(buf)
                buf.seek(0)
                response = HttpResponse(buf.getvalue(), content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                response['Content-Disposition'] = f'attachment; filename="tenants_{prop.name}.xlsx"'
                return response
            except ImportError:
                return Response({'error': 'openpyxl not installed. Use format=csv instead.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="tenants_{prop.name}.csv"'
        writer = csv.DictWriter(response, fieldnames=self.HEADERS)
        writer.writeheader()
        for row in tenants_data:
            writer.writerow(row)
        return response


class PaymentCSVExportView(generics.GenericAPIView):
    """Export payment/transaction history as CSV or Excel with ALL transaction fields."""
    permission_classes = [IsAuthenticated]

    HEADERS = [
        'tenant_id', 'tenant_name', 'room_number', 'date', 'timestamp',
        'amount', 'payment_type', 'method', 'status', 'is_late',
        'for_month', 'payment_status', 'remaining_balance', 'receipt_number', 'notes',
    ]

    def get(self, request, pk):
        import csv
        try:
            prop = Property.objects.get(pk=pk)
        except Property.DoesNotExist:
            return Response({'error': 'Property not found'}, status=status.HTTP_404_NOT_FOUND)

        date_from = request.query_params.get('from', '')
        date_to = request.query_params.get('to', '')

        layouts = prop.layouts or {}
        payments = []

        for _, arr in layouts.items():
            if not isinstance(arr, list):
                continue
            for b in arr:
                room_display = format_room_display(str(b.get('number', '')), b.get('type', 'room'), b.get('section'))
                for tx in (b.get('transactions') or []):
                    tx_date = tx.get('date', '')
                    if date_from and tx_date < date_from:
                        continue
                    if date_to and tx_date > date_to:
                        continue
                    payments.append({
                        'tenant_id': tx.get('tenant_id', ''),
                        'tenant_name': tx.get('tenant_name') or tx.get('name', ''),
                        'room_number': room_display,
                        'date': tx_date,
                        'timestamp': tx.get('timestamp', ''),
                        'amount': tx.get('amount', ''),
                        'payment_type': tx.get('payment_type') or 'rent',
                        'method': tx.get('method') or 'cash',
                        'status': tx.get('status', ''),
                        'is_late': 'yes' if tx.get('is_late') else 'no',
                        'for_month': tx.get('for_month', ''),
                        'payment_status': tx.get('payment_status', 'full'),
                        'remaining_balance': tx.get('remaining_balance', 0) or 0,
                        'receipt_number': tx.get('receipt_number', ''),
                        'notes': tx.get('notes', ''),
                    })

        # Sort by date descending
        payments.sort(key=lambda x: x['date'], reverse=True)

        fmt = request.query_params.get('format', 'csv').lower()

        if fmt == 'xlsx':
            try:
                import openpyxl
                from io import BytesIO
                wb = openpyxl.Workbook()
                ws = wb.active
                ws.title = 'Payments'
                ws.append(self.HEADERS)
                for row in payments:
                    ws.append([row[h] for h in self.HEADERS])
                buf = BytesIO()
                wb.save(buf)
                buf.seek(0)
                response = HttpResponse(buf.getvalue(), content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                response['Content-Disposition'] = f'attachment; filename="payments_{prop.name}.xlsx"'
                return response
            except ImportError:
                return Response({'error': 'openpyxl not installed. Use format=csv instead.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="payments_{prop.name}.csv"'
        writer = csv.DictWriter(response, fieldnames=self.HEADERS)
        writer.writeheader()
        for row in payments:
            writer.writerow(row)
        return response


class PaymentCSVTemplateView(generics.GenericAPIView):
    """Download a blank CSV template for payment history import with all fields."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        import csv
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="payment_import_template.csv"'
        writer = csv.writer(response)
        writer.writerow([
            'tenant_id', 'tenant_name', 'room_number', 'date', 'timestamp',
            'amount', 'payment_type', 'method', 'status', 'is_late',
            'for_month', 'payment_status', 'remaining_balance', 'receipt_number', 'notes',
        ])
        # Example 1: Full rent payment
        writer.writerow([
            '20250001', 'Juan Dela Cruz', 'M1', '2025-06-15', '2025-06-15T14:30:00',
            '5000', 'rent', 'cash', 'paid', 'no',
            '2025-06', 'full', '0', '', 'June rent payment',
        ])
        # Example 2: Partial rent payment
        writer.writerow([
            '20250001', 'Juan Dela Cruz', 'M1', '2025-07-10', '2025-07-10T09:00:00',
            '3000', 'rent', 'gcash', 'paid', 'no',
            '2025-07', 'partial', '2000', '', 'Partial July rent',
        ])
        # Example 3: Advance payment
        writer.writerow([
            '20250002', 'Maria Santos', 'C5', '2025-01-01', '2025-01-01T12:00:00',
            '5000', 'advance', 'cash', 'paid', 'no',
            '', '', '0', '', 'Initial advance payment',
        ])
        return response


class PaymentCSVImportView(generics.GenericAPIView):
    """Bulk import payment/transaction history from a CSV file into a property's layouts."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        import csv
        import io
        import datetime

        csv_file = request.FILES.get('file')
        property_id = request.data.get('property_id')

        if not csv_file:
            return Response({'error': 'No CSV file provided'}, status=status.HTTP_400_BAD_REQUEST)
        if not property_id:
            return Response({'error': 'property_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            prop = Property.objects.get(pk=property_id)
        except Property.DoesNotExist:
            return Response({'error': 'Property not found'}, status=status.HTTP_404_NOT_FOUND)

        # Read and decode CSV
        try:
            raw = csv_file.read()
            try:
                content = raw.decode('utf-8-sig')
            except UnicodeDecodeError:
                content = raw.decode('latin-1')
            reader = csv.DictReader(io.StringIO(content))
            rows = list(reader)
        except Exception as e:
            return Response({'error': f'Failed to parse CSV: {str(e)}'}, status=status.HTTP_400_BAD_REQUEST)

        if not rows:
            return Response({'error': 'CSV file is empty'}, status=status.HTTP_400_BAD_REQUEST)

        logger = logging.getLogger(__name__)
        imported = 0
        errors = []
        layouts = prop.layouts or {}

        def _parse_date(val):
            if not val:
                return None
            try:
                return datetime.date.fromisoformat(val)
            except ValueError:
                for fmt in ('%m/%d/%Y', '%d/%m/%Y', '%m-%d-%Y'):
                    try:
                        return datetime.datetime.strptime(val, fmt).date()
                    except ValueError:
                        pass
            return None

        def _find_room_box(room_number):
            for vk, arr in layouts.items():
                if not isinstance(arr, list):
                    continue
                for b in arr:
                    box_number = str(b.get('number', ''))
                    box_type = b.get('type', 'room')
                    box_section = b.get('section')
                    formatted_box = format_room_display(box_number, box_type, box_section)
                    if _normalize_room_for_compare(formatted_box) == _normalize_room_for_compare(room_number):
                        return b, vk
            return None, None

        def _find_box_by_tenant_id(tid):
            tid_str = str(tid)
            for _, arr in layouts.items():
                if not isinstance(arr, list):
                    continue
                for b in arr:
                    t = b.get('tenant')
                    if t and str(t.get('tenant_id') or t.get('id', '')) == tid_str:
                        return b
            return None

        for idx, row in enumerate(rows, start=2):
            row = {k.strip().lower().replace(' ', '_'): (v.strip() if v else '') for k, v in row.items() if k}

            tenant_id_str = row.get('tenant_id', '')
            room_number = row.get('room_number', '') or row.get('room', '')
            date_str = row.get('date', '')
            amount_str = row.get('amount', '')

            # Validate required fields
            if not date_str:
                errors.append({'row': idx, 'error': 'Missing required field: date'})
                continue
            if not amount_str:
                errors.append({'row': idx, 'error': 'Missing required field: amount'})
                continue
            if not tenant_id_str and not room_number:
                errors.append({'row': idx, 'error': 'Either tenant_id or room_number is required'})
                continue

            tx_date = _parse_date(date_str)
            if not tx_date:
                errors.append({'row': idx, 'error': f'Invalid date format: {date_str}'})
                continue

            try:
                amount_val = float(amount_str.replace(',', ''))
            except (ValueError, TypeError):
                errors.append({'row': idx, 'error': f'Invalid amount: {amount_str}'})
                continue

            # Find the target room box
            target_box = None
            if tenant_id_str:
                target_box = _find_box_by_tenant_id(tenant_id_str)
            if not target_box and room_number:
                target_box, _ = _find_room_box(room_number)

            if target_box is None:
                loc = f'tenant_id={tenant_id_str}' if tenant_id_str else f'room={room_number}'
                errors.append({'row': idx, 'error': f'Room not found for {loc}'})
                continue

            # Get tenant info from the box (or from the CSV row)
            tenant_data = target_box.get('tenant') or {}
            tenant_name = row.get('tenant_name', '') or tenant_data.get('full_name', '') or tenant_data.get('name', '')
            tid = tenant_id_str or str(tenant_data.get('tenant_id') or tenant_data.get('id', ''))
            room_display = format_room_display(
                str(target_box.get('number', '')),
                target_box.get('type', 'room'),
                target_box.get('section')
            )

            payment_type = (row.get('payment_type', '') or row.get('type', '') or 'rent').lower()
            method = (row.get('method', '') or 'cash').lower()
            tx_status = row.get('status', '') or 'paid'
            for_month = row.get('for_month', '')
            notes = row.get('notes', '')
            receipt_number = row.get('receipt_#', '') or row.get('receipt_number', '')

            # Parse extended fields
            timestamp_str = row.get('timestamp', '')
            is_late_str = row.get('is_late', '')
            is_late = is_late_str.lower() in ('yes', 'true', '1', 'y') if is_late_str else False
            payment_status = row.get('payment_status', '') or 'full'
            remaining_balance = 0
            if row.get('remaining_balance', ''):
                try:
                    remaining_balance = float(row['remaining_balance'].replace(',', ''))
                except (ValueError, TypeError):
                    pass

            # Use provided timestamp or auto-generate from date
            if timestamp_str:
                tx_timestamp = timestamp_str
            else:
                tx_timestamp = datetime.datetime.combine(tx_date, datetime.time(12, 0)).isoformat()

            # Build the transaction object with ALL fields
            tx = {
                'date': tx_date.isoformat(),
                'amount': f'{amount_val:,.2f}',
                'name': tenant_name,
                'notes': notes,
                'tenant_id': int(tid) if tid and tid.isdigit() else tid,
                'tenant_name': tenant_name,
                'room_no': room_display,
                'timestamp': tx_timestamp,
                'is_late': is_late,
                'status': tx_status,
                'payment_type': payment_type,
                'method': method,
                'payment_status': payment_status,
                'remaining_balance': remaining_balance,
            }
            if for_month:
                tx['for_month'] = for_month
            if receipt_number:
                tx['receipt_number'] = receipt_number

            # Add to room's transactions
            if 'transactions' not in target_box:
                target_box['transactions'] = []
            target_box['transactions'].append(tx)

            imported += 1
            logger.info('CSV payment import: added transaction for tenant %s in room %s (date: %s, amount: %s)', tenant_name, room_display, tx_date, amount_val)

        # Sort each room's transactions by date descending
        if imported > 0:
            for _, arr in layouts.items():
                if not isinstance(arr, list):
                    continue
                for b in arr:
                    txns = b.get('transactions')
                    if txns and isinstance(txns, list):
                        txns.sort(key=lambda t: t.get('date', ''), reverse=True)

            prop.layouts = layouts
            prop.save(update_fields=['layouts'])

            # Broadcast layout update via WebSocket
            try:
                from channels.layers import get_channel_layer
                from asgiref.sync import async_to_sync
                channel_layer = get_channel_layer()
                group_name = f'property_{prop.id}'
                async_to_sync(channel_layer.group_send)(
                    group_name,
                    {'type': 'layouts.update', 'layouts': prop.layouts}
                )
            except Exception:
                pass

            # Audit log
            try:
                AuditLog.objects.create(
                    severity='info',
                    event='CSV Payment Import',
                    user=request.user.username,
                    ip_address=get_client_ip(request),
                    details=f'Imported {imported} payment transaction(s) from CSV into {prop.name}',
                    user_ref=request.user,
                    property_ref=prop,
                )
            except Exception:
                pass

        return Response({
            'imported': imported,
            'errors': errors,
            'total_rows': len(rows),
        })
