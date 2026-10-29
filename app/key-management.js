/*
 * Hangbitch - local key handling helpers.
 *
 * Bridges the crypto core (crypto.js) to the browser: file download / upload,
 * and the key material we remember between sessions so the player does not have
 * to set the key up again on every visit.
 *
 * WHAT IS REMEMBERED, AND WHY
 *   - The PUBLIC key, its fingerprint and its creation date (not secrets).
 *   - The PRIVATE key, so the game can unlock payloads straight away instead of
 *     asking for a backup restore each time. It is stored as raw PKCS#8 bytes
 *     (base64) under `hb.privateKeyPkcs8`.
 *
 * SECURITY NOTES (read these before trusting the convenience)
 *   - localStorage is scoped to this browser profile and origin
 *     (http://127.0.0.1:<port>), so the saved key works only here, on this PC.
 *   - Anything that can run script on this origin - or anyone with access to
 *     this Windows account - can read the saved private key.
 *   - The secret word and hint are NEVER stored: not here, not anywhere.
 *   - Nothing is ever sent anywhere: no cookies, no IndexedDB, no network.
 */
(function (root) {
  'use strict';

  var STORAGE_KEYS = {
    publicKeyPem: 'hb.publicKeyPem',
    fingerprint: 'hb.fingerprint',
    createdAt: 'hb.keyCreatedAt',
    privateKeyB64: 'hb.privateKeyPkcs8'
  };

  function storage() {
    try {
      var s = root.localStorage;
      // Touch it: some browsers throw on access in private mode.
      s.setItem('hb.probe', '1');
      s.removeItem('hb.probe');
      return s;
    } catch (e) {
      return null;
    }
  }

  /**
   * Remember the current key. `material` may be:
   *   { publicKeyPem, fingerprint, createdAt, privateKeyB64 }
   * Passing no privateKeyB64 (or an empty one) clears any saved private key
   * while keeping the public half — used when a saved key can no longer be
   * imported.
   */
  function rememberKey(material) {
    var s = storage();
    if (!s) {
      return false;
    }
    var m = material || {};
    try {
      s.setItem(STORAGE_KEYS.publicKeyPem, m.publicKeyPem || '');
      s.setItem(STORAGE_KEYS.fingerprint, m.fingerprint || '');
      s.setItem(STORAGE_KEYS.createdAt, m.createdAt || new Date().toISOString());
      if (m.privateKeyB64) {
        s.setItem(STORAGE_KEYS.privateKeyB64, m.privateKeyB64);
      } else {
        s.removeItem(STORAGE_KEYS.privateKeyB64);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function loadStoredKey() {
    var s = storage();
    if (!s) {
      return null;
    }
    try {
      var pem = s.getItem(STORAGE_KEYS.publicKeyPem);
      var privateKeyB64 = s.getItem(STORAGE_KEYS.privateKeyB64);
      if (!pem && !privateKeyB64) {
        return null;
      }
      return {
        publicKeyPem: pem || '',
        fingerprint: s.getItem(STORAGE_KEYS.fingerprint) || '',
        createdAt: s.getItem(STORAGE_KEYS.createdAt) || null,
        privateKeyB64: privateKeyB64 || ''
      };
    } catch (e) {
      return null;
    }
  }

  /** Drop the public key only, keeping any saved private key untouched. */
  function forgetPublicKey() {
    var s = storage();
    if (!s) {
      return;
    }
    try {
      s.removeItem(STORAGE_KEYS.publicKeyPem);
      s.removeItem(STORAGE_KEYS.fingerprint);
      s.removeItem(STORAGE_KEYS.createdAt);
    } catch (e) {
      /* ignore */
    }
  }

  /** Forget everything, including the saved private key. */
  function forgetKey() {
    var s = storage();
    if (!s) {
      return;
    }
    try {
      Object.keys(STORAGE_KEYS).forEach(function (k) {
        s.removeItem(STORAGE_KEYS[k]);
      });
    } catch (e) {
      /* ignore */
    }
  }

  /** Suggested, timestamped file names for exports. */
  function backupFileName(date) {
    var d = date instanceof Date ? date : new Date();
    return 'hangbitch-key-backup-' + d.toISOString().slice(0, 10) + '.json';
  }

  function publicKeyFileName(date) {
    var d = date instanceof Date ? date : new Date();
    return 'hangbitch-public-key-' + d.toISOString().slice(0, 10) + '.pem';
  }

  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    root.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 2000);
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ''));
      };
      reader.onerror = function () {
        reject(new Error('Could not read the selected file.'));
      };
      reader.readAsText(file);
    });
  }

  /**
   * Copy text to the clipboard, resolving to a boolean instead of throwing so
   * the UI can offer a manual fallback when clipboard access is denied.
   */
  function copyText(text) {
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      return root.navigator.clipboard.writeText(String(text)).then(function () {
        return true;
      }).catch(function () {
        return legacyCopy(text);
      });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = String(text);
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  function passphraseStrength(passphrase) {
    var p = String(passphrase || '');
    if (p.length < root.BHCrypto.MIN_PASSPHRASE_LENGTH) {
      return 'too-short';
    }
    if (p.length < root.BHCrypto.RECOMMENDED_PASSPHRASE_LENGTH) {
      return 'weak';
    }
    var classes = 0;
    if (/[a-z]/.test(p)) { classes++; }
    if (/[A-Z]/.test(p)) { classes++; }
    if (/[0-9]/.test(p)) { classes++; }
    if (/[^A-Za-z0-9]/.test(p)) { classes++; }
    if (p.length >= 20 && classes >= 3) {
      return 'strong';
    }
    return classes >= 3 ? 'good' : 'weak';
  }

  // Simple Web App Manifest / Service Worker support detection.
  function isSecureContextLike() {
    var loc = root.location || {};
    return loc.protocol === 'https:' || loc.hostname === 'localhost' || loc.hostname === '127.0.0.1' || loc.hostname === '[::1]';
  }

  root.BHKeys = {
    STORAGE_KEYS: STORAGE_KEYS,
    rememberKey: rememberKey,
    loadStoredKey: loadStoredKey,
    forgetPublicKey: forgetPublicKey,
    forgetKey: forgetKey,
    backupFileName: backupFileName,
    publicKeyFileName: publicKeyFileName,
    downloadText: downloadText,
    readFileAsText: readFileAsText,
    copyText: copyText,
    passphraseStrength: passphraseStrength,
    isSecureContextLike: isSecureContextLike
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
