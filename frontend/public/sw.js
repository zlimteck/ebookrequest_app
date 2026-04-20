const CACHE_NAME = 'ebookrequest-v1';
const OFFLINE_URL = '/offline.html';

const PRECACHE_ASSETS = [
  '/',
  '/offline.html',
  '/img/logo.png',
  '/img/favicon.ico',
];

// ── Installation : précache les assets essentiels ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

// ── Activation : nettoie les anciens caches ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch : network-first pour API, cache-first pour assets ──
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorer les requêtes non HTTP(S)
  if (!url.protocol.startsWith('http')) return;

  // API : network-first, pas de cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'Hors ligne', offline: true }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Navigation (pages HTML) : network-first, fallback offline.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Autres assets : cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      });
    })
  );
});

// ── Push notifications ──
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch (e) {
    data = { title: 'EbookRequest', body: event.data?.text() || '' };
  }

  const options = {
    body: data.body || '',
    icon: data.icon || '/img/logo.png',
    badge: '/img/logo.png',
    data: { url: data.url || '/dashboard' },
    vibrate: [100, 50, 100],
    requireInteraction: false,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'EbookRequest', options)
  );
});

// ── Clic sur une notification → ouvre/focus l'app ──
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Si une fenêtre est déjà ouverte, la focus et naviguer
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Sinon ouvrir une nouvelle fenêtre
      return clients.openWindow(targetUrl);
    })
  );
});
