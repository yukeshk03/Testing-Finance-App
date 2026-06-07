// Finance Tracker Service Worker v2
// Handles: caching, push notifications, background SMS detection

const CACHE_NAME = 'finance-tracker-v2';
const ASSETS = ['/', '/index.html', '/manifest.json'];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch (cache-first for assets, network-first for API) ─────────────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── Push Notification handler ─────────────────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: 'Finance Tracker', body: 'New transaction detected', smsId: null };
  try { data = e.data ? e.data.json() : data; } catch {}

  e.waitUntil(
    self.registration.showNotification(data.title || 'Transaction Detected', {
      body: data.body || 'Tap to review and categorize.',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      tag: 'finance-sms-' + (data.smsId || Date.now()),
      renotify: true,
      requireInteraction: true,
      data: { url: '/?tab=sms', smsId: data.smsId },
      actions: [
        { action: 'open', title: 'Review Now' },
        { action: 'dismiss', title: 'Later' }
      ]
    })
  );
});

// ── Notification click → open app on SMS tab ─────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;

  const targetUrl = (e.notification.data && e.notification.data.url) || '/?tab=sms';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // If app is already open, focus and navigate
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({ type: 'OPEN_SMS_TAB', smsId: e.notification.data?.smsId });
          return;
        }
      }
      // Otherwise open new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// ── Message from app: show local notification ────────────────────────────
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SHOW_SMS_NOTIFICATION') {
    const { amount, merchant, smsId, txType } = e.data;
    const sign = txType === 'income' ? '+' : '-';
    self.registration.showNotification('New Transaction Detected', {
      body: `${sign}Rs.${amount} ${txType === 'income' ? 'credited' : 'debited'} — ${merchant}\nTap to categorize.`,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      tag: 'finance-sms-' + smsId,
      renotify: true,
      requireInteraction: true,
      data: { url: '/?tab=sms', smsId },
      actions: [
        { action: 'open', title: 'Categorize' },
        { action: 'dismiss', title: 'Later' }
      ]
    });
  }
});
