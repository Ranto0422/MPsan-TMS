// Service Worker for MP-SAN Tenant Management System
// Handles push notifications and caching

const CACHE_NAME = 'mpsan-v2';
const SW_VERSION = '1.0.2';

// Detect iOS
const isIOS = /iPad|iPhone|iPod/.test(self.navigator?.userAgent || '');

console.log('[SW] Service Worker loaded, version:', SW_VERSION, 'iOS:', isIOS);

// Install event - skip waiting to activate immediately
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker v' + SW_VERSION);
  // Force the waiting service worker to become the active service worker
  self.skipWaiting();
});

// Activate event - claim clients immediately
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker v' + SW_VERSION);
  // Claim all clients immediately so we don't need a page refresh
  event.waitUntil(
    self.clients.claim().then(() => {
      console.log('[SW] Clients claimed, SW is now active');
      // Clean up old caches in background
      return caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      });
    })
  );
});

// Push event - handle incoming push notifications
self.addEventListener('push', (event) => {
  console.log('[SW] Push received');
  
  let data = {
    title: 'MP-SAN Notification',
    body: 'You have a new notification',
    icon: '/vite.svg',
    tag: 'mpsan-notification',
    data: {}
  };
  
  if (event.data) {
    try {
      const payload = event.data.json();
      console.log('[SW] Push payload:', JSON.stringify(payload));
      data = { ...data, ...payload };
    } catch (e) {
      console.log('[SW] Push text:', event.data.text());
      data.body = event.data.text();
    }
  }
  
  // iOS Safari doesn't support all notification options
  // Keep it simple for maximum compatibility
  const options = {
    body: data.body,
    icon: data.icon || '/vite.svg',
    tag: data.tag || 'mpsan-notification',
    data: data.data || {},
  };
  
  // Only add these on non-iOS (they can cause issues on Safari)
  if (!isIOS) {
    options.badge = data.badge || '/vite.svg';
    options.vibrate = [200, 100, 200];
    options.requireInteraction = data.requireInteraction || false;
    if (data.actions) {
      options.actions = data.actions;
    }
  }
  
  console.log('[SW] Showing notification:', data.title);
  
  event.waitUntil(
    self.registration.showNotification(data.title, options)
      .then(() => console.log('[SW] Notification shown successfully'))
      .catch(err => console.error('[SW] Failed to show notification:', err))
  );
});

// Notification click event - handle user clicking on notification
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event);
  
  event.notification.close();
  
  const urlToOpen = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Check if there's already a window open
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.focus();
            if (event.notification.data?.url) {
              client.navigate(urlToOpen);
            }
            return;
          }
        }
        // Open new window if none exists
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// Handle notification close
self.addEventListener('notificationclose', (event) => {
  console.log('[SW] Notification closed:', event);
});

// Background sync (for offline support)
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
});
