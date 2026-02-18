const CACHE_NAME = 'cinevault-lite';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/images/icone-192.png'
];

// 1. Service Worker Installation
self.addEventListener('install', event => {
  self.skipWaiting(); // Force immediate activation
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// 2. Cleanup Old Caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// 3. Request Interception (Network Strategy)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // --- API SECURITY ---
  if (event.request.method !== 'GET' || 
      url.pathname.includes('/login') || 
      url.pathname.includes('/check-session') || 
      url.pathname.includes('/download') ||
      url.pathname.includes('/music') ||
      url.pathname.includes('/plex')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
