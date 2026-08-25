/**
 * Branding.
 *
 * The logo is configurable in three independent places, highest priority
 * first, so it can be swapped without touching code:
 *
 *   1. `?logo=` in the MOAP url        - set by LSL, per-TV override
 *   2. LOGO_URL env var on Render      - per-deployment override
 *   3. branding.json                   - repo default (logo.png, then logo.svg)
 *
 * Every <img class="brand-logo-img"> on the page is filled in by applyLogo(),
 * and a load failure silently falls back down the chain rather than leaving a
 * broken image on a screen that is meant to look like a product.
 */

import { config } from './config.js';
import { $$ } from './dom.js';
import { log } from './log.js';

const FALLBACK = {
  brandName: 'Musical Impact',
  productName: 'SMART TV',
  tagline: '',
  logo: {
    primary: 'assets/branding/logo.png',
    fallback: 'assets/branding/logo.svg',
    mark: '',
    maxWidthPx: 620
  },
  theme: {},
  boot: { enabled: true, durationMs: 2600, lines: ['Initializing...'] },
  idle: { showClock: true, showDate: true, showTimezone: true, prompt: 'Press any button to begin' }
};

export let branding = FALLBACK;

export async function loadBranding() {
  try {
    const res = await fetch('branding.json', { cache: 'no-cache' });
    if (res.ok) {
      const json = await res.json();
      branding = Object.assign({}, FALLBACK, json);
      branding.logo = Object.assign({}, FALLBACK.logo, json.logo || {});
    }
  } catch (e) {
    log.warn('[branding] branding.json unreadable, using defaults');
  }

  if (config.brandName) branding.brandName = config.brandName;

  applyTheme();
  applyText();
  applyLogo();
  return branding;
}

/** Push palette overrides from branding.json onto :root. */
function applyTheme() {
  const t = branding.theme || {};
  const map = {
    accent: '--accent',
    accentDim: '--accent-dim',
    accentGlow: '--accent-glow',
    bg: '--bg',
    bgElevated: '--bg-elevated',
    bgTile: '--bg-tile',
    text: '--text',
    textMuted: '--text-muted',
    border: '--border'
  };
  Object.keys(map).forEach(function (k) {
    if (t[k]) document.documentElement.style.setProperty(map[k], t[k]);
  });
  if (t.accent) {
    // Derive the soft tint so a single accent override stays coherent.
    document.documentElement.style.setProperty('--accent-soft', hexToRgba(t.accent, 0.16));
  }
}

function hexToRgba(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
  if (!m) return 'rgba(255,45,46,' + alpha + ')';
  return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + alpha + ')';
}

function applyText() {
  $$('[data-bind]').forEach(function (el) {
    const key = el.getAttribute('data-bind');
    if (branding[key]) el.textContent = branding[key];
  });
  document.title = branding.brandName + ' ' + branding.productName;
}

/**
 * Resolve the logo, walking the fallback chain on error. `<img>` onerror is
 * the only reliable existence check available to us inside CEF.
 */
export function applyLogo() {
  const chain = [];
  if (config.logoUrl) chain.push(config.logoUrl);
  if (branding.logo.primary) chain.push(branding.logo.primary);
  if (branding.logo.fallback) chain.push(branding.logo.fallback);

  $$('.brand-logo-img').forEach(function (img) {
    attach(img, chain.slice(), branding.brandName);
  });
}

function attach(img, chain, alt) {
  img.alt = alt || '';
  function next() {
    if (!chain.length) {
      img.style.display = 'none';
      log.warn('[branding] no logo could be loaded');
      return;
    }
    const src = chain.shift();
    img.onerror = next;
    img.onload = function () { img.onerror = null; img.style.display = ''; };
    img.src = src;
  }
  next();
}

/** Small square mark for tight spaces; falls back to the full logo. */
export function markUrl() {
  if (branding.logo.mark) return branding.logo.mark;
  if (config.logoUrl) return config.logoUrl;
  return branding.logo.primary;
}
