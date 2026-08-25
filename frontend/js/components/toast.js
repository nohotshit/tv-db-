/**
 * Toast notifications.
 *
 * Used for everything the TV needs to say without stealing the screen:
 * cloud went away, a viewer joined, a command was refused. Auto-dismiss, with
 * a cap so a reconnect storm cannot fill the display.
 */

import { h, $ } from '../core/dom.js';
import { on } from '../core/bus.js';
import { state } from '../core/state.js';

const MAX_VISIBLE = 4;
let root = null;

export function initToasts() {
  root = $('#toasts');
  on('notice', function (n) {
    show(n.title, n.message, n.level, n.timeoutMs);
  });
}

export function show(title, message, level, timeoutMs) {
  if (!root) return;
  if (!state.settings.notifications && level !== 'error') return;

  while (root.children.length >= MAX_VISIBLE) {
    root.removeChild(root.firstChild);
  }

  const el = h('div.toast', { class: 'toast t-' + (level || 'info') }, [
    h('div.grow', [
      h('div.t-title', title || 'Notice'),
      message ? h('div.t-msg', message) : null
    ])
  ]);
  root.appendChild(el);

  const life = timeoutMs || (level === 'error' ? 7000 : 4000);
  setTimeout(function () {
    el.classList.add('is-leaving');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
  }, life);

  return el;
}
