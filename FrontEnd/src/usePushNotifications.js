import { useState, useEffect, useCallback } from 'react'
import { authFetch } from './auth.js'

/**
 * Convert a base64 string to a Uint8Array for the applicationServerKey
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

/**
 * Hook for managing push notifications
 */
export function usePushNotifications() {
  const [permission, setPermission] = useState('default')
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [subscription, setSubscription] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [vapidPublicKey, setVapidPublicKey] = useState(null)
  const [isSupported, setIsSupported] = useState(false)

  // Check if running as standalone PWA (added to home screen)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
    window.navigator.standalone === true

  // Debug info for troubleshooting - retry a few times for iOS
  useEffect(() => {
    let attempts = 0
    const maxAttempts = 5

    const checkSupport = async () => {
      attempts++
      const hasServiceWorker = 'serviceWorker' in navigator
      const hasPushManager = 'PushManager' in window
      const hasNotification = 'Notification' in window
      
      console.log(`[Push Debug] Attempt ${attempts}/${maxAttempts} - Environment check:`, {
        hasServiceWorker,
        hasPushManager,
        hasNotification,
        isStandalone,
        userAgent: navigator.userAgent.substring(0, 80),
      })

      // Basic support check
      let supported = hasServiceWorker && hasPushManager && hasNotification

      // On iOS, we need to wait for service worker to be ready
      if (hasServiceWorker) {
        try {
          // Wait for SW registration with timeout
          const registration = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((_, reject) => setTimeout(() => reject(new Error('SW ready timeout')), 5000))
          ])
          
          // Double-check PushManager is available on the registration
          if (registration && registration.pushManager) {
            console.log('[Push Debug] Service worker ready, pushManager available')
            supported = true
          } else {
            console.log('[Push Debug] Service worker ready, but no pushManager on registration')
            // On iOS PWA, pushManager might be on window but not registration - still valid
            supported = hasPushManager && hasNotification
          }
        } catch (e) {
          console.warn('[Push Debug] SW ready check failed:', e.message)
          // Still might work - check window APIs
          supported = hasPushManager && hasNotification
        }
      }

      setIsSupported(supported)
      console.log('[Push Debug] Final isSupported:', supported)

      // If not supported and we haven't exhausted retries, try again after a delay
      // This helps with iOS where APIs might not be immediately available
      if (!supported && attempts < maxAttempts) {
        console.log(`[Push Debug] Will retry in ${attempts * 1000}ms...`)
        setTimeout(checkSupport, attempts * 1000)
      }
    }

    // Small initial delay to let iOS settle
    const timer = setTimeout(checkSupport, 500)
    return () => clearTimeout(timer)
  }, [isStandalone])

  // Get current permission and subscription status
  const checkStatus = useCallback(async () => {
    if (!isSupported) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Check browser permission
      const perm = Notification.permission
      setPermission(perm)

      // Get VAPID key and subscription status from server
      const res = await authFetch('/api/push/subscribe/', { method: 'GET' })
      if (res.ok) {
        const data = await res.json()
        setVapidPublicKey(data.vapid_public_key)
        setIsSubscribed(data.subscribed)
      }

      // Check if we have an active subscription in the browser
      const registration = await navigator.serviceWorker.ready
      const sub = await registration.pushManager.getSubscription()
      setSubscription(sub)
      
      if (sub && perm === 'granted') {
        setIsSubscribed(true)
      }
    } catch (e) {
      console.error('Error checking push status:', e)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [isSupported])

  // Helper to add timeout to promises
  const withTimeout = (promise, ms, errorMsg) => {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
    ])
  }

  // Subscribe to push notifications
  const subscribe = useCallback(async () => {
    console.log('[Push] Starting subscribe...')
    
    if (!isSupported) {
      setError('Push notifications are not supported in this browser')
      return false
    }

    setLoading(true)
    setError(null)

    try {
      // Request permission if needed
      console.log('[Push] Requesting permission...')
      const permission = await withTimeout(
        Notification.requestPermission(),
        10000,
        'Permission request timed out'
      )
      console.log('[Push] Permission result:', permission)
      setPermission(permission)

      if (permission !== 'granted') {
        setError('Notification permission denied. Please allow notifications in your browser settings.')
        setLoading(false)
        return false
      }

      // Get VAPID public key if we don't have it
      let publicKey = vapidPublicKey
      if (!publicKey) {
        console.log('[Push] Fetching VAPID key...')
        const res = await withTimeout(
          authFetch('/api/push/subscribe/', { method: 'GET' }),
          10000,
          'Failed to fetch VAPID key (timeout)'
        )
        if (res.ok) {
          const data = await res.json()
          publicKey = data.vapid_public_key
          setVapidPublicKey(publicKey)
        }
      }

      if (!publicKey) {
        setError('Could not get VAPID public key from server')
        setLoading(false)
        return false
      }

      // Wait for service worker with timeout, or try to get existing registration
      console.log('[Push] Waiting for service worker...')
      let registration
      try {
        registration = await withTimeout(
          navigator.serviceWorker.ready,
          5000,
          'SW ready timeout'
        )
      } catch (e) {
        // Fallback: try to get existing registration
        console.log('[Push] SW ready timed out, trying getRegistration...')
        registration = await navigator.serviceWorker.getRegistration('/')
        if (!registration) {
          // Re-register the service worker
          console.log('[Push] No registration found, registering SW...')
          registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
          // Wait a moment for it to activate
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }
      
      if (!registration || !registration.pushManager) {
        throw new Error('Service worker registration failed. Please refresh the page.')
      }
      console.log('[Push] Got registration, state:', registration.active?.state || 'no active worker')

      // Subscribe with the push service (this can hang on some browsers)
      const sub = await withTimeout(
        registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }),
        15000,
        'Push subscription timed out. Your browser may not support push notifications.'
      )
      console.log('[Push] Got subscription:', sub.endpoint.substring(0, 50) + '...')

      setSubscription(sub)

      // Send subscription to server
      const subJson = sub.toJSON()
      console.log('[Push] Sending subscription to server...')
      const serverRes = await withTimeout(
        authFetch('/api/push/subscribe/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: subJson.endpoint,
            keys: {
              p256dh: subJson.keys.p256dh,
              auth: subJson.keys.auth,
            },
          }),
        }),
        10000,
        'Failed to save subscription (timeout)'
      )

      if (!serverRes.ok) {
        const errData = await serverRes.json().catch(() => ({}))
        throw new Error(errData.detail || 'Failed to save subscription on server')
      }

      console.log('[Push] Subscribe complete!')
      setIsSubscribed(true)
      return true
    } catch (e) {
      console.error('[Push] Error subscribing:', e)
      setError(e.message || 'Unknown error during subscription')
      return false
    } finally {
      setLoading(false)
    }
  }, [isSupported, vapidPublicKey])

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async () => {
    console.log('[Push] Starting unsubscribe...')
    setLoading(true)
    setError(null)

    try {
      // Unsubscribe from push service
      if (subscription) {
        await withTimeout(subscription.unsubscribe(), 5000, 'Unsubscribe timed out')
      }

      // Remove from server
      await withTimeout(
        authFetch('/api/push/subscribe/', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription?.endpoint }),
        }),
        10000,
        'Server unsubscribe timed out'
      )

      setSubscription(null)
      setIsSubscribed(false)
      console.log('[Push] Unsubscribe complete')
      return true
    } catch (e) {
      console.error('[Push] Error unsubscribing:', e)
      setError(e.message)
      return false
    } finally {
      setLoading(false)
    }
  }, [subscription])

  // Reset: clear all subscriptions and re-subscribe (useful when VAPID keys change)
  const reset = useCallback(async () => {
    console.log('[Push] Starting reset...')
    setLoading(true)
    setError(null)

    try {
      // Clear browser subscription
      if (subscription) {
        try {
          await withTimeout(subscription.unsubscribe(), 5000, 'Browser unsubscribe timed out')
        } catch (e) {
          console.warn('[Push] Error unsubscribing from browser:', e)
        }
      }

      // Clear all server subscriptions
      console.log('[Push] Clearing server subscriptions...')
      await withTimeout(
        authFetch('/api/push/subscribe/', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clear_all: true }),
        }),
        10000,
        'Server clear timed out'
      )

      setSubscription(null)
      setIsSubscribed(false)

      // Now re-subscribe with fresh keys
      console.log('[Push] Reset complete, now re-subscribing...')
      setLoading(false)
      return await subscribe()
    } catch (e) {
      console.error('[Push] Error resetting:', e)
      setError(e.message || 'Reset failed')
      setLoading(false)
      return false
    }
  }, [subscription, subscribe])

  // Send a test notification
  const sendTest = useCallback(async (title, body) => {
    try {
      const res = await authFetch('/api/push/test/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body }),
      })
      const data = await res.json()
      return { ok: res.ok, ...data }
    } catch (e) {
      return { ok: false, detail: e.message }
    }
  }, [])

  // Check status on mount
  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  return {
    isSupported,
    permission,
    isSubscribed,
    loading,
    error,
    subscribe,
    unsubscribe,
    reset,
    sendTest,
    checkStatus,
  }
}

export default usePushNotifications
