/**
 * Shared view factory for every section whose content lives on someone else's
 * website: Movies, YouTube, Twitch, Kick and the general Browser.
 *
 * They differ only in destinations and shortcuts, so they share one
 * implementation. Each provides:
 *
 *   { id, title, icon, baseUrl, searchUrl(q), shortcuts[], embed(input),
 *     notes[] }
 *
 * What every one of them has in common is the constraint: these sites cannot
 * be iframed (X-Frame-Options / frame-ancestors), so "open" means asking LSL
 * to point the prim media url at them. Our interface disappears while that is
 * on screen, and the HUD remote becomes the way back. The UI states this
 * plainly instead of implying we still control the page.
 */

import { h } from '../core/dom.js';
import { state, canControl } from '../core/state.js';
import { go, back } from '../core/router.js';
import { setScope } from '../components/nav.js';
import { keyboard } from '../components/keyboard.js';
import { openOnTv, returnToApp, normalizeUrl, hostOf } from '../core/moap.js';
import { addHistory } from '../core/userdata.js';
import { emit } from '../core/bus.js';

export function makeExternalView(spec) {
  let cleanup = [];

  return {
    id: spec.id,
    title: spec.title,

    mount: function (container) {
      const input = h('input.input.grow.mono', {
        type: 'text',
        placeholder: spec.placeholder || 'Search or enter an address',
        value: ''
      });

      const submit = function () {
        const value = input.value.trim();
        if (!value) return;
        const parsed = normalizeUrl(value);
        if (parsed.ok) launch(spec, parsed.url, hostOf(parsed.url));
        else if (spec.searchUrl) launch(spec, spec.searchUrl(value), value + ' \u2013 ' + spec.title);
        else emit('notice', { level: 'warn', title: 'Invalid address', message: parsed.reason });
      };

      const view = h('div.view', [
        header(spec),
        h('div.view-body', [
          h('div.section', [
            h('h3', spec.searchUrl ? 'Search' : 'Address'),
            h('div.row', [
              input,
              h('button.btn.btn-primary.focusable', { onclick: submit }, spec.searchUrl ? 'Search' : 'Go')
            ]),
            keyboard(input, { onSubmit: submit, submitLabel: spec.searchUrl ? 'SEARCH' : 'GO' })
          ]),
          shortcutSection(spec),
          navSection(spec),
          notesSection(spec)
        ])
      ]);

      container.appendChild(view);
      setScope(view);
    },

    unmount: function () {
      cleanup.forEach(function (fn) { fn(); });
      cleanup = [];
    }
  };
}

function header(spec) {
  return h('div.view-head', [
    h('h2.view-title', [ spec.icon + ' ', h('span.accent', spec.title) ]),
    h('span.view-sub', spec.subtitle || ''),
    h('span.grow'),
    h('button.btn.btn-sm.focusable', { onclick: function () { back(); } }, 'Back'),
    h('button.btn.btn-sm.focusable', { onclick: function () { go('home'); } }, 'Home')
  ]);
}

function shortcutSection(spec) {
  if (!spec.shortcuts || !spec.shortcuts.length) return null;
  return h('div.section', [
    h('h3', spec.shortcutsLabel || 'Shortcuts'),
    h('div.row.wrap', spec.shortcuts.map(function (s) {
      return h('button.btn.focusable', {
        onclick: function () { launch(spec, s.url, s.label); }
      }, [ s.icon ? s.icon + ' ' : '', s.label ]);
    }))
  ]);
}

/**
 * Back / Forward / Refresh / Home.
 *
 * These are honest about where they act. Once the prim face is showing an
 * external site, its history belongs to the viewer's embedded browser, and LSL
 * has no API to step it back or forward - llSetPrimMediaParams can only SET a
 * url. So Back and Forward are implemented as our own url stack: we remember
 * what we navigated the prim to and re-set it. Refresh re-sets the current
 * url, which is exactly what a reload is from the object's side.
 */
function navSection(spec) {
  const disabled = !canControl();
  const btn = function (label, fn, title) {
    return h('button.btn.focusable', {
      class: 'btn focusable' + (disabled ? ' is-disabled' : ''),
      title: title || '',
      onclick: fn
    }, label);
  };

  return h('div.section', [
    h('h3', 'Screen controls'),
    h('div.row.wrap', [
      btn('\u25C0 Back', function () { stepHistory(-1); }, 'Return to the previous page we opened'),
      btn('Forward \u25B6', function () { stepHistory(1); }, 'Go forward through pages we opened'),
      btn('\u21BB Refresh', function () { reopenCurrent(); }, 'Re-set the same url on the prim, which reloads it'),
      btn('\u2302 TV Home', function () { returnToApp(); }, 'Put the Smart TV interface back on the screen')
    ]),
    disabled ? h('div.why', 'You do not currently control this TV, so these are disabled.') : null
  ]);
}

function notesSection(spec) {
  if (!spec.notes || !spec.notes.length) return null;
  return h('div.section', [
    h('h3', 'What to expect'),
    h('div.col', spec.notes.map(function (n) {
      return h('div.list-row', [ h('div.lr-main', [ h('div.lr-sub', n) ]) ]);
    }))
  ]);
}

/* -------------------------------------------------------------------------
   Prim url history
   -------------------------------------------------------------------------
   Our own stack, because the embedded browser's history is not reachable from
   LSL. Kept per session and small.
   ------------------------------------------------------------------------- */

const primHistory = [];
let primIndex = -1;

function launch(spec, url, title) {
  const ok = openOnTv(url, {
    title: title || hostOf(url),
    source: spec.id,
    isLive: !!spec.isLive
  });
  if (!ok) return;

  // Drop anything ahead of us, then push.
  primHistory.splice(primIndex + 1);
  primHistory.push({ url: url, title: title || hostOf(url), source: spec.id });
  primIndex = primHistory.length - 1;
  if (primHistory.length > 30) { primHistory.shift(); primIndex--; }

  addHistory({ title: title || hostOf(url), url: url, source: spec.id });

  emit('notice', {
    level: 'ok',
    title: 'Opening on the TV screen',
    message: 'The Smart TV interface is hidden while this site is on screen. Use the HUD remote, or TV Home, to come back.'
  });
}

function stepHistory(delta) {
  const next = primIndex + delta;
  if (next < 0 || next >= primHistory.length) {
    emit('notice', {
      level: 'warn',
      title: delta < 0 ? 'Nothing further back' : 'Nothing further forward',
      message: 'This history only covers pages opened from the TV, not links followed inside the site itself. The viewer keeps that history and it is not reachable from a script.'
    });
    return;
  }
  primIndex = next;
  const entry = primHistory[primIndex];
  openOnTv(entry.url, { title: entry.title, source: entry.source });
}

function reopenCurrent() {
  const entry = primHistory[primIndex];
  if (entry) openOnTv(entry.url, { title: entry.title, source: entry.source });
  else if (state.media.url) openOnTv(state.media.url, { title: state.media.title, source: state.media.source });
}

export function primHistoryState() {
  return { entries: primHistory.slice(), index: primIndex };
}
