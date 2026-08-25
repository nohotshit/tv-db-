/**
 * View router.
 *
 * Views are registered as { id, title, mount(container, params), unmount() }.
 * Only one is mounted at a time; the previous one is torn down so its timers
 * and subscriptions go with it. A view that throws on mount shows the error
 * panel rather than leaving a blank screen - requirement 35, the TV must never
 * be bricked by one broken section.
 */

import { $, clear, h } from './dom.js';
import { state, patch } from './state.js';
import { emit } from './bus.js';
import { log } from './log.js';

const registry = Object.create(null);
let current = null;
let container = null;

export function init(el) {
  container = el;
}

export function register(view) {
  registry[view.id] = view;
}

export function known(id) {
  return !!registry[id];
}

/**
 * Navigate. `push` (default true) records the previous view so Back works.
 */
export function go(id, params, push) {
  if (!registry[id]) {
    log.warn('[router] unknown view', id);
    id = 'home';
  }

  const stack = state.history.slice();
  if (push !== false && current && current.id !== id) {
    stack.push({ id: current.id, params: state.viewParams });
    if (stack.length > 20) stack.shift();
  }

  if (current && current.unmount) {
    try { current.unmount(); } catch (e) { log.warn('[router] unmount threw:', e.message); }
  }

  clear(container);
  current = registry[id];
  patch({ view: id, viewParams: params || {}, history: stack });

  try {
    current.mount(container, params || {});
  } catch (err) {
    log.error('[router] mount failed for', id, err.message);
    renderMountError(id, err);
  }

  emit('view:changed', { id: id, params: params || {} });
}

export function back() {
  const stack = state.history.slice();
  const prev = stack.pop();
  patch({ history: stack });
  if (prev) go(prev.id, prev.params, false);
  else go('home', {}, false);
}

export function currentView() {
  return current ? current.id : null;
}

function renderMountError(id, err) {
  clear(container);
  container.appendChild(
    h('div.view', [
      h('div.panel-error', [
        h('div.pe-icon', '\u26A0'),
        h('div.pe-title', 'This section could not open'),
        h('div.pe-msg', 'The rest of the TV is still working. You can go back to the home screen and try again.'),
        h('div.pe-detail', id + ': ' + (err && err.message ? err.message : 'unknown error')),
        h('div.row', { style: { marginTop: '0.8rem' } }, [
          h('button.btn.btn-primary', { onclick: function () { go(id, state.viewParams, false); } }, 'Retry'),
          h('button.btn', { onclick: function () { go('home'); } }, 'Home')
        ])
      ])
    ])
  );
}
