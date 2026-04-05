from ..models import Tenant


def get_client_ip(request):
    """Extract client IP address from request."""
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        return x_forwarded_for.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', '')


def format_room_display(room_number, room_type='room', section=None):
    """Format room display name with section prefix (F/M/R) or C for commercial"""
    if room_type == 'commercial':
        return f'C{room_number}'
    if section:
        return f'{section[0].upper()}{room_number}'
    return str(room_number)


def _normalize_room_for_compare(room_display):
    """Normalize room display string for comparison (strip, upper). Handles R1/r1, R2, etc."""
    if room_display is None:
        return ''
    return str(room_display).strip().upper()


def _iter_layout_boxes(layouts):
    """Yield (box, variant_key) for every box in layouts. Handles layouts = {variant: [boxes]} or {key: {variant: [boxes]}}."""
    if not isinstance(layouts, dict):
        return
    for var, val in layouts.items():
        if isinstance(val, list):
            for b in val:
                if isinstance(b, dict):
                    yield b, var
        elif isinstance(val, dict):
            for subvar, arr in val.items():
                if isinstance(arr, list):
                    for b in arr:
                        if isinstance(b, dict):
                            yield b, subvar


def _enrich_layouts_with_receivables(layouts):
    """Enrich each box.tenant in layouts with receivables from Tenant model (by tenant_id)."""
    if not isinstance(layouts, dict):
        return layouts
    tenant_ids = set()
    for var, val in layouts.items():
        if isinstance(val, list):
            for b in val:
                if isinstance(b, dict):
                    t = b.get('tenant')
                    if isinstance(t, dict):
                        tid = t.get('tenant_id') or t.get('id')
                        if tid is not None:
                            tenant_ids.add(tid)
    tenants_by_id = {}
    if tenant_ids:
        for t in Tenant.objects.filter(pk__in=tenant_ids).values('tenant_id', 'receivables'):
            tenants_by_id[t['tenant_id']] = t.get('receivables') or []
    for var, val in layouts.items():
        if isinstance(val, list):
            for b in val:
                if isinstance(b, dict) and 'tenant' in b and isinstance(b['tenant'], dict):
                    tid = b['tenant'].get('tenant_id') or b['tenant'].get('id')
                    if tid is not None and tid in tenants_by_id:
                        b['tenant'] = dict(b['tenant'])
                        b['tenant']['receivables'] = tenants_by_id[tid]
    return layouts
