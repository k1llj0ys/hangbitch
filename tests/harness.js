/*
 * Hangbitch — minimal dependency-free test harness.
 *
 * Used by tests/hangbitch-tests.js. Run with plain Node:
 *
 *   node tests/hangbitch-tests.js
 *
 * This file is Hangbitch's own copy: `projectRoot` is the Hangbitch folder, so
 * the suite never reaches outside this app.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');

class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

function ok(value, message) {
  if (!value) {
    throw new AssertionError(message || ('expected a truthy value, got ' + String(value)));
  }
}

function eq(actual, expected, message) {
  if (actual !== expected) {
    throw new AssertionError(
      (message || 'values differ') +
      ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)
    );
  }
}

function includes(haystack, needle, message) {
  if (String(haystack).indexOf(needle) === -1) {
    throw new AssertionError((message || 'expected to find') + ' ' + JSON.stringify(needle));
  }
}

function notIncludes(haystack, needle, message) {
  if (String(haystack).indexOf(needle) !== -1) {
    throw new AssertionError((message || 'expected NOT to find') + ' ' + JSON.stringify(needle));
  }
}

function match(text, regex, message) {
  if (!regex.test(String(text))) {
    throw new AssertionError(message || ('did not match ' + regex));
  }
}

function noMatch(text, regex, message) {
  if (regex.test(String(text))) {
    throw new AssertionError(message || ('unexpectedly matched ' + regex));
  }
}

/** Assert that `fn` throws/rejects, optionally with a specific error code. */
async function rejects(fn, code, message) {
  let threw = false;
  let caught = null;
  try {
    await fn();
  } catch (err) {
    threw = true;
    caught = err;
  }
  if (!threw) {
    throw new AssertionError(message || 'expected the call to fail, but it succeeded');
  }
  if (code && caught && caught.code !== code) {
    throw new AssertionError(
      (message || 'unexpected error code') +
      ': expected ' + code + ', got ' + (caught.code || caught.name) + ' (' + caught.message + ')'
    );
  }
  return caught;
}

/**
 * Load one of the browser scripts (classic IIFEs that attach to `globalThis`)
 * and return the namespace it exports, without polluting this process.
 *
 * The scripts reach the platform through `globalThis.crypto` and friends, so the
 * sandbox we hand them must expose the real Node implementations.
 */
function loadNamespace(relativeFile, namespaceName) {
  const file = path.join(projectRoot, relativeFile);
  const source = fs.readFileSync(file, 'utf8');

  const sandbox = {
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    console,
    URL,
    Blob,
    setTimeout,
    clearTimeout,
    Date,
    JSON,
    Math,
    Promise,
    Set,
    Map,
    WeakMap,
    Error,
    TypeError,
    ArrayBuffer,
    Uint8Array,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Symbol,
    RegExp,
    isNaN,
    parseInt,
    parseFloat
  };
  // Some browser scripts assign to `window.<NAME>`; treat the sandbox as the
  // window so those scripts work unchanged under Node.
  sandbox.window = sandbox;
  sandbox.self = sandbox;

  // `new Function` bodies only see real globals plus their own parameters, so
  // the browser globals a script might reach for must be injected by name.
  const factory = new Function(
    'globalThis',
    'window',
    'self',
    source + '\n;return globalThis.' + namespaceName + ';'
  );
  const namespace = factory(sandbox, sandbox, sandbox);
  if (!namespace) {
    throw new AssertionError(relativeFile + ' did not export globalThis.' + namespaceName);
  }
  return namespace;
}

function read(relativeFile) {
  return fs.readFileSync(path.join(projectRoot, relativeFile), 'utf8');
}

/**
 * Read a source file with comments removed.
 *
 * Static audits (for example "no fetch(), no Math.random()") must look at code,
 * not at prose: the crypto core legitimately documents "never use Math.random()"
 * and the game documents where secrets are stored.
 *
 * The `//` rule deliberately requires a preceding character that is neither a
 * colon nor a backslash, so `https://…` inside a string is left untouched.
 */
function code(relativeFile) {
  return read(relativeFile)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

function exists(relativeFile) {
  return fs.existsSync(path.join(projectRoot, relativeFile));
}

async function runAll(title, cases) {
  let passed = 0;
  const failures = [];

  console.log('\n' + title);
  console.log('-'.repeat(title.length));

  for (const testCase of cases) {
    try {
      await testCase.fn();
      passed++;
      console.log('  PASS  ' + testCase.name);
    } catch (err) {
      failures.push({ name: testCase.name, error: err });
      console.log('  FAIL  ' + testCase.name);
      console.log('        ' + (err && err.message ? err.message : String(err)));
    }
  }

  console.log('');
  console.log(passed + ' passed, ' + failures.length + ' failed, ' + cases.length + ' total');

  if (failures.length) {
    process.exitCode = 1;
  }
  return { passed, failures };
}

module.exports = {
  projectRoot,
  AssertionError,
  ok,
  eq,
  includes,
  notIncludes,
  match,
  noMatch,
  rejects,
  loadNamespace,
  read,
  code,
  exists,
  runAll
};
