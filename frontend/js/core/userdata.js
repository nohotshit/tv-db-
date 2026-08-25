/**
 * Favorites, history and settings persistence.
 *
 * Two tiers, deliberately:
 *
 *   local  - localStorage, always available, per viewer machine. This is what
 *            keeps the TV useful when Render is down (requirement 36).
 *   cloud  - Postgres via the backend, only when this surface carries an
 *            identity. The shared TV screen has no idea who is looking at it,
 *            so it can only ever write local data; the HUD, which is attached
 *            to one avatar and carries a token, writes to the account.
 *
 * Local is written first and always. Cloud is best-effort on top.
 */

import { api } from './api.js';
import { config, hasIdentity } from './config.js';
import { state, patch } from './state.js';
import * as storage from './storage.js';
import { log } from './log.js';

const HISTORY_MAX = 60;

/* ---- load --------------------------------------------------------------- */

export async function loadUserData() {
  patch({
    favorites: storage.get('favorites', []),
    historyItems: storage.get('history', [])
  });

  if (!hasIdentity()) return;

  const favs = await api.listFavorites();
  if (favs.ok && favs.data && Array.isArray(favs.data.favorites)) {
    patch({ favorites: mergeById(state.favorites, favs.data.favorites) });
    storage.set('favorites', state.favorites);
  }

  const hist = await api.listHistory();
  if (hist.ok && hist.data && Array.isArray(hist.data.history)) {
    patch({ historyItems: hist.data.history.slice(0, HISTORY_MAX) });
    storage.set('history', state.historyItems);
  }
}

function mergeById(local, remote) {
  const byId = Object.create(null);
  local.concat(remote).forEach(function (item) {
    const key = item.id || (item.source + '|' + item.url);
    if (!byId[key]) byId[key] = item;
  });
  return Object.keys(byId).map(function (k) { return byId[k]; });
}

/* ---- favorites ---------------------------------------------------------- */

export function isFavorite(url) {
  return state.favorites.some(function (f) { return f.url === url; });
}

export async function addFavorite(fav) {
  if (!fav || !fav.url) return false;
  if (isFavorite(fav.url)) return false;

  const item = {
    id: 'loc-' + Date.now().toString(36),
    title: fav.title || fav.url,
    url: fav.url,
    source: fav.source || 'web',
    createdAt: Date.now()
  };

  patch({ favorites: state.favorites.concat([item]) });
  storage.set('favorites', state.favorites);

  if (hasIdentity()) {
    const res = await api.addFavorite({ title: item.title, url: item.url, source: item.source });
    if (res.ok && res.data && res.data.favorite) {
      // Swap the local id for the server one so removal works on both sides.
      const list = state.favorites.map(function (f) {
        return f.id === item.id ? res.data.favorite : f;
      });
      patch({ favorites: list });
      storage.set('favorites', list);
    }
  }
  return true;
}

export async function removeFavorite(id) {
  patch({ favorites: state.favorites.filter(function (f) { return f.id !== id; }) });
  storage.set('favorites', state.favorites);
  if (hasIdentity() && String(id).indexOf('loc-') !== 0) {
    await api.removeFavorite(id);
  }
}

/* ---- history ------------------------------------------------------------ */

/**
 * Requirement 17: title, url, source, timestamp. Nothing else. No avatar
 * position, no session fingerprint, no analytics - there is no reason for a
 * television to collect any of that.
 */
export function addHistory(item) {
  if (!item || !item.url) return;

  const entry = {
    title: item.title || item.url,
    url: item.url,
    source: item.source || 'web',
    timestamp: Date.now()
  };

  // Collapse consecutive duplicates rather than filling the list.
  const list = state.historyItems.filter(function (x) { return x.url !== entry.url; });
  list.unshift(entry);
  const trimmed = list.slice(0, HISTORY_MAX);

  patch({ historyItems: trimmed });
  storage.set('history', trimmed);

  if (hasIdentity()) api.addHistory(entry);
}

export async function clearHistory() {
  patch({ historyItems: [] });
  storage.set('history', []);
  if (hasIdentity()) await api.clearHistory();
  log.info('[userdata] history cleared');
}

/* ---- settings ----------------------------------------------------------- */

export function loadSettingsLocal() {
  const saved = storage.get('settings', null);
  if (saved) patch({ settings: saved });
  applySettingsToDocument();
}

export async function loadSettingsCloud() {
  if (!hasIdentity()) return;
  const res = await api.getSettings();
  if (res.ok && res.data && res.data.settings) {
    patch({ settings: Object.assign({}, state.settings, res.data.settings) });
    storage.set('settings', state.settings);
    applySettingsToDocument();
  }
}

let saveTimer = null;

/** Persist locally at once, and to the cloud debounced. */
export function saveSettings(delta) {
  patch({ settings: delta });
  storage.set('settings', state.settings);
  applySettingsToDocument();

  if (!hasIdentity()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    api.saveSettings(state.settings);
  }, 800);
}

/** Push the display-affecting settings onto the document. */
export function applySettingsToDocument() {
  const s = state.settings;
  const root = document.documentElement;
  root.setAttribute('data-theme', s.theme || 'brand');
  root.style.setProperty('--ui-scale', String(s.uiScale || 1));
  root.style.setProperty('--brightness', String(s.brightness || 1));
}
