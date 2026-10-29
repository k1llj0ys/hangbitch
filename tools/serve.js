/*
 * Hangbitch — tiny local static file server (Node.js fallback).
 *
 * Used by start-game.bat when Python is not installed. It binds to 127.0.0.1
 * only, so nothing is exposed to the local network, and it never contacts the
 * internet. Standard library only — no packages, no install step.
 *
 * Usage:
 *   node tools/serve.js 8777 "C:\path\to\hangbitch\app"
 */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const port = Number(process.argv[2] || 8777);
const defaultRoot = path.join(__dirname, '..', 'app');
const root = path.resolve(process.argv[3] || defaultRoot);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }, headers || {}));
  if (body === null) {
    res.end();
  } else {
    res.end(body);
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  let requestPath;
  try {
    requestPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  } catch (err) {
    send(res, 400, 'Bad request', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  if (requestPath === '/' || requestPath === '') {
    requestPath = '/index.html';
  }

  const target = path.resolve(path.join(root, requestPath));

  // Refuse anything that escapes the served directory.
  if (target !== root && !target.startsWith(root + path.sep)) {
    send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  fs.stat(target, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }

    const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
    if (req.method === 'HEAD') {
      send(res, 200, null, { 'Content-Type': type, 'Content-Length': stats.size });
      return;
    }

    fs.readFile(target, (readErr, data) => {
      if (readErr) {
        send(res, 500, 'Read error', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
      }
      send(res, 200, data, { 'Content-Type': type, 'Content-Length': data.length });
    });
  });
});

server.on('error', (err) => {
  console.error('Could not start the local server on port ' + port + ': ' + err.message);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  console.log('Hangbitch is being served from ' + root);
  console.log('Open http://127.0.0.1:' + port + '/index.html  (press Ctrl+C to stop)');
});

['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
});
