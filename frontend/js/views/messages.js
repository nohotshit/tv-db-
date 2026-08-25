/**
 * Messages.
 *
 * WHAT THIS IS
 *   A message board that belongs to this TV. Avatars near the TV are detected
 *   by LSL (llGetAgentList over the parcel, on a slow timer - no sensor sweeps)
 *   and reported to the backend, which relays the list here. Messages typed
 *   here go back out through the backend to the object, which says them in
 *   world with llRegionSayTo, or delivers them as an instant message from the
 *   object if the recipient has walked away.
 *
 * WHAT THIS IS NOT
 *   It has no access to anyone private Second Life IMs, group chat, friend
 *   list or account. No script can read those, and nothing here tries. Every
 *   message in this view was typed into this TV by someone standing at it.
 */

import { h, clear } from '../core/dom.js';
import { state, patch, subscribe } from '../core/state.js';
import { go, back } from '../core/router.js';
import { setScope } from '../components/nav.js';
import { keyboard } from '../components/keyboard.js';
import { config, hasIdentity } from '../core/config.js';
import { send, isConnected } from '../core/socket.js';
import { relativeTime, formatTime } from '../core/clock.js';
import { emit } from '../core/bus.js';

let unsub = null;
let refs = null;
let target = null;      // null = everyone at this TV

export const messages = {
  id: 'messages',
  title: 'Messages',

  mount: function (container) {
    const input = h('input.input.grow', {
      type: 'text', placeholder: 'Type a message', maxlength: '400'
    });

    const submit = function () {
      const text = input.value.trim();
      if (!text) return;
      sendMessage(text);
      input.value = '';
    };

    const chat = h('div.chat');
    const people = h('div.col');

    const view = h('div.view', [
      h('div.view-head', [
        h('h2.view-title', [ '\u{1F4AC} ', h('span.accent', 'Messages') ]),
        h('span.view-sub', 'Everyone at this TV'),
        h('span.grow'),
        h('button.btn.btn-sm.focusable', { onclick: function () { back(); } }, 'Back'),
        h('button.btn.btn-sm.focusable', { onclick: function () { go('home'); } }, 'Home')
      ]),
      h('div.row.grow', { style: { gap: '1rem', alignItems: 'stretch', minHeight: '0' } }, [
        h('div.col.grow', { style: { minWidth: '0' } }, [ chat ]),
        h('div.col', { style: { width: '13rem', flex: '0 0 auto' } }, [
          h('div.section', [ h('h3', 'Nearby'), people ])
        ])
      ]),
      h('div.view-foot', { style: { flexDirection: 'column', alignItems: 'stretch' } }, [
        h('div.row', [
          h('span.badge', { id: 'msg-target' }, 'To: everyone'),
          input,
          h('button.btn.btn-primary.focusable', { onclick: submit }, 'Send')
        ]),
        keyboard(input, { onSubmit: submit, submitLabel: 'SEND', showDot: false })
      ])
    ]);

    container.appendChild(view);
    setScope(view);

    refs = { chat: chat, people: people, target: view.querySelector('#msg-target') };
    unsub = subscribe(['messages', 'viewers'], render);
    render();
  },

  unmount: function () {
    if (unsub) unsub();
    unsub = null;
    refs = null;
  }
};

function sendMessage(text) {
  if (!state.settings.messagingEnabled) {
    emit('notice', { level: 'warn', title: 'Messaging is off', message: 'Turn it on in Settings, Messaging.' });
    return;
  }

  const msg = {
    tvId: state.tv.id,
    from: { key: config.userKey || '', name: config.userName || 'Screen' },
    to: target ? { key: target.key, name: target.name } : null,
    text: text.slice(0, 400),
    at: Date.now()
  };

  // Show it immediately; the relay confirms or the cloud is down.
  patch({ messages: state.messages.concat([Object.assign({ local: true }, msg)]).slice(-100) });

  if (!isConnected()) {
    patch({
      messages: state.messages.concat([{
        system: true, text: 'Not delivered: the cloud is unreachable, so the TV cannot pass this to the in-world script.', at: Date.now()
      }]).slice(-100)
    });
    return;
  }
  send('message', msg);
}

function setTarget(person) {
  target = person;
  if (refs) {
    refs.target.textContent = person ? 'To: ' + person.name : 'To: everyone';
    refs.target.className = person ? 'badge b-accent' : 'badge';
  }
  render();
}

function render() {
  if (!refs) return;

  // ---- conversation ----
  clear(refs.chat);
  const list = state.messages.filter(function (m) {
    if (!target) return true;
    const involved = (m.from && m.from.key === target.key) || (m.to && m.to.key === target.key);
    return involved || m.system;
  });

  if (!list.length) {
    refs.chat.appendChild(h('div.empty', [
      h('div.empty-icon', '\u{1F4AC}'),
      h('div', 'No messages yet'),
      h('div.faint', 'Messages are kept for this session only')
    ]));
  }

  list.forEach(function (m) {
    if (m.system) {
      refs.chat.appendChild(h('div.msg.is-system', m.text));
      return;
    }
    const mine = hasIdentity() && m.from && m.from.key === config.userKey;
    refs.chat.appendChild(h('div.msg', { class: 'msg' + (mine ? ' is-mine' : '') }, [
      h('div.m-from', (m.from ? m.from.name : 'Unknown') + (m.to ? ' \u2192 ' + m.to.name : '')),
      h('div', m.text),
      h('div.m-time', formatTime(new Date(m.at)))
    ]));
  });
  refs.chat.scrollTop = refs.chat.scrollHeight;

  // ---- nearby people ----
  clear(refs.people);
  refs.people.appendChild(h('div.viewer-chip.focusable', {
    class: 'viewer-chip focusable' + (target ? '' : ' is-host'),
    onclick: function () { setTarget(null); }
  }, [
    h('div.avatar-initial', '\u2605'),
    h('div.grow', 'Everyone here')
  ]));

  if (!state.viewers.length) {
    refs.people.appendChild(h('div.faint', { style: { fontSize: '0.72rem' } },
      'No one detected. The script reports avatars on the parcel every few seconds.'));
  }

  state.viewers.forEach(function (v) {
    refs.people.appendChild(h('div.viewer-chip.focusable', {
      class: 'viewer-chip focusable' + (target && target.key === v.key ? ' is-host' : ''),
      onclick: function () { setTarget(v); }
    }, [
      h('div.avatar-initial', (v.name || '?').charAt(0).toUpperCase()),
      h('div.grow.ellipsis', v.name || 'Resident'),
      state.host && state.host.key === v.key ? h('span.badge.b-accent', 'Host') : null
    ]));
  });
}
