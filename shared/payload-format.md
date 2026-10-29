# Payload format — Hangbitch

Version: **1**
Status: stable and documented.

This describes the wire format Hangbitch produces and consumes. The payload is
self-contained: it needs no server, no database, and no per-message passphrase.
The only secret required to read it is the RSA private key.

| Application | Role | Uses |
| --- | --- | --- |
| Hangbitch (`app/`) | Encrypt a secret / play a game | public **and** private key |

Hangbitch ships a **built-in key pair** (`app/default-keys.js`), which is why the
round trip works with no setup at all. You can replace it with your own pair from
**Key settings → Change key pair**.

---

## 1. Transport representation

The copyable string that coworkers paste into Teams is:

```
BHANGMAN1.<base64url(utf8(JSON envelope))>
```

* `BHANGMAN1.` — literal prefix identifying the format family (`BHANGMAN`, major
  version `1`).
* Everything after the prefix is the JSON envelope below, UTF-8 encoded and then
  Base64URL encoded (`-` and `_` instead of `+` and `/`, no `=` padding).
* Base64URL is an **encoding**, not encryption. The secrecy comes from
  AES-256-GCM + RSA-OAEP.
* The string contains no spaces or line breaks by construction, so it survives
  copy/paste through chat clients.

The decoder also accepts a bare JSON envelope (starting with `{`) for debugging
and tests; anything else is rejected with `PAYLOAD_FORMAT`.

---

## 2. Envelope schema

```jsonc
{
  "v": 1,                               // envelope format version (integer)
  "alg": {
    "kek": "RSA-OAEP-3072/SHA-256",     // key-encryption algorithm (must match)
    "dek": "AES-256-GCM",               // data-encryption algorithm (must match)
    "enc": "base64url"                  // encoding of the binary fields
  },
  "kid": "9f2c…64 hex chars",           // SHA-256 of the recipient SPKI public key
  "wrapped": "<base64url>",             // 256-bit AES key, RSA-OAEP wrapped (≤ 1024 bytes)
  "iv": "<base64url>",                  // AES-GCM IV, exactly 12 bytes (96 bits)
  "ct": "<base64url>",                  // AES-GCM ciphertext incl. 16-byte tag
  "created": "2026-10-29T04:15:22.113Z" // ISO-8601 UTC timestamp (informational)
}
```

### Field rules enforced before any cryptographic operation

| Field | Rule |
| --- | --- |
| `v` | must be the integer `1`; any other value → `UNSUPPORTED_VERSION` |
| `alg.kek/dek/enc` | must equal the three literals above → else `INVALID_FIELD` |
| `kid` | 32–64 lowercase hex chars (SHA-256) → else `INVALID_FIELD` |
| `wrapped` | valid Base64URL, 1–1024 bytes → else `INVALID_FIELD` |
| `iv` | valid Base64URL, exactly 12 bytes → else `INVALID_FIELD` |
| `ct` | valid Base64URL, 17–16384 bytes (≥ 1 byte + 16-byte tag) → else `INVALID_FIELD` |
| whole string | ≤ 32768 characters → else `PAYLOAD_TOO_LARGE` |

### Fields that must never appear

* The plaintext `word`.
* The plaintext `hint`.
* Any private key material.
* Any backup passphrase.

---

## 3. Plaintext (after decryption)

```jsonc
{
  "type": "BHANGMAN-SECRET",
  "v": 1,
  "word": "SECRET PHRASE",
  "hint": "optional hint, may be empty"
}
```

* `word` — required, non-empty after trimming, ≤ 500 characters.
* `hint` — optional, ≤ 300 characters (empty string when unused).
* The game validates this structure after decryption and rejects anything else
  with `BAD_PLAINTEXT`.

---

## 4. Cryptographic construction

Encryption (public key only):

1. Build the plaintext JSON object.
2. `crypto.subtle.generateKey({name:'AES-GCM', length:256})` — random 256-bit AES key.
3. `crypto.getRandomValues(new Uint8Array(12))` — unique 96-bit IV.
4. `crypto.subtle.encrypt({name:'AES-GCM', iv})` — authenticated encryption of the plaintext.
5. `crypto.subtle.importKey('spki', …)` — import the recipient's RSA public key.
6. `crypto.subtle.encrypt({name:'RSA-OAEP'}, …)` — wrap the raw AES key.
7. Assemble the envelope, Base64URL-encode, prefix, done.

Decryption (private key required):

1. Parse and validate the envelope (see §2) **before** any crypto call.
2. Compare `kid` with the fingerprint of the loaded key → `KID_MISMATCH` on difference.
3. RSA-OAEP unwrap the AES key → `DECRYPT_FAILED` on failure.
4. AES-GCM decrypt (authenticated) → `DECRYPT_FAILED` on tampering or wrong key.
5. Validate the plaintext JSON shape → `BAD_PLAINTEXT`.
6. Keep the result in memory for the active round only; never log or persist it.

`crypto.getRandomValues()` and `crypto.subtle` only. No `Math.random()`, no
hand-rolled algorithms.

---

## 5. Key identifier (`kid`)

```
kid = lowercase_hex( SHA-256( DER-SPKI( recipient public key ) ) )
```

* Both applications compute it identically, so you can verify that the public key
  in use is the same key the other side will use to decrypt.
* The human-readable form is the first 32 hex characters grouped in fours:
  `a1b2-c3d4-e5f6-0718-…`.
* `kid` is not secret and is deliberately included in the payload so an app can
  tell you *which* key a payload was addressed to (important after key rotation).

---

## 6. Private-key backup format (never published)

```jsonc
{
  "type": "BHANGMAN-PRIVATE-KEY-BACKUP",
  "v": 1,
  "created": "2026-10-29T04:12:00.000Z",
  "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "<base64url 16B>" },
  "cipher": { "name": "AES-GCM", "keyBits": 256, "iv": "<base64url 12B>" },
  "keyAlg": { "name": "RSA-OAEP", "hash": "SHA-256", "modulusLength": 3072 },
  "fingerprint": "<64 hex chars>",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----…",
  "data": "<base64url AES-256-GCM( PKCS#8 private key )>"
}
```

* The backup file is **not** a payload and must never be uploaded, shared, or
  committed to Git.
* Unlocking requires the backup passphrase:
  `PBKDF2-SHA256(passphrase, salt, 600000) → AES-256-GCM key`.
* Restoring recomputes the fingerprint from `publicKeyPem` and compares it with
  `fingerprint`, so a corrupted or swapped backup is rejected.

---

## 7. Error codes

`CRYPTO_UNAVAILABLE`, `EMPTY_WORD`, `WORD_TOO_LONG`, `HINT_TOO_LONG`,
`MISSING_PUBLIC_KEY`, `INVALID_PUBLIC_KEY`, `NO_PRIVATE_KEY`, `PAYLOAD_FORMAT`,
`PAYLOAD_JSON`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_VERSION`, `INVALID_FIELD`,
`KID_MISMATCH`, `DECRYPT_FAILED`, `BAD_PLAINTEXT`, `BACKUP_FORMAT`,
`BACKUP_VERSION`, `BAD_PASSPHRASE`, `WEAK_PASSPHRASE`, `PASSPHRASE_MISMATCH`.

User-facing messages for these codes live in `app/crypto.js` (`BHCrypto.MESSAGES`)
and are intentionally free of plaintext, key material and stack traces.
