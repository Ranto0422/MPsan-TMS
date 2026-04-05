"""
Email notification service for MPSAN Tenant Management System.
Uses Django's email backend (configured for Gmail SMTP).
"""

import logging
from django.core.mail import send_mail, EmailMultiAlternatives
from django.conf import settings
from django.template.loader import render_to_string
from django.utils.html import strip_tags

logger = logging.getLogger(__name__)


def is_email_configured():
    """Check if email settings are properly configured."""
    return bool(
        getattr(settings, 'EMAIL_HOST_USER', '') and
        getattr(settings, 'EMAIL_HOST_PASSWORD', '')
    )


def send_rent_reminder_email(
    tenant_email,
    tenant_name,
    room_number,
    payment_amount,
    due_date,
    days_left,
    property_name,
    subject_template=None,
    message_template=None,
    cc_owner_email=None
):
    """
    Send a rent reminder email to a tenant.

    Args:
        tenant_email: Tenant's email address
        tenant_name: Tenant's full name
        room_number: Room/unit number
        payment_amount: Amount due
        due_date: Due date (date object or string)
        days_left: Number of days until due
        property_name: Name of the property
        subject_template: Optional custom subject template
        message_template: Optional custom message template
        cc_owner_email: Optional owner email to CC

    Returns:
        tuple: (success: bool, error_message: str or None)
    """
    if not is_email_configured():
        return False, 'Email not configured (EMAIL_HOST_USER or EMAIL_HOST_PASSWORD missing)'

    if not tenant_email:
        return False, 'No tenant email provided'

    try:
        # Format due date
        if hasattr(due_date, 'strftime'):
            due_date_str = due_date.strftime('%B %d, %Y')
        else:
            due_date_str = str(due_date)

        # Build subject
        if subject_template:
            subject = subject_template.replace('[Tenant Name]', tenant_name)
            subject = subject.replace('[Days Left]', str(days_left))
            subject = subject.replace('[Due Date]', due_date_str)
            subject = subject.replace('[Room Number]', str(room_number))
        else:
            if days_left == 0:
                subject = f'Rent Payment Due Today - Room {room_number}'
            elif days_left == 1:
                subject = f'Rent Payment Due Tomorrow - Room {room_number}'
            else:
                subject = f'Rent Payment Reminder - Due in {days_left} days'

        # Apply subject prefix
        full_subject = f"{settings.EMAIL_SUBJECT_PREFIX}{subject}"

        # Build message body from template
        if message_template:
            text_content = message_template.replace('[Tenant Name]', tenant_name)
            text_content = text_content.replace('[Payment Amount]', f'{payment_amount:,.2f}')
            text_content = text_content.replace('[Days Left]', str(days_left))
            text_content = text_content.replace('[Due Date]', due_date_str)
            text_content = text_content.replace('[Room Number]', str(room_number))
            text_content = text_content.replace('[Property Name]', property_name)
        else:
            text_content = f"""
Good Day {tenant_name}!

This is a reminder that your rent payment of ₱{payment_amount:,.2f} for Room {room_number} at {property_name} is due {'TODAY' if days_left == 0 else f'in {days_left} days'}.

Due Date: {due_date_str}
Amount: ₱{payment_amount:,.2f}
Room: {room_number}

Please settle your payment on or before the due date to avoid any inconvenience.

Thank you for your prompt attention to this matter.

Best regards,
{property_name} Management
            """.strip()

        # Build HTML version
        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background: linear-gradient(135deg, #3b82f6, #6366f1); color: white; padding: 20px; border-radius: 8px 8px 0 0; }}
        .content {{ background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }}
        .details {{ background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }}
        .amount {{ font-size: 24px; font-weight: bold; color: #3b82f6; }}
        .due-badge {{ display: inline-block; padding: 5px 12px; border-radius: 20px; font-weight: bold; }}
        .due-today {{ background: #fee2e2; color: #dc2626; }}
        .due-soon {{ background: #fef3c7; color: #d97706; }}
        .due-upcoming {{ background: #dbeafe; color: #2563eb; }}
        .footer {{ text-align: center; padding: 15px; color: #6b7280; font-size: 12px; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2 style="margin: 0;">Rent Payment Reminder</h2>
            <p style="margin: 5px 0 0 0; opacity: 0.9;">{property_name}</p>
        </div>
        <div class="content">
            <p>Good Day <strong>{tenant_name}</strong>!</p>

            <p>This is a friendly reminder about your upcoming rent payment.</p>

            <div class="details">
                <p><strong>Room:</strong> {room_number}</p>
                <p><strong>Amount Due:</strong> <span class="amount">₱{payment_amount:,.2f}</span></p>
                <p><strong>Due Date:</strong> {due_date_str}</p>
                <p>
                    <span class="due-badge {'due-today' if days_left == 0 else 'due-soon' if days_left <= 3 else 'due-upcoming'}">
                        {'Due TODAY' if days_left == 0 else 'Due Tomorrow' if days_left == 1 else f'Due in {days_left} days'}
                    </span>
                </p>
            </div>

            <p>Please settle your payment on or before the due date to avoid any inconvenience.</p>

            <p>Thank you for your prompt attention to this matter.</p>

            <p>Best regards,<br><strong>{property_name} Management</strong></p>
        </div>
        <div class="footer">
            <p>This is an automated message from MPSAN Tenant Management System.</p>
        </div>
    </div>
</body>
</html>
        """

        # Prepare recipients
        recipient_list = [tenant_email]
        cc_list = []
        if cc_owner_email:
            cc_list.append(cc_owner_email)

        # Create email with HTML alternative
        email = EmailMultiAlternatives(
            subject=full_subject,
            body=text_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=recipient_list,
            cc=cc_list if cc_list else None
        )
        email.attach_alternative(html_content, "text/html")

        # Send email
        email.send(fail_silently=False)

        logger.info(
            'Rent reminder email sent to %s (tenant: %s, room: %s, cc: %s)',
            tenant_email, tenant_name, room_number, cc_owner_email or 'none'
        )

        return True, None

    except Exception as e:
        error_msg = str(e)
        logger.exception('Failed to send rent reminder email to %s: %s', tenant_email, error_msg)
        return False, error_msg


def send_owner_notification_email(
    owner_email,
    tenant_name,
    room_number,
    payment_amount,
    due_date,
    days_left,
    property_name,
    notification_type='due_reminder'
):
    """
    Send a notification email to the property owner/manager.

    Args:
        owner_email: Owner's email address
        tenant_name: Tenant's name
        room_number: Room number
        payment_amount: Amount due
        due_date: Due date
        days_left: Days until due
        property_name: Property name
        notification_type: Type of notification (due_reminder, payment_received, etc.)

    Returns:
        tuple: (success: bool, error_message: str or None)
    """
    if not is_email_configured():
        return False, 'Email not configured'

    if not owner_email:
        return False, 'No owner email provided'

    try:
        # Format due date
        if hasattr(due_date, 'strftime'):
            due_date_str = due_date.strftime('%B %d, %Y')
        else:
            due_date_str = str(due_date)

        # Build subject based on urgency
        if days_left == 0:
            subject = f'🔴 Due Today: {tenant_name} - Room {room_number}'
            urgency = 'TODAY'
        elif days_left == 1:
            subject = f'🟠 Due Tomorrow: {tenant_name} - Room {room_number}'
            urgency = 'tomorrow'
        elif days_left <= 3:
            subject = f'🟡 Due Soon: {tenant_name} - Room {room_number}'
            urgency = f'in {days_left} days'
        else:
            subject = f'📅 Rent Reminder: {tenant_name} - Room {room_number}'
            urgency = f'in {days_left} days'

        full_subject = f"{settings.EMAIL_SUBJECT_PREFIX}{subject}"

        text_content = f"""
Rent Payment Due Notification

Tenant: {tenant_name}
Room: {room_number}
Property: {property_name}
Amount: ₱{payment_amount:,.2f}
Due Date: {due_date_str}
Status: Due {urgency}

This notification was automatically generated by MPSAN Tenant Management System.
        """.strip()

        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background: {'#dc2626' if days_left == 0 else '#d97706' if days_left <= 3 else '#3b82f6'}; color: white; padding: 15px; border-radius: 8px 8px 0 0; }}
        .content {{ background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px; }}
        .info-table {{ width: 100%; border-collapse: collapse; }}
        .info-table td {{ padding: 8px 0; border-bottom: 1px solid #e5e7eb; }}
        .info-table td:first-child {{ color: #6b7280; width: 120px; }}
        .amount {{ font-size: 20px; font-weight: bold; color: #3b82f6; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h3 style="margin: 0;">{'🔴' if days_left == 0 else '🟠' if days_left <= 1 else '🟡' if days_left <= 3 else '📅'} Rent Due {urgency.upper()}</h3>
        </div>
        <div class="content">
            <table class="info-table">
                <tr><td>Tenant:</td><td><strong>{tenant_name}</strong></td></tr>
                <tr><td>Room:</td><td>{room_number}</td></tr>
                <tr><td>Property:</td><td>{property_name}</td></tr>
                <tr><td>Amount:</td><td><span class="amount">₱{payment_amount:,.2f}</span></td></tr>
                <tr><td>Due Date:</td><td>{due_date_str}</td></tr>
            </table>
            <p style="margin-top: 20px; color: #6b7280; font-size: 12px;">
                This notification was automatically generated by MPSAN Tenant Management System.
            </p>
        </div>
    </div>
</body>
</html>
        """

        email = EmailMultiAlternatives(
            subject=full_subject,
            body=text_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[owner_email]
        )
        email.attach_alternative(html_content, "text/html")
        email.send(fail_silently=False)

        logger.info('Owner notification email sent to %s for tenant %s', owner_email, tenant_name)
        return True, None

    except Exception as e:
        error_msg = str(e)
        logger.exception('Failed to send owner notification email: %s', error_msg)
        return False, error_msg


def send_payment_received_email(
    owner_email,
    tenant_name,
    room_number,
    amount_paid,
    payment_method,
    payment_date,
    property_name,
    payment_type='rent',
    remaining_balance=0,
    receipt_number=None
):
    """
    Send a payment received notification email to the property owner.

    Returns:
        tuple: (success: bool, error_message: str or None)
    """
    if not is_email_configured():
        return False, 'Email not configured'

    if not owner_email:
        return False, 'No owner email provided'

    try:
        if hasattr(payment_date, 'strftime'):
            date_str = payment_date.strftime('%B %d, %Y')
        else:
            date_str = str(payment_date)

        try:
            amount_val = float(amount_paid)
            amount_str = f'₱{amount_val:,.2f}'
        except (ValueError, TypeError):
            amount_str = f'₱{amount_paid}'

        type_display = {
            'rent': 'Monthly Rent',
            'advance': 'Advance Payment',
            'deposit': 'Deposit Payment',
            'utilities': 'Utilities',
            'maintenance': 'Maintenance',
            'damages': 'Damages',
        }.get(payment_type, payment_type.title() if payment_type else 'Payment')

        subject = f"✅ Payment Received: {tenant_name} - Room {room_number}"
        full_subject = f"{settings.EMAIL_SUBJECT_PREFIX}{subject}"

        text_content = f"""
Payment Received

Tenant: {tenant_name}
Room: {room_number}
Property: {property_name}
Amount: {amount_str}
Type: {type_display}
Method: {(payment_method or 'cash').title()}
Date: {date_str}
{f'Receipt #: {receipt_number}' if receipt_number else ''}
{f'Remaining Balance: ₱{float(remaining_balance):,.2f}' if remaining_balance else ''}

This notification was automatically generated by MPSAN Tenant Management System.
        """.strip()

        balance_row = ''
        if remaining_balance:
            try:
                bal = float(remaining_balance)
                if bal > 0:
                    balance_row = f'<tr><td>Balance:</td><td><span style="color: #dc2626; font-weight: bold;">₱{bal:,.2f}</span></td></tr>'
            except (ValueError, TypeError):
                pass

        receipt_row = ''
        if receipt_number:
            receipt_row = f'<tr><td>Receipt #:</td><td>{receipt_number}</td></tr>'

        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 15px; border-radius: 8px 8px 0 0; }}
        .content {{ background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px; }}
        .info-table {{ width: 100%; border-collapse: collapse; }}
        .info-table td {{ padding: 8px 0; border-bottom: 1px solid #e5e7eb; }}
        .info-table td:first-child {{ color: #6b7280; width: 120px; }}
        .amount {{ font-size: 20px; font-weight: bold; color: #10b981; }}
        .footer {{ text-align: center; padding: 15px; color: #6b7280; font-size: 12px; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h3 style="margin: 0;">✅ Payment Received</h3>
            <p style="margin: 5px 0 0 0; opacity: 0.9;">{property_name}</p>
        </div>
        <div class="content">
            <table class="info-table">
                <tr><td>Tenant:</td><td><strong>{tenant_name}</strong></td></tr>
                <tr><td>Room:</td><td>{room_number}</td></tr>
                <tr><td>Amount:</td><td><span class="amount">{amount_str}</span></td></tr>
                <tr><td>Type:</td><td>{type_display}</td></tr>
                <tr><td>Method:</td><td>{(payment_method or 'cash').title()}</td></tr>
                <tr><td>Date:</td><td>{date_str}</td></tr>
                {receipt_row}
                {balance_row}
            </table>
            <p style="margin-top: 20px; color: #6b7280; font-size: 12px;">
                This notification was automatically generated by MPSAN Tenant Management System.
            </p>
        </div>
    </div>
</body>
</html>
        """

        email = EmailMultiAlternatives(
            subject=full_subject,
            body=text_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[owner_email]
        )
        email.attach_alternative(html_content, "text/html")
        email.send(fail_silently=False)

        logger.info('Payment received email sent to %s for tenant %s', owner_email, tenant_name)
        return True, None

    except Exception as e:
        error_msg = str(e)
        logger.exception('Failed to send payment received email: %s', error_msg)
        return False, error_msg


def send_tenant_payment_confirmation_email(
    tenant_email,
    tenant_name,
    room_number,
    amount_paid,
    payment_method,
    payment_date,
    property_name,
    payment_type='rent',
    remaining_balance=0,
    receipt_number=None
):
    """
    Send a payment confirmation email to the tenant after their payment is recorded.

    Returns:
        tuple: (success: bool, error_message: str or None)
    """
    if not is_email_configured():
        return False, 'Email not configured'

    if not tenant_email:
        return False, 'No tenant email provided'

    try:
        if hasattr(payment_date, 'strftime'):
            date_str = payment_date.strftime('%B %d, %Y')
        else:
            date_str = str(payment_date)

        try:
            amount_val = float(amount_paid)
            amount_str = f'₱{amount_val:,.2f}'
        except (ValueError, TypeError):
            amount_str = f'₱{amount_paid}'

        type_display = {
            'rent': 'Monthly Rent',
            'advance': 'Advance Payment',
            'deposit': 'Deposit Payment',
            'utilities': 'Utilities',
            'maintenance': 'Maintenance',
            'damages': 'Damages',
        }.get(payment_type, payment_type.title() if payment_type else 'Payment')

        subject = f"✅ Payment Confirmation - {property_name}"
        full_subject = f"{settings.EMAIL_SUBJECT_PREFIX}{subject}"

        text_content = f"""
Payment Confirmation

Dear {tenant_name},

Your payment has been received and confirmed. Thank you!

Room: {room_number}
Amount Paid: {amount_str}
Type: {type_display}
Method: {(payment_method or 'cash').title()}
Date: {date_str}
{f'Receipt #: {receipt_number}' if receipt_number else ''}
{f'Remaining Balance: ₱{float(remaining_balance):,.2f}' if remaining_balance else ''}

Thank you for your prompt payment!

This confirmation was automatically generated by MPSAN Tenant Management System.
        """.strip()

        balance_row = ''
        if remaining_balance:
            try:
                bal = float(remaining_balance)
                if bal > 0:
                    balance_row = f'<tr><td>Remaining Balance:</td><td><span style="color: #dc2626; font-weight: bold;">₱{bal:,.2f}</span></td></tr>'
            except (ValueError, TypeError):
                pass

        receipt_row = ''
        if receipt_number:
            receipt_row = f'<tr><td>Receipt #:</td><td>{receipt_number}</td></tr>'

        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background: linear-gradient(135deg, #2563eb, #1d4ed8); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }}
        .content {{ background: #f9fafb; padding: 25px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px; }}
        .info-table {{ width: 100%; border-collapse: collapse; margin-top: 15px; }}
        .info-table td {{ padding: 10px 0; border-bottom: 1px solid #e5e7eb; }}
        .info-table td:first-child {{ color: #6b7280; width: 140px; }}
        .amount {{ font-size: 22px; font-weight: bold; color: #10b981; }}
        .thank-you {{ background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 12px; text-align: center; margin-top: 20px; color: #065f46; font-weight: 500; }}
        .footer {{ text-align: center; padding: 15px; color: #6b7280; font-size: 12px; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2 style="margin: 0;">✅ Payment Confirmed</h2>
            <p style="margin: 5px 0 0 0; opacity: 0.9;">{property_name}</p>
        </div>
        <div class="content">
            <p style="margin: 0 0 5px 0;">Dear <strong>{tenant_name}</strong>,</p>
            <p style="margin: 0; color: #6b7280;">Your payment has been received and confirmed.</p>
            <table class="info-table">
                <tr><td>Room:</td><td>{room_number}</td></tr>
                <tr><td>Amount Paid:</td><td><span class="amount">{amount_str}</span></td></tr>
                <tr><td>Type:</td><td>{type_display}</td></tr>
                <tr><td>Method:</td><td>{(payment_method or 'cash').title()}</td></tr>
                <tr><td>Date:</td><td>{date_str}</td></tr>
                {receipt_row}
                {balance_row}
            </table>
            <div class="thank-you">
                Thank you for your prompt payment!
            </div>
        </div>
        <div class="footer">
            <p>This confirmation was automatically generated by MPSAN Tenant Management System.</p>
        </div>
    </div>
</body>
</html>
        """

        email = EmailMultiAlternatives(
            subject=full_subject,
            body=text_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[tenant_email]
        )
        email.attach_alternative(html_content, "text/html")
        email.send(fail_silently=False)

        logger.info('Payment confirmation email sent to tenant %s at %s', tenant_name, tenant_email)
        return True, None

    except Exception as e:
        error_msg = str(e)
        logger.exception('Failed to send tenant payment confirmation email: %s', error_msg)
        return False, error_msg


def send_generic_styled_email(
    to_email,
    subject,
    message_body,
    property_name,
    tenant_name=None
):
    """
    Send a styled HTML email with a custom message body (for mass messages, freeform reminders, etc.).

    Returns:
        tuple: (success: bool, error_message: str or None)
    """
    if not is_email_configured():
        return False, 'Email not configured'

    if not to_email:
        return False, 'No recipient email provided'

    try:
        full_subject = f"{settings.EMAIL_SUBJECT_PREFIX}{subject}"

        greeting = f'Good Day {tenant_name}!' if tenant_name else 'Good Day!'
        text_content = f"{greeting}\n\n{message_body}\n\nBest regards,\n{property_name} Management"

        # Convert newlines in message body to <br> for HTML
        html_message = message_body.replace('\n', '<br>')

        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background: linear-gradient(135deg, #3b82f6, #6366f1); color: white; padding: 20px; border-radius: 8px 8px 0 0; }}
        .content {{ background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px; }}
        .footer {{ text-align: center; padding: 15px; color: #6b7280; font-size: 12px; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2 style="margin: 0;">Message from {property_name}</h2>
        </div>
        <div class="content">
            <p>{greeting}</p>
            <div style="margin: 15px 0; padding: 15px; background: white; border-radius: 8px; border: 1px solid #e5e7eb;">
                {html_message}
            </div>
            <p>Best regards,<br><strong>{property_name} Management</strong></p>
        </div>
        <div class="footer">
            <p>This is an automated message from MPSAN Tenant Management System.</p>
        </div>
    </div>
</body>
</html>
        """

        email = EmailMultiAlternatives(
            subject=full_subject,
            body=text_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[to_email]
        )
        email.attach_alternative(html_content, "text/html")
        email.send(fail_silently=False)

        logger.info('Generic styled email sent to %s (subject: %s)', to_email, subject)
        return True, None

    except Exception as e:
        error_msg = str(e)
        logger.exception('Failed to send generic styled email to %s: %s', to_email, error_msg)
        return False, error_msg


def send_test_email(to_email, property_name='Test Property'):
    """
    Send a test email to verify configuration.

    Args:
        to_email: Email address to send test to
        property_name: Property name for the test

    Returns:
        tuple: (success: bool, error_message: str or None)
    """
    if not is_email_configured():
        return False, 'Email not configured. Set EMAIL_HOST_USER and EMAIL_HOST_PASSWORD in .env'

    try:
        subject = f"{settings.EMAIL_SUBJECT_PREFIX}Test Email Configuration"

        text_content = f"""
This is a test email from MPSAN Tenant Management System.

If you received this email, your email configuration is working correctly!

Property: {property_name}
From: {settings.DEFAULT_FROM_EMAIL}
        """.strip()

        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 500px; margin: 0 auto; padding: 20px; text-align: center; }}
        .success {{ background: #d1fae5; border: 1px solid #10b981; border-radius: 8px; padding: 20px; }}
        .checkmark {{ font-size: 48px; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="success">
            <div class="checkmark">✅</div>
            <h2>Email Configuration Successful!</h2>
            <p>Your MPSAN Tenant Management System email notifications are working correctly.</p>
            <p><strong>Property:</strong> {property_name}</p>
        </div>
    </div>
</body>
</html>
        """

        email = EmailMultiAlternatives(
            subject=subject,
            body=text_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[to_email]
        )
        email.attach_alternative(html_content, "text/html")
        email.send(fail_silently=False)

        logger.info('Test email sent successfully to %s', to_email)
        return True, None

    except Exception as e:
        error_msg = str(e)
        logger.exception('Failed to send test email: %s', error_msg)
        return False, error_msg


def send_password_reset_email(user_email, reset_code, expiry_minutes=15):
    """
    Send a password reset email with verification code.

    Args:
        user_email: User's email address
        reset_code: 6-digit verification code
        expiry_minutes: Minutes until code expires (default 15)

    Returns:
        tuple: (success: bool, error_message: str or None)
    """
    if not is_email_configured():
        return False, 'Email not configured (EMAIL_HOST_USER or EMAIL_HOST_PASSWORD missing)'

    if not user_email:
        return False, 'No email provided'

    try:
        subject = f"{settings.EMAIL_SUBJECT_PREFIX}Password Reset Code"

        text_content = f"""
Password Reset Request

You have requested to reset your password for MPSAN Tenant Management System.

Your verification code is: {reset_code}

This code will expire in {expiry_minutes} minutes.

If you did not request this password reset, please ignore this email and your password will remain unchanged.

For security reasons, do not share this code with anyone.

Best regards,
MPSAN Tenant Management System
        """.strip()

        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background: linear-gradient(135deg, #3b82f6, #6366f1); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }}
        .content {{ background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; }}
        .code-box {{ background: white; border: 2px dashed #3b82f6; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }}
        .code {{ font-size: 32px; font-weight: bold; color: #3b82f6; letter-spacing: 8px; font-family: 'Courier New', monospace; }}
        .warning {{ background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin: 15px 0; border-radius: 4px; }}
        .footer {{ text-align: center; padding: 15px; color: #6b7280; font-size: 12px; }}
        .security-icon {{ font-size: 48px; margin-bottom: 10px; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="security-icon">🔐</div>
            <h2 style="margin: 0;">Password Reset Request</h2>
        </div>
        <div class="content">
            <p>You have requested to reset your password for <strong>MPSAN Tenant Management System</strong>.</p>

            <p>Enter this verification code to reset your password:</p>

            <div class="code-box">
                <div class="code">{reset_code}</div>
                <p style="margin: 10px 0 0 0; color: #6b7280; font-size: 14px;">Expires in {expiry_minutes} minutes</p>
            </div>

            <div class="warning">
                <p style="margin: 0;"><strong>⚠️ Security Notice:</strong></p>
                <ul style="margin: 5px 0; padding-left: 20px;">
                    <li>Do not share this code with anyone</li>
                    <li>MPSAN staff will never ask for this code</li>
                    <li>If you didn't request this, ignore this email</li>
                </ul>
            </div>

            <p style="margin-top: 20px;">If you did not request this password reset, please ignore this email. Your password will remain unchanged.</p>

            <p>Best regards,<br><strong>MPSAN Tenant Management System</strong></p>
        </div>
        <div class="footer">
            <p>This is an automated security message. Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>
        """

        email = EmailMultiAlternatives(
            subject=subject,
            body=text_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[user_email]
        )
        email.attach_alternative(html_content, "text/html")
        email.send(fail_silently=False)

        logger.info('Password reset email sent to %s', user_email)
        return True, None

    except Exception as e:
        error_msg = str(e)
        logger.exception('Failed to send password reset email to %s: %s', user_email, error_msg)
        return False, error_msg


def send_two_factor_email(user_email, code, expiry_minutes=10):
    """
    Send a 2FA verification code email during login.

    Returns:
        tuple: (success: bool, error_message: str or None)
    """
    if not is_email_configured():
        return False, 'Email not configured (EMAIL_HOST_USER or EMAIL_HOST_PASSWORD missing)'

    if not user_email:
        return False, 'No email provided'

    try:
        subject = f"{settings.EMAIL_SUBJECT_PREFIX}Login Verification Code"

        text_content = f"""
Login Verification Code

Someone is trying to sign in to your MPSAN Tenant Management System account.

Your verification code is: {code}

This code will expire in {expiry_minutes} minutes.

If you did not attempt to sign in, please change your password immediately.

For security reasons, do not share this code with anyone.

Best regards,
MPSAN Tenant Management System
        """.strip()

        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background: linear-gradient(135deg, #10b981, #3b82f6); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }}
        .content {{ background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; }}
        .code-box {{ background: white; border: 2px dashed #10b981; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }}
        .code {{ font-size: 32px; font-weight: bold; color: #10b981; letter-spacing: 8px; font-family: 'Courier New', monospace; }}
        .warning {{ background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin: 15px 0; border-radius: 4px; }}
        .footer {{ text-align: center; padding: 15px; color: #6b7280; font-size: 12px; }}
        .security-icon {{ font-size: 48px; margin-bottom: 10px; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="security-icon">🔑</div>
            <h2 style="margin: 0;">Login Verification</h2>
        </div>
        <div class="content">
            <p>Someone is trying to sign in to your <strong>MPSAN Tenant Management System</strong> account.</p>

            <p>Enter this code to complete your sign-in:</p>

            <div class="code-box">
                <div class="code">{code}</div>
                <p style="margin: 10px 0 0 0; color: #6b7280; font-size: 14px;">Expires in {expiry_minutes} minutes</p>
            </div>

            <div class="warning">
                <p style="margin: 0;"><strong>⚠️ Security Notice:</strong></p>
                <ul style="margin: 5px 0; padding-left: 20px;">
                    <li>Do not share this code with anyone</li>
                    <li>MPSAN staff will never ask for this code</li>
                    <li>If you didn't try to sign in, change your password immediately</li>
                </ul>
            </div>

            <p>Best regards,<br><strong>MPSAN Tenant Management System</strong></p>
        </div>
        <div class="footer">
            <p>This is an automated security message. Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>
        """

        email = EmailMultiAlternatives(
            subject=subject,
            body=text_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[user_email]
        )
        email.attach_alternative(html_content, "text/html")
        email.send(fail_silently=False)

        logger.info('2FA verification email sent to %s', user_email)
        return True, None

    except Exception as e:
        error_msg = str(e)
        logger.exception('Failed to send 2FA email to %s: %s', user_email, error_msg)
        return False, error_msg


def send_lockout_email(user_email, failed_attempts=5, lockout_minutes=120):
    """
    Send account lockout notification email.

    Args:
        user_email: Email of locked account
        failed_attempts: Number of failed attempts that triggered lockout
        lockout_minutes: Minutes until lockout expires automatically

    Returns:
        tuple: (success: bool, error_message: str or None)
    """
    if not is_email_configured():
        return False, 'Email not configured (EMAIL_HOST_USER or EMAIL_HOST_PASSWORD missing)'

    if not user_email:
        return False, 'No email provided'

    try:
        subject = f"{settings.EMAIL_SUBJECT_PREFIX}Account Locked - Security Alert"

        text_content = f"""
Account Locked - Security Alert

Your MPSAN Tenant Management System account has been locked after {failed_attempts} failed login attempts.

Your account will automatically unlock after {lockout_minutes} minutes.

If you need to access your account sooner, use the "Forgot password?" link on the login page to reset your password and unlock your account immediately.

If you did not attempt to log in, someone may be trying to access your account. We recommend changing your password as soon as possible.

Best regards,
MPSAN Tenant Management System
        """.strip()

        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background: linear-gradient(135deg, #dc2626, #991b1b); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }}
        .content {{ background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; }}
        .alert {{ background: #fef2f2; border-left: 4px solid #dc2626; padding: 12px; margin: 15px 0; border-radius: 4px; }}
        .info {{ background: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px; margin: 15px 0; border-radius: 4px; }}
        .footer {{ text-align: center; padding: 15px; color: #6b7280; font-size: 12px; }}
        .lock-icon {{ font-size: 48px; margin-bottom: 10px; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="lock-icon">🔒</div>
            <h2 style="margin: 0;">Account Locked</h2>
            <p style="margin: 5px 0 0 0; opacity: 0.9;">Security Alert</p>
        </div>
        <div class="content">
            <div class="alert">
                <p style="margin: 0;"><strong>Your account has been locked</strong> after {failed_attempts} failed login attempts.</p>
            </div>

            <p>Your account will automatically unlock after <strong>{lockout_minutes} minutes</strong>.</p>

            <div class="info">
                <p style="margin: 0;"><strong>Need access sooner?</strong> Use the "Forgot password?" link on the login page to reset your password and unlock your account immediately.</p>
            </div>

            <div class="alert">
                <p style="margin: 0;"><strong>Wasn't you?</strong> Someone may be trying to access your account. We recommend changing your password as soon as possible.</p>
            </div>

            <p>Best regards,<br><strong>MPSAN Tenant Management System</strong></p>
        </div>
        <div class="footer">
            <p>This is an automated security message. Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>
        """

        email = EmailMultiAlternatives(
            subject=subject,
            body=text_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[user_email]
        )
        email.attach_alternative(html_content, "text/html")
        email.send(fail_silently=False)

        logger.info('Account lockout email sent to %s', user_email)
        return True, None

    except Exception as e:
        error_msg = str(e)
        logger.exception('Failed to send lockout email to %s: %s', user_email, error_msg)
        return False, error_msg
