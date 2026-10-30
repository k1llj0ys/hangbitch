/*
 * Hangbitch - built-in default key pair.
 *
 * WHY THIS FILE EXISTS
 *   The app ships with one ready-to-use key pair so it works with NO setup:
 *   "Generate a word" encrypts to this public key and "Play a game" decrypts
 *   with the matching private key.
 *
 * READ THIS BEFORE PUBLISHING
 *   The private key below is PUBLIC once this file is deployed. Anyone who can
 *   open the app can therefore decrypt payloads made with the default key. That
 *   is the deliberate price of a frictionless first run.
 *   Use Key settings -> "Change key pair" to generate your own pair, which is
 *   kept in your browser instead of in this file.
 */
window.BH_DEFAULT_KEYS = {
  createdAt: '2026-10-30T00:00:00.000Z',
  publicKeyPem:
    '-----BEGIN PUBLIC KEY-----\n' +
    'MIGdMA0GCSqGSIb3DQEBAQUAA4wAMIGIAoEAtUGIHgFMqFISaGC41ykqplptDoKn\n' +
    'WSti9/SZUmlJSxkM3GYji+muAH6vXntDm1yfsTyQr9rTsRPn4dHdEkdd1bVY8SAT\n' +
    'A/jyWkCYywCqkmJa2LR92nISAASSpiXfRUCuSLFK/Hoks0Z6eF9DL0HEO+MQ2CZn\n' +
    'ZCFIVR4KvDWuo4kCAwEAAQ==\n' +
    '-----END PUBLIC KEY-----\n',
  privateKeyPem:
    '-----BEGIN PRIVATE KEY-----\n' +
    'MIICdQIBADANBgkqhkiG9w0BAQEFAASCAl8wggJbAgEAAoEAtUGIHgFMqFISaGC4\n' +
    '1ykqplptDoKnWSti9/SZUmlJSxkM3GYji+muAH6vXntDm1yfsTyQr9rTsRPn4dHd\n' +
    'Ekdd1bVY8SATA/jyWkCYywCqkmJa2LR92nISAASSpiXfRUCuSLFK/Hoks0Z6eF9D\n' +
    'L0HEO+MQ2CZnZCFIVR4KvDWuo4kCAwEAAQKAXnck5d5vgVok1dly/FAsNj7yj5lw\n' +
    'dnyyO+By+Ax/cnA/z6474HONiBx+cZN0jMgdQlX6Ymx939AsDfk+aoRfVl00Kn0+\n' +
    'XskN6Nh1igTTYdKCIHeonKIhL0m/6BDpHZGjIVlTDdL9FvG97lTmuh0BMK2u/Z/7\n' +
    'XEcmkPKANdjeYLECQQDMl1nS718dBDCoZ1/Pee7RszPhp1Ap2El6/b7IhXmZlNpJ\n' +
    '1lMlKPenR0e9FqjNxtpy5/S4UmAgecoNCZsA6V5LAkEA4s0bDaKMq2MpGNmHS7Y9\n' +
    'h1TYtKuEPE9Jv2bmlDxGylIZ6rSdiNO5l4xpATuc0fuKCiPTsrqnWImHQD6Oal+Q\n' +
    '+wJAWGYpBJAzG5l84LbR2hbITslMaHrfk0UF8uOCtKefc/GyI+c8Q7kg0KFm6NfK\n' +
    'licOqkl5Hs9RA5c760g0Nj+fYwJBAJ4FRhoj7VrkhhfYSBoKaahHB44qCsJyg/Gl\n' +
    '4nXZ4YDJ32DWYwSYcDEVFXxUapkrZyxVdgSLZFmdyOyMKXIYD80CQQDD1E8sg4+s\n' +
    'Z14L4dG0znNx2K55BOJY2lq/pCHXxnKl9Vif++VXX/Gee3cCJGaFqfrUehRosE6m\n' +
    '2NyZkKtAYV4R\n' +
    '-----END PRIVATE KEY-----\n'
};
