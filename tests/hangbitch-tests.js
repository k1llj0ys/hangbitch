/*
 * Hangbitch — verification tests.
 *
 * Hangbitch is a standalone, self-contained app: it ships every file it needs
 * in app/ and never reaches outside this folder. This suite proves that — it
 * checks the app's own layout, rules, crypto, illustration, chrome, offline
 * cache and storage, all without looking at any other project.
 *
 * Run:  node tests/hangbitch-tests.js
 * (The crypto round-trip needs Web Crypto. On Node 18 add
 *  --experimental-global-webcrypto; without it those cases are skipped.)
 */
'use strict';

const { runAll, ok, eq, includes, notIncludes, match, noMatch, loadNamespace, read, code, exists } = require('./harness.js');

const indexHtml = read('app/index.html');
const appJs = read('app/app.js');
const appCode = code('app/app.js');
const keyMgmt = read('app/key-management.js');
const keyMgmtCode = code('app/key-management.js');
const styleCss = read('app/paint.css');
const sw = read('app/service-worker.js');

/* ---------------------------------------------------------------- helpers */

const PART_ORDER = ['head', 'body', 'left-arm', 'right-arm', 'left-leg', 'right-leg', 'beer'];

function countParts(source) {
  return (source.match(/data-part="/g) || []).length;
}

function pemBody(pem) {
  return String(pem || '').split(/\r?\n/).filter(function (line) {
    return line && !/^-----/.test(line.trim());
  }).join('');
}

/** Every data-action an element in the page carries. */
function pageActions(html) {
  return Array.from(new Set((html.match(/data-action="([^"]+)"/g) || []).map(function (s) {
    return s.replace(/data-action="|"/g, '');
  })));
}

/* ---------------------------------------------------------------- cases */

const cases = [
  {
    name: '1. Hangbitch ships as a complete, self-contained app',
    fn: async () => {
      [
        'app/index.html', 'app/paint.css', 'app/app.js',
        'app/crypto.js', 'app/game-logic.js', 'app/default-keys.js',
        'app/key-management.js', 'app/manifest.json',
        'app/service-worker.js', 'app/assets/icon.svg'
      ].forEach(function (file) {
        ok(exists(file), file + ' must exist');
        ok(read(file).length > 0, file + ' must not be empty');
      });
    }
  },
  {
    name: '2. Hangbitch is fully self-contained — nothing outside app/ is needed',
    fn: async () => {
      includes(indexHtml, 'paint.css', 'Hangbitch loads its own Paint theme');
      notIncludes(indexHtml, 'styles.css', 'Hangbitch must not load a foreign stylesheet');

      // The app shell must reach for its own files only: no parent-relative
      // paths, so it runs from any folder (or a Pages sub-path) on its own.
      ['app/index.html', 'app/app.js', 'app/key-management.js', 'app/service-worker.js', 'app/crypto.js', 'app/game-logic.js', 'app/default-keys.js', 'app/manifest.json']
        .forEach(function (file) {
          noMatch(read(file), /["'(]\.\.\//, file + ' must not use a parent-relative path');
        });
    }
  },
  {
    name: '3. the game is the seven-life Hangman it is meant to be',
    fn: async () => {
      const L = loadNamespace('app/game-logic.js', 'BHLogic');
      eq(L.LIVES, 7, 'seven lives');
      eq(L.STAGES.length, 8, 'gallows plus seven stages');
      eq(L.STAGES[0], 'gallows', 'stage 0 is the bare gallows');
      eq(L.STAGES[7], 'beer', 'stage 7 is the beer');

      const round = L.createRound({ word: 'CAT' });
      eq(L.guess(round, 'Z').result, 'incorrect', 'a wrong guess still costs a life');
      eq(L.stageIndex(round), 1, 'stage 1 after one mistake');
      eq(L.guess(round, 'c').result, 'correct', 'a correct guess still reveals');
    }
  },
  {
    name: '4. the crypto core, payload format and built-in key are unchanged',
    fn: async () => {
      const C = loadNamespace('app/crypto.js', 'BHCrypto');
      eq(C.PAYLOAD_PREFIX, 'LESTERCUTE.', 'the payload format is unchanged');
      eq(C.ENVELOPE_VERSION, 1, 'the envelope version is unchanged');
      eq(C.BACKUP_TYPE, 'LESTERCUTE-PRIVATE-KEY-BACKUP', 'key backups stay interchangeable');

      const keys = loadNamespace('app/default-keys.js', 'BH_DEFAULT_KEYS');
      includes(keys.publicKeyPem, '-----BEGIN PUBLIC KEY-----', 'the built-in public key is present');
      includes(keys.privateKeyPem, '-----BEGIN PRIVATE KEY-----', 'the built-in private key is present');
    }
  },
  {
    name: '5. the illustration has exactly the seven switchable parts, beer last',
    fn: async () => {
      const found = (indexHtml.match(/data-part="([^"]+)"/g) || []).map(function (s) {
        return s.replace(/data-part="|"/g, '');
      });
      eq(found.join(','), PART_ORDER.join(','), 'head, body, arms, legs, then the beer mug');
      eq(countParts(indexHtml), 7, 'exactly seven parts — the gallows is not a life');

      PART_ORDER.forEach(function (part) {
        includes(indexHtml, 'data-part="' + part + '"', 'the ' + part + ' exists');
      });
      includes(indexHtml, 'id="doodles"', 'there is a doodle layer over the picture');
    }
  },
  {
    name: '6. every element app.js looks up exists in the page and is cached up front',
    fn: async () => {
      const pageIds = new Set((indexHtml.match(/\bid="([^"]+)"/g) || []).map(function (s) {
        return s.replace(/id="|"/g, '');
      }));

      const arrStart = appJs.indexOf('[', appJs.indexOf('function cacheElements()'));
      const arrEnd = appJs.indexOf(']', arrStart);
      eq(arrStart > -1 && arrEnd > arrStart, true, 'the cached-element list must be readable');
      const cached = new Set((appJs.slice(arrStart, arrEnd).match(/'[a-z0-9-]+'/g) || []).map(function (s) {
        return s.replace(/'/g, '');
      }));

      const referenced = new Set((appCode.match(/el\['([^']+)'\]/g) || []).map(function (s) {
        return s.replace(/el\['|'\]/g, '');
      }));
      ok(referenced.size > 20, 'the audit should find the element references');

      referenced.forEach(function (id) {
        ok(cached.has(id), "el['" + id + "'] is used but not listed in cacheElements()");
        ok(pageIds.has(id), "el['" + id + "'] is used but index.html has no id=\"" + id + '"');
      });

      (appCode.match(/\$\('([^']+)'\)/g) || []).forEach(function (s) {
        const id = s.replace(/\$\('|'\)/g, '');
        ok(pageIds.has(id), 'index.html must contain id="' + id + '"');
      });

      cached.forEach(function (id) {
        ok(pageIds.has(id), 'cacheElements() lists "' + id + '" but index.html has no such id');
      });
    }
  },
  {
    name: '7. every control in the menu bar and tool bar does something (no dead items)',
    fn: async () => {
      const actions = pageActions(indexHtml);
      ok(actions.length >= 12, 'the page should carry the menu and tool actions');
      actions.forEach(function (action) {
        includes(appCode, "case '" + action + "':", 'nothing handles the "' + action + '" action');
      });

      // The four Paint menus are all present and wired to a single delegated
      // handler that also closes a menu again.
      ['menu-file', 'menu-edit', 'menu-view', 'menu-help'].forEach(function (id) {
        includes(indexHtml, 'id="' + id + '"', 'the menu "' + id + '" exists');
        includes(appCode, "'" + id + "'", 'the menu "' + id + '" is managed by the controller');
      });
      includes(appCode, 'function closeMenus(', 'menus can be closed');
      includes(appCode, "document.addEventListener('click', onDocumentClick)", 'a click outside a menu closes it');
      includes(appCode, 'function dialogOpen(', 'dialogs are tracked');
      includes(appCode, "event.key === 'Escape'", 'Escape closes menus and dialogs');

      // Help offers both documented dialogs.
      includes(appCode, 'function showHowToPlay(', 'Help -> How to Play is implemented');
      includes(appCode, 'function showAbout(', 'Help -> About is implemented');
    }
  },
  {
    name: '8. the palette is real: 28 swatches that actually set the drawing colour',
    fn: async () => {
      const swatches = (indexHtml.match(/data-color="/g) || []).length;
      eq(swatches, 28, 'the classic 28-colour Paint palette');

      // Each swatch is a real button carrying a colour, and one is marked active.
      const firstSwatch = indexHtml.slice(indexHtml.indexOf('class="swatch swatch-1"'));
      includes(firstSwatch, 'data-color="#000000"', 'the first swatch is black');
      includes(indexHtml, 'data-color="#ffffff"', 'white is available');

      // Selecting a swatch changes the pencil colour and switches to the pencil,
      // exactly like Paint; the current-colour well shows the choice.
      includes(appCode, "closest('[data-color]')", 'swatch clicks are handled');
      includes(appCode, 'function setColor(', 'the colour can be set');
      includes(appCode, 'function selectTool(', 'the tool can be selected');
      includes(appCode, 'color-current', 'the current-colour well is updated');
      includes(appCode, "state.tool === 'eraser' ? '#ffffff' : state.color", 'the pencil draws in the chosen colour');
    }
  },
  {
    name: '9. the Paint chrome is all there and nothing external is loaded',
    fn: async () => {
      ['class="titlebar"', 'class="menubar"', 'class="toolbar"', 'class="palette"', 'class="statusbar"']
        .forEach(function (needle) {
          includes(indexHtml, needle, 'the page has ' + needle);
        });

      // Title-bar controls and the doodle tooling.
      ['titlebar-min', 'titlebar-max', 'titlebar-close'].forEach(function (id) {
        includes(indexHtml, 'id="' + id + '"', 'the title bar offers ' + id);
      });
      includes(appCode, "classList.toggle('minimized')", 'Minimize works');
      includes(appCode, "classList.toggle('maximized')", 'Maximize works');
      includes(appCode, "addEventListener('pointerdown', onCanvasPointerDown)", 'the pencil is wired to the canvas');
      includes(appCode, "createElementNS('http://www.w3.org/2000/svg'", 'doodles are drawn as SVG strokes');
      includes(appCode, 'function clearDoodles(', 'doodles can be cleared');

      // Local assets only — no CDN, no web fonts, no remote images.
      [indexHtml, styleCss, read('app/manifest.json'), read('app/assets/icon.svg')].forEach(function (source, i) {
        noMatch(source, /(?:src|href)\s*=\s*["'](?:\/\/|https?:)/i, 'file #' + i + ' must not load an external resource');
        noMatch(source, /@import\s+(?:url\()?["']?(?:\/\/|https?:)/i, 'file #' + i + ' must not @import a remote stylesheet');
        noMatch(source, /url\(\s*["']?(?:\/\/|https?:)/i, 'file #' + i + ' must not reference a remote URL');
      });
    }
  },
  {
    name: '10. Hangbitch has its own offline cache and a Pages-friendly manifest',
    fn: async () => {
      match(sw, /var CACHE_NAME = 'hangbitch-shell-v\d+';/, 'Hangbitch uses its own cache name');
      includes(sw, "'hangbitch-'", 'Hangbitch only ever manages caches it owns');

      // The shell lists only its own files, relatively, so it works from a
      // GitHub Pages sub-path as well as a custom domain.
      ['index.html', 'paint.css', 'app.js', 'crypto.js', 'default-keys.js', 'game-logic.js', 'key-management.js', 'manifest.json', 'assets/icon.svg']
        .forEach(function (file) {
          includes(sw, "'./" + file + "'", 'the offline shell must list ' + file);
        });

      const manifest = JSON.parse(read('app/manifest.json'));
      eq(manifest.name, 'Hangbitch', 'the manifest names Hangbitch');
      eq(manifest.start_url, './index.html', 'a relative start URL');
      eq(manifest.scope, './', 'a relative scope');
      includes(indexHtml, 'rel="manifest"', 'the manifest is linked');
      match(appJs, /navigator\.serviceWorker\.register\('service-worker\.js'\)/, 'the worker is registered relatively');
    }
  },
  {
    name: '11. secrets stay in memory and Hangbitch keeps its key under hb.*',
    fn: async () => {
      noMatch(appCode, /localStorage/, 'app.js must not touch localStorage directly');
      noMatch(appCode, /sessionStorage/, 'app.js must not use sessionStorage');
      noMatch(appCode, /indexedDB/, 'app.js must not use IndexedDB');
      noMatch(appCode, /document\.cookie/, 'app.js must not use cookies');
      noMatch(appCode, /console\.(log|warn|error|info)/, 'the secret must never be logged');
      noMatch(appCode, /setItem\(\s*[^)]*round/, 'the round must never be written to storage');
      includes(appCode, 'round: null', 'the round is an in-memory field');

      // By the same rule, the answer is only ever written as text, never markup.
      noMatch(appCode, /innerHTML\s*=\s*[^;]*round/, 'round data is never injected as markup');

      // Every key Hangbitch stores is namespaced under hb.*.
      includes(keyMgmt, "'hb.publicKeyPem'", 'Hangbitch remembers its public key under hb.*');
      includes(keyMgmt, "'hb.privateKeyPkcs8'", 'Hangbitch remembers its private key under hb.*');
      noMatch(keyMgmtCode, /'bh\./, 'Hangbitch storage must stay namespaced under hb.*');
      noMatch(keyMgmtCode, /round|word|hint/i, 'key-management.js must not touch round data');
      noMatch(keyMgmtCode, /fetch\(|XMLHttpRequest|sendBeacon/, 'key material never leaves the origin');
    }
  },
  {
    name: '12. the built-in key encrypts and decrypts a payload on its own',
    fn: async () => {
      if (!(globalThis.crypto && globalThis.crypto.subtle)) {
        console.log('        (skipped: run with --experimental-global-webcrypto to exercise the crypto round-trip)');
        return;
      }

      const hang = loadNamespace('app/crypto.js', 'BHCrypto');
      const keys = loadNamespace('app/default-keys.js', 'BH_DEFAULT_KEYS');

      const fpHang = await hang.publicKeyPemFingerprint(keys.publicKeyPem);
      const hangPrivate = await hang.importPrivateKeyPkcs8(hang.b64ToBytes(pemBody(keys.privateKeyPem)));

      // Self-contained: Hangbitch encrypts to its built-in public key and reads
      // it back with the matching built-in private key.
      const own = await hang.encryptForRecipient(keys.publicKeyPem, { word: 'PAINT IN A HANGMAN', hint: 'doodle' });
      includes(own, 'LESTERCUTE.', 'the payload uses the documented transport prefix');
      const readOwn = await hang.decryptPayload(own, hangPrivate, fpHang);
      eq(readOwn.word, 'PAINT IN A HANGMAN', 'Hangbitch reads its own payload');
      eq(readOwn.hint, 'doodle', 'the hint survives the round trip');
    }
  }
];

runAll('Hangbitch tests', cases).then(function (result) {
  console.log('\nManual checks that cannot be automated from Node:');
  console.log('  * open app/index.html and confirm it looks like classic Microsoft Paint');
  console.log('  * open each File / Edit / View / Help menu item and confirm it does something and closes');
  console.log('  * pick a colour, draw on the picture, then clear the doodles');
  console.log('  * confirm the seven illustration stages appear in order and the beer mug is last');
  if (result.failures.length) {
    console.log('  (' + result.failures.length + ' automated checks failed — fix those first)');
  }
});
