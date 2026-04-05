// Enhanced auth helper for long-lived PWA authentication
// Includes proactive token refresh, activity tracking, and device fingerprinting

const API_BASE = import.meta.env.VITE_API_URL || ''

const ACCESS_KEY = 'access_token'
const REFRESH_KEY = 'refresh_token'
const LAST_ACTIVITY_KEY = 'last_activity'

// Track ongoing refresh to prevent race conditions
let refreshPromise = null
let refreshTimer = null
let activityTimer = null

export function setTokens({ access, refresh }) {
  try {
    if (access) localStorage.setItem(ACCESS_KEY, access)
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh)
    updateLastActivity()

    // Start proactive refresh timer
    scheduleTokenRefresh()

    // Start activity tracking
    startActivityTracking()
  } catch (e) {
    console.error('Error saving tokens:', e)
  }
}

export function clearTokens() {
  try {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(LAST_ACTIVITY_KEY)

    // Clear timers
    if (refreshTimer) clearTimeout(refreshTimer)
    if (activityTimer) clearInterval(activityTimer)
  } catch (e) {}
}

export function getAccess() {
  try { return localStorage.getItem(ACCESS_KEY) } catch (e) { return null }
}

export function getRefresh() {
  try { return localStorage.getItem(REFRESH_KEY) } catch (e) { return null }
}

export function updateLastActivity() {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString())
  } catch (e) {}
}

export function getLastActivity() {
  try {
    const timestamp = localStorage.getItem(LAST_ACTIVITY_KEY)
    return timestamp ? parseInt(timestamp) : null
  } catch (e) {
    return null
  }
}

// Decode JWT to get expiration time
function decodeToken(token) {
  try {
    const base64Url = token.split('.')[1]
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    )
    return JSON.parse(jsonPayload)
  } catch (e) {
    return null
  }
}

// Schedule proactive token refresh (5 minutes before expiration)
function scheduleTokenRefresh() {
  // Clear existing timer
  if (refreshTimer) clearTimeout(refreshTimer)

  const access = getAccess()
  if (!access) return

  const payload = decodeToken(access)
  if (!payload || !payload.exp) return

  const expiresAt = payload.exp * 1000 // Convert to milliseconds
  const now = Date.now()
  const timeUntilExpiry = expiresAt - now

  // Refresh 5 minutes before expiration (or immediately if already expired)
  const refreshIn = Math.max(0, timeUntilExpiry - (5 * 60 * 1000))

  console.log(`Token refresh scheduled in ${Math.round(refreshIn / 1000)}s`)

  refreshTimer = setTimeout(async () => {
    console.log('Proactively refreshing token...')
    const newAccess = await refreshAccess()
    if (newAccess) {
      console.log('Token refreshed successfully')
      // Schedule next refresh
      scheduleTokenRefresh()
    } else {
      console.log('Token refresh failed - session expired')
    }
  }, refreshIn)
}

// Track user activity and send to backend periodically
function startActivityTracking() {
  // Clear existing timer
  if (activityTimer) clearInterval(activityTimer)

  // Send activity ping every 30 seconds (for faster session revocation detection)
  activityTimer = setInterval(async () => {
    const access = getAccess()
    if (!access) {
      clearInterval(activityTimer)
      return
    }

    try {
      await authFetch('/api/check-activity/')
      updateLastActivity()
    } catch (e) {
      console.error('Activity tracking failed:', e)
    }
  }, 30 * 1000) // 30 seconds
}

async function refreshAccess() {
  // If a refresh is already in progress, wait for it
  if (refreshPromise) {
    return refreshPromise
  }

  const refresh = getRefresh()
  if (!refresh) return null

  // Create a new refresh promise
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/token/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh }),
      })
      if (!res.ok) {
        refreshPromise = null
        clearTokens()
        return null
      }
      const data = await res.json()
      if (data.access) {
        // Update only access token (refresh token may have rotated)
        setTokens({
          access: data.access,
          refresh: data.refresh || refresh  // Use new refresh if rotated
        })
        refreshPromise = null
        return data.access
      }
    } catch (e) {
      refreshPromise = null
      clearTokens()
      return null
    }
    refreshPromise = null
    return null
  })()

  return refreshPromise
}

// Fetch with Authorization header; on 401 try to refresh and retry once
export async function authFetch(input, init = {}) {
  // Update activity timestamp
  updateLastActivity()

  // Prepend API_BASE for relative API paths
  const url = typeof input === 'string' && input.startsWith('/api/')
    ? `${API_BASE}${input}`
    : input

  const access = getAccess()
  const headers = new Headers(init.headers || {})
  if (access) headers.set('Authorization', `Bearer ${access}`)
  headers.set('Accept', 'application/json')

  const res = await fetch(url, { ...init, headers })
  if (res.status !== 401) return res

  // Check if this is a session revocation error
  try {
    const errorData = await res.clone().json()
    if (errorData.code === 'session_revoked' || errorData.code === 'session_not_found') {
      // Session was revoked - log out immediately without trying to refresh
      clearTokens()
      window.dispatchEvent(new Event('auth:sessionExpired'))
      return res
    }
  } catch (e) {
    // If we can't parse the error, continue with normal refresh logic
  }

  // Try refresh
  const newAccess = await refreshAccess()
  if (!newAccess) {
    clearTokens()
    try {
      window.dispatchEvent(new Event('auth:sessionExpired'))
    } catch (e) {}
    return res
  }

  // Retry with new token
  headers.set('Authorization', `Bearer ${newAccess}`)
  return fetch(url, { ...init, headers })
}

// Get device fingerprint for security tracking
export function getDeviceFingerprint() {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  ctx.textBaseline = 'top'
  ctx.font = '14px Arial'
  ctx.fillText('fingerprint', 2, 2)
  const canvasData = canvas.toDataURL()

  const fingerprint = {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    screen: `${screen.width}x${screen.height}x${screen.colorDepth}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    canvas: canvasData.slice(-50), // Last 50 chars
  }

  // Hash the fingerprint
  const str = JSON.stringify(fingerprint)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash = hash & hash
  }
  return hash.toString(36)
}

export function getDeviceName() {
  const ua = navigator.userAgent

  // Detect device type
  if (/mobile/i.test(ua)) {
    if (/iphone/i.test(ua)) return 'iPhone'
    if (/ipad/i.test(ua)) return 'iPad'
    if (/android/i.test(ua)) return 'Android Phone'
    return 'Mobile Device'
  }

  // Desktop browsers
  if (/chrome/i.test(ua)) return 'Chrome Browser'
  if (/firefox/i.test(ua)) return 'Firefox Browser'
  if (/safari/i.test(ua)) return 'Safari Browser'
  if (/edge/i.test(ua)) return 'Edge Browser'

  return 'Desktop Browser'
}

// Build a WebSocket URL from VITE_API_URL (or fall back to current host)
// e.g. VITE_API_URL="https://api.example.com" → "wss://api.example.com/ws/..."
export function buildWsUrl(path) {
  let base = API_BASE
  if (base) {
    // Replace http(s) with ws(s)
    base = base.replace(/^http/, 'ws')
  } else {
    // No API_BASE configured — derive from current page location
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    base = `${proto}://${window.location.host}`
  }
  // Remove trailing slash from base
  base = base.replace(/\/+$/, '')
  return `${base}${path}`
}

export const API_BASE_EXPORT = API_BASE
export { API_BASE }

export default {
  setTokens,
  clearTokens,
  getAccess,
  getRefresh,
  authFetch,
  getDeviceFingerprint,
  getDeviceName,
  buildWsUrl,
  API_BASE: API_BASE_EXPORT,
}
