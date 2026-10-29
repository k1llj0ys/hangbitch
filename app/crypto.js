/*
 * Hangbitch - shared cryptographic core.
 *
 * Classic script (no bundler, no modules, no dependencies) that exposes
 * `globalThis.BHCrypto`. This is the single crypto core for the whole app: the
 * game side (decrypt a received payload) and the encrypt side (seal a word for
 * the host) both call into it.
 *
 * Everything here uses the native Web Crypto API only. There is no custom
 * cryptography, no Math.random(), and no network access.
 *
 * NOTE: Web Crypto (`crypto.subtle`) is only available in a *secure context*.
 * That means https:// or http://localhost / http://127.0.0.1. Opening the app
 * from file:// will NOT have crypto.subtle in most browsers; use start-game.bat.
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Constants
   * ------------------------------------------------------------------ */

  var PAYLOAD_PREFIX = 'LESTERCUTE.';
  var ENVELOPE_VERSION = 1;

  var RSA_ALGORITHM = 'RSA-OAEP';
  var RSA_HASH = 'SHA-256';
  var RSA_MODULUS_LENGTH = 3072;
  var RSA_PUBLIC_EXPONENT = new Uint8Array([1, 0, 1]);

  var AES_ALGORITHM = 'AES-GCM';
  var AES_KEY_LENGTH = 256;
  var GCM_IV_BYTES = 12;
  var GCM_TAG_BYTES = 16;

  var KDF = 'PBKDF2';
  var PBKDF2_ITERATIONS = 600000;
  var PBKDF2_SALT_BYTES = 16;

  var BACKUP_TYPE = 'LESTERCUTE-PRIVATE-KEY-BACKUP';
  var BACKUP_VERSION = 1;

  var MIN_PASSPHRASE_LENGTH = 8;
  var RECOMMENDED_PASSPHRASE_LENGTH = 12;
  var MAX_WORD_LENGTH = 500;
  var MAX_HINT_LENGTH = 300;
  var MAX_PAYLOAD_CHARS = 32768;
  var MAX_WRAPPED_KEY_BYTES = 1024;
  var MAX_CIPHERTEXT_BYTES = 16384;

  var ENC_LABELS = {
    kek: 'RSA-OAEP-3072/SHA-256',
    dek: 'AES-256-GCM',
    enc: 'base64url'
  };

  /* ------------------------------------------------------------------ *
   * Errors
   * ------------------------------------------------------------------ */

  /**
   * Every failure is reported as a BHError carrying a stable machine code and
   * a short, user-safe message. Never put plaintext, key material or stack
   * traces into these messages.
   */
  function BHError(code, message) {
    var err = Error.call(this, message);
    this.name = 'BHError';
    this.code = code;
    this.message = message || code;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BHError);
    } else if (err.stack) {
      this.stack = err.stack;
    }
  }
  BHError.prototype = Object.create(Error.prototype);
  BHError.prototype.constructor = BHError;

  var MESSAGES = {
    CRYPTO_UNAVAILABLE: 'Browser cryptography (Web Crypto) is unavailable. Launch the game with start-game.bat so it runs on http://127.0.0.1 (a secure context).',
    EMPTY_WORD: 'Please enter a secret word or phrase.',
    WORD_TOO_LONG: 'The secret word is too long (maximum ' + MAX_WORD_LENGTH + ' characters).',
    HINT_TOO_LONG: 'The hint is too long (maximum ' + MAX_HINT_LENGTH + ' characters).',
    MISSING_PUBLIC_KEY: 'No recipient public key is configured, so no payload can be produced.',
    INVALID_PUBLIC_KEY: 'The configured public key is missing, malformed, or not an RSA-OAEP key.',
    NO_PRIVATE_KEY: 'No private key is loaded in this session. Restore your private-key backup first.',
    PAYLOAD_FORMAT: 'That does not look like a Hangbitch payload.',
    PAYLOAD_JSON: 'The payload envelope is not valid JSON.',
    PAYLOAD_TOO_LARGE: 'The payload is too large to process.',
    UNSUPPORTED_VERSION: 'This payload was produced by an unsupported format version.',
    INVALID_FIELD: 'The payload is malformed (a required field is missing, empty, or has an invalid length).',
    KID_MISMATCH: 'This payload was encrypted for a different key than the one currently loaded.',
    DECRYPT_FAILED: 'Decryption failed. The payload is damaged, tampered with, or was not encrypted for the loaded private key.',
    BAD_PLAINTEXT: 'The decrypted content is not a valid Hangbitch secret.',
    BACKUP_FORMAT: 'That file is not a Hangbitch private-key backup.',
    BACKUP_VERSION: 'This backup uses an unsupported format version.',
    BAD_PASSPHRASE: 'Could not unlock the backup. The passphrase is wrong or the backup file is damaged.',
    WEAK_PASSPHRASE: 'Choose a backup passphrase of at least ' + MIN_PASSPHRASE_LENGTH + ' characters (aim for ' + RECOMMENDED_PASSPHRASE_LENGTH + ' or more).',
    PASSPHRASE_MISMATCH: 'The two passphrases do not match.',
    BAD_BUFFER: 'Received an unexpected buffer type.'
  };

  function fail(code) {
    throw new BHError(code, MESSAGES[code] || code);
  }

  /* ------------------------------------------------------------------ *
   * Environment / encoding helpers
   * ------------------------------------------------------------------ */

  var textEncoder = new TextEncoder();
  var textDecoder = new TextDecoder();

  function encoder() {
    return textEncoder;
  }

  function encodeText(text) {
    return textEncoder.encode(text);
  }

  function decodeText(bytes) {
    return textDecoder.decode(bytes);
  }

  function isAvailable() {
    return !!(root && root.crypto && root.crypto.subtle && root.crypto.subtle.generateKey);
  }

  function requireCrypto() {
    if (!isAvailable()) {
      fail('CRYPTO_UNAVAILABLE');
    }
  }

  function randomBytes(length) {
    requireCrypto();
    var out = new Uint8Array(length);
    root.crypto.getRandomValues(out);
    return out;
  }

  function toUint8(value) {
    if (value instanceof Uint8Array) {
      return value;
    }
    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    fail('BAD_BUFFER');
    return new Uint8Array(0);
  }

  function bytesToBinary(bytes) {
    var arr = toUint8(bytes);
    var chunk = 0x8000;
    var parts = [];
    for (var i = 0; i < arr.length; i += chunk) {
      parts.push(String.fromCharCode.apply(null, arr.subarray(i, Math.min(i + chunk, arr.length))));
    }
    return parts.join('');
  }

  function bytesToB64url(bytes) {
    return btoa(bytesToBinary(bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlToBytes(text) {
    var s = String(text).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4 !== 0) {
      s += '=';
    }
    var binary;
    try {
      binary = atob(s);
    } catch (e) {
      fail('INVALID_FIELD');
    }
    var out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }

  function bytesToB64(bytes) {
    return btoa(bytesToBinary(bytes));
  }

  function b64ToBytes(text) {
    var binary;
    try {
      binary = atob(String(text).replace(/\s+/g, ''));
    } catch (e) {
      fail('INVALID_FIELD');
    }
    var out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }

  var HEX = '0123456789abcdef';

  function bytesToHex(bytes) {
    var arr = toUint8(bytes);
    var out = '';
    for (var i = 0; i < arr.length; i++) {
      out += HEX[(arr[i] >> 4) & 0x0f] + HEX[arr[i] & 0x0f];
    }
    return out;
  }

  /** Group a hex fingerprint into readable blocks: xxxx-xxxx-.... */
  function formatFingerprint(hex, groups) {
    var n = groups || 8;
    var per = 4;
    var out = [];
    for (var i = 0; i < n && i * per < hex.length; i++) {
      out.push(hex.substr(i * per, per));
    }
    return out.join('-');
  }

  /* ------------------------------------------------------------------ *
   * PEM helpers (SPKI public keys, PKCS#8 private keys)
   * ------------------------------------------------------------------ */

  var PEM_PUBLIC_HEADER = '-----BEGIN PUBLIC KEY-----';
  var PEM_PUBLIC_FOOTER = '-----END PUBLIC KEY-----';

  function derToPem(der, label) {
    var body = bytesToB64(der).replace(/(.{64})/g, '$1\n').replace(/\n$/, '');
    return '-----BEGIN ' + label + '-----\n' + body + '\n-----END ' + label + '-----';
  }

  function pemToDer(pem) {
    var lines = String(pem || '').split(/\r?\n/);
    var body = '';
    var inBody = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) {
        continue;
      }
      if (/^-----BEGIN .*-----$/.test(line)) {
        inBody = true;
        continue;
      }
      if (/^-----END .*-----$/.test(line)) {
        inBody = false;
        continue;
      }
      if (inBody) {
        body += line;
      }
    }
    if (!body) {
      // Allow a bare base64 blob as a convenience.
      body = String(pem || '').replace(/\s+/g, '');
    }
    if (!body) {
      fail('INVALID_PUBLIC_KEY');
    }
    return b64ToBytes(body);
  }

  /* ------------------------------------------------------------------ *
   * RSA-OAEP key pair
   * ------------------------------------------------------------------ */

  function generateKeyPair() {
    requireCrypto();
    return root.crypto.subtle.generateKey(
      {
        name: RSA_ALGORITHM,
        modulusLength: RSA_MODULUS_LENGTH,
        publicExponent: RSA_PUBLIC_EXPONENT,
        hash: RSA_HASH
      },
      // The private key must be extractable so the operator can back it up.
      // The key never leaves the machine except inside the encrypted backup.
      true,
      ['encrypt', 'decrypt']
    ).then(function (pair) {
      return { publicKey: pair.publicKey, privateKey: pair.privateKey };
    });
  }

  function exportPublicKeyPem(publicKey) {
    requireCrypto();
    return root.crypto.subtle.exportKey('spki', publicKey).then(function (der) {
      return derToPem(der, 'PUBLIC KEY');
    });
  }

  function importPublicKeyPem(pem) {
    requireCrypto();
    var der;
    try {
      der = pemToDer(pem);
    } catch (e) {
      fail('INVALID_PUBLIC_KEY');
    }
    if (!der || der.length < 64) {
      fail('INVALID_PUBLIC_KEY');
    }
    return root.crypto.subtle.importKey(
      'spki',
      der,
      { name: RSA_ALGORITHM, hash: RSA_HASH },
      true,
      ['encrypt']
    ).catch(function () {
      fail('INVALID_PUBLIC_KEY');
    });
  }

  function publicKeyFingerprint(publicKey) {
    requireCrypto();
    return root.crypto.subtle.exportKey('spki', publicKey).then(function (der) {
      return root.crypto.subtle.digest('SHA-256', der);
    }).then(function (digest) {
      return bytesToHex(digest);
    });
  }

  function publicKeyPemFingerprint(pem) {
    return importPublicKeyPem(pem).then(publicKeyFingerprint);
  }

  function exportPrivateKeyPkcs8(privateKey) {
    requireCrypto();
    return root.crypto.subtle.exportKey('pkcs8', privateKey);
  }

  function importPrivateKeyPkcs8(pkcs8) {
    requireCrypto();
    return root.crypto.subtle.importKey(
      'pkcs8',
      toUint8(pkcs8),
      { name: RSA_ALGORITHM, hash: RSA_HASH },
      true,
      ['decrypt']
    ).catch(function () {
      fail('DECRYPT_FAILED');
    });
  }

  /* ------------------------------------------------------------------ *
   * Private-key backup (passphrase protected)
   * ------------------------------------------------------------------ */

  function checkPassphrase(passphrase, confirm) {
    var pass = String(passphrase == null ? '' : passphrase);
    if (pass.length < MIN_PASSPHRASE_LENGTH) {
      fail('WEAK_PASSPHRASE');
    }
    if (confirm !== undefined && pass !== String(confirm)) {
      fail('PASSPHRASE_MISMATCH');
    }
    return pass;
  }

  function deriveBackupKey(passphrase, salt, usage) {
    return root.crypto.subtle.importKey('raw', encodeText(String(passphrase)), KDF, false, ['deriveKey'])
      .then(function (baseKey) {
        return root.crypto.subtle.deriveKey(
          { name: KDF, salt: salt, iterations: PBKDF2_ITERATIONS, hash: RSA_HASH },
          baseKey,
          { name: AES_ALGORITHM, length: AES_KEY_LENGTH },
          false,
          [usage]
        );
      });
  }

  /**
   * Create a versioned, passphrase-protected backup of the private key.
   * The public key travels inside the backup so restoring on another machine
   * also restores the matching public key and fingerprint.
   */
  function createKeyBackup(options) {
    requireCrypto();
    var privateKey = options.privateKey;
    var publicKey = options.publicKey;
    var passphrase = checkPassphrase(options.passphrase, options.confirm);

    var salt = randomBytes(PBKDF2_SALT_BYTES);
    var iv = randomBytes(GCM_IV_BYTES);
    var pkcs8;
    var publicKeyPem;
    var fingerprint;

    return exportPrivateKeyPkcs8(privateKey)
      .then(function (exported) {
        pkcs8 = exported;
        return exportPublicKeyPem(publicKey);
      })
      .then(function (pem) {
        publicKeyPem = pem;
        return publicKeyFingerprint(publicKey);
      })
      .then(function (fp) {
        fingerprint = fp;
        return deriveBackupKey(passphrase, salt, 'encrypt');
      })
      .then(function (kek) {
        return root.crypto.subtle.encrypt({ name: AES_ALGORITHM, iv: iv }, kek, pkcs8);
      })
      .then(function (ciphertext) {
        return {
          type: BACKUP_TYPE,
          v: BACKUP_VERSION,
          created: new Date().toISOString(),
          kdf: {
            name: KDF,
            hash: RSA_HASH,
            iterations: PBKDF2_ITERATIONS,
            salt: bytesToB64url(salt)
          },
          cipher: {
            name: AES_ALGORITHM,
            keyBits: AES_KEY_LENGTH,
            iv: bytesToB64url(iv)
          },
          keyAlg: {
            name: RSA_ALGORITHM,
            hash: RSA_HASH,
            modulusLength: RSA_MODULUS_LENGTH
          },
          fingerprint: fingerprint,
          publicKeyPem: publicKeyPem,
          data: bytesToB64url(ciphertext)
        };
      });
  }

  function serializeBackup(backup) {
    return JSON.stringify(backup, null, 2);
  }

  function parseBackup(text) {
    var raw = String(text == null ? '' : text).trim();
    if (!raw) {
      fail('BACKUP_FORMAT');
    }
    var obj;
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      fail('BACKUP_FORMAT');
    }
    if (!obj || typeof obj !== 'object' || obj.type !== BACKUP_TYPE) {
      fail('BACKUP_FORMAT');
    }
    if (obj.v !== BACKUP_VERSION) {
      fail('BACKUP_VERSION');
    }
    if (!obj.kdf || !obj.cipher || typeof obj.data !== 'string' || !obj.data) {
      fail('BACKUP_FORMAT');
    }
    if (obj.kdf.name !== KDF || obj.kdf.hash !== RSA_HASH) {
      fail('BACKUP_FORMAT');
    }
    if (!obj.kdf.iterations || obj.kdf.iterations < 10000) {
      fail('BACKUP_FORMAT');
    }
    if (obj.cipher.name !== AES_ALGORITHM) {
      fail('BACKUP_FORMAT');
    }
    if (!obj.publicKeyPem || typeof obj.publicKeyPem !== 'string') {
      fail('BACKUP_FORMAT');
    }
    return obj;
  }

  /**
   * Restore a private key from a backup object plus its passphrase.
   * Resolves with { privateKey, publicKey, publicKeyPem, fingerprint }.
   */
  function restoreKeyBackup(backupInput, passphrase) {
    requireCrypto();
    var backup = typeof backupInput === 'string' ? parseBackup(backupInput) : parseBackup(JSON.stringify(backupInput));
    var pass = String(passphrase == null ? '' : passphrase);
    if (!pass) {
      fail('BAD_PASSPHRASE');
    }

    var salt = b64urlToBytes(backup.kdf.salt);
    var iv = b64urlToBytes(backup.cipher.iv);
    var data = b64urlToBytes(backup.data);

    if (salt.length < 8 || iv.length !== GCM_IV_BYTES || data.length <= GCM_TAG_BYTES) {
      fail('BACKUP_FORMAT');
    }

    return deriveBackupKey(pass, salt, 'decrypt')
      .then(function (kek) {
        return root.crypto.subtle.decrypt(
          { name: AES_ALGORITHM, iv: iv },
          kek,
          data
        ).catch(function () {
          fail('BAD_PASSPHRASE');
        });
      })
      .then(function (pkcs8) {
        return importPrivateKeyPkcs8(pkcs8);
      })
      .then(function (privateKey) {
        return importPublicKeyPem(backup.publicKeyPem).catch(function () {
          fail('BACKUP_FORMAT');
        }).then(function (publicKey) {
          return publicKeyFingerprint(publicKey).then(function (fp) {
            if (backup.fingerprint && fp !== backup.fingerprint) {
              fail('BACKUP_FORMAT');
            }
            return {
              privateKey: privateKey,
              publicKey: publicKey,
              publicKeyPem: backup.publicKeyPem,
              fingerprint: fp,
              created: backup.created || null
            };
          });
        });
      });
  }

  /* ------------------------------------------------------------------ *
   * Payload envelope
   * ------------------------------------------------------------------ */

  function buildEnvelope(fields) {
    return {
      v: ENVELOPE_VERSION,
      alg: { kek: ENC_LABELS.kek, dek: ENC_LABELS.dek, enc: ENC_LABELS.enc },
      kid: fields.kid,
      wrapped: fields.wrapped,
      iv: fields.iv,
      ct: fields.ct,
      created: fields.created
    };
  }

  /**
   * Validate a decoded envelope. Throws BHError with a specific code.
   * Returns { envelope, wrapped, iv, ct } with decoded byte arrays.
   */
  function validateEnvelope(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      fail('PAYLOAD_JSON');
    }
    if (typeof obj.v !== 'number') {
      fail('INVALID_FIELD');
    }
    if (obj.v !== ENVELOPE_VERSION) {
      fail('UNSUPPORTED_VERSION');
    }
    if (!obj.alg || typeof obj.alg !== 'object') {
      fail('INVALID_FIELD');
    }
    if (obj.alg.kek !== ENC_LABELS.kek || obj.alg.dek !== ENC_LABELS.dek || obj.alg.enc !== ENC_LABELS.enc) {
      fail('INVALID_FIELD');
    }
    if (typeof obj.wrapped !== 'string' || !obj.wrapped) {
      fail('INVALID_FIELD');
    }
    if (typeof obj.iv !== 'string' || !obj.iv) {
      fail('INVALID_FIELD');
    }
    if (typeof obj.ct !== 'string' || !obj.ct) {
      fail('INVALID_FIELD');
    }
    if (typeof obj.kid !== 'string' || !/^[0-9a-f]{32,64}$/.test(obj.kid)) {
      fail('INVALID_FIELD');
    }

    var wrapped = b64urlToBytes(obj.wrapped);
    var iv = b64urlToBytes(obj.iv);
    var ct = b64urlToBytes(obj.ct);

    if (wrapped.length === 0 || wrapped.length > MAX_WRAPPED_KEY_BYTES) {
      fail('INVALID_FIELD');
    }
    if (iv.length !== GCM_IV_BYTES) {
      fail('INVALID_FIELD');
    }
    if (ct.length <= GCM_TAG_BYTES || ct.length > MAX_CIPHERTEXT_BYTES) {
      fail('INVALID_FIELD');
    }

    return { envelope: obj, wrapped: wrapped, iv: iv, ct: ct };
  }

  /**
   * Read the non-secret metadata of a payload without decrypting it.
   * Useful for showing "this was encrypted for key <kid>".
   */
  function describePayload(payloadText) {
    var parsed = parsePayload(payloadText);
    return {
      version: parsed.envelope.v,
      kid: parsed.envelope.kid,
      created: parsed.envelope.created || null,
      fingerprint: formatFingerprint(parsed.envelope.kid),
      algorithms: parsed.envelope.alg
    };
  }

  function parsePayload(payloadText) {
    var raw = String(payloadText == null ? '' : payloadText).trim();
    if (!raw) {
      fail('PAYLOAD_FORMAT');
    }
    if (raw.length > MAX_PAYLOAD_CHARS) {
      fail('PAYLOAD_TOO_LARGE');
    }

    var json;
    if (raw.indexOf(PAYLOAD_PREFIX) === 0) {
      var encoded = raw.slice(PAYLOAD_PREFIX.length).replace(/\s+/g, '');
      if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
        fail('PAYLOAD_FORMAT');
      }
      try {
        json = decodeText(b64urlToBytes(encoded));
      } catch (e) {
        if (e instanceof BHError) {
          throw e;
        }
        fail('PAYLOAD_FORMAT');
      }
    } else if (raw.charAt(0) === '{') {
      // Tolerate a raw JSON envelope (handy when testing or when a Teams
      // client mangles the transport wrapper).
      json = raw;
    } else {
      fail('PAYLOAD_FORMAT');
    }

    var obj;
    try {
      obj = JSON.parse(json);
    } catch (e) {
      fail('PAYLOAD_JSON');
    }
    return validateEnvelope(obj);
  }

  /* ------------------------------------------------------------------ *
   * Hybrid encryption: AES-256-GCM data key, RSA-OAEP key wrap
   * ------------------------------------------------------------------ */

  /**
   * Encrypt a secret for a recipient public key.
   * @param {string} publicKeyPem recipient public key (SPKI PEM or bare base64)
   * @param {{word: string, hint?: string}} secret
   * @returns {Promise<string>} transport payload (LESTERCUTE.<base64url>)
   */
  function encryptForRecipient(publicKeyPem, secret) {
    requireCrypto();

    var word = String(secret && secret.word != null ? secret.word : '').trim();
    var hint = String(secret && secret.hint != null ? secret.hint : '').trim();

    if (!word) {
      fail('EMPTY_WORD');
    }
    if (word.length > MAX_WORD_LENGTH) {
      fail('WORD_TOO_LONG');
    }
    if (hint.length > MAX_HINT_LENGTH) {
      fail('HINT_TOO_LONG');
    }
    if (!publicKeyPem) {
      fail('MISSING_PUBLIC_KEY');
    }

    var aesKey;
    var iv;
    var publicKey;
    var kid;

    return importPublicKeyPem(publicKeyPem)
      .then(function (imported) {
        publicKey = imported;
        return publicKeyFingerprint(publicKey);
      })
      .then(function (fp) {
        kid = fp;
        return root.crypto.subtle.generateKey({ name: AES_ALGORITHM, length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt']);
      })
      .then(function (key) {
        aesKey = key;
        iv = randomBytes(GCM_IV_BYTES);
        var plaintext = JSON.stringify({
          type: 'LESTERCUTE-SECRET',
          v: ENVELOPE_VERSION,
          word: word,
          hint: hint
        });
        return root.crypto.subtle.encrypt({ name: AES_ALGORITHM, iv: iv }, aesKey, encodeText(plaintext));
      })
      .then(function (ciphertext) {
        return root.crypto.subtle.exportKey('raw', aesKey).then(function (rawKey) {
          return root.crypto.subtle.encrypt({ name: RSA_ALGORITHM }, publicKey, rawKey).then(function (wrapped) {
            var envelope = buildEnvelope({
              kid: kid,
              wrapped: bytesToB64url(wrapped),
              iv: bytesToB64url(iv),
              ct: bytesToB64url(ciphertext),
              created: new Date().toISOString()
            });
            return PAYLOAD_PREFIX + bytesToB64url(encodeText(JSON.stringify(envelope)));
          });
        });
      });
  }

  /**
   * Decrypt a payload with the loaded private key.
   * @param {string} payloadText
   * @param {CryptoKey} privateKey
   * @param {string} [expectedFingerprint] active key fingerprint (hex)
   * @returns {Promise<{word: string, hint: string, kid: string, created: string|null}>}
   */
  function decryptPayload(payloadText, privateKey, expectedFingerprint) {
    requireCrypto();
    if (!privateKey) {
      fail('NO_PRIVATE_KEY');
    }

    var parsed = parsePayload(payloadText);

    if (expectedFingerprint && parsed.envelope.kid !== expectedFingerprint) {
      fail('KID_MISMATCH');
    }

    var aesKey;
    return root.crypto.subtle.decrypt({ name: RSA_ALGORITHM }, privateKey, parsed.wrapped)
      .catch(function () {
        fail('DECRYPT_FAILED');
      })
      .then(function (rawKey) {
        return root.crypto.subtle.importKey('raw', rawKey, { name: AES_ALGORITHM }, false, ['decrypt']);
      })
      .then(function (key) {
        aesKey = key;
        return root.crypto.subtle.decrypt({ name: AES_ALGORITHM, iv: parsed.iv }, aesKey, parsed.ct);
      })
      .catch(function (e) {
        if (e instanceof BHError) {
          throw e;
        }
        fail('DECRYPT_FAILED');
      })
      .then(function (plaintextBuffer) {
        var text = decodeText(plaintextBuffer);
        var obj;
        try {
          obj = JSON.parse(text);
        } catch (e) {
          fail('BAD_PLAINTEXT');
        }
        if (!obj || typeof obj !== 'object' || typeof obj.word !== 'string' || !obj.word.trim()) {
          fail('BAD_PLAINTEXT');
        }
        return {
          word: obj.word,
          hint: typeof obj.hint === 'string' ? obj.hint : '',
          kid: parsed.envelope.kid,
          created: parsed.envelope.created || null
        };
      });
  }

  /* ------------------------------------------------------------------ *
   * Export
   * ------------------------------------------------------------------ */

  root.BHCrypto = {
    PAYLOAD_PREFIX: PAYLOAD_PREFIX,
    ENVELOPE_VERSION: ENVELOPE_VERSION,
    BACKUP_TYPE: BACKUP_TYPE,
    BACKUP_VERSION: BACKUP_VERSION,
    PBKDF2_ITERATIONS: PBKDF2_ITERATIONS,
    RSA_MODULUS_LENGTH: RSA_MODULUS_LENGTH,
    MIN_PASSPHRASE_LENGTH: MIN_PASSPHRASE_LENGTH,
    RECOMMENDED_PASSPHRASE_LENGTH: RECOMMENDED_PASSPHRASE_LENGTH,
    MAX_WORD_LENGTH: MAX_WORD_LENGTH,
    MAX_HINT_LENGTH: MAX_HINT_LENGTH,
    BHError: BHError,
    MESSAGES: MESSAGES,

    isAvailable: isAvailable,
    randomBytes: randomBytes,
    bytesToHex: bytesToHex,
    bytesToB64url: bytesToB64url,
    b64urlToBytes: b64urlToBytes,
    bytesToB64: bytesToB64,
    b64ToBytes: b64ToBytes,
    formatFingerprint: formatFingerprint,

    generateKeyPair: generateKeyPair,
    exportPublicKeyPem: exportPublicKeyPem,
    importPublicKeyPem: importPublicKeyPem,
    publicKeyFingerprint: publicKeyFingerprint,
    publicKeyPemFingerprint: publicKeyPemFingerprint,
    exportPrivateKeyPkcs8: exportPrivateKeyPkcs8,
    importPrivateKeyPkcs8: importPrivateKeyPkcs8,

    checkPassphrase: checkPassphrase,
    createKeyBackup: createKeyBackup,
    restoreKeyBackup: restoreKeyBackup,
    serializeBackup: serializeBackup,
    parseBackup: parseBackup,

    encryptForRecipient: encryptForRecipient,
    decryptPayload: decryptPayload,
    parsePayload: parsePayload,
    validateEnvelope: validateEnvelope,
    describePayload: describePayload
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
