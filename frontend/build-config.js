#!/usr/bin/env node
/**
 * Render static-site build step.
 *
 * Turns build-time environment variables into `config.generated.js`, which the
 * app loads before anything else. This is the ONLY place deployment-specific
 * values enter the frontend - there are no secrets here, just public URLs.
 *
 * Local development: skip it. `js/core/config.js` falls back to sensible
 * localhost defaults when `config.generated.js` is absent.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** Render's `property: host` gives a bare hostname; accept either form. */
function toOrigin(value, fallback) {
  if (!value) return fallback;
  const trimmed = String(value).trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

const backendUrl = toOrigin(process.env.BACKEND_URL, '');
const wsUrl = backendUrl ? backendUrl.replace(/^http/i, 'ws') + '/rt' : '';

const config = {
  BACKEND_URL: backendUrl,
  WS_URL: wsUrl,
  LOGO_URL: process.env.LOGO_URL || '',
  BRAND_NAME: process.env.BRAND_NAME || '',
  BUILD_TIME: new Date().toISOString(),
  COMMIT: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7)
};

const out = `/* Generated at build time by build-config.js - do not edit by hand. */
window.__SMARTTV_CONFIG__ = ${JSON.stringify(config, null, 2)};
`;

fs.writeFileSync(path.join(__dirname, 'config.generated.js'), out, 'utf8');
console.log('[build-config] wrote config.generated.js');
console.log('[build-config] BACKEND_URL =', backendUrl || '(unset - frontend will run in local-only mode)');
