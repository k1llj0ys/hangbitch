/*
 * Hangbitch — the Paint-themed controller.
 *
 * One page, five views (toggled by the .hidden class), five jobs:
 *   home    — pick a job: "Play a game" or "Generate a word"
 *   play    — type a word yourself, or paste an encrypted payload
 *   game    — the five-life board
 *   encrypt — turn a secret word into a payload for the host
 *   keys    — see / change the key pair
 *
 * What makes Hangbitch its own thing is the costume: a Windows 10-era
 * Microsoft Paint chrome around the game —
 *   - a modern title bar with Minimize / Maximize / Close,
 *   - a File / Home / View ribbon,
 *   - tool buttons (Pencil, Eraser, Clear, New game, Restart, Hint),
 *   - a square color palette that sets the colour you draw with,
 *   - a freehand doodle layer over the illustration,
 *   - a status bar, and
 *   - modern dialogs for help and game results.
 *
 * Key handling:
 *   - a built-in key pair ships in default-keys.js, so both jobs work with no
 *     setup at all;
 *   - a key generated or restored here is remembered in this browser
 *     (localStorage, under the `hb.*` namespace) and
 *     takes priority over the built-in one;
 *   - "Use built-in key" drops the saved key and goes back to the default.
 *
 * Privacy notes enforced by this file:
 *   - the secret word and hint live only in `state.round` (memory) and in the
 *     #answer-text / #hint-text nodes while the round is on screen;
 *   - they are never written to localStorage, sessionStorage, cookies, logs or
 *     the network;
 *   - the private key lives only in `state.privateKey` (memory) plus, when the
 *     player generated/restored their own, the copy BHKeys keeps on purpose.
 */
(function () {
  'use strict';

  var C = window.BHCrypto;
  var L = window.BHLogic;
  var K = window.BHKeys;

  var STAGE_CAPTIONS = {
    0: 'Gallows only — five mistakes and she gets a beer.',
    1: 'Head with hair. One life down.',
    2: 'Body. Two lives down.',
    3: 'Arms. Three lives down.',
    4: 'Legs. Four lives down — one life left!',
    5: 'She got her beer. Game over.'
  };

  var VIEW_TIPS = {
    home: 'Pick a job to begin.',
    play: 'Type a word, or paste an encrypted payload.',
    game: 'Guess with the on-screen keys or your keyboard.',
    encrypt: 'Encrypt a word, then copy the payload to the host.',
    keys: 'Compare fingerprints before sharing a payload.'
  };

  var HOW_TO_PLAY =
    '<p>Type a word or paste an encrypted payload, then guess letters one at a time.</p>' +
    '<ul>' +
      '<li>A correct guess reveals every occurrence and costs nothing.</li>' +
      '<li>A wrong guess costs one life. You have five.</li>' +
      '<li>Spaces, punctuation and digits are shown automatically.</li>' +
      '<li>Guess with the on-screen keys or your physical keyboard.</li>' +
      '<li>The fifth wrong guess adds the beer mug — game over.</li>' +
    '</ul>' +
    '<p>Below the picture you can doodle with the Pencil, rub it out with the Eraser, ' +
    'and pick a color from the palette. Nothing you draw is saved.</p>';

  var ABOUT_TEXT =
    '<p><strong>Hangbitch</strong> — a five-life game of Hangman with a modern ' +
    'Microsoft Paint-style interface.</p>' +
    '<p>Everything runs in your browser. No accounts, no network requests, no analytics.</p>' +
    '<p>Words are sealed with RSA-OAEP and AES-GCM through the native Web Crypto API. ' +
    'The secret word and the hint live only in memory and are never written to storage.</p>' +
    '<p>A built-in key pair ships with the app, so it works out of the box; the key tools ' +
    'let you use your own pair instead.</p>';

  var state = {
    privateKey: null,      // memory only
    publicKeyPem: null,
    fingerprint: null,
    keyCreatedAt: null,
    keySource: null,       // 'default' | 'user'
    round: null,
    busy: false,
    tool: 'pencil',        // 'pencil' | 'eraser'
    color: '#000000',
    doodling: false,
    activeDoodle: null,
    gameOverTimer: null,    // pending game-over dialog timer
    messageTimer: null,     // pending message fade-out timer
    winTimer: null,           // delayed win bubble timer
    winDialogTimer: null      // delayed win message-dialog timer
  };

  // The round whose word DOM currently exists in #word-display. A full rebuild
  // is required whenever the round changes (e.g. starting a new game with a
  // different word); only re-renders of the same round (letter guesses) may
  // update tiles in place.
  var renderedRound = null;

  // View display preferences (persisted in localStorage)
  var viewPrefs = {
    showWordNum: false,   // 'View word num' — unchecked by default
    showWordCount: true   // 'View word count' — checked by default
  };

  function loadViewPrefs() {
    try {
      var stored = localStorage.getItem('hb.viewPrefs');
      if (stored) {
        var parsed = JSON.parse(stored);
        if (typeof parsed.showWordNum === 'boolean') {
          viewPrefs.showWordNum = parsed.showWordNum;
        }
        if (typeof parsed.showWordCount === 'boolean') {
          viewPrefs.showWordCount = parsed.showWordCount;
        }
      }
    } catch (e) {
      // ignore storage errors; use defaults
    }
  }

  function saveViewPrefs() {
    try {
      localStorage.setItem('hb.viewPrefs', JSON.stringify(viewPrefs));
    } catch (e) {
      // ignore storage errors
    }
  }

  // Service-worker update lifecycle state.
  var swUpdating = false;           // true while reload-from-update is in flight
  var swReloadPending = false;      // set on controllerchange; reload once
  var swUpdateApplied = false;      // prevents duplicate reloads per page load
  var updateWorker = null;          // waiting worker ready to be activated

  var MENU_IDS = ['menu-file', 'menu-edit', 'menu-view', 'menu-help'];

  var el = {};

  function $(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    [
      // banners + window frame
      'env-warning', 'env-warning-text', 'win',
      'titlebar-min', 'titlebar-max', 'titlebar-close',

      // menu bar + tool bar
      'menubar', 'menu-file', 'menu-edit', 'menu-view', 'menu-help', 'key-chip',
      'tool-pencil', 'tool-eraser', 'tool-clear', 'tool-new', 'tool-restart',
      'tool-hint', 'tool-readout',

      // home
      'view-home', 'btn-go-play', 'btn-go-encrypt', 'btn-open-keys',

      // play
      'view-play', 'manual-word', 'manual-hint', 'btn-manual-start', 'manual-status',
      'payload-input', 'btn-paste-start', 'btn-clear-payload', 'decrypt-key-note',
      'payload-meta', 'import-status', 'btn-home-from-play',

      // view tab checkboxes
      'view-word-num', 'view-word-count',

      // game
      'view-game', 'hangman-svg', 'stage-caption', 'lives-display', 'lives-icons',
      'lives-text', 'word-display', 'message', 'letter-grid', 'doodles',
      'thought-bubble-win', 'thought-bubble-nice', 'thought-bubble-loss', 'thought-bubble-answer',
      'btn-hint', 'btn-restart', 'btn-new-word', 'hint-box', 'hint-text',

      // encrypt
      'view-encrypt', 'word', 'hint', 'word-counter', 'hint-counter', 'form-status',
      'btn-encrypt', 'btn-clear', 'payload', 'btn-copy', 'btn-reset',
      'encrypt-status', 'success-box', 'btn-home-from-encrypt',

      // key settings
      'view-keys', 'setup-panel', 'key-state', 'key-state-text', 'key-results',
      'key-fingerprint', 'btn-copy-public', 'btn-download-public', 'btn-use-default',
      'public-pem', 'gen-pass', 'gen-pass-confirm', 'gen-pass-hint', 'btn-generate',
      'restore-file', 'restore-text', 'restore-pass', 'btn-restore', 'setup-status',
      'btn-home-from-keys',

      // paint chrome
      'palette', 'color-current',
      'status-state', 'status-lives', 'status-tips', 'sw-status',

      // dialog
      'dialog-overlay', 'dialog-title', 'dialog-close', 'dialog-body', 'dialog-buttons'
    ].forEach(function (id) {
      el[id] = $(id);
    });
  }

  var VIEWS = ['home', 'play', 'game', 'encrypt', 'keys'];

  function showView(name) {
    VIEWS.forEach(function (view) {
      var node = el['view-' + view];
      if (node) {
        node.classList.toggle('hidden', view !== name);
      }
    });
    closeMenus();
    setState('View: ' + name);
    setTips(VIEW_TIPS[name] || 'Ready.');
    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------------ *
   * Small UI helpers
   * ------------------------------------------------------------------ */

  function setStatus(node, text, kind) {
    if (!node) {
      return;
    }
    node.textContent = text || '';
    node.classList.remove('status--error', 'status--ok');
    if (kind === 'error') {
      node.classList.add('status--error');
    } else if (kind === 'ok') {
      node.classList.add('status--ok');
    }
  }

  function setMessage(text, kind, duration) {
    // Cancel any existing message fade-out timer.
    if (state.messageTimer) {
      clearTimeout(state.messageTimer);
      state.messageTimer = null;
    }
    hideThoughtBubbles();

    var msg = el['message'];
    msg.classList.remove('message--good', 'message--bad', 'message--info', 'message--fade-out');
    if (kind) {
      msg.classList.add('message--' + kind);
    }
    msg.textContent = text || '';

    // Immediate clear when text is empty.
    if (!text) {
      return;
    }

    // Default display duration is 2 seconds.
    if (duration === undefined) {
      duration = 2000;
    }

    if (duration > 0) {
      state.messageTimer = setTimeout(function () {
        state.messageTimer = null;
        msg.classList.add('message--fade-out');
      }, duration);
    }
  }

  function setState(text) {
    if (el['status-state']) {
      el['status-state'].textContent = text || 'Ready.';
    }
  }

  function setTips(text) {
    if (el['status-tips']) {
      el['status-tips'].textContent = text || '';
    }
  }

  function setLivesStatus(remaining, total) {
    if (el['status-lives']) {
      el['status-lives'].textContent = 'Lives: ' + remaining + ' / ' + total;
    }
  }

  function setReadout(text) {
    if (el['tool-readout']) {
      el['tool-readout'].textContent = text || '';
    }
  }

  function updateToolReadout() {
    var label = state.tool === 'eraser' ? 'Eraser' : 'Pencil';
    var color = state.tool === 'eraser' ? '#ffffff' : state.color;
    setReadout(label + ' · ' + color);
  }

  function describeError(err) {
    if (err && err.code && C.MESSAGES[err.code]) {
      return C.MESSAGES[err.code];
    }
    if (err && err.message) {
      return err.message;
    }
    return 'Something went wrong.';
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function busy(on, label) {
    state.busy = on;
    document.body.style.cursor = on ? 'progress' : '';
    if (label) {
      setStatus(el['setup-status'], label);
    }
  }

  /* ------------------------------------------------------------------ *
   * Key state
   * ------------------------------------------------------------------ */

  /** Strip the BEGIN/END markers off a PEM body and base64-decode it. */
  function pemToBytes(pem) {
    var lines = String(pem || '').split(/\r?\n/);
    var body = '';
    var inBody = false;
    lines.forEach(function (line) {
      var t = line.trim();
      if (!t) {
        return;
      }
      if (/^-----BEGIN /.test(t)) {
        inBody = true;
        return;
      }
      if (/^-----END /.test(t)) {
        inBody = false;
        return;
      }
      if (inBody) {
        body += t;
      }
    });
    if (!body) {
      body = String(pem || '').replace(/\s+/g, '');
    }
    return C.b64ToBytes(body);
  }

  function renderKeyState() {
    var unlocked = !!state.privateKey;
    var isDefault = state.keySource === 'default';

    el['key-state'].classList.toggle('state--unlocked', unlocked);
    el['key-state'].classList.toggle('state--locked', !unlocked);

    if (unlocked && isDefault) {
      el['key-state-text'].textContent = 'Using the built-in key — everything works with no setup. Generate your own below to replace it.';
      el['key-chip'].textContent = 'Built-in key';
      el['key-chip'].className = 'chip chip--muted';
    } else if (unlocked) {
      el['key-state-text'].textContent = 'Using your own key — remembered in this browser and loaded automatically.';
      el['key-chip'].textContent = 'Custom key active';
      el['key-chip'].className = 'chip chip--ok';
    } else {
      el['key-state-text'].textContent = 'No key available. Typing a word still works; encryption and decryption are disabled.';
      el['key-chip'].textContent = 'No key';
      el['key-chip'].className = 'chip chip--bad';
    }

    if (state.publicKeyPem) {
      el['key-results'].classList.remove('hidden');
      el['public-pem'].value = state.publicKeyPem;
      el['key-fingerprint'].textContent = state.fingerprint
        ? C.formatFingerprint(state.fingerprint, 8)
        : 'unknown';
    } else {
      el['key-results'].classList.add('hidden');
      el['public-pem'].value = '';
      el['key-fingerprint'].textContent = '—';
    }

    // Playing needs a round, not a key: a locally typed word is just as valid
    // as a decrypted payload.
    var canPlay = !!state.round;
    el['btn-hint'].disabled = !canPlay || !state.round.hint;
    el['btn-restart'].disabled = !canPlay;
  }

  /**
   * Remember the player's own key in this browser so the next visit unlocks with
   * no setup. The private key is exported as PKCS#8 and stored (base64) via
   * BHKeys; if the export fails we still keep the public half.
   */
  function saveKeyLocally(privateKey, publicKeyPem, fingerprint, createdAt) {
    C.exportPrivateKeyPkcs8(privateKey).then(function (pkcs8) {
      K.rememberKey({
        publicKeyPem: publicKeyPem,
        fingerprint: fingerprint,
        createdAt: createdAt,
        privateKeyB64: C.bytesToB64(pkcs8)
      });
    }).catch(function () {
      K.rememberKey({ publicKeyPem: publicKeyPem, fingerprint: fingerprint, createdAt: createdAt });
    });
  }

  /** Import the pair that ships with the app (zero-setup default). */
  function loadBuiltInKey() {
    var def = window.BH_DEFAULT_KEYS;
    if (!def || !def.publicKeyPem || !def.privateKeyPem || !C.isAvailable()) {
      return Promise.resolve(false);
    }
    return C.importPrivateKeyPkcs8(pemToBytes(def.privateKeyPem)).then(function (privateKey) {
      state.privateKey = privateKey;
      state.publicKeyPem = def.publicKeyPem;
      state.keyCreatedAt = def.createdAt || null;
      state.keySource = 'default';
      return C.publicKeyPemFingerprint(def.publicKeyPem).then(function (fingerprint) {
        state.fingerprint = fingerprint;
        return true;
      });
    }).catch(function () {
      return false;
    });
  }

  /**
   * Boot the key: prefer the player's own saved key, otherwise fall back to the
   * built-in one so the app always has a usable pair.
   */
  function bootKey() {
    var stored = K.loadStoredKey();

    if (stored && stored.privateKeyB64 && C.isAvailable()) {
      state.publicKeyPem = stored.publicKeyPem || null;
      state.fingerprint = stored.fingerprint || null;
      state.keyCreatedAt = stored.createdAt || null;
      state.keySource = 'user';
      return C.importPrivateKeyPkcs8(C.b64ToBytes(stored.privateKeyB64)).then(function (privateKey) {
        state.privateKey = privateKey;
      }).catch(function () {
        // The saved key can no longer be imported: drop it and use the default.
        K.forgetKey();
        state.privateKey = null;
        state.publicKeyPem = null;
        state.fingerprint = null;
        state.keySource = null;
        return loadBuiltInKey().then(function () {
          return null;
        });
      });
    }

    return loadBuiltInKey().then(function () {
      return null;
    });
  }

  /* ------------------------------------------------------------------ *
   * Round + board
   * ------------------------------------------------------------------ */

  function resetRound() {
    // Cancel any pending game-over timer
    if (state.gameOverTimer) {
      clearTimeout(state.gameOverTimer);
      state.gameOverTimer = null;
    }
    // Cancel any pending win timer
    if (state.winTimer) {
      clearTimeout(state.winTimer);
      state.winTimer = null;
    }
    // Cancel any pending win dialog timer
    if (state.winDialogTimer) {
      clearTimeout(state.winDialogTimer);
      state.winDialogTimer = null;
    }

    state.round = null;
    renderedRound = null;
    renderBoard(null);
    renderLetters(null);
    updateStage(0);
    hideThoughtBubbles();
    el['hint-box'].classList.add('hidden');
    el['hint-text'].textContent = '';
    setMessage('', null);
    resetHintMenuLabel();
  }

  function updateStage(stage) {
    var clamped = Math.max(0, Math.min(L.STAGES.length - 1, stage));
    el['hangman-svg'].setAttribute('data-stage', String(clamped));

    var parts = el['hangman-svg'].querySelectorAll('.part');
    Array.prototype.forEach.call(parts, function (node) {
      var name = node.getAttribute('data-part');
      var index = L.STAGES.indexOf(name);
      node.classList.toggle('on', index > 0 && index <= clamped);
    });

    el['stage-caption'].textContent = STAGE_CAPTIONS[clamped] || STAGE_CAPTIONS[0];
  }

  function shakeStage() {
    var wrap = el['hangman-svg'].parentNode;
    wrap.classList.remove('shake');
    // Force reflow so the animation can restart.
    void wrap.offsetWidth;
    wrap.classList.add('shake');
    window.setTimeout(function () {
      wrap.classList.remove('shake');
    }, 500);
  }

  function showThoughtBubble(kind, answer, customBody, duration) {
    // Cancel any existing message fade-out timer.
    if (state.messageTimer) {
      clearTimeout(state.messageTimer);
      state.messageTimer = null;
    }

    [el['thought-bubble-win'], el['thought-bubble-nice'], el['thought-bubble-loss']].forEach(function (b) {
      if (b) {
        b.classList.add('hidden');
        b.classList.remove('thought-bubble--fade-out');
      }
    });
    var bubble = el['thought-bubble-' + kind];
    if (!bubble) {
      return;
    }
    var body = bubble.querySelector('.thought-bubble__body');
    if (body) {
      body.textContent = customBody || (kind === 'win' ? 'Nice ka brox!' : kind === 'nice' ? 'Nice!' : 'Mamatay tas imong ka-bugo brox!');
    }
    if (kind === 'loss' && el['thought-bubble-answer']) {
      el['thought-bubble-answer'].textContent = customBody
        ? ''
        : answer ? ' — The answer was: ' + answer : '';
    }
    bubble.classList.remove('hidden');
    bubble.classList.remove('thought-bubble--pop');
    void bubble.offsetWidth;
    bubble.classList.add('thought-bubble--pop');

    // Default display duration is 2 seconds.
    if (duration === undefined) {
      duration = 2000;
    }
    if (duration > 0) {
      state.messageTimer = setTimeout(function () {
        state.messageTimer = null;
        bubble.classList.add('thought-bubble--fade-out');
        setTimeout(function () {
          bubble.classList.add('hidden');
          bubble.classList.remove('thought-bubble--fade-out');
        }, 300);
      }, duration);
    }
  }

  function hideThoughtBubbles() {
    [el['thought-bubble-win'], el['thought-bubble-nice'], el['thought-bubble-loss']].forEach(function (b) {
      if (b) {
        b.classList.add('hidden');
      }
    });
  }

  function renderBoard(round) {
    var icons = el['lives-icons'];
    icons.innerHTML = '';
    var lives = round ? round.lives : L.LIVES;
    var lost = round ? round.wrong : 0;

    for (var i = 0; i < lives; i++) {
      var s = document.createElement('span');
      s.className = 'life' + (i < lost ? ' lost' : '');
      s.textContent = '♥';
      icons.appendChild(s);
    }
    var remaining = Math.max(0, lives - lost);
    el['lives-text'].textContent = remaining + ' / ' + lives;
    el['lives-display'].setAttribute(
      'aria-label',
      'Lives remaining: ' + remaining + ' of ' + lives
    );
    setLivesStatus(remaining, lives);

var container = el['word-display'];
    var existingGrid = container.querySelector('.word-grid');

    if (!round) {
      container.innerHTML = '';
      var p = document.createElement('p');
      p.className = 'word-display__placeholder';
      p.id = 'word-placeholder';
      p.textContent = 'Type a word or paste an encrypted payload to begin.';
      container.appendChild(p);
      container.setAttribute('aria-label', 'No secret word loaded');
      return;
    }

    // If there is an existing grid and it belongs to this same round, this is
    // an update (letter revealed) — update tile states in place without
    // rebuilding the DOM. A new round always rebuilds from scratch so leftover
    // tiles/rows from the previous word never persist.
    if (existingGrid && round === renderedRound) {
      var view = L.renderWord(round);
      var revealedCount = 0;
      var letterCount = 0;

      var rows = [];
      var row = [];
      view.forEach(function (item) {
        if (item.char === ' ') {
          if (row.length) {
            rows.push(row);
            row = [];
          }
        } else {
          row.push(item);
        }
      });
      if (row.length) {
        rows.push(row);
      }

      // Count total letters
      rows.forEach(function (rowItems) {
        rowItems.forEach(function (item) {
          if (item.guessable) {
            letterCount++;
            if (item.revealed) {
              revealedCount++;
            }
          }
        });
      });

      container.setAttribute(
        'aria-label',
        'Secret word: ' + letterCount + ' letters, ' + revealedCount + ' revealed'
      );

      // Update each word-row's tiles in place without rebuilding DOM.
      var groups = existingGrid.querySelectorAll('.word-group');
      var rowIndex = 0;
      groups.forEach(function (groupNode) {
        var rowNode = groupNode.querySelector('.word-row');
        if (!rowNode) {
          return;
        }
        var tiles = rowNode.querySelectorAll('.tile');
        var rowItems = rows[rowIndex];
        if (!rowItems) {
          return;
        }
        rowIndex++;

        var tileIdx = 0;
        tiles.forEach(function (tile) {
          if (!rowItems[tileIdx]) {
            return;
          }
          var item = rowItems[tileIdx];
          tileIdx++;

          if (!item.guessable) {
            tile.classList.remove('tile--revealed', 'tile--hidden', 'tile--auto');
            tile.classList.add('tile--fixed');
            tile.textContent = item.char;
            return;
          }

          if (item.revealed) {
            tile.classList.remove('tile--hidden');
            tile.classList.add('tile--revealed');
            if (!/^[A-Za-z]$/.test(item.char)) {
              tile.classList.add('tile--auto');
            } else {
              tile.classList.remove('tile--auto');
            }
            var charSpan = tile.querySelector('.tile__char');
            if (!charSpan) {
              charSpan = document.createElement('span');
              charSpan.className = 'tile__char';
              tile.appendChild(charSpan);
            }
            charSpan.textContent = item.char;
          } else {
            tile.classList.remove('tile--revealed', 'tile--auto');
            tile.classList.add('tile--hidden');
            var charSpan = tile.querySelector('.tile__char');
            if (charSpan) {
              charSpan.remove();
            }
          }
        });
      });

      // Toggle visibility of word numbers and counts per preference
      groups.forEach(function (groupNode) {
        var rowNode = groupNode.querySelector('.word-row');
        if (!rowNode) {
          return;
        }
        var numSpan = rowNode.querySelector('.word-num');
        if (numSpan) {
          numSpan.style.display = viewPrefs.showWordNum ? '' : 'none';
        }
        var countSpan = rowNode.querySelector('.word-count');
        if (countSpan) {
          countSpan.style.display = viewPrefs.showWordCount ? '' : 'none';
        }
      });
      return;
    }

    // Fresh phrase render — build DOM and layout
    container.innerHTML = '';

    var view = L.renderWord(round);
    var revealedCount = 0;
    var letterCount = 0;

    var rows = [];
    var row = [];
    view.forEach(function (item) {
      if (item.char === ' ') {
        if (row.length) {
          rows.push(row);
          row = [];
        }
      } else {
        row.push(item);
      }
    });
    if (row.length) {
      rows.push(row);
    }

    // Count total letters
    rows.forEach(function (rowItems) {
      rowItems.forEach(function (item) {
        if (item.guessable) {
          letterCount++;
          if (item.revealed) {
            revealedCount++;
          }
        }
      });
    });

    container.setAttribute(
      'aria-label',
      'Secret word: ' + letterCount + ' letters, ' + revealedCount + ' revealed'
    );

    var groups = [];
    rows.forEach(function (rowItems, index) {
      var groupNode = document.createElement('div');
      groupNode.className = 'word-group';

      var rowNode = document.createElement('div');
      rowNode.className = 'word-row';

      // Add word number (1-indexed) — always created, hidden when disabled
      var numSpan = document.createElement('span');
      numSpan.className = 'word-num';
      numSpan.textContent = (index + 1);
      numSpan.style.display = viewPrefs.showWordNum ? '' : 'none';
      rowNode.appendChild(numSpan);

      // Count letters in this word (guessable letters only)
      var wordLetterCount = 0;
      rowItems.forEach(function (item) {
        if (item.guessable) {
          wordLetterCount++;
        }
      });

      // Add tiles
      rowItems.forEach(function (item) {
        var span = document.createElement('span');
        span.className = 'tile';
        if (!item.guessable) {
          span.classList.add('tile--fixed');
          span.textContent = item.char;
          if (item.char !== ' ') {
            var underline = document.createElement('span');
            underline.className = 'tile__underline';
            span.appendChild(underline);
          }
        } else {
          if (item.revealed) {
            span.classList.add('tile--revealed');
            if (!/^[A-Za-z]$/.test(item.char)) {
              span.classList.add('tile--auto');
            }
            var charNode = document.createElement('span');
            charNode.className = 'tile__char';
            charNode.textContent = item.char;
            span.appendChild(charNode);
            var underline = document.createElement('span');
            underline.className = 'tile__underline';
            span.appendChild(underline);
          } else {
            span.classList.add('tile--hidden');
            var underline = document.createElement('span');
            underline.className = 'tile__underline';
            span.appendChild(underline);
          }
        }
        rowNode.appendChild(span);
      });

      // Add letter count superscript — always created, hidden when disabled
      var countSpan = document.createElement('span');
      countSpan.className = 'word-count';
      countSpan.textContent = wordLetterCount;
      countSpan.style.display = viewPrefs.showWordCount ? '' : 'none';
      rowNode.appendChild(countSpan);

      groupNode.appendChild(rowNode);
      groups.push(groupNode);
    });

    // Build the grid container
    var grid = document.createElement('div');
    grid.className = 'word-grid';
    groups.forEach(function (g) {
      grid.appendChild(g);
    });
    container.appendChild(grid);

    renderedRound = round;

    // Schedule layout recalculation for the new phrase
    scheduleWordLayout();
  }

  /**
   * Recalculate the responsive word layout: decide between single-column and
   * two-column layout, and adjust font size / spacing to fit the available
   * game display area without scrollbars.
   */
  var wordLayoutTimer = null;
  var wordResizeObserver = null;

  function scheduleWordLayout() {
    if (wordLayoutTimer) {
      clearTimeout(wordLayoutTimer);
    }
    wordLayoutTimer = setTimeout(applyWordLayout, 50);
  }

function applyWordLayout() {
    wordLayoutTimer = null;
    var container = el['word-display'];
    if (!container) {
      return;
    }

    var grid = container.querySelector('.word-grid');
    if (!grid) {
      return;
    }

    // Collect all word-group elements (they may be nested in columns from a previous layout)
    var groups = Array.prototype.slice.call(grid.querySelectorAll('.word-group'));
    if (groups.length === 0) {
      return;
    }

    // Remove previous layout classes and column wrappers
    grid.classList.remove('word-grid--two');
    container.classList.remove('word-display--sm', 'word-display--xs');

    // Remove any existing column wrappers, moving groups back to grid
    var existingColumns = grid.querySelectorAll('.word-column');
    existingColumns.forEach(function (col) {
      while (col.firstChild) {
        grid.insertBefore(col.firstChild, col);
      }
      col.remove();
    });

    // Measure available space
    var containerWidth = container.clientWidth;
    var containerHeight = container.clientHeight;
    if (!containerWidth || !containerHeight) {
      return;
    }

    var padding = 24; // container padding
    var availableWidth = containerWidth - padding;
    var availableHeight = containerHeight - padding;

    // Measure natural row sizes
    var maxRowWidth = 0;
    var rowHeights = [];
    groups.forEach(function (group) {
      var row = group.querySelector('.word-row');
      if (row) {
        var w = row.scrollWidth;
        if (w > maxRowWidth) {
          maxRowWidth = w;
        }
        rowHeights.push(group.offsetHeight + 4); // +4 gap
      }
    });

    var totalHeight = rowHeights.reduce(function (sum, h) { return sum + h; }, 0) - 4; // remove last gap

    // Decide layout: prefer single column if it fits vertically
    var useTwoColumns = false;
    var useSm = false;
    var useXs = false;

    if (totalHeight > availableHeight) {
      // Single column too tall: try two columns first
      useTwoColumns = true;
      var half = Math.ceil(groups.length / 2);
      var col1H = 0;
      var col2H = 0;
      for (var i = 0; i < groups.length; i++) {
        if (i < half) {
          col1H += rowHeights[i];
        } else {
          col2H += rowHeights[i];
        }
      }
      var maxColHeight = Math.max(col1H, col2H);
      if (maxColHeight > availableHeight) {
        useSm = true;
      }
    } else if (maxRowWidth > availableWidth) {
      // Single column fits height but a row overflows width: try smaller font first
      // If even small font overflows, use two columns
      useTwoColumns = true;
    }

    // Apply font-size class if needed
    if (useSm) {
      container.classList.add('word-display--sm');
    }

    // Apply two-column layout if needed
    if (useTwoColumns) {
      var half = Math.ceil(groups.length / 2);
      var col1 = document.createElement('div');
      col1.className = 'word-column';
      var col2 = document.createElement('div');
      col2.className = 'word-column';

      for (var j = 0; j < groups.length; j++) {
        if (j < half) {
          col1.appendChild(groups[j]);
        } else {
          col2.appendChild(groups[j]);
        }
      }

      grid.appendChild(col1);
      grid.appendChild(col2);
      grid.classList.add('word-grid--two');

      // After layout, re-measure and possibly shrink further
      requestAnimationFrame(function () {
        var col1H = col1.scrollHeight;
        var col2H = col2.scrollHeight;
        var maxH = Math.max(col1H, col2H);
        if (maxH > availableHeight && !container.classList.contains('word-display--sm')) {
          container.classList.add('word-display--sm');
        } else if (maxH > availableHeight && container.classList.contains('word-display--sm')) {
          container.classList.add('word-display--xs');
        }
      });
    }
  }

  function updateWordDisplayPrefs() {
    var container = el['word-display'];
    if (!container) {
      return;
    }
    var grid = container.querySelector('.word-grid');
    if (!grid) {
      return;
    }
    var rows = grid.querySelectorAll('.word-row');
    rows.forEach(function (rowNode) {
      var numSpan = rowNode.querySelector('.word-num');
      if (numSpan) {
        numSpan.style.display = viewPrefs.showWordNum ? '' : 'none';
      }
      var countSpan = rowNode.querySelector('.word-count');
      if (countSpan) {
        countSpan.style.display = viewPrefs.showWordCount ? '' : 'none';
      }
    });
  }

  function setupWordLayoutObserver() {
    if (wordResizeObserver) {
      return;
    }
    if (typeof ResizeObserver !== 'undefined') {
      wordResizeObserver = new ResizeObserver(function () {
        scheduleWordLayout();
      });
    }
  }

  function renderLetters(round) {
    var grid = el['letter-grid'];
    grid.innerHTML = '';
    var active = !!(round && round.status === 'playing');

    L.letterKeys().forEach(function (letter) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'letter';
      btn.textContent = letter;
      btn.setAttribute('aria-label', 'Guess ' + letter);

      if (round && L.hasGuessed(round, letter)) {
        var right = round.guessableKeys.indexOf(letter) !== -1;
        btn.classList.add(right ? 'is-correct' : 'is-wrong');
        btn.disabled = true;
      } else {
        btn.classList.add('is-idle');
        btn.disabled = !active;
        btn.addEventListener('click', function () {
          handleGuess(letter);
        });
      }
      grid.appendChild(btn);
    });
  }

  function startRound(secret) {
    hideThoughtBubbles();
    var round = L.createRound(secret);
    state.round = round;
    el['hint-box'].classList.add('hidden');
    el['hint-text'].textContent = '';
    resetHintMenuLabel();
    renderBoard(round);
    renderLetters(round);
    updateStage(0);
    setMessage('Round ready. ' + round.word.split(/\s+/).filter(Boolean).length + ' word/s to guess' + (round.word.split(/\s+/).filter(Boolean).length === 1 ? '' : 's') + '.', 'info');
    setState('Round in progress.');
    setTips('Guess with the on-screen keys or your keyboard.');
    renderKeyState();
  }

  function restartRound() {
    if (!state.round) {
      return;
    }

    // Cancel any pending game-over timer and message timer.
    if (state.gameOverTimer) {
      clearTimeout(state.gameOverTimer);
      state.gameOverTimer = null;
    }
    if (state.messageTimer) {
      clearTimeout(state.messageTimer);
      state.messageTimer = null;
    }
    // Cancel any pending win timer.
    if (state.winTimer) {
      clearTimeout(state.winTimer);
      state.winTimer = null;
    }

    var secret = { word: state.round.word, hint: state.round.hint };
    startRound(secret);
    setMessage('', null);
    setState('Round restarted.');
    hideThoughtBubbles();
    showThoughtBubble('loss', null, 'Taronga brox ha');
  }

  function handleGuess(letter) {
    var round = state.round;
    if (!round) {
      return;
    }
    if (round.status !== 'playing') {
      setMessage('This round is over. Start a new game or restart.', 'info');
      return;
    }

    var outcome = L.guess(round, letter);

    if (outcome.result === 'blocked' || outcome.result === 'invalid') {
      return;
    }
    if (outcome.result === 'repeat') {
      setMessage(letter + ' was already guessed. No life lost.', 'info');
      return;
    }

    if (outcome.result === 'correct') {
      setMessage('', null);
      showThoughtBubble('nice', null, 'Nice!');
    } else {
      showThoughtBubble('loss', null, 'BOBO!');
      shakeStage();
    }

    renderBoard(round);
    renderLetters(round);
    updateStage(L.stageIndex(round));

    if (round.status === 'won') {
      finishRound('won');
    } else if (round.status === 'lost') {
      finishRound('lost');
    }
  }

  function finishRound(result) {
    var round = state.round;
    renderBoard(round);
    renderLetters(round);
    el['btn-restart'].disabled = false;
    el['btn-hint'].disabled = !round.hint;

    if (result === 'won') {
      // Cancel any stale win timers so repeated wins cannot stack triggers.
      if (state.winTimer) {
        clearTimeout(state.winTimer);
        state.winTimer = null;
      }
      if (state.winDialogTimer) {
        clearTimeout(state.winDialogTimer);
        state.winDialogTimer = null;
      }
      setMessage('', null);
      setState('Round won.');
      setTips('You solved it. Everyone drinks.');
      // Show the win thought bubble after 600ms, once the final revealed
      // letter has landed, then the result dialog after 1200ms.
      state.winTimer = window.setTimeout(function () {
        state.winTimer = null;
        showThoughtBubble('win', null, 'Nice ka brox!');
      }, 600);
      state.winDialogTimer = window.setTimeout(function () {
        state.winDialogTimer = null;
        openResultDialog(round, {
          title: 'Hangbitch — You win!',
          lines: [
            'Solved with ' + (round.lives - round.wrong) + ' of ' + round.lives + ' lives left.'
          ],
          variant: 'win',
          showReveal: false,
          buttons: [
            { label: 'Restart round', onClick: restartRound },
            { label: 'New game', primary: true, onClick: openPlayView }
          ]
        });
      }, 1200);
    } else {
      // Cancel any pending game-over timer and message timer first.
      if (state.gameOverTimer) {
        clearTimeout(state.gameOverTimer);
        state.gameOverTimer = null;
      }
      if (state.messageTimer) {
        clearTimeout(state.messageTimer);
        state.messageTimer = null;
      }
      if (state.winTimer) {
        clearTimeout(state.winTimer);
        state.winTimer = null;
      }
      if (state.winDialogTimer) {
        clearTimeout(state.winDialogTimer);
        state.winDialogTimer = null;
      }

      setMessage('', null);
      showThoughtBubble('loss', L.answer(round), 'Mamatay tas imong ka-bugo brox!');
      setState('Round lost.');
      setTips('The beer mug appeared.');

      // Set a 1.2 second delay before showing the game-over dialog.
      // The loss modal carries the "Reveal the answer" button inside it;
      // the answer stays hidden until the player clicks it.
      state.gameOverTimer = window.setTimeout(function () {
        openResultDialog(round, {
          title: 'Hangbitch — Game over',
          lines: ['Five wrong guesses. She got her beer.'],
          variant: 'loss',
          showReveal: true,
          buttons: [
            { label: 'Restart round', onClick: restartRound },
            { label: 'New game', primary: true, onClick: openPlayView }
          ]
        });
        state.gameOverTimer = null;
      }, 1200);
    }
  }

  /** Build the loss/game-over dialog with an embedded reveal control. */
  function openLossDialog(round) {
    openResultDialog(round, {
      title: 'Hangbitch — Game over',
      lines: ['Five wrong guesses. She got her beer.'],
      variant: 'loss',
      showReveal: true,
      buttons: [
        { label: 'Restart round', onClick: restartRound },
        { label: 'New game', primary: true, onClick: openPlayView }
      ]
    });
  }

  /**
   * Shared result-dialog builder. Both win and loss use the same answer-box
   * chrome; the only differences are the title, copy, colour variant, and
   * whether the answer is shown outright (win) or gated behind a button (loss).
   *
   * @param {object} round
   * @param {object} opts
   * @param {string} opts.title
   * @param {string[]} opts.lines        paragraphs above the answer box
   * @param {string} opts.variant        'win' (green) | 'loss' (amber)
   * @param {boolean} opts.showReveal    true to add the "Reveal the answer" button
   * @param {object[]} opts.buttons
   */
  function openResultDialog(round, opts) {
    el['dialog-title'].textContent = opts.title;
    el['dialog-body'].innerHTML = '';

    (opts.lines || []).forEach(function (line) {
      var p = document.createElement('p');
      p.textContent = line;
      el['dialog-body'].appendChild(p);
    });

    var answer = L.answer(round);

    if (opts.showReveal) {
      // Loss: the answer stays hidden until the player clicks the button.
      var revealWrap = document.createElement('div');
      revealWrap.className = 'dialog-reveal dialog-reveal--' + opts.variant;
      revealWrap.innerHTML =
        '<button type="button" class="btn btn--reveal" id="dialog-reveal-answer" aria-label="Reveal the answer">' +
        '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
        '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
        '<circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="2"/></svg>' +
        '<span>Reveal the answer</span>' +
        '</button>' +
        '<div class="dialog-reveal__answer hidden" id="dialog-reveal-answer-box">' +
        '<span class="label">Answer</span><p id="dialog-reveal-answer-text"></p>' +
        '</div>';
      el['dialog-body'].appendChild(revealWrap);

      var revealBtn = revealWrap.querySelector('#dialog-reveal-answer');
      revealBtn.addEventListener('click', function () {
        var box = revealWrap.querySelector('#dialog-reveal-answer-box');
        var text = revealWrap.querySelector('#dialog-reveal-answer-text');
        if (box.classList.contains('hidden')) {
          text.textContent = answer;
          box.classList.remove('hidden');
          revealBtn.classList.add('is-active');
        }
      });
    } else {
      // Win: the answer is shown outright in the same box chrome, in green.
      var box = document.createElement('div');
      box.className = 'dialog-reveal__answer dialog-reveal__answer--' + opts.variant;
      box.innerHTML =
        '<span class="label">Answer</span><p id="dialog-reveal-answer-text"></p>';
      box.querySelector('#dialog-reveal-answer-text').textContent = answer;
      el['dialog-body'].appendChild(box);
    }

    mountDialogButtons(opts.buttons || []);
    el['dialog-overlay'].classList.remove('hidden');
    var first = el['dialog-buttons'].querySelector('button');
    if (first) {
      first.focus();
    }
  }

  function showHint() {
    var round = state.round;
    if (!round || !round.hint) {
      return false;
    }
    el['hint-text'].textContent = round.hint;
    el['hint-box'].classList.remove('hidden');
    el['btn-hint'].disabled = true;
    var item = menuItem('toggle-hint');
    if (item) {
      item.textContent = 'Hide Hint';
    }
    return true;
  }

  function resetHintMenuLabel() {
    var item = menuItem('toggle-hint');
    if (item) {
      item.textContent = 'Show Hint';
    }
  }

  function revealHint() {
    if (showHint()) {
      setTips('Hint revealed.');
      setState('Hint shown.');
    }
  }

  function toggleHint() {
    var round = state.round;
    if (!round || !round.hint) {
      setTips('No hint is available for this round.');
      setState('No hint to show.');
      return;
    }
    if (el['hint-box'].classList.contains('hidden')) {
      showHint();
      setTips('Hint revealed.');
    } else {
      el['hint-box'].classList.add('hidden');
      var item = menuItem('toggle-hint');
      if (item) {
        item.textContent = 'Show Hint';
      }
      setTips('Hint hidden.');
    }
  }

  /* ------------------------------------------------------------------ *
   * Play: local word entry (no keys) + payload import
   * ------------------------------------------------------------------ */

  function openPlayView() {
    // Cancel any pending game-over timer and message timer.
    if (state.gameOverTimer) {
      clearTimeout(state.gameOverTimer);
      state.gameOverTimer = null;
    }
    if (state.messageTimer) {
      clearTimeout(state.messageTimer);
      state.messageTimer = null;
    }

    showView('play');
    if (el['manual-word']) {
      el['manual-word'].focus();
    }
  }

  function handleManualStart() {
    var word = el['manual-word'].value;
    var hint = el['manual-hint'].value;

    var round;
    try {
      round = L.createRound({ word: word, hint: hint });
    } catch (roundError) {
      setStatus(el['manual-status'], describeError(roundError), 'error');
      return;
    }

    // Clear the fields so the typed secret is not left sitting on screen.
    el['manual-word'].value = '';
    el['manual-hint'].value = '';
    setStatus(el['manual-status'], '', null);
    startRound({ word: round.word, hint: round.hint });
    showView('game');
  }

  function handlePasteStart() {
    if (state.busy) {
      return;
    }

    setStatus(el["import-status"], "", null);
    el["payload-meta"].textContent = "";

    navigator.clipboard
      .readText()
      .then(function (text) {
        text = text.trim();

        if (!text) {
          setStatus(el["import-status"], "Nothing copied to paste.", "error");
          return { skipped: true };
        }

        try {
          var meta = C.describePayload(text);
          el["payload-meta"].textContent =
            "Payload v" + (meta.version || "?") + " (simple share format)";
        } catch (metaErr) {
          setStatus(el["import-status"], describeError(metaErr), "error");
          return { skipped: true };
        }

        busy(true);
        return C.decryptPayload(text, null, null);
      })
      .then(function (secret) {
        if (secret && secret.skipped) {
          return;
        }

        if (!secret) {
          setStatus(
            el["import-status"],
            "Unable to decrypt payload. Check your key or copied content.",
            "error"
          );
          return;
        }

        if (!secret.word) {
          setStatus(
            el["import-status"],
            "Invalid payload. No word was found.",
            "error"
          );
          return;
        }

        startRound({ word: secret.word, hint: secret.hint });

        setStatus(
          el["import-status"],
          "Decrypted locally. " +
            (secret.hint
              ? "A hint is available if you need it."
              : "No hint was provided."),
          "ok"
        );

        showView("game");
      })
      .catch(function (err) {
        setStatus(el["import-status"], describeError(err), "error");
      })
      .finally(function () {
        busy(false);
      });
  }

  function clearPayloadBox() {
    el['payload-input'].value = '';
    el['payload-meta'].textContent = '';
    setStatus(el['import-status'], '', null);
    setTips('Payload box cleared.');
  }

  /* ------------------------------------------------------------------ *
   * Encrypt: turn a secret word into a payload
   * ------------------------------------------------------------------ */

  function updateCounters() {
    if (el['word-counter']) {
      el['word-counter'].textContent = el['word'].value.length + ' / ' + C.MAX_WORD_LENGTH;
    }
    if (el['hint-counter']) {
      el['hint-counter'].textContent = el['hint'].value.length + ' / ' + C.MAX_HINT_LENGTH;
    }
  }

  function handleEncrypt() {
    if (state.busy) {
      return;
    }
    setStatus(el['form-status'], '', null);
    setStatus(el['encrypt-status'], '', null);
    el['success-box'].classList.add('hidden');

    var word = el['word'].value;
    var hint = el['hint'].value;

    if (!word || !word.trim()) {
      setStatus(el['form-status'], 'Type the secret word first.', 'error');
      return;
    }

    busy(true);
    C.encryptForRecipient(null, { word: word, hint: hint })
      .then(function (payloadText) {
        el['payload'].value = payloadText;
        el['btn-copy'].disabled = false;
        el['btn-reset'].disabled = false;
        el['success-box'].classList.remove('hidden');
        setStatus(el['form-status'], 'Encrypted. Copy the payload and send it to the host.', 'ok');
        setState('Word encrypted.');
        setTips('Copy the payload and send it to the host.');
      })
      .catch(function (err) {
        setStatus(el['form-status'], describeError(err), 'error');
      })
      .then(function () {
        busy(false);
      });
  }

  function copyPayload() {
    var text = el['payload'].value;
    if (!text) {
      setStatus(el['encrypt-status'], 'Nothing to copy yet.', 'error');
      return;
    }
    K.copyText(text).then(function (ok) {
      setStatus(
        el['encrypt-status'],
        ok ? 'Payload copied. Send it to the host.' : 'Clipboard access was refused — select the payload and copy it manually.',
        ok ? 'ok' : 'error'
      );
    });
  }

  function clearEncryptForm() {
    el['word'].value = '';
    el['hint'].value = '';
    updateCounters();
    setStatus(el['form-status'], '', null);
  }

  function resetEncryptOutput() {
    el['word'].value = '';
    el['hint'].value = '';
    updateCounters();
    el['payload'].value = '';
    el['btn-copy'].disabled = true;
    el['btn-reset'].disabled = true;
    el['success-box'].classList.add('hidden');
    setStatus(el['form-status'], '', null);
    setStatus(el['encrypt-status'], '', null);
  }

  /* ------------------------------------------------------------------ *
   * Key settings
   * ------------------------------------------------------------------ */

  function applyKey(material, source) {
    state.privateKey = material.privateKey;
    state.publicKeyPem = material.publicKeyPem;
    state.fingerprint = material.fingerprint;
    state.keyCreatedAt = material.createdAt;
    state.keySource = source;
  }

  function handleGenerate() {
    if (state.busy) {
      return;
    }
    var pass = el['gen-pass'].value;
    var confirm = el['gen-pass-confirm'].value;

    try {
      C.checkPassphrase(pass, confirm);
    } catch (e) {
      setStatus(el['setup-status'], describeError(e), 'error');
      return;
    }

    busy(true, 'Generating a 3072-bit RSA key pair… this takes a few seconds.');
    var privateKey;

    C.generateKeyPair()
      .then(function (pair) {
        privateKey = pair.privateKey;
        return C.publicKeyFingerprint(pair.publicKey).then(function (fingerprint) {
          var created = new Date().toISOString();
          return C.createKeyBackup({ privateKey: pair.privateKey, publicKey: pair.publicKey, passphrase: pass })
            .then(function (backup) {
              var text = C.serializeBackup(backup);
              K.downloadText(K.backupFileName(), text, 'application/json');
              return C.restoreKeyBackup(text, pass).then(function (restored) {
                // Self-test: the backup we just wrote must restore to the same key.
                if (restored.fingerprint !== fingerprint) {
                  throw new C.BHError('BACKUP_FORMAT', 'The backup did not verify against the generated key. Nothing was changed.');
                }
                applyKey({
                  privateKey: privateKey,
                  publicKeyPem: restored.publicKeyPem,
                  fingerprint: fingerprint,
                  createdAt: created
                }, 'user');
                saveKeyLocally(privateKey, restored.publicKeyPem, fingerprint, created);
                el['gen-pass'].value = '';
                el['gen-pass-confirm'].value = '';
                resetRound();
                renderKeyState();
                setStatus(
                  el['setup-status'],
                  'New key pair ready, backup downloaded and verified, and the key is remembered in this browser. The whole app now uses it.',
                  'ok'
                );
              });
            });
        });
      })
      .catch(function (err) {
        setStatus(el['setup-status'], describeError(err), 'error');
      })
      .then(function () {
        busy(false);
      });
  }

  function handleRestore() {
    if (state.busy) {
      return;
    }
    var text = el['restore-text'].value.trim();
    var file = el['restore-file'].files && el['restore-file'].files[0];
    var pass = el['restore-pass'].value;

    var read = file && !text ? K.readFileAsText(file) : Promise.resolve(text);

    busy(true, 'Unlocking your backup (600,000 PBKDF2 rounds)…');

    read
      .then(function (backupText) {
        if (!backupText || !String(backupText).trim()) {
          throw new C.BHError('BACKUP_FORMAT', 'Choose a backup file or paste the backup text.');
        }
        return C.restoreKeyBackup(backupText, pass);
      })
      .then(function (restored) {
        applyKey({
          privateKey: restored.privateKey,
          publicKeyPem: restored.publicKeyPem,
          fingerprint: restored.fingerprint,
          createdAt: restored.created
        }, 'user');
        saveKeyLocally(restored.privateKey, restored.publicKeyPem, restored.fingerprint, restored.created);
        el['restore-pass'].value = '';
        el['restore-text'].value = '';
        el['restore-file'].value = '';
        resetRound();
        renderKeyState();
        setStatus(el['setup-status'], 'Restored and remembered in this browser. Fingerprint ' + C.formatFingerprint(restored.fingerprint, 4) + '.', 'ok');
      })
      .catch(function (err) {
        setStatus(el['setup-status'], describeError(err), 'error');
      })
      .then(function () {
        busy(false);
      });
  }

  function handleUseDefault() {
    if (state.busy) {
      return;
    }
    if (!window.BH_DEFAULT_KEYS || !window.BH_DEFAULT_KEYS.privateKeyPem) {
      setStatus(el['setup-status'], 'The built-in key is not available in this build.', 'error');
      return;
    }
    busy(true, 'Switching back to the built-in key…');
    K.forgetKey();
    loadBuiltInKey().then(function (ok) {
      busy(false);
      resetRound();
      renderKeyState();
      setStatus(
        el['setup-status'],
        ok ? 'Back to the built-in key. Your generated key was removed from this browser.' : 'Could not load the built-in key here.',
        ok ? 'ok' : 'error'
      );
    });
  }

  function handleExportPublic() {
    if (!state.publicKeyPem) {
      setStatus(el['setup-status'], 'No public key to export yet.', 'error');
      return;
    }
    K.downloadText(K.publicKeyFileName(), state.publicKeyPem, 'application/x-pem-file');
    setStatus(el['setup-status'], 'Public key file downloaded. It contains no secrets — safe to share.', 'ok');
  }

  function handleCopyPublic() {
    if (!state.publicKeyPem) {
      setStatus(el['setup-status'], 'No public key to copy yet.', 'error');
      return;
    }
    K.copyText(state.publicKeyPem).then(function (ok) {
      setStatus(
        el['setup-status'],
        ok ? 'Public key copied.' : 'Clipboard access was refused — select the text in the box and copy it manually.',
        ok ? 'ok' : 'error'
      );
    });
  }

  function updatePassphraseHint() {
    var value = el['gen-pass'].value;
    if (!value) {
      el['gen-pass-hint'].textContent = 'Aim for 12+ characters. This passphrase only unlocks your key backup.';
      return;
    }
    var strength = K.passphraseStrength(value);
    var words = {
      'too-short': 'Too short — minimum 8 characters.',
      weak: 'Weak. Longer is better than complicated.',
      good: 'Good. Add length for more safety.',
      strong: 'Strong backup passphrase.'
    };
    el['gen-pass-hint'].textContent = words[strength] || words.weak;
  }

  /* ------------------------------------------------------------------ *
   * Paint chrome: menus
   * ------------------------------------------------------------------ */

  function menuItem(action) {
    if (!el['menubar']) {
      return null;
    }
    return el['menubar'].querySelector('[data-action="' + action + '"]');
  }

  function anyMenuOpen() {
    return MENU_IDS.some(function (id) {
      return el[id] && el[id].classList.contains('menu--open');
    });
  }

  function updateMenuAria() {
    MENU_IDS.forEach(function (id) {
      var menu = el[id];
      if (!menu) {
        return;
      }
      var btn = menu.querySelector('.menu__btn');
      if (btn) {
        btn.setAttribute('aria-expanded', menu.classList.contains('menu--open') ? 'true' : 'false');
      }
    });
  }

  function closeMenus() {
    MENU_IDS.forEach(function (id) {
      if (el[id]) {
        el[id].classList.remove('menu--open');
      }
    });
    updateMenuAria();
  }

  function toggleMenu(id) {
    var menu = el[id];
    if (!menu) {
      return;
    }
    var wasOpen = menu.classList.contains('menu--open');
    closeMenus();
    if (!wasOpen) {
      menu.classList.add('menu--open');
      updateMenuAria();
    }
  }

  function runAction(action) {
    switch (action) {
      case 'new-game':
        requestNewGame();
        break;
      case 'restart-round':
        doRestartRound(false);
        break;
      case 'reset-round':
        doRestartRound(true);
        break;
      case 'back-home':
        showView('home');
        setTips('Back at Home.');
        break;
      case 'import-word':
        showView('play');
        if (el['payload-input']) {
          el['payload-input'].focus();
        }
        setTips('Paste the encrypted payload here.');
        break;
      case 'clear-word':
        el['manual-word'].value = '';
        el['manual-hint'].value = '';
        setStatus(el['manual-status'], 'Word box cleared.', null);
        setTips('Word box cleared.');
        break;
      case 'clear-payload':
        clearPayloadBox();
        break;
      case 'toggle-hint':
        toggleHint();
        break;
      case 'toggle-lives':
        toggleLives();
        break;
      case 'clear-doodles':
        clearDoodles();
        break;
      case 'tool-pencil':
        selectTool('pencil');
        setTips('Pencil selected — drag on the picture to draw.');
        break;
      case 'tool-eraser':
        selectTool('eraser');
        setTips('Eraser selected — drag on the picture to rub out.');
        break;
      case 'how-to-play':
        showHowToPlay();
        break;
      case 'about':
        showAbout();
        break;
      default:
        setState('Nothing to do for "' + action + '".');
    }
  }

  function requestNewGame() {
    if (state.round && state.round.status === 'playing') {
      confirmDialog('New Game', 'Start a new game? The round in progress will be abandoned.', openPlayView);
      return;
    }
    openPlayView();
  }

  function doRestartRound(askFirst) {
    if (!state.round) {
      setTips('No round is in progress.');
      setState('Nothing to restart.');
      return;
    }
    if (askFirst) {
      confirmDialog('Reset Current Round', 'Reset this round to the same secret with full lives?', restartRound);
      return;
    }
    restartRound();
  }

  function toggleLives() {
    var hidden = el['lives-display'].classList.toggle('hidden');
    var item = menuItem('toggle-lives');
    if (item) {
      item.textContent = hidden ? 'Show Lives' : 'Hide Lives';
    }
    setTips(hidden ? 'Life counter hidden.' : 'Life counter shown.');
  }

  function onDocumentClick(event) {
    var target = event.target;
    if (!target || !target.closest) {
      return;
    }

    var menuBtn = target.closest('.menu__btn');
    if (menuBtn) {
      var wrap = menuBtn.closest('.menu');
      if (wrap && wrap.id) {
        toggleMenu(wrap.id);
        return;
      }
    }

    var actionNode = target.closest('[data-action]');
    if (actionNode) {
      var action = actionNode.getAttribute('data-action');
      closeMenus();
      runAction(action);
      return;
    }

    if (!target.closest('.menu')) {
      closeMenus();
    }
  }

  /* ------------------------------------------------------------------ *
   * Paint chrome: dialogs
   * ------------------------------------------------------------------ */

  function mountDialogButtons(buttons) {
    el['dialog-buttons'].innerHTML = '';
    var list = buttons && buttons.length ? buttons : [{ label: 'OK', primary: true }];
    list.forEach(function (spec) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (spec.primary ? ' btn--primary' : '');
      b.textContent = spec.label;
      b.addEventListener('click', function () {
        closeDialog();
        if (typeof spec.onClick === 'function') {
          spec.onClick();
        }
      });
      el['dialog-buttons'].appendChild(b);
    });
  }

  function showDialog(title, buttons) {
    el['dialog-title'].textContent = title;
    mountDialogButtons(buttons);
    el['dialog-overlay'].classList.remove('hidden');
    var first = el['dialog-buttons'].querySelector('button');
    if (first) {
      first.focus();
    }
  }

  /** Dialog body from trusted, static markup (help / about copy only). */
  function openHtmlDialog(title, html, buttons) {
    el['dialog-body'].innerHTML = html;
    showDialog(title, buttons);
  }

  /** Dialog body from plain strings — never markup, so secrets stay inert. */
  function openMessageDialog(title, lines, buttons) {
    el['dialog-body'].innerHTML = '';
    (lines || []).forEach(function (line) {
      var p = document.createElement('p');
      p.textContent = line;
      el['dialog-body'].appendChild(p);
    });
    showDialog(title, buttons);
  }

  function confirmDialog(title, message, onConfirm) {
    openMessageDialog(title, [message], [
      { label: 'OK', primary: true, onClick: onConfirm },
      { label: 'Cancel' }
    ]);
  }

  function closeDialog() {
    el['dialog-overlay'].classList.add('hidden');
    el['dialog-body'].innerHTML = '';
    el['dialog-buttons'].innerHTML = '';
  }

  function dialogOpen() {
    return !el['dialog-overlay'].classList.contains('hidden');
  }

  function showHowToPlay() {
    openHtmlDialog('How to Play', HOW_TO_PLAY, [{ label: 'OK', primary: true }]);
  }

  function showAbout() {
    openHtmlDialog('About Hangbitch', ABOUT_TEXT, [{ label: 'OK', primary: true }]);
  }

  /* ------------------------------------------------------------------ *
   * Paint chrome: tool bar, palette and the doodle layer
   * ------------------------------------------------------------------ */

  function selectTool(tool) {
    state.tool = tool === 'eraser' ? 'eraser' : 'pencil';
    var svg = el['hangman-svg'];
    if (svg) {
      svg.classList.toggle('tool-pencil', state.tool === 'pencil');
      svg.classList.toggle('tool-eraser', state.tool === 'eraser');
    }
    var toolBtns = document.querySelectorAll('[data-action="tool-pencil"], [data-action="tool-eraser"]');
    Array.prototype.forEach.call(toolBtns, function (btn) {
      var action = btn.getAttribute('data-action');
      btn.classList.toggle('is-active', (state.tool === 'pencil' && action === 'tool-pencil') || (state.tool === 'eraser' && action === 'tool-eraser'));
    });
    updateToolReadout();
  }

  function setColor(hex) {
    state.color = hex;
    var wells = document.querySelectorAll('#color-current, .color-well--fg .color-well__inner');
    Array.prototype.forEach.call(wells, function (node) {
      if (node && node.style) {
        node.style.background = hex;
      }
    });
    if (el['palette']) {
      var swatches = el['palette'].querySelectorAll('.swatch');
      Array.prototype.forEach.call(swatches, function (s) {
        s.classList.toggle('is-active', s.getAttribute('data-color') === hex);
      });
    }
    var minis = document.querySelectorAll('.palette__swatch.mini');
    Array.prototype.forEach.call(minis, function (s) {
      s.classList.toggle('active', s.getAttribute('data-ribcolor') === hex);
    });
    updateToolReadout();
  }

  function clearDoodles() {
    if (el['doodles']) {
      el['doodles'].innerHTML = '';
    }
    state.doodling = false;
    state.activeDoodle = null;
    setTips('Canvas doodles cleared.');
  }

  function svgCoords(event) {
    var svg = el['hangman-svg'];
    if (!svg || !svg.createSVGPoint || !svg.getScreenCTM) {
      return null;
    }
    var point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    var ctm = svg.getScreenCTM();
    if (!ctm) {
      return null;
    }
    return point.matrixTransform(ctm.inverse());
  }

  function onCanvasPointerDown(event) {
    if (state.tool !== 'pencil' && state.tool !== 'eraser') {
      return;
    }
    if (el['view-game'].classList.contains('hidden')) {
      return;
    }
    var point = svgCoords(event);
    if (!point) {
      return;
    }
    event.preventDefault();

    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'doodle');
    path.setAttribute('data-tool', state.tool);
    path.style.stroke = state.tool === 'eraser' ? '#ffffff' : state.color;
    path.setAttribute('d', 'M' + point.x.toFixed(1) + ' ' + point.y.toFixed(1));
    el['doodles'].appendChild(path);

    state.activeDoodle = path;
    state.doodling = true;
    try {
      el['hangman-svg'].setPointerCapture(event.pointerId);
    } catch (e) {
      /* pointer capture is a nicety, not a requirement */
    }
  }

  function onCanvasPointerMove(event) {
    if (!state.doodling || !state.activeDoodle) {
      return;
    }
    var point = svgCoords(event);
    if (!point) {
      return;
    }
    event.preventDefault();
    var d = state.activeDoodle.getAttribute('d');
    state.activeDoodle.setAttribute('d', d + ' L' + point.x.toFixed(1) + ' ' + point.y.toFixed(1));
  }

  function onCanvasPointerUp(event) {
    if (!state.doodling) {
      return;
    }
    state.doodling = false;
    state.activeDoodle = null;
    try {
      el['hangman-svg'].releasePointerCapture(event.pointerId);
    } catch (e) {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------------ *
   * Keyboard input
   * ------------------------------------------------------------------ */

  function isTypingContext(target) {
    if (!target) {
      return false;
    }
    var tag = (target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      if (dialogOpen()) {
        closeDialog();
        return;
      }
      if (anyMenuOpen()) {
        closeMenus();
        return;
      }
      return;
    }
    if (dialogOpen()) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (isTypingContext(event.target)) {
      return;
    }
    if (el['view-game'].classList.contains('hidden')) {
      return;
    }
    if (!/^[a-zA-Z]$/.test(event.key)) {
      return;
    }
    if (!state.round) {
      return;
    }
    event.preventDefault();
    handleGuess(event.key.toUpperCase());
  }

  /* ------------------------------------------------------------------ *
   * Service worker (PWA, optional)
   * ------------------------------------------------------------------ */

  function isGameActive() {
    return !el['view-game'].classList.contains('hidden') && state.round;
  }

  function swStatus(text) {
    if (el['sw-status']) {
      el['sw-status'].textContent = text;
    }
  }

  function showUpdateBanner(show) {
    var banner = document.getElementById('sw-update');
    if (!banner) {
      return;
    }
    banner.classList.toggle('hidden', !show);
  }

  function activateUpdate() {
    if (swUpdating || swUpdateApplied || !updateWorker) {
      return;
    }
    swUpdating = true;
    swReloadPending = true;
    swStatus('update available - activating...');
    try {
      updateWorker.postMessage({ type: 'SKIP_WAITING' });
    } catch (e) {
      swUpdating = false;
      swReloadPending = false;
    }
  }

  function handleWaitingWorker(worker, registration) {
    if (!worker || swUpdateApplied) {
      return;
    }
    updateWorker = worker;
    swStatus('update available');
    showUpdateBanner(true);
    // Do not interrupt active gameplay; banner lets the user reload when ready.
    if (!isGameActive()) {
      activateUpdate();
    } else if (registration && registration.waiting && registration.waiting !== worker) {
      // no-op: keep latest waiting worker only
    }
  }

  function registerServiceWorker() {
    var status = el['sw-status'];
    if (!status) {
      return;
    }
    if (!('serviceWorker' in navigator)) {
      swStatus('offline cache unavailable in this browser (app still works)');
      return;
    }
    if (!K.isSecureContextLike()) {
      swStatus('offline cache needs http://127.0.0.1 or https (app still works)');
      return;
    }

    navigator.serviceWorker.register('service-worker.js').then(function (registration) {
      swStatus('offline cache active');

      // If a worker is already waiting (e.g. after refresh), handle it once.
      if (registration.waiting && navigator.serviceWorker.controller) {
        handleWaitingWorker(registration.waiting, registration);
      }

      // Check for a fresh worker when the user refreshes/returns online.
      try { registration.update(); } catch (e) {}
      window.addEventListener('online', function () {
        try { registration.update(); } catch (e) {}
      }, { passive: true });

      registration.addEventListener('updatefound', function () {
        var worker = registration.installing;
        if (!worker) {
          return;
        }
        worker.addEventListener('statechange', function () {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            handleWaitingWorker(worker, registration);
          }
        });
      });

      navigator.serviceWorker.addEventListener('controllerchange', function () {
        // Reload once, and only when this page initiated an update.
        if (!swReloadPending || swUpdateApplied) {
          return;
        }
        swUpdateApplied = true;
        swReloadPending = false;
        swUpdating = false;
        window.location.reload();
      });

      var reloadBtn = document.getElementById('sw-update-reload');
      var dismissBtn = document.getElementById('sw-update-dismiss');
      if (reloadBtn && !reloadBtn._hbBound) {
        reloadBtn._hbBound = true;
        reloadBtn.addEventListener('click', function () {
          showUpdateBanner(false);
          activateUpdate();
        });
      }
      if (dismissBtn && !dismissBtn._hbBound) {
        dismissBtn._hbBound = true;
        dismissBtn.addEventListener('click', function () {
          showUpdateBanner(false);
        });
      }
    }).catch(function () {
      swStatus('offline cache could not start (app still works)');
    });
  }
  function showEnvironmentWarning() {
    el['env-warning'].classList.remove('hidden');
    el['env-warning-text'].textContent =
      'Web Crypto is only available on https:// or http://localhost. ' +
      "The key tools are disabled here, but you can still play: choose \"Play a game\", type a word and press Start game. " +
      'To encrypt or unlock payloads, run start-game.bat instead of opening index.html directly, then reload.';
  }

  function init() {
    loadViewPrefs();
    cacheElements();

    // Initialize view preference checkboxes from saved state
    if (el['view-word-num']) {
      el['view-word-num'].checked = viewPrefs.showWordNum;
    }
    if (el['view-word-count']) {
      el['view-word-count'].checked = viewPrefs.showWordCount;
    }

    var cryptoReady = C.isAvailable();
    if (!cryptoReady) {
      showEnvironmentWarning();
      el['btn-copy'].disabled = true;
      el['btn-generate'].disabled = true;
      el['btn-restore'].disabled = true;
      el['btn-use-default'].disabled = true;
    }

    resetRound();
    renderKeyState();
    updateStage(0);
    updateCounters();
    selectTool('pencil');
    setColor('#000000');
    showView('home');

    // Load the built-in (or saved) key so both jobs work with no setup.
    bootKey().then(function () {
      renderKeyState();
    });

    // Home
    el['btn-go-play'].addEventListener('click', function () {
      el['manual-word'].focus();
      showView('play');
    });
    el['btn-go-encrypt'].addEventListener('click', function () {
      el['word'].focus();
      showView('encrypt');
    });
    el['btn-open-keys'].addEventListener('click', function () {
      showView('keys');
    });

    // Back buttons
    el['btn-home-from-play'].addEventListener('click', function () { showView('home'); });
    el['btn-home-from-encrypt'].addEventListener('click', function () { showView('home'); });
    el['btn-home-from-keys'].addEventListener('click', function () { showView('home'); });

    // Play view
    el['btn-manual-start'].addEventListener('click', handleManualStart);
    ['manual-word', 'manual-hint'].forEach(function (id) {
      el[id].addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          handleManualStart();
        }
      });
    });

    el['btn-paste-start'].addEventListener('click', handlePasteStart);
    el['btn-clear-payload'].addEventListener('click', clearPayloadBox);

    // Game view
    el['btn-restart'].addEventListener('click', restartRound);
    el['btn-hint'].addEventListener('click', revealHint);
    el['btn-new-word'].addEventListener('click', openPlayView);

    // Encrypt view
    el['btn-encrypt'].addEventListener('click', handleEncrypt);
    el['btn-copy'].addEventListener('click', copyPayload);
    el['btn-clear'].addEventListener('click', clearEncryptForm);
    el['btn-reset'].addEventListener('click', resetEncryptOutput);
    el['word'].addEventListener('input', updateCounters);
    el['hint'].addEventListener('input', updateCounters);

    // Key settings
    el['btn-generate'].addEventListener('click', handleGenerate);
    el['btn-restore'].addEventListener('click', handleRestore);
    el['btn-use-default'].addEventListener('click', handleUseDefault);
    el['btn-copy-public'].addEventListener('click', handleCopyPublic);
    el['btn-download-public'].addEventListener('click', handleExportPublic);
    el['gen-pass'].addEventListener('input', updatePassphraseHint);

    var ribbonTabs = el['win'].querySelectorAll('.ribbon__tab[data-tab]');
    Array.prototype.forEach.call(ribbonTabs, function (tab) {
      tab.addEventListener('click', function () {
        var targetTab = tab.getAttribute('data-tab');
        Array.prototype.forEach.call(ribbonTabs, function (t) {
          var active = t === tab;
          t.classList.toggle('is-active', active);
          t.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        ['file', 'home', 'view'].forEach(function (name) {
          var panel = el['win'].querySelector('#ribbon-' + name);
          if (panel) {
            var on = name === targetTab;
            panel.classList.toggle('is-active', on);
            panel.classList.toggle('hidden', !on);
          }
        });
        setTips(targetTab.charAt(0).toUpperCase() + targetTab.slice(1) + ' tab.');
      });
    });

    // Title bar
    el['titlebar-min'].addEventListener('click', function () {
      var minimized = document.body.classList.toggle('minimized');
      setState(minimized ? 'Window rolled up.' : 'Window restored.');
    });
    el['titlebar-max'].addEventListener('click', function () {
      var maximized = document.body.classList.toggle('maximized');
      setState(maximized ? 'Window maximized.' : 'Window restored.');
    });
    el['titlebar-close'].addEventListener('click', function () {
      document.body.classList.remove('minimized', 'maximized');

      // Cancel any pending game-over timer
      if (state.gameOverTimer) {
        clearTimeout(state.gameOverTimer);
        state.gameOverTimer = null;
      }
      // Cancel any pending win timers
      if (state.winTimer) {
        clearTimeout(state.winTimer);
        state.winTimer = null;
      }
      if (state.winDialogTimer) {
        clearTimeout(state.winDialogTimer);
        state.winDialogTimer = null;
      }

      showView('home');
      setState('Document closed - back to Home.');
    });

    // Menus, tool bar and dialogs share one delegated click handler.
    document.addEventListener('click', onDocumentClick);
    el['dialog-close'].addEventListener('click', closeDialog);
    el['dialog-overlay'].addEventListener('click', function (event) {
      if (event.target === el['dialog-overlay']) {
        closeDialog();
      }
    });

    // Colour palette (compat layer)
    if (el['palette']) {
      el['palette'].addEventListener('click', function (event) {
        var target = event.target;
        if (!target || !target.closest) {
          return;
        }
        var swatch = target.closest('[data-color]');
        if (!swatch) {
          return;
        }
        var hex = swatch.getAttribute('data-color');
        var title = swatch.getAttribute('title') || '';
        var name = title.split(' ').slice(0, -1).join(' ') || hex;
        setColor(hex);
        selectTool('pencil');
        setTips(name + ' selected — drawing color is now ' + hex + '.');
      });
    }

    // Mini ribbon palette swatches
    document.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest) {
        return;
      }
      var swatch = target.closest('.palette__swatch.mini[data-ribcolor]');
      if (!swatch) {
        return;
      }
      var hex = swatch.getAttribute('data-ribcolor');
      setColor(hex);
      selectTool('pencil');
      setTips('Colour set to ' + hex + '.');
    }, true);

    // Freehand doodle layer over the illustration
    el['hangman-svg'].addEventListener('pointerdown', onCanvasPointerDown);
    el['hangman-svg'].addEventListener('pointermove', onCanvasPointerMove);
    el['hangman-svg'].addEventListener('pointerup', onCanvasPointerUp);
    el['hangman-svg'].addEventListener('pointercancel', onCanvasPointerUp);

    document.addEventListener('keydown', onKeyDown);

    // Responsive word layout: recalculate on resize and orientation change
    window.addEventListener('resize', scheduleWordLayout);
    window.addEventListener('orientationchange', function () {
      setTimeout(scheduleWordLayout, 200);
    });
    setupWordLayoutObserver();
    if (el['word-display']) {
      wordResizeObserver.observe(el['word-display']);
    }

    // View tab checkboxes: word number and word count visibility
    el['view-word-num'].addEventListener('change', function () {
      viewPrefs.showWordNum = el['view-word-num'].checked;
      saveViewPrefs();
      updateWordDisplayPrefs();
    });
    el['view-word-count'].addEventListener('change', function () {
      viewPrefs.showWordCount = el['view-word-count'].checked;
      saveViewPrefs();
      updateWordDisplayPrefs();
    });

    registerServiceWorker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
