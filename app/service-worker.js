/*
 * Hangbitch — service worker.
 *
 * Purpose: let Hangbitch start from the local cache when the machine is offline
 * and keep the deployed shell up to date without asking users to clear their
 * browser cache.
 *
 * Cache policy:
 *   * Same-origin GET requests (HTML navigations and static shell assets) —
 *     network first when online, store the fresh response, and fall back to the
 *     cached copy when offline. This ensures a normal browser refresh retrieves
 *     the latest deployed version without clearing site data.
 *   * Anything cross-origin or non-GET is ignored.
 *
 * Only caches it owns (hangbitch-*) are ever created or deleted, so user data
 * (keys, settings, in-memory round state, localStorage) is never touched.
 */
'use strict';

var CACHE_NAME = 'hangbitch-shell-v4';

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
      return Promise.all(SHELL.map(function (asset) {
        return cache.add(asset).catch(function () {
          return null;
        });
      }));
    }).then(function () {
      // Allow the new worker to move toward activation promptly; the page still
      // controls when to reload (guarded) so we avoid disruptive loops.
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
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

// The page can ask the waiting worker to take over (kept for compatibility).
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

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

  if (url.origin !== self.location.origin) {
    return;
  }

  // Network-first for navigations and static shell assets. A normal online
  // refresh gets the latest deployed files; offline falls back to cache.
  event.respondWith(
    fetch(request).then(function (response) {
      if (response && response.ok && (response.type === 'basic' || response.type === 'default')) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(request, copy).catch(function () {
            return null;
          });
        }).catch(function () {
          return null;
        });
      }
      return response;
    }).catch(function () {
      return caches.match(request).then(function (cached) {
        if (cached) {
          return cached;
        }
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return Response.error();
      });
    })
  );
});
