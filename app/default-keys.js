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
  createdAt: '2026-10-29T00:45:36.308Z',
  publicKeyPem:
    '-----BEGIN PUBLIC KEY-----\n' +
    'MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA2YuN8/9aOUST7fCKdwFx\n' +
    'ugcsNmw94BgdED4Oar+uEipKjLHEP3lPx8RMAm0/Wfmx3r9IGJojb1vOtFnt6dGI\n' +
    'U0YwSnc9S3lo0Xbv2cqoRWv4zK3/cfF8e/UwhiAk1LnnI2GAlokbMjTQznUXNn7s\n' +
    'kM3mJzE64ZoI1JF+er+PtMyFOSlop8cORKCv5cZ0M7hI8ls/oXYt0ILzzD44WZY8\n' +
    'i0gTpxQ1sYthZXo5PPaBWK71S6YVdsX2ax7PzrGda7hB+W2oX25BanSaDhG3jrlX\n' +
    'oHjB3SW14fQy2pgfQvRtYpviH73HL0q8qKzg4FvfKrzGzoBeiTQkrN3et9FuiQo7\n' +
    '3nFioj0cTB0cdBuem8/edslyRMbz37Z775n1D7+HU/e105f1tvT/ZLUN1D92Cjgs\n' +
    '+kp1MTac4fzxRSJlFQa5Vf7Y7B08jqikM9FSizrxwQnE9EkI7yPOIZcbB6EHNThk\n' +
    'i0iMYXL1U5Yr/s6PoK59wYYIbkvhyHhSDT+qj7Apucy1AgMBAAE=\n' +
    '-----END PUBLIC KEY-----\n',
  privateKeyPem:
    '-----BEGIN PRIVATE KEY-----\n' +
    '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\n' +
    'AIEVwVNR0DltqrxDkVixcoE=\n' +
    '-----END PRIVATE KEY-----\n'
};
