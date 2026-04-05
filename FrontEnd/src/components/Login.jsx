import { useState } from 'react'
import { setTokens, API_BASE, getDeviceFingerprint, getDeviceName } from '../auth'

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [showForgot, setShowForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [resetStep, setResetStep] = useState(1) // 1: email, 2: verify code, 3: new password
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetMessage, setResetMessage] = useState('')
  const [resetLoading, setResetLoading] = useState(false)

  // 2FA state
  const [show2FA, setShow2FA] = useState(false)
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [tempToken, setTempToken] = useState('')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [twoFALoading, setTwoFALoading] = useState(false)
  const [twoFAError, setTwoFAError] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    setError('')
    if (!email || !password) {
      setError('Please enter both email and password.')
      return
    }
    // call token endpoint — send `email` field (backend accepts email-only)
    fetch(`${API_BASE}/api/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email,
        password,
        device_name: getDeviceName(),
        device_fingerprint: getDeviceFingerprint()
      }),
    })
      .then((r) => r.json().then((data) => ({ status: r.status, data })))
      .then(({ status, data }) => {
        if (status >= 200 && status < 300 && data.access) {
          setTokens({ access: data.access, refresh: data.refresh })
          onLogin()
        } else if (status >= 200 && status < 300 && data.two_factor_required) {
          // 2FA required — show code input
          setTempToken(data.temp_token)
          setMaskedEmail(data.two_factor_email)
          setShow2FA(true)
          setTwoFactorCode('')
          setTwoFAError('')
        } else {
          // Handle validation errors - DRF may return detail, non_field_errors, or nested arrays
          const msg = data.detail
            || (Array.isArray(data.non_field_errors) ? data.non_field_errors[0] : null)
            || (typeof data === 'object' ? Object.values(data).flat()[0] : null)
            || 'Invalid credentials'
          setError(typeof msg === 'string' ? msg : 'Invalid credentials')
        }
      })
      .catch((err) => setError('Network error'))
  }

  const handleVerify2FA = async (e) => {
    e.preventDefault()
    setTwoFAError('')
    if (!twoFactorCode) {
      setTwoFAError('Please enter the verification code')
      return
    }
    setTwoFALoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/token/verify-2fa/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          temp_token: tempToken,
          code: twoFactorCode,
          device_fingerprint: getDeviceFingerprint(),
          device_name: getDeviceName(),
        }),
      })
      const data = await res.json()
      if (res.ok && data.access) {
        setTokens({ access: data.access, refresh: data.refresh })
        onLogin()
      } else {
        setTwoFAError(data.error || 'Invalid verification code')
      }
    } catch (err) {
      setTwoFAError('Network error. Please try again.')
    } finally {
      setTwoFALoading(false)
    }
  }

  const close2FA = () => {
    setShow2FA(false)
    setTempToken('')
    setTwoFactorCode('')
    setTwoFAError('')
    setMaskedEmail('')
  }

  const handleRequestReset = async (e) => {
    e.preventDefault()
    setResetMessage('')
    setResetLoading(true)

    if (!forgotEmail) {
      setResetMessage('Please enter your email address')
      setResetLoading(false)
      return
    }

    try {
      const res = await fetch(`${API_BASE}/api/password-reset/request/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail })
      })

      const data = await res.json()

      if (res.ok && data.success) {
        // Use the message from backend (handles both success and "if registered" cases)
        setResetMessage(data.message || 'Reset code sent! Check your email.')
        setResetStep(2)
      } else {
        setResetMessage(data.error || 'Failed to send reset code')
      }
    } catch (err) {
      setResetMessage('Network error. Please try again.')
    } finally {
      setResetLoading(false)
    }
  }

  const handleVerifyCode = async (e) => {
    e.preventDefault()
    setResetMessage('')
    setResetLoading(true)

    if (!resetCode) {
      setResetMessage('Please enter the verification code')
      setResetLoading(false)
      return
    }

    try {
      const res = await fetch(`${API_BASE}/api/password-reset/verify-code/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: forgotEmail,
          code: resetCode
        })
      })

      const data = await res.json()

      if (res.ok && data.success) {
        setResetMessage('Code verified! Please enter your new password.')
        setResetStep(3)
      } else {
        setResetMessage(data.error || 'Invalid or expired code')
      }
    } catch (err) {
      setResetMessage('Network error. Please try again.')
    } finally {
      setResetLoading(false)
    }
  }

  const handleChangePassword = async (e) => {
    e.preventDefault()
    setResetMessage('')
    setResetLoading(true)

    if (!newPassword || !confirmPassword) {
      setResetMessage('Please enter and confirm your new password')
      setResetLoading(false)
      return
    }

    if (newPassword !== confirmPassword) {
      setResetMessage('Passwords do not match')
      setResetLoading(false)
      return
    }

    if (newPassword.length < 8) {
      setResetMessage('Password must be at least 8 characters long')
      setResetLoading(false)
      return
    }

    try {
      const res = await fetch(`${API_BASE}/api/password-reset/change-password/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: forgotEmail,
          code: resetCode,
          new_password: newPassword
        })
      })

      const data = await res.json()

      if (res.ok && data.success) {
        setResetMessage('Password changed successfully! Please log in.')
        setTimeout(() => {
          setShowForgot(false)
          setResetStep(1)
          setForgotEmail('')
          setResetCode('')
          setNewPassword('')
          setConfirmPassword('')
          setResetMessage('')
        }, 2000)
      } else {
        setResetMessage(data.error || 'Failed to reset password')
      }
    } catch (err) {
      setResetMessage('Network error. Please try again.')
    } finally {
      setResetLoading(false)
    }
  }

  const closeForgotModal = () => {
    setShowForgot(false)
    setResetStep(1)
    setForgotEmail('')
    setResetCode('')
    setNewPassword('')
    setConfirmPassword('')
    setResetMessage('')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-900">
      <div className="w-full max-w-md mx-4 p-8 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-md">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-1">Welcome back</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Sign in to continue to MP-SAN Tenant Management</p>

        {error && (
          <div className={`text-sm mb-3 p-3 rounded-lg ${
            error.includes('locked')
              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
              : error.includes('attempt')
                ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
                : 'text-red-600 dark:text-red-400'
          }`}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="••••••••"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600" />
            <button
              type="button"
              onClick={() => setShowForgot(true)}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              Forgot password?
            </button>
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
          >
            Sign in
          </button>
        </form>
      </div>

      {showForgot && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
            {/* Step 1: Enter Email */}
            {resetStep === 1 && (
              <>
                <div className="text-center mb-4">
                  <div className="text-4xl mb-2">🔐</div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">Reset Password</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Enter your email to receive a verification code
                  </p>
                </div>

                {resetMessage && (
                  <div className={`mb-4 p-3 rounded text-sm ${
                    resetMessage.includes('sent')
                      ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                      : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                  }`}>
                    {resetMessage}
                  </div>
                )}

                <form onSubmit={handleRequestReset} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="you@company.com"
                      disabled={resetLoading}
                    />
                  </div>

                  <div className="flex justify-end space-x-2">
                    <button
                      type="button"
                      onClick={closeForgotModal}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                      disabled={resetLoading}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                      disabled={resetLoading}
                    >
                      {resetLoading ? 'Sending...' : 'Send Code'}
                    </button>
                  </div>
                </form>
              </>
            )}

            {/* Step 2: Verify Code */}
            {resetStep === 2 && (
              <>
                <div className="text-center mb-4">
                  <div className="text-4xl mb-2">📧</div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">Enter Verification Code</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Check your email for the 6-digit code
                  </p>
                </div>

                {resetMessage && (
                  <div className={`mb-4 p-3 rounded text-sm ${
                    resetMessage.includes('verified')
                      ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                      : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                  }`}>
                    {resetMessage}
                  </div>
                )}

                <form onSubmit={handleVerifyCode} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Verification Code
                    </label>
                    <input
                      type="text"
                      value={resetCode}
                      onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-center text-2xl font-mono tracking-widest"
                      placeholder="000000"
                      maxLength={6}
                      disabled={resetLoading}
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Code expires in 15 minutes
                    </p>
                  </div>

                  <div className="flex justify-between space-x-2">
                    <button
                      type="button"
                      onClick={() => setResetStep(1)}
                      className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:underline"
                      disabled={resetLoading}
                    >
                      ← Back
                    </button>
                    <div className="flex space-x-2">
                      <button
                        type="button"
                        onClick={closeForgotModal}
                        className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                        disabled={resetLoading}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                        disabled={resetLoading}
                      >
                        {resetLoading ? 'Verifying...' : 'Verify Code'}
                      </button>
                    </div>
                  </div>
                </form>
              </>
            )}

            {/* Step 3: Enter New Password */}
            {resetStep === 3 && (
              <>
                <div className="text-center mb-4">
                  <div className="text-4xl mb-2">🔑</div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">Set New Password</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Enter your new password
                  </p>
                </div>

                {resetMessage && (
                  <div className={`mb-4 p-3 rounded text-sm ${
                    resetMessage.includes('successfully')
                      ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                      : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                  }`}>
                    {resetMessage}
                  </div>
                )}

                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      New Password
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="••••••••"
                      disabled={resetLoading}
                      autoFocus
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Must be at least 8 characters
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Confirm Password
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="••••••••"
                      disabled={resetLoading}
                    />
                  </div>

                  <div className="flex justify-between space-x-2">
                    <button
                      type="button"
                      onClick={() => setResetStep(2)}
                      className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:underline"
                      disabled={resetLoading}
                    >
                      ← Back
                    </button>
                    <div className="flex space-x-2">
                      <button
                        type="button"
                        onClick={closeForgotModal}
                        className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                        disabled={resetLoading}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                        disabled={resetLoading}
                      >
                        {resetLoading ? 'Changing...' : 'Change Password'}
                      </button>
                    </div>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* 2FA Verification Modal */}
      {show2FA && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">🔑</div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Verify Your Identity</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                We sent a verification code to <strong>{maskedEmail}</strong>
              </p>
            </div>

            {twoFAError && (
              <div className="mb-4 p-3 rounded text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
                {twoFAError}
              </div>
            )}

            <form onSubmit={handleVerify2FA} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Verification Code
                </label>
                <input
                  type="text"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-center text-2xl font-mono tracking-widest"
                  placeholder="000000"
                  maxLength={6}
                  disabled={twoFALoading}
                  autoFocus
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Code expires in 10 minutes
                </p>
              </div>

              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={close2FA}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                  disabled={twoFALoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  disabled={twoFALoading || twoFactorCode.length < 6}
                >
                  {twoFALoading ? 'Verifying...' : 'Verify'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
