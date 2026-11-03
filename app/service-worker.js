/*
 * Hangbitch — service worker.
 *
 * Purpose: let Hangbitch start from the local cache when the machine is offline
 * and keep the deployed shell up to date without asking users to clear their
 * browser cache.
 *
 * Cache policy:
 *   * HTML navigations (index.html) — network first, cached copy as offline
 *     fallback; the network response is stored so the next offline load is fresh.
 *   * Static shell assets (CSS, JS, manifest, icon) — cache first; assets are
 *     precached at install and refreshed whenever the cache version changes.
 *   * Anything cross-origin or non-GET is ignored.
 *
 * Only caches it owns (hangbitch-*) are ever created or deleted, so user data
 * (keys, settings, in-memory round state) is never touched.
 */
'use strict';

var CACHE_NAME = 'hangbitch-shell-v2';

// Only ever manages caches whose name starts with this prefix.
var CACHE_PREFIX = 'hangbitch-';

var SHELL = [
  './index.html',
  './paint.css',
  './app.js',
  './crypto.js',
  './default-keys.js',
  './game-logic.js',
  './key-management.js',
  './manifest.json',
  './assets/icon.svg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // Cache what we can; a single miss must not break the install.
      return Promise.all(SHELL.map(function (asset) {
        return cache.add(asset).catch(function () {
          return null;
        });
      }));
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        // Leave every cache that is not ours alone. Delete obsolete Hangbitch
        // shells so a stale app.js/paint.css can never keep being served.
        if (name !== CACHE_NAME && name.indexOf(CACHE_PREFIX) === 0) {
          return caches.delete(name);
        }
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// The page can ask the waiting worker to skip waiting and take over (for
// example when the user clicks "Reload" on the update notice).
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isNavigation(request) {
  return request.mode === 'navigate';
}

self.addEventListener('fetch', function (event) {
  var request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  var url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }

  // Same-origin only. Anything else is left completely alone.
  if (url.origin !== self.location.origin) {
    return;
  }

  if (isNavigation(request)) {
    // HTML: network first so the latest deployed HTML is always served.
    // Fall back to the cached shell (or index.html) when offline.
    event.respondWith(
      fetch(request).then(function (response) {
        if (response && response.ok && response.type === 'basic') {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, copy).catch(function () {
              return null;
            });
          });
        }
        return response;
      }).catch(function () {
        return caches.match(request).then(function (cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // Static assets: cache first, then network, then store the network copy.
  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) {
        return cached;
      }
      return fetch(request).then(function (response) {
        if (response && response.ok && response.type === 'basic') {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, copy).catch(function () {
              return null;
            });
          });
        }
        return response;
      }).catch(function () {
        return Response.error();
      });
    })
  );
});
