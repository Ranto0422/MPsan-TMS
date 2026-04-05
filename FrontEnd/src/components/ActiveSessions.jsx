import { useState, useEffect } from 'react'
import { authFetch } from '../auth.js'

export default function ActiveSessions() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadSessions()

    // Auto-refresh every 10 seconds
    const interval = setInterval(() => {
      loadSessions()
    }, 10000)

    return () => clearInterval(interval)
  }, [])

  const loadSessions = async () => {
    try {
      const res = await authFetch('/api/sessions/')
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions)
        setError('')
      } else {
        setError('Failed to load sessions')
      }
    } catch (e) {
      console.error('Failed to load sessions:', e)
      setError('Network error while loading sessions')
    } finally {
      setLoading(false)
    }
  }

  const revokeSession = async (sessionId, lockAccount = false) => {
    const confirmMessage = lockAccount
      ? 'Revoke this session AND lock the account for 2 hours? This will prevent anyone from logging in with this account until the lockout expires.'
      : 'Revoke this session? The device will be logged out immediately.'

    if (!confirm(confirmMessage)) return

    try {
      const res = await authFetch('/api/sessions/revoke/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          lock_account: lockAccount
        })
      })

      if (res.ok) {
        const data = await res.json()
        loadSessions()

        if (lockAccount && data.locked_until) {
          alert(`Session revoked and account locked until ${new Date(data.locked_until).toLocaleString()}`)
        }
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to revoke session')
      }
    } catch (e) {
      console.error('Failed to revoke session:', e)
      setError('Network error while revoking session')
    }
  }

  const logoutAllOthers = async () => {
    if (!confirm('Logout from all other devices? You will remain logged in on this device only.')) return

    try {
      const res = await authFetch('/api/sessions/logout-all/', {
        method: 'POST'
      })

      if (res.ok) {
        const data = await res.json()
        loadSessions()
        alert(data.message || 'Logged out from all other devices')
      } else {
        setError('Failed to logout from other devices')
      }
    } catch (e) {
      console.error('Failed to logout all:', e)
      setError('Network error while logging out')
    }
  }

  if (loading) {
    return (
      <div className="p-4 md:p-6 text-center text-gray-600 dark:text-gray-400 text-sm">
        Loading sessions...
      </div>
    )
  }

  return (
    <div className="p-3 md:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
        <div>
          <h2 className="text-lg md:text-2xl font-bold text-gray-900 dark:text-white">Active Sessions</h2>
          <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Manage devices where you're currently logged in
          </p>
        </div>
        {sessions.length > 1 && (
          <button
            onClick={logoutAllOthers}
            className="shrink-0 px-3 py-1.5 md:px-4 md:py-2 bg-red-500 text-white text-sm font-medium rounded-lg hover:bg-red-600 transition-colors"
          >
            Logout All Others
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">
          {error}
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="text-center text-gray-500 dark:text-gray-400 py-8 text-sm">
          No active sessions found
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map(session => (
            <div
              key={session.session_id}
              className={`p-3 md:p-4 border rounded-xl transition-all ${
                session.is_current
                  ? 'border-green-500 bg-green-50 dark:bg-green-900/20 dark:border-green-700'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50'
              }`}
            >
              {/* Session name + badge */}
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-bold text-gray-900 dark:text-white text-sm md:text-base truncate">
                  {session.device_name}
                </h3>
                {session.is_current && (
                  <span className="shrink-0 px-2 py-0.5 bg-green-600 text-white text-xs font-medium rounded-full">
                    This device
                  </span>
                )}
              </div>

              {/* Session details */}
              <div className="grid grid-cols-1 gap-0.5 text-xs md:text-sm text-gray-600 dark:text-gray-400 mb-3">
                <div className="flex gap-1.5">
                  <span className="font-medium shrink-0">IP:</span>
                  <span className="font-mono truncate">{session.ip_address}</span>
                </div>
                <div className="flex gap-1.5">
                  <span className="font-medium shrink-0">Last active:</span>
                  <span>{new Date(session.last_activity).toLocaleString()}</span>
                </div>
                <div className="flex gap-1.5">
                  <span className="font-medium shrink-0">Logged in:</span>
                  <span>{new Date(session.created_at).toLocaleString()}</span>
                </div>
              </div>

              {/* Action buttons */}
              {!session.is_current && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => revokeSession(session.session_id, false)}
                    className="flex-1 px-3 py-1.5 bg-orange-500 text-white text-xs font-medium rounded-lg hover:bg-orange-600 transition-colors text-center"
                  >
                    Revoke Session
                  </button>
                  <button
                    onClick={() => revokeSession(session.session_id, true)}
                    className="flex-1 px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 transition-colors text-center"
                  >
                    Revoke &amp; Lock Account
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Info panels */}
      <div className="mt-4 space-y-3">
        <div className="p-3 md:p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
          <h4 className="font-medium text-blue-900 dark:text-blue-300 mb-1 text-sm">About Sessions</h4>
          <p className="text-xs md:text-sm text-blue-800 dark:text-blue-400">
            Sessions remain active for 30 days or until you log out. Sessions are automatically
            deactivated after 14 days of inactivity. If you notice any unfamiliar devices,
            revoke them immediately and consider changing your password.
          </p>
        </div>

        <div className="p-3 md:p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl">
          <h4 className="font-medium text-orange-900 dark:text-orange-300 mb-1 text-sm">Security Options</h4>
          <ul className="text-xs md:text-sm text-orange-800 dark:text-orange-400 space-y-1.5">
            <li>
              <strong>Revoke Session:</strong> Logs out the device immediately. The user can log back in
              with their password.
            </li>
            <li>
              <strong>Revoke &amp; Lock Account:</strong> Logs out the device AND prevents anyone from
              logging in for 2 hours. Use this if you suspect unauthorized access.
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
