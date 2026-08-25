/**
 * Spatial focus manager.
 *
 * A TV is driven by a D-pad, and in this system that D-pad is a HUD button or
 * an LSL dialog - not a keyboard. So focus cannot rely on the browser's tab
 * order. This module keeps its own notion of "the focused element" among
 * everything matching `.focusable` inside the active view, and moves it by
 * geometry: pressing Right picks the nearest focusable whose centre is to the
 * right, with a penalty for vertical distance.
 *
 * Mouse hover and clicks also update the focus, so the shared TV screen (where
 * people do click directly) and the HUD remote stay consistent.
 */

import { $$, cls } from '../core/dom.js';
import { on, emit } from '../core/bus.js';

let scope = document;
let focused = null;

export function setScope(el) {
  scope = el || document;
  // Focus the first candidate so a freshly opened view is immediately drivable
  // from the remote without needing a click first.
  const items = candidates();
  focus(items[0] || null);
}

function candidates() {
  return $$('.focusable', scope).filter(function (el) {
    if (el.classList.contains('is-disabled') || el.hasAttribute('disabled')) return false;
    if (el.classList.contains('hidden')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

export function focus(el) {
  if (focused === el) return;
  if (focused) cls(focused, 'is-focused', false);
  focused = el;
  if (focused) {
    cls(focused, 'is-focused', true);
    scrollIntoViewIfNeeded(focused);
    emit('nav:focus', focused);
  }
}

export function focused$() {
  return focused;
}

function scrollIntoViewIfNeeded(el) {
  const box = el.getBoundingClientRect();
  let p = el.parentElement;
  while (p && p !== document.body) {
    const style = window.getComputedStyle(p);
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
      const pr = p.getBoundingClientRect();
      if (box.top < pr.top) p.scrollTop -= (pr.top - box.top) + 12;
      else if (box.bottom > pr.bottom) p.scrollTop += (box.bottom - pr.bottom) + 12;
      return;
    }
    p = p.parentElement;
  }
}

/**
 * Move focus in a direction. Scoring: primary-axis distance plus four times
 * the off-axis distance, so a control directly to the right always beats one
 * that is slightly right but far above.
 */
export function move(dir) {
  const items = candidates();
  if (!items.length) return;
  if (!focused || items.indexOf(focused) < 0) { focus(items[0]); return; }

  const from = center(focused);
  let best = null;
  let bestScore = Infinity;

  items.forEach(function (el) {
    if (el === focused) return;
    const to = center(el);
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    let along, across;
    if (dir === 'left')       { along = -dx; across = Math.abs(dy); }
    else if (dir === 'right') { along =  dx; across = Math.abs(dy); }
    else if (dir === 'up')    { along = -dy; across = Math.abs(dx); }
    else                      { along =  dy; across = Math.abs(dx); }

    if (along <= 2) return;                 // wrong side, ignore
    const score = along + across * 4;
    if (score < bestScore) { bestScore = score; best = el; }
  });

  if (best) focus(best);
}

function center(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Activate the focused control. */
export function select() {
  if (!focused) return;
  focused.click();
}

/* ---- wiring ------------------------------------------------------------- */

// Remote commands arrive on the bus from three places: the HUD page, LSL link
// messages relayed through the backend, and a physical keyboard during
// development.
on('remote:key', function (key) {
  if (key === 'up' || key === 'down' || key === 'left' || key === 'right') move(key);
  else if (key === 'select') select();
});

document.addEventListener('mouseover', function (ev) {
  const el = ev.target && ev.target.closest ? ev.target.closest('.focusable') : null;
  if (el && scope.contains && scope.contains(el)) focus(el);
});

// Keyboard is a development convenience. In-world, MOAP only receives key
// events while the media face has focus, which is not something a TV UI can
// rely on - the HUD is the real remote.
document.addEventListener('keydown', function (ev) {
  const map = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Enter: 'select', Escape: 'back', Backspace: 'back'
  };
  const target = ev.target;
  const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
  if (typing && ev.key !== 'Escape') return;
  const key = map[ev.key];
  if (!key) return;
  ev.preventDefault();
  emit('remote:key', key);
});
