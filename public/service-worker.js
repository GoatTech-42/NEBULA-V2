// service-worker.js — Nebula V2 offline shell
//
// Strategy:
//   * Core HTML/CSS/JS assets are cached on install ("precache").
//   * At runtime we use a network-first fallback to cache for our own
//     same-origin navigations — this means the app *always* tries the
//     live copy first and falls back to cache only when offline.
//   * Firebase SDK URLs, Firestore, RTDB, auth, and reCAPTCHA are NEVER
//     intercepted — realtime features need direct network access and
//     they already have their own aggressive caching.
//   * Bumping CACHE_VERSION invalidates old caches and the SW activates
//     the new one next load. We also listen for a SKIP_WAITING message
//     so the client can force an immediate upgrade.
//
// This is compatible with the Firebase Spark (free) plan because it is
// served as a static asset from Firebase Hosting — no Cloud Functions
// required.

// @@deploy:CACHE_VERSION  (kept in sync by deploy.py with public/js/version.js)
const CACHE_VERSION = 'nebula-v2.4.2-b630759';
const CORE_CACHE    = `core-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

// Shell assets — these get pre-cached so the app can cold-boot offline.
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/main.html',
  '/404.html',
  '/css/layout.css',
  '/css/themes/og.css',
  '/js/firebase.js',
  '/js/app.js',
  '/js/version.js',
  '/js/icons.js',
  '/js/goatcoin.js',
  '/js/games.js',
  '/js/profile.js',
  '/js/shop.js',
  '/manifest.webmanifest',
];

// Hostnames we should NEVER touch — let them go straight to the network.
const BYPASS_HOSTS = [
  'firestore.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebaseappcheck.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'nebulahistorians-default-rtdb.firebaseio.com',
  's-usc1a-nss-2077.firebaseio.com', // RTDB websocket endpoints
  'www.googletagmanager.com',
  'www.google-analytics.com',
  'www.google.com',          // reCAPTCHA
  'www.gstatic.com',         // firebase SDKs — let browser cache them
  'recaptcha.net',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS).catch(() => {
        // Don't fail install if one asset is missing (e.g. old deploy)
        return Promise.all(CORE_ASSETS.map((u) =>
          cache.add(u).catch(() => null)
        ));
      }))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((k) => k !== CORE_CACHE && k !== RUNTIME_CACHE)
        .map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Bypass realtime / auth / analytics endpoints entirely.
  if (BYPASS_HOSTS.some((h) => url.hostname.endsWith(h))) return;

  // Different origin (CDN game assets, etc.) — let the browser handle it.
  if (url.origin !== self.location.origin) return;

  // HTML navigations → network-first with cache fallback.
  const accept = req.headers.get('accept') || '';
  const isDoc  = req.mode === 'navigate' || accept.includes('text/html');

  if (isDoc) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          return caches.match('/main.html') || caches.match('/index.html');
        })
    );
    return;
  }

  // Static assets → stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
