/**
 * Modal dialogs: confirm, prompt, and a generic content shell.
 *
 * Focus is trapped to the dialog by re-scoping the navigation manager, so the
 * D-pad cannot wander off behind the scrim.
 */

import { h, $, clear } from '../core/dom.js';
import { setScope } from './nav.js';

let root = null;
let restoreScope = null;

export function initModals() {
  root = $('#modal-root');
}

export function openModal(opts) {
  if (!root) return function () {};
  close();

  const scrim = h('div.modal-scrim');
  const box = h('div.modal', [
    h('div.modal-head', opts.title || ''),
    h('div.modal-body', opts.body || null),
    h('div.modal-foot', (opts.buttons || []).map(function (b) {
      return h('button.btn.focusable', {
        class: 'btn focusable ' + (b.primary ? 'btn-primary' : (b.danger ? 'btn-danger' : '')),
        onclick: function () {
          if (b.onclick) b.onclick();
          if (b.keepOpen !== true) close();
        }
      }, b.label);
    }))
  ]);

  scrim.appendChild(box);
  root.appendChild(scrim);

  restoreScope = opts.restoreScope || document.getElementById('viewport');
  setScope(box);

  if (opts.dismissible !== false) {
    scrim.addEventListener('click', function (ev) { if (ev.target === scrim) close(); });
  }
  return close;
}

export function close() {
  if (!root) return;
  clear(root);
  if (restoreScope) setScope(restoreScope);
  restoreScope = null;
}

export function confirm(title, message, onYes, yesLabel) {
  return openModal({
    title: title,
    body: message,
    buttons: [
      { label: 'Cancel' },
      { label: yesLabel || 'Confirm', primary: true, onclick: onYes }
    ]
  });
}
