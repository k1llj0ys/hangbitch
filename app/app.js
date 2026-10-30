/*
 * Hangbitch — the Paint-themed controller.
 *
 * One page, five views (toggled by the .hidden class), five jobs:
 *   home    — pick a job: "Play a game" or "Generate a word"
 *   play    — type a word yourself, or paste an encrypted payload
 *   game    — the seven-life board
 *   encrypt — turn a secret word into a payload for the host
 *   keys    — see / change the key pair
 *
 * What makes Hangbitch its own thing is the costume: a Windows XP / Microsoft
 * Paint chrome around the game —
 *   - a blue title bar with Minimize / Maximize / Close,
 *   - a File / Edit / View / Help menu bar,
 *   - a tool bar (Pencil, Eraser, Clear, New game, Restart, Hint),
 *   - a 28-swatch colour palette that sets the colour you draw with,
 *   - a freehand doodle layer over the illustration,
 *   - a status bar, and
 *   - old-Windows dialogs for menus, help and game results.
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
    0: 'Gallows only — seven mistakes and he gets a beer.',
    1: 'Head. One life down.',
    2: 'Body. Two lives down.',
    3: 'Left arm. Three lives down.',
    4: 'Right arm. Four lives down.',
    5: 'Left leg and foot. Five lives down.',
    6: 'Right leg and foot. Six lives down — one life left!',
    7: 'He got his beer. Game over.'
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
      '<li>A wrong guess costs one life. You have seven.</li>' +
      '<li>Spaces, punctuation and digits are shown automatically.</li>' +
      '<li>Guess with the on-screen keys or your physical keyboard.</li>' +
      '<li>The seventh wrong guess adds the beer mug — game over.</li>' +
    '</ul>' +
    '<p>Below the picture you can doodle with the Pencil, rub it out with the Eraser, ' +
    'and pick a colour from the palette. Nothing you draw is saved.</p>';

  var ABOUT_TEXT =
    '<p><strong>Hangbitch</strong> — a seven-life game of Hangman wearing a classic ' +
    'Microsoft Paint costume.</p>' +
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
    gameOverTimer: null    // pending game-over dialog timer
  };

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
      'payload-input', 'btn-import', 'btn-clear-payload', 'decrypt-key-note',
      'payload-meta', 'import-status', 'btn-home-from-play',

      // game
      'view-game', 'hangman-svg', 'stage-caption', 'lives-display', 'lives-icons',
      'lives-text', 'word-display', 'message', 'letter-grid', 'doodles',
      'thought-bubble-win', 'thought-bubble-loss', 'thought-bubble-answer',
      'btn-hint', 'btn-restart', 'btn-new-word', 'hint-box', 'hint-text',
      'answer-box', 'answer-text',

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

  function setMessage(text, kind) {
    el['message'].textContent = text || '';
    el['message'].classList.remove('message--good', 'message--bad', 'message--info');
    if (kind) {
      el['message'].classList.add('message--' + kind);
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

    state.round = null;
    renderBoard(null);
    renderLetters(null);
    updateStage(0);
    hideThoughtBubbles();
    el['hint-box'].classList.add('hidden');
    el['hint-text'].textContent = '';
    el['answer-box'].classList.add('hidden');
    el['answer-text'].textContent = '';
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

  function showThoughtBubble(kind, answer, customBody) {
    [el['thought-bubble-win'], el['thought-bubble-loss']].forEach(function (b) {
      if (b) {
        b.classList.add('hidden');
      }
    });
    var bubble = el['thought-bubble-' + kind];
    if (!bubble) {
      return;
    }
    var body = bubble.querySelector('.thought-bubble__body');
    if (body) {
      body.textContent = customBody || (kind === 'win' ? 'Nice one brox!' : 'BOBO!');
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
  }

  function hideThoughtBubbles() {
    [el['thought-bubble-win'], el['thought-bubble-loss']].forEach(function (b) {
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
    container.innerHTML = '';

    if (!round) {
      var p = document.createElement('p');
      p.className = 'word-display__placeholder';
      p.id = 'word-placeholder';
      p.textContent = 'Type a word or paste an encrypted payload to begin.';
      container.appendChild(p);
      container.setAttribute('aria-label', 'No secret word loaded');
      return;
    }

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

    rows.forEach(function (rowItems) {
      var rowNode = document.createElement('div');
      rowNode.className = 'word-row';
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
          letterCount++;
          if (item.revealed) {
            revealedCount++;
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
      container.appendChild(rowNode);
    });

    container.setAttribute(
      'aria-label',
      'Secret word: ' + letterCount + ' letters, ' + revealedCount + ' revealed'
    );
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
    el['answer-box'].classList.add('hidden');
    el['answer-text'].textContent = '';
    el['hint-box'].classList.add('hidden');
    el['hint-text'].textContent = '';
    resetHintMenuLabel();
    renderBoard(round);
    renderLetters(round);
    updateStage(0);
    setMessage('Round ready. ' + L.remainingKeys(round).length + ' distinct letters to find.', 'info');
    setState('Round in progress.');
    setTips('Guess with the on-screen keys or your keyboard.');
    renderKeyState();
  }

  function restartRound() {
    if (!state.round) {
      return;
    }

    // Cancel any pending game-over timer
    if (state.gameOverTimer) {
      clearTimeout(state.gameOverTimer);
      state.gameOverTimer = null;
    }

    var secret = { word: state.round.word, hint: state.round.hint };
    startRound(secret);
    setMessage('Round restarted. Same secret, fresh lives.', 'info');
    setState('Round restarted.');
    hideThoughtBubbles();
    showThoughtBubble('loss', null, "Mamatay ta's imong ka-bugo brox!");
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
      setMessage('Yes — ' + letter + ' is in there.', 'good');
    } else {
      setMessage('No ' + letter + '. That costs a life.', 'bad');
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
    el['answer-text'].textContent = L.answer(round);
    el['answer-box'].classList.remove('hidden');
    el['btn-restart'].disabled = false;
    el['btn-hint'].disabled = !round.hint;

    if (result === 'won') {
      showThoughtBubble('win');
      setMessage('Solved! ' + (round.lives - round.wrong) + ' of ' + round.lives + ' lives left. Everyone drinks.', 'good');
      setState('Round won.');
      setTips('You solved it. Everyone drinks.');
      openMessageDialog('Hangbitch — You win!', [
        'Solved with ' + (round.lives - round.wrong) + ' of ' + round.lives + ' lives left.',
        'The secret was: ' + round.word
      ], [
        { label: 'Restart round', onClick: restartRound },
        { label: 'New game…', primary: true, onClick: openPlayView }
      ]);
    } else {
      // Cancel any pending game-over timer first
      if (state.gameOverTimer) {
        clearTimeout(state.gameOverTimer);
        state.gameOverTimer = null;
      }

      setMessage('Out of lives — and out of luck. The beer mug appears.', 'bad');
      showThoughtBubble('loss', L.answer(round));
      setState('Round lost.');
      setTips('The beer mug appeared.');

      // Set a 1.2 second delay before showing the game-over dialog
      state.gameOverTimer = window.setTimeout(function () {
        openMessageDialog('Hangbitch — Game over', [
          'Seven wrong guesses. He got his beer.',
          'The secret was: ' + round.word
        ], [
          { label: 'Restart round', onClick: restartRound },
          { label: 'New game…', primary: true, onClick: openPlayView }
        ]);
        state.gameOverTimer = null;
      }, 1200);
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
    // Cancel any pending game-over timer
    if (state.gameOverTimer) {
      clearTimeout(state.gameOverTimer);
      state.gameOverTimer = null;
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

  function handleImport() {
    if (state.busy) {
      return;
    }
    var text = el['payload-input'].value.trim();
    setStatus(el['import-status'], '', null);
    el['payload-meta'].textContent = '';

    if (!text) {
      setStatus(el['import-status'], 'Paste the payload someone sent you first.', 'error');
      return;
    }
    if (!state.privateKey) {
      setStatus(el['import-status'], C.MESSAGES.NO_PRIVATE_KEY, 'error');
      return;
    }

    // Show which key the payload targets before touching the private key.
    try {
      var meta = C.describePayload(text);
      el['payload-meta'].textContent = 'Payload v' + meta.version + ' for key ' + C.formatFingerprint(meta.kid, 4) +
        (meta.created ? ' · created ' + meta.created : '');
      if (state.fingerprint && meta.kid !== state.fingerprint) {
        setStatus(
          el['import-status'],
          C.MESSAGES.KID_MISMATCH + ' (payload: ' + C.formatFingerprint(meta.kid, 4) +
            ', this app: ' + C.formatFingerprint(state.fingerprint, 4) + ')',
          'error'
        );
        return;
      }
    } catch (metaErr) {
      setStatus(el['import-status'], describeError(metaErr), 'error');
      return;
    }

    busy(true);
    C.decryptPayload(text, state.privateKey, state.fingerprint)
      .then(function (secret) {
        // Clear the ciphertext box; the plaintext now lives only in the round.
        el['payload-input'].value = '';
        startRound({ word: secret.word, hint: secret.hint });
        setStatus(el['import-status'], 'Decrypted locally. ' + (secret.hint ? 'A hint is available if you need it.' : 'No hint was provided.'), 'ok');
        showView('game');
      })
      .catch(function (err) {
        setStatus(el['import-status'], describeError(err), 'error');
      })
      .then(function () {
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
    if (!state.publicKeyPem) {
      setStatus(el['form-status'], 'No public key is available to encrypt with.', 'error');
      return;
    }

    busy(true);
    C.encryptForRecipient(state.publicKeyPem, { word: word, hint: hint })
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
    if (el['tool-pencil']) {
      el['tool-pencil'].classList.toggle('is-active', state.tool === 'pencil');
    }
    if (el['tool-eraser']) {
      el['tool-eraser'].classList.toggle('is-active', state.tool === 'eraser');
    }
    updateToolReadout();
  }

  function setColor(hex) {
    state.color = hex;
    if (el['color-current']) {
      el['color-current'].style.background = hex;
    }
    if (el['palette']) {
      var swatches = el['palette'].querySelectorAll('.swatch');
      Array.prototype.forEach.call(swatches, function (s) {
        s.classList.toggle('is-active', s.getAttribute('data-color') === hex);
      });
    }
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

  function registerServiceWorker() {
    var status = el['sw-status'];
    if (!status) {
      return;
    }
    if (!('serviceWorker' in navigator)) {
      status.textContent = 'offline cache unavailable in this browser (app still works)';
      return;
    }
    if (!K.isSecureContextLike()) {
      status.textContent = 'offline cache needs http://127.0.0.1 or https (app still works)';
      return;
    }
    navigator.serviceWorker.register('service-worker.js').then(function () {
      status.textContent = 'offline cache active';
    }).catch(function () {
      status.textContent = 'offline cache could not start (app still works)';
    });
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */

  function showEnvironmentWarning() {
    el['env-warning'].classList.remove('hidden');
    el['env-warning-text'].textContent =
      'Web Crypto is only available on https:// or http://localhost. ' +
      'The key tools are disabled here, but you can still play: choose “Play a game”, type a word and press Start game. ' +
      'To encrypt or unlock payloads, run start-game.bat instead of opening index.html directly, then reload.';
  }

  function init() {
    cacheElements();

    var cryptoReady = C.isAvailable();
    if (!cryptoReady) {
      showEnvironmentWarning();
      el['btn-encrypt'].disabled = true;
      el['btn-copy'].disabled = true;
      el['btn-import'].disabled = true;
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

    el['btn-import'].addEventListener('click', handleImport);
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

    // Ribbon tabs
    var ribbonTabs = el['win'].querySelectorAll('.ribbon__tab');
    Array.prototype.forEach.call(ribbonTabs, function (tab) {
      tab.addEventListener('click', function () {
        var targetTab = tab.getAttribute('data-tab');
        Array.prototype.forEach.call(ribbonTabs, function (t) {
          t.classList.toggle('is-active', t === tab);
        });
        ['file', 'home', 'view'].forEach(function (name) {
          var panel = el['win'].querySelector('#ribbon-' + name);
          if (panel) {
            panel.classList.toggle('is-active', name === targetTab);
            panel.classList.toggle('hidden', name !== targetTab);
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

      showView('home');
      setState('Document closed — back to Home.');
    });

    // Menus, tool bar and dialogs share one delegated click handler.
    document.addEventListener('click', onDocumentClick);
    el['dialog-close'].addEventListener('click', closeDialog);
    el['dialog-overlay'].addEventListener('click', function (event) {
      if (event.target === el['dialog-overlay']) {
        closeDialog();
      }
    });

    // Colour palette
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
      setTips(name + ' selected — drawing colour is now ' + hex + '.');
    });

    // Mini ribbon palette swatches
    document.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest) {
        return;
      }
      var swatch = target.closest('.palette__swatch.mini');
      if (!swatch) {
        return;
      }
      var hex = swatch.getAttribute('data-ribcolor');
      setColor(hex);
      selectTool('pencil');
      var wells = document.querySelectorAll('.palette__swatch.mini');
      Array.prototype.forEach.call(wells, function (w) {
        w.classList.toggle('active', w === swatch);
      });
      setTips('Colour set to ' + hex + '.');
    }, true);

    // Freehand doodle layer over the illustration
    el['hangman-svg'].addEventListener('pointerdown', onCanvasPointerDown);
    el['hangman-svg'].addEventListener('pointermove', onCanvasPointerMove);
    el['hangman-svg'].addEventListener('pointerup', onCanvasPointerUp);
    el['hangman-svg'].addEventListener('pointercancel', onCanvasPointerUp);

    document.addEventListener('keydown', onKeyDown);

    registerServiceWorker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
