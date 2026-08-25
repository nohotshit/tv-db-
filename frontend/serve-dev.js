#!/usr/bin/env node
/**
 * Minimal static server for local development.
 *
 * Render serves the frontend as a static site, so there is no server in
 * production. This exists only so you can open the TV interface in an ordinary
 * browser while working on it - which is by far the fastest way to develop,
 * since the whole UI works before Second Life is involved at all.
 *
 *   node frontend/serve-dev.js          then open http://localhost:5173
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

http.createServer(function (req, res) {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let rel = url === '/' ? '/index.html' : url;
  if (rel === '/remote') rel = '/hud.html';

  // Never serve outside the frontend directory.
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found: ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}).listen(PORT, function () {
  console.log('Smart TV frontend on http://localhost:' + PORT);
});
