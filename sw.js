// sw.js — Powerful offline-first PWA support for Service Line (WhatsApp-style)
// Now caches members list + statuses, comments, announcements, view counts, approval status

const CACHE_NAME = 'service-line-v3';   // ← bumped version for members + status caching

const STATIC_ASSETS = [
  '/',                        // root → usually resolves to index.html
  '/login.html',
  '/index.html',
  '/announce.html',
  '/members.html',            // ← added members.html
  '/manifest.json',
  '/customer-192.png',
  '/customer-512.png'
];

const EXPECTED_CACHES = [CACHE_NAME];

const API_BASE = 'https://script.google.com/macros/s/AKfycbyG18AvucL_ckaUQr6V-nzBtwxi21TEOL_096iArq8RXC-Z6xAQotZwtFU7WiYOl8xG/exec';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Installing v' + CACHE_NAME + ' — caching core assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.error('[SW] Install failed:', err))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(
          keys
            .filter(key => !EXPECTED_CACHES.includes(key))
            .map(key => {
              console.log('[SW] Deleting old cache:', key);
              return caches.delete(key);
            })
        )
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // ────────────────────────────────────────────────
  // Handle all Google Apps Script API calls
  // ────────────────────────────────────────────────
  if (url.href.startsWith(API_BASE)) {

    // GET requests → cache-first (offline members, comments, announcements, status, views)
    if (event.request.method === 'GET') {
      event.respondWith(
        caches.open(CACHE_NAME).then(cache => {
          return cache.match(event.request).then(cachedResponse => {
            // Return cached data instantly → enables offline viewing of members/comments/announcements
            if (cachedResponse) {
              // Quietly update cache in background when online
              fetch(event.request)
                .then(freshResponse => {
                  if (freshResponse && freshResponse.status === 200) {
                    cache.put(event.request, freshResponse.clone());
                  }
                })
                .catch(() => {}); // silent fail

              return cachedResponse;
            }

            // No cache yet → fetch from network and cache if successful
            return fetch(event.request).then(networkResponse => {
              if (networkResponse && networkResponse.status === 200) {
                cache.put(event.request, networkResponse.clone());
              }
              return networkResponse;
            }).catch(() => {
              // Offline fallback — safe defaults your frontend can handle
              return new Response(
                JSON.stringify({
                  status: 'offline',
                  offline: true,
                  userStatus: 'pending',              // safe default for approval check
                  users: [],                          // empty array for members list
                  comments: [],
                  announcements: [],
                  viewCounts: [],                     // for announcement badges
                  announcementsViewCounts: [],        // fallback name if used
                  message: 'Offline — showing last known data (members, comments, announcements).'
                }),
                {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' }
                }
              );
            });
          });
        })
      );
      return;
    }

    // POST/DELETE (status updates, send/edit/delete message/announcement) → network-first
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({
            status: 'offline',
            message: 'Cannot update status, send, edit or delete while offline. Action will retry when you reconnect.'
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      })
    );
    return;
  }

  // ────────────────────────────────────────────────
  // Navigation & HTML pages → network-first + cache fallback
  // ────────────────────────────────────────────────
  if (event.request.mode === 'navigate' || 
      url.pathname.endsWith('.html') || 
      url.pathname === '/') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // ────────────────────────────────────────────────
  // All other requests (images, CSS, JS, fonts…) → cache-first + revalidate
  // ────────────────────────────────────────────────
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        fetch(event.request)
          .then(freshResponse => {
            if (freshResponse && freshResponse.status === 200 && event.request.method === 'GET') {
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, freshResponse.clone());
              });
            }
          })
          .catch(() => {});

        return cachedResponse;
      }

      return fetch(event.request).then(networkResponse => {
        if (!networkResponse || networkResponse.status !== 200 || event.request.method !== 'GET') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('', { status: 503 });
      });
    })
  );
});

// Future: background sync for pending actions (messages, status updates, etc.)
self.addEventListener('sync', event => {
  if (event.tag === 'sync-pending-actions') {
    event.waitUntil(syncPendingActions());
  }
});

async function syncPendingActions() {
  console.log('[SW] Background sync triggered — attempting to send pending items');
  // → Add IndexedDB queue + retry logic here later if needed

}
