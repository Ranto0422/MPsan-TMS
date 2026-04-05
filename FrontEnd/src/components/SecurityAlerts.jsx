import { useState, useEffect } from 'react'
import { authFetch } from '../auth.js'

export default function SecurityAlerts() {
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lockoutStatus, setLockoutStatus] = useState(null)

  useEffect(() => {
    loadAlerts()
    checkLockoutStatus()

    // Auto-refresh every 10 seconds
    const interval = setInterval(() => {
      loadAlerts()
      checkLockoutStatus()
    }, 10000)

    return () => clearInterval(interval)
  }, [])

  const loadAlerts = async () => {
    try {
      const res = await authFetch('/api/security-alerts/')
      if (res.ok) {
        const data = await res.json()
        setAlerts(data.alerts)
        setError('')
      } else {
        setError('Failed to load security alerts')
      }
    } catch (e) {
      console.error('Failed to load alerts:', e)
      setError('Network error while loading alerts')
    } finally {
      setLoading(false)
    }
  }

  const checkLockoutStatus = async () => {
    try {
      const res = await authFetch('/api/lockout/status/')
      if (res.ok) {
        const data = await res.json()
        setLockoutStatus(data.is_locked ? data : null)
      }
    } catch (e) {
      console.error('Failed to check lockout status:', e)
    }
  }

  const unlockAccount = async () => {
    if (!confirm('Remove account lockout? This will allow login attempts immediately.')) return

    try {
      const res = await authFetch('/api/lockout/unlock/', {
        method: 'POST'
      })

      if (res.ok) {
        const data = await res.json()
        alert(data.message)
        checkLockoutStatus()
        loadAlerts()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to unlock account')
      }
    } catch (e) {
      console.error('Failed to unlock account:', e)
      setError('Network error while unlocking account')
    }
  }

  const acknowledgeAlert = async (alertId) => {
    try {
      const res = await authFetch('/api/security-alerts/acknowledge/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alert_id: alertId })
      })

      if (res.ok) {
        loadAlerts()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to acknowledge alert')
      }
    } catch (e) {
      console.error('Failed to acknowledge alert:', e)
      setError('Network error while acknowledging alert')
    }
  }

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-50 border-red-400 dark:bg-red-900/20 dark:border-red-700'
      case 'warning':
        return 'bg-yellow-50 border-yellow-400 dark:bg-yellow-900/20 dark:border-yellow-700'
      default:
        return 'bg-blue-50 border-blue-400 dark:bg-blue-900/20 dark:border-blue-700'
    }
  }

  const getSeverityBadge = (severity) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-600 text-white'
      case 'warning':
        return 'bg-yellow-500 text-white'
      default:
        return 'bg-blue-600 text-white'
    }
  }

  const getAlertIcon = (alertType) => {
    switch (alertType) {
      case 'ip_change': return '🌍'
      case 'new_device': return '📱'
      case 'failed_login': return '❌'
      case 'account_lockout': return '🔒'
      case 'suspicious_activity': return '⚠️'
      case 'session_revoked': return '🚪'
      default: return '🔔'
    }
  }

  const getAlertTypeLabel = (alertType) => {
    return alertType
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  if (loading) {
    return (
      <div className="p-4 md:p-6 text-center text-gray-600 dark:text-gray-400 text-sm">
        Loading security alerts...
      </div>
    )
  }

  return (
    <div className="p-3 md:p-6 max-w-4xl mx-auto overflow-hidden">
      <div className="mb-4">
        <h2 className="text-lg md:text-2xl font-bold text-gray-900 dark:text-white">Security Alerts</h2>
        <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Review security events and notifications for your account
        </p>
      </div>

      {/* Account Lockout Banner */}
      {lockoutStatus && (
        <div className="mb-4 p-3 md:p-4 bg-red-100 dark:bg-red-900/30 border-2 border-red-600 dark:border-red-700 rounded-xl">
          <div className="flex items-start gap-3">
            <span className="text-2xl flex-shrink-0">🔒</span>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-red-900 dark:text-red-300">Account Locked</h3>
              <p className="text-sm text-red-800 dark:text-red-400 mt-0.5">{lockoutStatus.reason}</p>
              <p className="text-sm font-medium text-red-900 dark:text-red-300 mt-1">
                Until: {new Date(lockoutStatus.locked_until).toLocaleString()}
              </p>
              <p className="text-xs text-red-700 dark:text-red-500">
                (~{lockoutStatus.minutes_remaining} min remaining)
              </p>
              <button
                onClick={unlockAccount}
                className="mt-2 px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
              >
                Unlock Now
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">
          {error}
        </div>
      )}

      {alerts.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-gray-500 dark:text-gray-400 text-base">No security alerts</p>
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">Your account activity looks normal</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {alerts.map(alert => (
            <div
              key={alert.alert_id}
              className={`p-3 md:p-4 border-l-4 rounded-lg transition-all ${getSeverityColor(alert.severity)} ${alert.acknowledged ? 'opacity-50' : ''}`}
            >
              {/* Header row */}
              <div className="flex items-start gap-2 mb-1.5">
                <span className="text-xl flex-shrink-0 leading-none mt-0.5">{getAlertIcon(alert.alert_type)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="font-bold text-gray-900 dark:text-white text-sm">
                      {getAlertTypeLabel(alert.alert_type)}
                    </h3>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${getSeverityBadge(alert.severity)}`}>
                      {alert.severity.toUpperCase()}
                    </span>
                    {alert.acknowledged && (
                      <span className="text-xs px-1.5 py-0.5 bg-gray-500 text-white rounded font-medium">
                        ACK
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <p className="text-sm text-gray-800 dark:text-gray-200 mb-1 pl-0 sm:pl-7 break-words">
                {alert.description}
              </p>

              {alert.ip_address && (
                <p className="text-xs text-gray-600 dark:text-gray-400 pl-0 sm:pl-7">
                  IP: <span className="font-mono break-all">{alert.ip_address}</span>
                </p>
              )}

              <div className="flex items-center justify-between mt-2 pl-0 sm:pl-7 gap-2 flex-wrap">
                <p className="text-xs text-gray-500 dark:text-gray-500">
                  {new Date(alert.created_at).toLocaleString()}
                </p>
                {!alert.acknowledged && (
                  <button
                    onClick={() => acknowledgeAlert(alert.alert_id)}
                    className="px-2.5 py-1 bg-gray-500 text-white text-xs rounded-lg hover:bg-gray-600 transition-colors font-medium flex-shrink-0"
                  >
                    Acknowledge
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 p-3 md:p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
        <h4 className="font-medium text-blue-900 dark:text-blue-300 mb-1.5 text-sm">Security Tips</h4>
        <ul className="text-xs md:text-sm text-blue-800 dark:text-blue-400 space-y-1 list-disc list-inside">
          <li>Review alerts regularly to ensure no unauthorized access</li>
          <li>If you see unfamiliar IP addresses, revoke those sessions immediately</li>
          <li>Account lockout alerts may indicate someone trying to guess your password</li>
          <li>Consider changing your password if you notice suspicious activity</li>
        </ul>
      </div>
    </div>
  )
}
