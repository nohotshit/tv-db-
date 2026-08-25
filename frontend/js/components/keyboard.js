/**
 * On-screen keyboard.
 *
 * Needed because text entry on a TV prim is awkward: MOAP only delivers key
 * events while the media face itself holds focus in the viewer, which a user
 * driving the TV from a HUD does not have. Every text field in the app can
 * therefore be filled with the D-pad instead.
 *
 * LSL also offers llTextBox for entry from the object side; the two paths feed
 * the same field, and the search views use whichever the user reaches for.
 */

import { h, clear } from '../core/dom.js';
import { setScope } from './nav.js';

const ROWS = [
  '1234567890',
  'qwertyuiop',
  'asdfghjkl:',
  'zxcvbnm./-'
];

/**
 * Mount a keyboard that types into `input`.
 * Returns the element so the caller can place it in its own layout.
 */
export function keyboard(input, opts) {
  const options = opts || {};
  const wrap = h('div.osk');

  const type = function (ch) {
    input.value += ch;
    input.dispatchEvent(new Event('input'));
  };

  ROWS.forEach(function (row) {
    row.split('').forEach(function (ch) {
      wrap.appendChild(h('div.key.focusable', { onclick: function () { type(ch); } }, ch));
    });
  });

  wrap.appendChild(h('div.key.focusable.wide', {
    onclick: function () {
      input.value = input.value.slice(0, -1);
      input.dispatchEvent(new Event('input'));
    }
  }, 'DEL'));

  wrap.appendChild(h('div.key.focusable.xwide', { onclick: function () { type(' '); } }, 'SPACE'));

  wrap.appendChild(h('div.key.focusable.wide', {
    onclick: function () { input.value = ''; input.dispatchEvent(new Event('input')); }
  }, 'CLEAR'));

  if (options.showDot !== false) {
    wrap.appendChild(h('div.key.focusable', { onclick: function () { type('.com'); } }, '.com'));
  }

  wrap.appendChild(h('div.key.focusable.wide.accent', {
    onclick: function () { if (options.onSubmit) options.onSubmit(input.value); }
  }, options.submitLabel || 'GO'));

  return wrap;
}

/** Full-screen keyboard in a modal, for one-off entry. */
export function promptText(title, initial, onSubmit) {
  const input = h('input.input.grow', { type: 'text', value: initial || '' });
  const body = h('div.col', [ input ]);
  const kb = keyboard(input, {
    submitLabel: 'DONE',
    onSubmit: function (v) { onSubmit(v); }
  });
  body.appendChild(kb);
  return { input: input, body: body, keyboard: kb };
}
