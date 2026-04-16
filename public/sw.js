/**
 * Service Worker for Vertex Agent — offline-first caching.
 *
 * Strategy:
 *   - Precache the app shell (index.html, JS, CSS, icons) on install.
 *   - Use cache-first for static assets, network-first for navigations.
 *   - All fetched resources are opportunistically cached for offline use.
 */

const CACHE_NAME = 'vertex-agent-v1';

// App shell files to precache (populated at build time via simple list;
// Vite hashed filenames change each build, so we also cache at runtime).
const APP_SHELL = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/manifest.json',
];

// ── Install: precache app shell ─────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  // Activate immediately without waiting for old SW to retire
  self.skipWaiting();
});

// ── Activate: clean up old caches ───────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  // Start controlling all clients immediately
  self.clients.claim();
});

// ── Fetch: cache-first for assets, network-first for navigations ────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests and cross-origin requests (e.g. LLM API calls)
  if (request.method !== 'GET') return;

  // Let LLM API / agent calls pass through without caching
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/agent')) return;

  // Navigation requests (HTML pages) — network first, fallback to cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets — cache first, fallback to network (and cache the response)
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Only cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
