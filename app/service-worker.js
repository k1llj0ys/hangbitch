/*
 * Hangbitch — service worker.
 *
 * Purpose: let Hangbitch start from the local cache when the machine is offline.
 * It only ever caches same-origin files that ship with Hangbitch. Requests to
 * any other origin are ignored entirely.
 *
 * This worker registers under the Hangbitch scope, uses its own cache name, and
 * its activate handler only ever deletes caches it owns, so a stale Hangbitch
 * shell can never be served alongside a fresh one.
 */
'use strict';

// Bump this whenever a Hangbitch shell file changes: the activate handler
// deletes every older cache, so a stale app.js/paint.css can never keep being
// served.
var CACHE_NAME = 'hangbitch-shell-v1';

// Only ever manages caches whose name starts with this prefix.
var CACHE_PREFIX = 'hangbitch-';

var SHELL = [
  './',
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
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        // Leave every cache that is not ours alone.
        if (name === CACHE_NAME || name.indexOf(CACHE_PREFIX) !== 0) {
          return null;
        }
        return caches.delete(name);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
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

  // Same-origin only. Anything else is left completely alone.
  if (url.origin !== self.location.origin) {
    return;
  }

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
        // Offline and not cached: fall back to the app shell when navigating.
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return Response.error();
      });
    })
  );
});
