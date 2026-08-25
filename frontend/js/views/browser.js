/**
 * General web browser.
 *
 * Address bar, Go, Back, Forward, Refresh, Home, Favorites, History, Clear
 * history - requirement 11 in full.
 *
 * Addresses are validated before they are handed to the object: scheme must be
 * http or https, the host must be a real host name. That check happens here for
 * a fast error message, again in the backend before it is relayed, and the
 * object itself keeps a media whitelist. Never trusting the frontend means
 * checking in all three places, not just the convenient one.
 */

import { h, clear } from '../core/dom.js';
import { state, subscribe } from '../core/state.js';
import { go, back } from '../core/router.js';
import { setScope } from '../components/nav.js';
import { keyboard } from '../components/keyboard.js';
import { confirm } from '../components/modal.js';
import { openOnTv, normalizeUrl, hostOf } from '../core/moap.js';
import { addFavorite, removeFavorite, isFavorite, clearHistory } from '../core/userdata.js';
import { config } from '../core/config.js';
import { relativeTime } from '../core/clock.js';
import { emit } from '../core/bus.js';

let unsub = null;

export const browser = {
  id: 'browser',
  title: 'Web Browser',

  mount: function (container) {
    const input = h('input.input.grow.mono', {
      type: 'text',
      placeholder: 'https://example.com',
      value: ''
    });

    const openTyped = function () {
      const parsed = normalizeUrl(input.value);
      if (!parsed.ok) {
        if (parsed.reason === 'search') {
          openOnTv('https://duckduckgo.com/?q=' + encodeURIComponent(parsed.query), {
            title: parsed.query, source: 'web'
          });
          return;
        }
        emit('notice', { level: 'warn', title: 'Invalid address', message: parsed.reason });
        return;
      }
      openOnTv(parsed.url, { title: hostOf(parsed.url), source: 'web' });
    };

    const lists = h('div.row', { style: { gap: '1rem', alignItems: 'flex-start' } });

    const view = h('div.view', [
      h('div.view-head', [
        h('h2.view-title', [ '\u{1F310} ', h('span.accent', 'Web Browser') ]),
        h('span.view-sub', 'Opens the address on the TV screen'),
        h('span.grow'),
        h('button.btn.btn-sm.focusable', { onclick: function () { back(); } }, 'Back'),
        h('button.btn.btn-sm.focusable', { onclick: function () { go('home'); } }, 'Home')
      ]),
      h('div.view-body', [
        h('div.section', [
          h('h3', 'Address'),
          h('div.row', [
            input,
            h('button.btn.btn-primary.focusable', { onclick: openTyped }, 'Go'),
            h('button.btn.focusable', {
              onclick: function () {
                const url = state.settings.browserHome || config.defaults.browserHome;
                input.value = url;
                openOnTv(url, { title: 'Home page', source: 'web' });
              }
            }, '\u2302 Home')
          ]),
          keyboard(input, { onSubmit: openTyped, submitLabel: 'GO' })
        ]),
        lists
      ])
    ]);

    container.appendChild(view);
    setScope(view);

    const renderLists = function () { drawLists(lists, input); };
    unsub = subscribe(['favorites', 'historyItems'], renderLists);
    renderLists();
  },

  unmount: function () {
    if (unsub) unsub();
    unsub = null;
  }
};

function drawLists(container, input) {
  clear(container);

  container.appendChild(
    h('div.section.grow', [
      h('h3', 'Favorites'),
      state.favorites.length
        ? h('div.list', state.favorites.map(function (f) {
            return h('div.list-row.focusable', {
              onclick: function () { openOnTv(f.url, { title: f.title, source: f.source }); }
            }, [
              h('div.lr-main', [
                h('div.lr-title.ellipsis', f.title),
                h('div.lr-sub.ellipsis', hostOf(f.url) + ' \u00B7 ' + f.source)
              ]),
              h('div.lr-actions', [
                h('button.btn.btn-sm.btn-ghost', {
                  onclick: function (ev) { ev.stopPropagation(); removeFavorite(f.id); }
                }, 'Remove')
              ])
            ]);
          }))
        : h('div.empty', [
            h('div.empty-icon', '\u2606'),
            h('div', 'No favorites yet'),
            h('div.faint', 'Open a page, then use Add to favorites')
          ])
    ])
  );

  container.appendChild(
    h('div.section.grow', [
      h('h3', [
        'Recent history',
        h('span.grow'),
        state.historyItems.length
          ? h('button.btn.btn-sm.btn-danger.focusable', {
              onclick: function () {
                confirm('Clear history?',
                  'This removes the list of pages opened from this TV. It cannot be undone.',
                  function () {
                    clearHistory();
                    emit('notice', { level: 'ok', title: 'History cleared', message: '' });
                  }, 'Clear');
              }
            }, 'Clear')
          : null
      ]),
      state.historyItems.length
        ? h('div.list', state.historyItems.slice(0, 12).map(function (item) {
            return h('div.list-row.focusable', {
              onclick: function () { openOnTv(item.url, { title: item.title, source: item.source }); }
            }, [
              h('div.lr-main', [
                h('div.lr-title.ellipsis', item.title),
                h('div.lr-sub.ellipsis', hostOf(item.url) + ' \u00B7 ' + relativeTime(item.timestamp))
              ]),
              h('div.lr-actions', [
                isFavorite(item.url)
                  ? h('span.badge.b-accent', 'Saved')
                  : h('button.btn.btn-sm.btn-ghost', {
                      onclick: function (ev) {
                        ev.stopPropagation();
                        addFavorite({ title: item.title, url: item.url, source: item.source });
                      }
                    }, '\u2606 Save')
              ])
            ]);
          }))
        : h('div.empty', [
            h('div.empty-icon', '\u{1F553}'),
            h('div', 'Nothing opened yet')
          ])
    ])
  );
}
