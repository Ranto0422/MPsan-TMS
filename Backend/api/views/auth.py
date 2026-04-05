from django.contrib.auth.models import User
from django.contrib.auth import get_user_model
from rest_framework import generics, serializers
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from django.utils import timezone
from datetime import timedelta
import copy
import logging
import traceback

from ..serializers import UserSerializer, CustomTokenObtainPairSerializer
from .utils import get_client_ip


class UserCreateView(generics.CreateAPIView):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [AllowAny]


class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    # accept `email` instead of `username` in the request payload
    email = serializers.EmailField(write_only=True, required=False)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # make the configured username field optional so clients may POST only `email`
        username_field = getattr(self, 'username_field', 'username')
        if username_field in self.fields:
            self.fields[username_field].required = False
            try:
                self.fields[username_field].allow_blank = True
            except Exception:
                pass

    def validate(self, attrs):
        # move provided email into username so the parent serializer can authenticate
        email = attrs.pop('email', None)
        if email:
            UserModel = get_user_model()
            try:
                user = UserModel.objects.get(email__iexact=email)
                attrs['username'] = user.get_username()
            except UserModel.DoesNotExist:
                # Raise authentication error - user with this email doesn't exist
                raise AuthenticationFailed('No account found with this credentials.')
        elif 'username' not in attrs:
            # No email provided and no username - can't authenticate
            raise AuthenticationFailed('Email is required.')
        return super().validate(attrs)


class EmailTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer


class DebugTokenRefreshView(TokenRefreshView):
    """Wrap TokenRefreshView to return 401 for expired/invalid tokens instead of 500."""
    from api.serializers import CustomTokenRefreshSerializer
    serializer_class = CustomTokenRefreshSerializer

    def post(self, request, *args, **kwargs):
        try:
            return super().post(request, *args, **kwargs)
        except (InvalidToken, TokenError) as exc:
            # ExpiredTokenError is a subclass of InvalidToken
            detail = getattr(exc, 'detail', str(exc)) if hasattr(exc, 'detail') else 'Token is expired or invalid'
            if isinstance(detail, dict):
                msg = detail.get('detail', detail.get('msg', 'token_not_valid'))
                code = detail.get('code', 'token_not_valid')
            else:
                msg = detail if isinstance(detail, str) else 'Token is expired or invalid'
                code = 'token_not_valid'
            return Response({'detail': msg, 'code': code}, status=status.HTTP_401_UNAUTHORIZED)
        except Exception as exc:
            logging.exception('Error in token refresh: %s', exc)
            tb = traceback.format_exc()
            return Response({'detail': 'internal server error during token refresh', 'trace': tb}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    # use safe serializer to avoid unhandled DoesNotExist
    serializer_class = None  # set below after SafeTokenRefreshSerializer definition


class SafeTokenRefreshSerializer(TokenRefreshSerializer):
    """Like TokenRefreshSerializer but handles deleted/missing users gracefully."""
    def validate(self, attrs):
        refresh = self.token_class(attrs["refresh"])

        from rest_framework_simplejwt.settings import api_settings as jwt_api_settings

        user_id = refresh.payload.get(jwt_api_settings.USER_ID_CLAIM, None)
        if user_id:
            try:
                user = get_user_model().objects.get(**{jwt_api_settings.USER_ID_FIELD: user_id})
            except get_user_model().DoesNotExist:
                raise AuthenticationFailed(self.error_messages.get('no_active_account', 'No active account found for the given token.'))
            if not jwt_api_settings.USER_AUTHENTICATION_RULE(user):
                raise AuthenticationFailed(self.error_messages.get('no_active_account', 'No active account found for the given token.'))

        data = {"access": str(refresh.access_token)}

        if jwt_api_settings.ROTATE_REFRESH_TOKENS:
            if jwt_api_settings.BLACKLIST_AFTER_ROTATION:
                try:
                    refresh.blacklist()
                except AttributeError:
                    pass

            refresh.set_jti()
            refresh.set_exp()
            refresh.set_iat()
            refresh.outstand()

            data["refresh"] = str(refresh)

        return data

# assign safe serializer to debug view
DebugTokenRefreshView.serializer_class = SafeTokenRefreshSerializer


# ============================================================================
# SESSION MANAGEMENT & SECURITY VIEWS (Long-Lived PWA Authentication)
# ============================================================================

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def active_sessions_view(request):
    """Get all active sessions for the current user."""
    from ..models import UserSession
    from rest_framework_simplejwt.tokens import AccessToken
    user = request.user

    # Extract session_id from current request's JWT token
    current_session_id = None
    try:
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if auth_header.startswith('Bearer '):
            token_str = auth_header.split(' ')[1]
            token = AccessToken(token_str)
            current_session_id = token.get('session_id')
    except Exception:
        # If we can't extract session_id, fall back to None (no session will match)
        pass

    # Get all active sessions
    sessions = UserSession.objects.filter(
        user=user,
        is_active=True,
        expires_at__gt=timezone.now()
    ).order_by('-last_activity')

    session_data = []
    for session in sessions:
        session_data.append({
            'session_id': session.session_id,
            'device_name': session.device_name or 'Unknown Device',
            'ip_address': session.ip_address,
            'created_at': session.created_at.isoformat(),
            'last_activity': session.last_activity.isoformat(),
            'is_current': current_session_id and session.session_id == current_session_id,
        })

    return Response({'sessions': session_data})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def revoke_session_view(request):
    """Revoke/logout a specific session, optionally locking the account."""
    from ..models import UserSession, SecurityAlert, FailedLoginAttempt
    from django.conf import settings
    from datetime import timedelta

    user = request.user
    session_id = request.data.get('session_id')
    lock_account = request.data.get('lock_account', False)  # New parameter

    if not session_id:
        return Response({'error': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        session = UserSession.objects.get(
            session_id=session_id,
            user=user,
            is_active=True
        )
    except UserSession.DoesNotExist:
        return Response({'error': 'Session not found'}, status=status.HTTP_404_NOT_FOUND)

    # Mark session as inactive
    session.is_active = False
    session.logout_at = timezone.now()
    session.save()

    # Blacklist the refresh token
    try:
        token = OutstandingToken.objects.get(jti=session.jti)
        BlacklistedToken.objects.get_or_create(token=token)
    except OutstandingToken.DoesNotExist:
        pass

    # If lock_account is True, create a lockout to prevent re-login
    if lock_account:
        lockout_hours = getattr(settings, 'FAILED_LOGIN_LOCKOUT_HOURS', 2)
        lockout_until = timezone.now() + timedelta(hours=lockout_hours)

        # Create lockout entry
        FailedLoginAttempt.objects.create(
            email=user.email,
            ip_address=session.ip_address,
            user_agent=session.user_agent or '',
            is_locked_out=True,
            lockout_until=lockout_until
        )

        # Create critical security alert
        SecurityAlert.objects.create(
            user=user,
            alert_type='account_lockout',
            severity='critical',
            ip_address=get_client_ip(request),
            description=f'Account locked due to suspicious session from {session.device_name or "Unknown"} ({session.ip_address}). Login disabled until {lockout_until.strftime("%Y-%m-%d %H:%M")}.',
            metadata={
                'revoked_session_id': session_id,
                'lockout_until': lockout_until.isoformat(),
                'reason': 'Manual session revocation with lock'
            }
        )

        return Response({
            'message': f'Session revoked and account locked until {lockout_until.strftime("%Y-%m-%d %H:%M")}',
            'locked_until': lockout_until.isoformat()
        })
    else:
        # Create normal security alert
        SecurityAlert.objects.create(
            user=user,
            alert_type='session_revoked',
            severity='info',
            ip_address=get_client_ip(request),
            description=f'Session revoked: {session.device_name or "Unknown"} from {session.ip_address}'
        )

        return Response({'message': 'Session revoked successfully'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_all_sessions_view(request):
    """Logout from all devices except current one."""
    from ..models import UserSession
    from rest_framework_simplejwt.tokens import AccessToken
    user = request.user

    # Extract session_id from current request's JWT token
    current_session_id = None
    try:
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if auth_header.startswith('Bearer '):
            token_str = auth_header.split(' ')[1]
            token = AccessToken(token_str)
            current_session_id = token.get('session_id')
    except Exception:
        # If we can't extract session_id, don't exclude any session
        pass

    # Get all active sessions except current
    sessions = UserSession.objects.filter(
        user=user,
        is_active=True
    )
    if current_session_id:
        sessions = sessions.exclude(session_id=current_session_id)

    count = 0
    for session in sessions:
        session.is_active = False
        session.logout_at = timezone.now()
        session.save()

        # Blacklist tokens
        try:
            token = OutstandingToken.objects.get(jti=session.jti)
            BlacklistedToken.objects.get_or_create(token=token)
            count += 1
        except OutstandingToken.DoesNotExist:
            pass

    return Response({'message': f'Logged out from {count} other devices'})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def security_alerts_view(request):
    """Get security alerts for current user."""
    from ..models import SecurityAlert
    user = request.user

    # Get recent alerts (last 30 days)
    thirty_days_ago = timezone.now() - timedelta(days=30)
    alerts = SecurityAlert.objects.filter(
        user=user,
        created_at__gte=thirty_days_ago
    ).order_by('-created_at')[:50]  # Limit to 50 most recent

    alert_data = []
    for alert in alerts:
        alert_data.append({
            'alert_id': alert.alert_id,
            'alert_type': alert.alert_type,
            'severity': alert.severity,
            'description': alert.description,
            'ip_address': alert.ip_address,
            'created_at': alert.created_at.isoformat(),
            'acknowledged': alert.acknowledged,
        })

    return Response({'alerts': alert_data})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def acknowledge_alert_view(request):
    """Mark a security alert as acknowledged."""
    from ..models import SecurityAlert
    user = request.user
    alert_id = request.data.get('alert_id')

    try:
        alert = SecurityAlert.objects.get(alert_id=alert_id, user=user)
        alert.acknowledged = True
        alert.acknowledged_by = user
        alert.acknowledged_at = timezone.now()
        alert.save()
        return Response({'message': 'Alert acknowledged'})
    except SecurityAlert.DoesNotExist:
        return Response({'error': 'Alert not found'}, status=status.HTTP_404_NOT_FOUND)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def check_activity_view(request):
    """
    Check user activity and update last_activity timestamp.
    Called periodically from frontend to track inactivity.
    """
    from ..models import UserSession
    from django.conf import settings

    user = request.user
    current_ip = get_client_ip(request)

    # Update last_activity for current session
    UserSession.objects.filter(
        user=user,
        ip_address=current_ip,
        is_active=True
    ).update(last_activity=timezone.now())

    # Check for inactive sessions and deactivate them
    inactive_days = getattr(settings, 'INACTIVE_LOGOUT_DAYS', 14)
    inactive_threshold = timezone.now() - timedelta(days=inactive_days)

    inactive_sessions = UserSession.objects.filter(
        user=user,
        is_active=True,
        last_activity__lt=inactive_threshold
    )

    for session in inactive_sessions:
        session.is_active = False
        session.save()

        # Blacklist token
        try:
            token = OutstandingToken.objects.get(jti=session.jti)
            BlacklistedToken.objects.get_or_create(token=token)
        except OutstandingToken.DoesNotExist:
            pass

    return Response({'message': 'Activity tracked'})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def lockout_status_view(request):
    """Check if the current user's account is locked."""
    from ..models import FailedLoginAttempt

    user = request.user
    now = timezone.now()

    # Check for active lockout
    active_lockout = FailedLoginAttempt.objects.filter(
        email=user.email,
        is_locked_out=True,
        lockout_until__gt=now
    ).order_by('-lockout_until').first()

    if active_lockout:
        return Response({
            'is_locked': True,
            'locked_until': active_lockout.lockout_until.isoformat(),
            'reason': 'Account temporarily locked due to security concerns',
            'minutes_remaining': int((active_lockout.lockout_until - now).total_seconds() / 60)
        })
    else:
        return Response({'is_locked': False})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def unlock_account_view(request):
    """Manually unlock the account by removing all active lockouts."""
    from ..models import FailedLoginAttempt, SecurityAlert

    user = request.user
    now = timezone.now()

    # Find all active lockouts
    active_lockouts = FailedLoginAttempt.objects.filter(
        email=user.email,
        is_locked_out=True,
        lockout_until__gt=now
    )

    if not active_lockouts.exists():
        return Response({'message': 'Account is not locked'})

    # Remove all lockouts
    count = active_lockouts.count()
    active_lockouts.delete()

    # Create security alert
    SecurityAlert.objects.create(
        user=user,
        alert_type='suspicious_activity',
        severity='info',
        ip_address=get_client_ip(request),
        description=f'Account lockout manually removed by user. {count} lockout(s) cleared.'
    )

    return Response({'message': f'Account unlocked. {count} lockout(s) removed.'})


@api_view(['POST'])
@permission_classes([])  # Public endpoint - no authentication required
def request_password_reset_view(request):
    """
    Request a password reset code.
    Sends a 6-digit verification code to the user's email.
    """
    from ..models import PasswordResetCode, AuditLog
    from ..email_service import send_password_reset_email
    from django.contrib.auth import get_user_model
    import random
    from datetime import timedelta

    email = request.data.get('email', '').strip().lower()

    if not email:
        return Response({'error': 'Email is required'}, status=status.HTTP_400_BAD_REQUEST)

    User = get_user_model()

    # Check if user exists (must be in User table, not Tenant table)
    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        # For security, don't reveal if email exists or not
        # Still return success to prevent email enumeration
        return Response({
            'message': 'If this email is registered, a reset code will be sent.',
            'success': True
        })

    # Generate 6-digit code
    reset_code = ''.join([str(random.randint(0, 9)) for _ in range(6)])

    # Create reset code record
    expires_at = timezone.now() + timedelta(minutes=15)

    PasswordResetCode.objects.create(
        user=user,
        code=reset_code,
        email=email,
        ip_address=get_client_ip(request),
        expires_at=expires_at
    )

    # Send email
    success, error = send_password_reset_email(email, reset_code, expiry_minutes=15)

    if not success:
        return Response(
            {'error': f'Failed to send email: {error}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )

    # Log the request
    AuditLog.objects.create(
        event='Password Reset Requested',
        user=email,
        user_ref=user,
        ip_address=get_client_ip(request),
        severity='info',
        details=f'Password reset code sent to {email}'
    )

    return Response({
        'message': 'Reset code sent to your email. Please check your inbox.',
        'success': True
    })


@api_view(['POST'])
@permission_classes([])  # Public endpoint - no authentication required
def verify_reset_code_only_view(request):
    """
    Verify the reset code without changing password.
    This is step 2 - just check if the code is valid.
    """
    from ..models import PasswordResetCode
    from django.contrib.auth import get_user_model

    email = request.data.get('email', '').strip().lower()
    code = request.data.get('code', '').strip()

    if not email or not code:
        return Response(
            {'error': 'Email and code are required'},
            status=status.HTTP_400_BAD_REQUEST
        )

    User = get_user_model()

    # Check if user exists
    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        return Response(
            {'error': 'Invalid code'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Clean up expired codes first
    now = timezone.now()
    PasswordResetCode.objects.filter(
        expires_at__lt=now
    ).delete()

    # Find valid reset code
    try:
        reset_record = PasswordResetCode.objects.get(
            user=user,
            code=code,
            is_used=False,
            expires_at__gt=now
        )

        # Code is valid
        return Response({
            'message': 'Code verified successfully',
            'success': True
        })
    except PasswordResetCode.DoesNotExist:
        return Response(
            {'error': 'Invalid or expired code'},
            status=status.HTTP_400_BAD_REQUEST
        )


@api_view(['POST'])
@permission_classes([])  # Public endpoint - no authentication required
def verify_reset_code_and_change_password_view(request):
    """
    Verify the reset code and change password.
    """
    from ..models import PasswordResetCode, AuditLog, SecurityAlert
    from django.contrib.auth import get_user_model

    email = request.data.get('email', '').strip().lower()
    code = request.data.get('code', '').strip()
    new_password = request.data.get('new_password', '')

    if not email or not code or not new_password:
        return Response(
            {'error': 'Email, code, and new password are required'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Validate password strength
    if len(new_password) < 8:
        return Response(
            {'error': 'Password must be at least 8 characters long'},
            status=status.HTTP_400_BAD_REQUEST
        )

    User = get_user_model()

    # Check if user exists
    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        return Response(
            {'error': 'Invalid email or code'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Clean up expired codes first
    now = timezone.now()
    PasswordResetCode.objects.filter(
        expires_at__lt=now
    ).delete()

    # Find valid reset code
    try:
        reset_record = PasswordResetCode.objects.get(
            user=user,
            code=code,
            is_used=False,
            expires_at__gt=now
        )
    except PasswordResetCode.DoesNotExist:
        # Log failed attempt
        AuditLog.objects.create(
            event='Invalid Password Reset Attempt',
            user=email,
            user_ref=user,
            ip_address=get_client_ip(request),
            severity='warning',
            details=f'Invalid or expired reset code used for {email}'
        )

        return Response(
            {'error': 'Invalid or expired code. Please request a new one.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Change password
    user.set_password(new_password)
    user.save()

    # Mark code as used
    reset_record.is_used = True
    reset_record.used_at = timezone.now()
    reset_record.save()

    # Clear all lockouts and failed login attempts (unlock account)
    from ..models import FailedLoginAttempt
    FailedLoginAttempt.objects.filter(email=email).delete()

    # Invalidate all existing sessions for security
    from ..models import UserSession
    UserSession.objects.filter(user=user, is_active=True).update(is_active=False)

    # Blacklist all refresh tokens
    from rest_framework_simplejwt.token_blacklist.models import OutstandingToken, BlacklistedToken
    outstanding_tokens = OutstandingToken.objects.filter(user=user)
    for token in outstanding_tokens:
        BlacklistedToken.objects.get_or_create(token=token)

    # Log successful password change
    AuditLog.objects.create(
        event='Password Changed',
        user=email,
        user_ref=user,
        ip_address=get_client_ip(request),
        severity='info',
        details=f'Password changed via reset code for {email}. Account unlocked, all sessions invalidated.'
    )

    # Create security alert
    SecurityAlert.objects.create(
        user=user,
        alert_type='suspicious_activity',
        severity='info',
        ip_address=get_client_ip(request),
        description='Password was changed via reset code. All sessions have been logged out for security.'
    )

    return Response({
        'message': 'Password changed successfully. Please log in with your new password.',
        'success': True
    })


@api_view(['POST'])
@permission_classes([AllowAny])
def verify_two_factor_view(request):
    """
    Verify 2FA code during login. Accepts temp_token + code, returns JWT tokens.
    Also trusts the device for 30 days so 2FA won't be required again.
    """
    from django.core import signing
    from rest_framework_simplejwt.tokens import RefreshToken, AccessToken
    from ..models import TwoFactorCode, TrustedDevice, UserSession, AuditLog
    from django.contrib.auth import get_user_model

    User = get_user_model()

    temp_token = request.data.get('temp_token', '')
    code = request.data.get('code', '').strip()
    device_fingerprint = request.data.get('device_fingerprint', '')
    device_name = request.data.get('device_name', '')

    if not temp_token or not code:
        return Response({'error': 'Verification code and temp_token are required'}, status=status.HTTP_400_BAD_REQUEST)

    # Verify temp token (max 10 minutes)
    try:
        payload = signing.loads(temp_token, max_age=600)
    except signing.BadSignature:
        return Response({'error': 'Verification session expired. Please log in again.'}, status=status.HTTP_400_BAD_REQUEST)

    user_id = payload.get('user_id')
    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_400_BAD_REQUEST)

    # Find a valid, unused code for this user
    now = timezone.now()
    two_fa_code = TwoFactorCode.objects.filter(
        user=user,
        code=code,
        is_used=False,
        expires_at__gt=now,
    ).order_by('-created_at').first()

    if not two_fa_code:
        return Response({'error': 'Invalid or expired verification code'}, status=status.HTTP_400_BAD_REQUEST)

    # Mark code as used
    two_fa_code.is_used = True
    two_fa_code.save(update_fields=['is_used'])

    # Invalidate all other unused codes for this user
    TwoFactorCode.objects.filter(user=user, is_used=False).update(is_used=True)

    # Trust this device for 30 days
    if device_fingerprint:
        # Update existing or create new trusted device
        TrustedDevice.objects.update_or_create(
            user=user,
            device_fingerprint=device_fingerprint,
            defaults={'trusted_until': now + timedelta(days=30)},
        )

    # Get client IP
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    ip_address = x_forwarded_for.split(',')[0].strip() if x_forwarded_for else request.META.get('REMOTE_ADDR', '0.0.0.0')
    user_agent = request.META.get('HTTP_USER_AGENT', '')

    # Generate JWT tokens (same logic as the serializer)
    refresh = RefreshToken.for_user(user)
    jti = str(refresh['jti'])
    expires_at = now + timedelta(days=30)

    # Create session
    session = UserSession.objects.create(
        user=user,
        jti=jti,
        device_name=device_name,
        device_fingerprint=device_fingerprint,
        ip_address=ip_address,
        user_agent=user_agent,
        expires_at=expires_at,
        is_active=True,
    )

    # Add session_id claim to tokens
    access = AccessToken.for_user(user)
    access['session_id'] = session.session_id
    refresh['session_id'] = session.session_id

    # Log successful 2FA login
    AuditLog.objects.create(
        event='User Login (2FA Verified)',
        user=user.email,
        user_ref=user,
        ip_address=ip_address,
        severity='info',
        details=f'2FA verified login from {ip_address} using {device_name or "Unknown device"}',
    )

    return Response({
        'access': str(access),
        'refresh': str(refresh),
        'session_id': session.session_id,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_password_view(request):
    """
    Change password for the currently authenticated user.
    Requires old_password and new_password.
    """
    from ..models import AuditLog, SecurityAlert, UserSession
    from rest_framework_simplejwt.token_blacklist.models import OutstandingToken, BlacklistedToken

    user = request.user
    old_password = request.data.get('old_password')
    new_password = request.data.get('new_password')

    if not old_password or not new_password:
        return Response(
            {'error': 'Both old and new passwords are required'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Verify old password
    if not user.check_password(old_password):
        # Log failed attempt
        AuditLog.objects.create(
            event='Failed Password Change',
            user=user.email,
            user_ref=user,
            ip_address=get_client_ip(request),
            severity='warning',
            details=f'Incorrect old password provided during change attempt for {user.email}'
        )
        return Response(
            {'error': 'Incorrect old password'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Validate new password strength
    if len(new_password) < 8:
        return Response(
            {'error': 'New password must be at least 8 characters long'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Update password
    user.set_password(new_password)
    user.save()

    # Invalidate all existing sessions for security
    UserSession.objects.filter(user=user, is_active=True).update(is_active=False)

    # Blacklist all refresh tokens
    outstanding_tokens = OutstandingToken.objects.filter(user=user)
    for token in outstanding_tokens:
        BlacklistedToken.objects.get_or_create(token=token)

    # Log successful change
    AuditLog.objects.create(
        event='Password Changed',
        user=user.email,
        user_ref=user,
        ip_address=get_client_ip(request),
        severity='info',
        details=f'Password successfully changed for {user.email}'
    )

    # Create security alert
    SecurityAlert.objects.create(
        user=user,
        alert_type='suspicious_activity',
        severity='info',
        ip_address=get_client_ip(request),
        description='Your password was recently changed. All other sessions have been logged out.'
    )

    return Response({
        'message': 'Password changed successfully. All other sessions have been logged out.',
        'success': True
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def combined_activity_log_view(request):
    """Combined activity log showing audit events, security alerts, and failed login attempts."""
    from ..models import AuditLog, SecurityAlert, FailedLoginAttempt

    user = request.user

    # Get audit logs
    audit_logs = AuditLog.objects.filter(
        user_ref=user
    ).order_by('-timestamp')[:100]

    # Get security alerts
    security_alerts = SecurityAlert.objects.filter(
        user=user
    ).order_by('-created_at')[:100]

    # Get failed login attempts for this user's email
    failed_attempts = FailedLoginAttempt.objects.filter(
        email=user.email
    ).order_by('-attempted_at')[:50]

    # Combine and format all events
    events = []

    for log in audit_logs:
        events.append({
            'type': 'audit',
            'timestamp': log.timestamp.isoformat(),
            'event': log.event,
            'severity': log.severity,
            'ip_address': log.ip_address,
            'details': log.details
        })

    for alert in security_alerts:
        events.append({
            'type': 'security',
            'timestamp': alert.created_at.isoformat(),
            'event': alert.alert_type.replace('_', ' ').title(),
            'severity': alert.severity,
            'ip_address': alert.ip_address,
            'details': alert.description,
            'acknowledged': alert.acknowledged
        })

    for attempt in failed_attempts:
        events.append({
            'type': 'failed_login',
            'timestamp': attempt.attempted_at.isoformat(),
            'event': 'Failed Login Attempt',
            'severity': 'warning' if attempt.is_locked_out else 'info',
            'ip_address': attempt.ip_address,
            'details': 'Account lockout' if attempt.is_locked_out else 'Invalid credentials'
        })

    # Sort by timestamp (most recent first)
    events.sort(key=lambda x: x['timestamp'], reverse=True)

    return Response({'events': events[:100]})  # Limit to 100 most recent

# ============================================================================
# END SESSION MANAGEMENT & SECURITY VIEWS
# ============================================================================


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def sessions_count_view(request):
    """Get count of active sessions for current user."""
    from ..models import UserSession
    from django.utils import timezone

    user = request.user
    count = UserSession.objects.filter(
        user=user,
        is_active=True,
        expires_at__gt=timezone.now()
    ).count()

    return Response({'count': count})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def security_alerts_count_view(request):
    """Get count of unacknowledged security alerts for current user."""
    from ..models import SecurityAlert

    user = request.user
    count = SecurityAlert.objects.filter(
        user=user,
        acknowledged=False
    ).count()

    return Response({'count': count})
