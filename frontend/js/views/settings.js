/**
 * Settings.
 *
 * Everything in requirement 25, plus an About page that carries the branding.
 *
 * WHERE EACH SETTING LIVES
 *   Display, clock, idle and sync preferences are per viewer: they change what
 *   this screen does and are stored locally, then to the account when the
 *   surface has an identity.
 *
 *   Permission mode, detection range and the default urls are properties of
 *   the TV OBJECT, not of a viewer. Those are written to Linkset Data in world
 *   by the script, because they must survive a script reset and be readable
 *   with no cloud at all. Changing them here sends a request to the object; if
 *   the cloud is down, the panel says so and points at the in-world menu.
 */

import { h, clear } from '../core/dom.js';
import { state, patch, canControl } from '../core/state.js';
import { go, back } from '../core/router.js';
import { setScope } from '../components/nav.js';
import { saveSettings } from '../core/userdata.js';
import { ZONES } from '../core/clock.js';
import { config } from '../core/config.js';
import { send, isConnected } from '../core/socket.js';
import { branding } from '../core/branding.js';
import { setLevel } from '../core/log.js';
import { emit } from '../core/bus.js';

let refs = null;
let panel = 'media';

const PANELS = [
  { id: 'media',       label: 'Media' },
  { id: 'sync',        label: 'Synchronisation' },
  { id: 'clock',       label: 'Clock' },
  { id: 'idle',        label: 'Idle' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'messaging',   label: 'Messaging' },
  { id: 'display',     label: 'Display' },
  { id: 'about',       label: 'About' }
];

export const settings = {
  id: 'settings',
  title: 'Settings',

  mount: function (container) {
    const nav = h('div.col', { style: { width: '11rem', flex: '0 0 auto' } });
    const body = h('div.grow', { style: { overflowY: 'auto', paddingRight: '0.5rem' } });

    const view = h('div.view', [
      h('div.view-head', [
        h('h2.view-title', [ '\u2699 ', h('span.accent', 'Settings') ]),
        h('span.grow'),
        h('button.btn.btn-sm.focusable', { onclick: function () { back(); } }, 'Back'),
        h('button.btn.btn-sm.focusable', { onclick: function () { go('home'); } }, 'Home')
      ]),
      h('div.row.grow', { style: { gap: '1.4rem', alignItems: 'stretch', minHeight: 0 } }, [ nav, body ])
    ]);

    container.appendChild(view);
    setScope(view);
    refs = { nav: nav, body: body, view: view };

    drawNav();
    drawPanel();
  },

  unmount: function () { refs = null; }
};

function drawNav() {
  clear(refs.nav);
  PANELS.forEach(function (p) {
    refs.nav.appendChild(h('button.btn.focusable', {
      class: 'btn focusable' + (panel === p.id ? ' btn-primary' : ''),
      style: { justifyContent: 'flex-start' },
      onclick: function () { panel = p.id; drawNav(); drawPanel(); }
    }, p.label));
  });
}

/* ---- reusable setting rows --------------------------------------------- */

function rowToggle(label, hint, get, set) {
  const sw = h('div.switch', { class: 'switch' + (get() ? ' is-on' : '') }, [ h('i') ]);
  return h('div.list-row.focusable', {
    onclick: function () { set(!get()); sw.classList.toggle('is-on', get()); }
  }, [
    h('div.lr-main', [ h('div.lr-title', label), hint ? h('div.lr-sub', hint) : null ]),
    sw
  ]);
}

function rowChoice(label, hint, options, get, set) {
  return h('div.list-row', [
    h('div.lr-main', [ h('div.lr-title', label), hint ? h('div.lr-sub', hint) : null ]),
    h('div.lr-actions', options.map(function (o) {
      return h('button.btn.btn-sm.focusable', {
        class: 'btn btn-sm focusable' + (get() === o.value ? ' btn-primary' : ''),
        onclick: function () { set(o.value); drawPanel(); }
      }, o.label);
    }))
  ]);
}

function rowText(label, hint, get, set, placeholder) {
  const input = h('input.input.mono', {
    type: 'text', value: get() || '', placeholder: placeholder || '', style: { width: '18rem' }
  });
  input.addEventListener('change', function () { set(input.value.trim()); });
  return h('div.list-row', [
    h('div.lr-main', [ h('div.lr-title', label), hint ? h('div.lr-sub', hint) : null ]),
    input
  ]);
}

function rowSlider(label, hint, min, max, step, get, set, format) {
  const out = h('span.badge', format ? format(get()) : String(get()));
  const input = h('input.slider', {
    type: 'range', min: String(min), max: String(max), step: String(step),
    value: String(get()), style: { width: '10rem' }
  });
  input.addEventListener('input', function () {
    const v = Number(input.value);
    set(v);
    out.textContent = format ? format(v) : String(v);
  });
  return h('div.list-row', [
    h('div.lr-main', [ h('div.lr-title', label), hint ? h('div.lr-sub', hint) : null ]),
    input, out
  ]);
}

/** Setting that belongs to the in-world object rather than to this viewer. */
function objectSetting(children) {
  const allowed = canControl();
  const wrap = h('div.col', children);
  if (!allowed) {
    wrap.style.opacity = '0.5';
    wrap.style.pointerEvents = 'none';
  }
  return h('div.col', [
    wrap,
    !allowed ? h('div.why', 'Only whoever controls this TV can change these.') : null,
    !isConnected() ? h('div.why', 'The cloud is unreachable, so changes cannot be sent to the in-world script right now. The TV owner can also set these from the object menu.') : null
  ]);
}

function sendObjectSetting(key, value) {
  if (!isConnected()) return;
  send('config', { tvId: state.tv.id, key: key, value: value });
  emit('notice', { level: 'ok', title: 'Saved to the TV', message: key + ' updated in world.' });
}

/* ---- panels ------------------------------------------------------------- */

function drawPanel() {
  if (!refs) return;
  clear(refs.body);
  const s = state.settings;
  const set = function (key) {
    return function (v) { const d = {}; d[key] = v; saveSettings(d); };
  };

  if (panel === 'media') {
    refs.body.appendChild(h('div.section', [
      h('h3', 'Media'),
      h('div.list', [
        rowChoice('Default source', 'Where the TV opens after boot',
          [{ label: 'Home', value: 'home' }, { label: 'Music', value: 'music' },
           { label: 'YouTube', value: 'youtube' }, { label: 'Last used', value: 'last' }],
          function () { return s.defaultSource; }, set('defaultSource')),
        rowToggle('Autoplay', 'Start playing as soon as media is selected',
          function () { return s.autoplay; }, set('autoplay')),
        rowToggle('Resume', 'Return to what was playing when the TV powers on',
          function () { return s.resume; }, set('resume'))
      ]),
      h('h3', { style: { marginTop: '1.2rem' } }, 'Addresses'),
      objectSetting([
        h('div.list', [
          rowText('Movies address', 'The destination behind the Movies tile',
            function () { return s.moviesUrl || config.defaults.moviesUrl; },
            function (v) { saveSettings({ moviesUrl: v }); sendObjectSetting('movies_url', v); },
            'https://example.com/'),
          rowText('Browser home page', 'Where the Home button goes in the Browser section',
            function () { return s.browserHome || config.defaults.browserHome; },
            function (v) { saveSettings({ browserHome: v }); sendObjectSetting('home_url', v); },
            'https://duckduckgo.com/')
        ])
      ])
    ]));
  }

  if (panel === 'sync') {
    refs.body.appendChild(h('div.section', [
      h('h3', 'Synchronisation'),
      h('div.list', [
        rowToggle('Enable sync', 'Follow the playback state shared by the cloud',
          function () { return s.syncEnabled; }, set('syncEnabled')),
        rowSlider('Sync tolerance', 'Drift smaller than this is left alone, because correcting it is more noticeable than the error',
          0.1, 3, 0.1, function () { return s.syncToleranceS; }, set('syncToleranceS'),
          function (v) { return v.toFixed(1) + ' s'; })
      ]),
      h('div.list', { style: { marginTop: '0.8rem' } }, [
        h('div.list-row', [
          h('div.lr-main', [
            h('div.lr-title', 'Current drift'),
            h('div.lr-sub', 'How far this screen is from the shared position')
          ]),
          h('span.badge', (state.sync.driftS >= 0 ? '+' : '') + state.sync.driftS.toFixed(2) + ' s')
        ]),
        h('div.list-row', [
          h('div.lr-main', [
            h('div.lr-title', 'Corrections applied'),
            h('div.lr-sub', 'Rate nudges and seeks since this page loaded')
          ]),
          h('span.badge', String(state.sync.corrections))
        ])
      ]),
      h('div.why', { style: { display: 'block', marginTop: '0.8rem' } },
        'Position synchronisation only applies to media the TV plays itself, such as music streams and embedded YouTube videos. A site opened full screen on the prim runs its own player, which nothing outside it can read or seek.')
    ]));
  }

  if (panel === 'clock') {
    const s2 = state.settings;
    refs.body.appendChild(h('div.section', [
      h('h3', 'Clock'),
      h('div.list', [
        rowChoice('Time format', 'Twelve or twenty four hour',
          [{ label: '12 hour', value: '12' }, { label: '24 hour', value: '24' }],
          function () { return s2.timeFormat; }, set('timeFormat')),
        rowToggle('Show seconds', 'Adds a seconds field to the clock',
          function () { return s2.showSeconds; }, set('showSeconds')),
        rowChoice('Date format', 'How dates are written throughout the TV',
          [{ label: 'MM/DD/YYYY', value: 'MM/DD/YYYY' },
           { label: 'DD/MM/YYYY', value: 'DD/MM/YYYY' },
           { label: 'YYYY-MM-DD', value: 'YYYY-MM-DD' }],
          function () { return s2.dateFormat; }, set('dateFormat'))
      ]),
      h('h3', { style: { marginTop: '1.2rem' } }, 'Timezone'),
      h('div.list', ZONES.map(function (z) {
        return h('div.list-row.focusable', {
          class: 'list-row focusable' + (s2.timezone === z.id ? ' is-current' : ''),
          onclick: function () { saveSettings({ timezone: z.id }); drawPanel(); }
        }, [
          h('div.lr-main', [ h('div.lr-title', z.label), h('div.lr-sub', z.abbrev) ]),
          s2.timezone === z.id ? h('span.badge.b-accent', 'In use') : null
        ]);
      })),
      h('div.why', { style: { display: 'block', marginTop: '0.6rem' } },
        'Zones are handled by name, so daylight saving changes on their own at the right moment. Arizona and Hawaii never shift, which is why they are listed separately.')
    ]));
  }

  if (panel === 'idle') {
    refs.body.appendChild(h('div.section', [
      h('h3', 'Idle screen'),
      h('div.list', [
        rowToggle('Enable idle screen', 'Return to the logo screen after a period of no activity',
          function () { return s.idleEnabled; }, set('idleEnabled')),
        rowSlider('Idle timeout', 'How long the TV waits before going idle',
          30, 1800, 30, function () { return s.idleTimeoutS; },
          function (v) { saveSettings({ idleTimeoutS: v }); sendObjectSetting('idle_timeout', v); },
          function (v) { return v >= 60 ? Math.round(v / 60) + ' min' : v + ' s'; })
      ]),
      h('h3', { style: { marginTop: '1.2rem' } }, 'Logo'),
      h('div.list-row', [
        h('div.lr-main', [
          h('div.lr-title', 'Current logo'),
          h('div.lr-sub', config.logoUrl || branding.logo.primary)
        ]),
        h('img.brand-logo-img', { style: { height: '2.6rem' }, src: config.logoUrl || branding.logo.primary, alt: '' })
      ]),
      h('div.why', { style: { display: 'block', marginTop: '0.6rem' } },
        'Replace assets/branding/logo.png in the repository, set a LOGO_URL environment variable on Render, or pass a logo address from the in-world script. All three work without rebuilding anything.')
    ]));
  }

  if (panel === 'permissions') {
    refs.body.appendChild(h('div.section', [
      h('h3', 'Who can control this TV'),
      objectSetting([
        h('div.list', [
          modeRow('owner', 'Owner only', 'Only the object owner can change anything.'),
          modeRow('group', 'Group', 'Anyone wearing the same group tag as the object.'),
          modeRow('everyone', 'Everyone', 'Anyone standing at the TV can control it.'),
          modeRow('host', 'Host', 'The owner appoints one person at a time.')
        ])
      ]),
      state.host
        ? h('div.list-row', { style: { marginTop: '0.8rem' } }, [
            h('div.lr-main', [
              h('div.lr-title', 'Current host'),
              h('div.lr-sub', state.host.name)
            ]),
            canControl()
              ? h('button.btn.btn-sm.btn-danger.focusable', {
                  onclick: function () { sendObjectSetting('host_clear', '1'); }
                }, 'Release host')
              : null
          ])
        : null,
      h('div.why', { style: { display: 'block', marginTop: '0.8rem' } },
        'Group membership is checked in world by the script, which is the only place that information exists. The backend records the answer the object gives it and re-checks every command against it, so a page cannot grant itself control.')
    ]));
  }

  if (panel === 'messaging') {
    refs.body.appendChild(h('div.section', [
      h('h3', 'Messaging'),
      h('div.list', [
        rowToggle('Enable messaging', 'Allow the Messages section to send and receive',
          function () { return s.messagingEnabled; },
          function (v) { saveSettings({ messagingEnabled: v }); sendObjectSetting('messaging', v ? '1' : '0'); }),
        rowToggle('Notifications', 'Show a toast when a message or event arrives',
          function () { return s.notifications; }, set('notifications')),
        rowSlider('Detection range', 'How far from the TV an avatar is counted as present',
          5, 96, 1, function () { return s.detectionRangeM; },
          function (v) { saveSettings({ detectionRangeM: v }); sendObjectSetting('detect_range', v); },
          function (v) { return v + ' m'; })
      ]),
      h('div.why', { style: { display: 'block', marginTop: '0.8rem' } },
        'Detection uses the region avatar list on a slow timer rather than a repeating sensor sweep, which is far cheaper for the sim. Ninety six metres is the practical ceiling for that kind of detection.'),
      h('div.why', { style: { display: 'block' } },
        'This system has no access to private instant messages, group chat, friend lists or accounts, and does not attempt any.')
    ]));
  }

  if (panel === 'display') {
    refs.body.appendChild(h('div.section', [
      h('h3', 'Display'),
      h('div.list', [
        rowSlider('UI scale', 'Makes everything larger or smaller on the screen',
          0.8, 1.4, 0.05, function () { return s.uiScale; }, set('uiScale'),
          function (v) { return Math.round(v * 100) + '%'; }),
        rowSlider('Brightness', 'Dims the whole interface, useful in a dark build',
          0.5, 1.2, 0.05, function () { return s.brightness; }, set('brightness'),
          function (v) { return Math.round(v * 100) + '%'; }),
        rowChoice('Theme', 'Accent colour used throughout',
          [{ label: 'Brand', value: 'brand' }, { label: 'Midnight', value: 'midnight' },
           { label: 'Mono', value: 'mono' }, { label: 'Ember', value: 'ember' }],
          function () { return s.theme; }, set('theme')),
        rowToggle('Debug mode', 'Shows the developer overlay. Off by default.',
          function () { return s.debug; },
          function (v) {
            saveSettings({ debug: v });
            setLevel(v ? 'debug' : 'info');
            emit('debug:toggle', v);
          })
      ]),
      h('div.why', { style: { display: 'block', marginTop: '0.8rem' } },
        'The prim media face is at most 1024 by 1024 pixels, so very large UI scales will crop rather than reflow. Around 100 to 115 percent reads well on a normal sized TV prim.')
    ]));
  }

  if (panel === 'about') {
    refs.body.appendChild(h('div.section', [
      h('div.col.center', { style: { padding: '1.4rem 0', gap: '0.8rem' } }, [
        h('img.brand-logo-img', { style: { width: '18rem', maxWidth: '70%' }, alt: '' }),
        h('div', { style: { fontSize: '1.2rem', letterSpacing: '0.3em' } }, branding.productName),
        h('div.faint', branding.tagline || '')
      ]),
      h('div.list', [
        aboutRow('TV name', state.tv.name || 'Unnamed'),
        aboutRow('TV identifier', state.tv.id || 'not paired'),
        aboutRow('Permission mode', state.tv.permissionMode),
        aboutRow('Backend', config.backendUrl || 'not configured'),
        aboutRow('Cloud status', state.cloud.status),
        aboutRow('Build', config.buildTime + (config.commit ? ' \u00B7 ' + config.commit : '')),
        aboutRow('Viewers connected', String(state.viewers.length))
      ])
    ]));
    // Late binding: the logo helper fills in every .brand-logo-img on the page.
    import('../core/branding.js').then(function (m) { m.applyLogo(); });
  }
}

function modeRow(value, label, hint) {
  return h('div.list-row.focusable', {
    class: 'list-row focusable' + (state.tv.permissionMode === value ? ' is-current' : ''),
    onclick: function () {
      patch({ tv: { permissionMode: value } });
      sendObjectSetting('permission_mode', value);
      drawPanel();
    }
  }, [
    h('div.lr-main', [ h('div.lr-title', label), h('div.lr-sub', hint) ]),
    state.tv.permissionMode === value ? h('span.badge.b-accent', 'Active') : null
  ]);
}

function aboutRow(label, value) {
  return h('div.list-row', [
    h('div.lr-main', [ h('div.lr-title', label) ]),
    h('span.mono.faint', { style: { fontSize: '0.74rem' } }, value)
  ]);
}
