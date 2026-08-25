/**
 * Clock.
 *
 * A full-screen clock with the timezone picker beside it. Everything is driven
 * by the shared one-second tick from core/clock.js rather than a timer of its
 * own, and the abbreviation shown is whatever is genuinely in force right now
 * for the selected zone - EST or EDT, not a guess.
 */

import { h, clear } from '../core/dom.js';
import { state } from '../core/state.js';
import { go, back } from '../core/router.js';
import { setScope } from '../components/nav.js';
import {
  ZONES, formatTime, formatDate, formatWeekday, currentAbbrev, isDST, onTick
} from '../core/clock.js';
import { saveSettings } from '../core/userdata.js';

let untick = null;
let refs = null;

export const clockView = {
  id: 'clock',
  title: 'Clock',

  mount: function (container) {
    const big = h('div', {
      style: { fontSize: '5.6rem', fontWeight: '200', lineHeight: '1', fontVariantNumeric: 'tabular-nums' }
    }, '--:--');
    const meta = h('div.muted', { style: { fontSize: '1.1rem', marginTop: '0.4rem' } });
    const zoneInfo = h('div.faint', { style: { fontSize: '0.82rem', marginTop: '0.2rem' } });
    const zoneList = h('div.list');

    const view = h('div.view', [
      h('div.view-head', [
        h('h2.view-title', [ '\u{1F550} ', h('span.accent', 'Clock') ]),
        h('span.grow'),
        h('button.btn.btn-sm.focusable', { onclick: function () { back(); } }, 'Back'),
        h('button.btn.btn-sm.focusable', { onclick: function () { go('home'); } }, 'Home')
      ]),
      h('div.row.grow', { style: { gap: '1.6rem', alignItems: 'stretch', minHeight: 0 } }, [
        h('div.col.grow.center', { style: { justifyContent: 'center' } }, [
          big, meta, zoneInfo,
          h('div.row', { style: { marginTop: '1.4rem' } }, [
            toggleBtn('12 hour', function () { return state.settings.timeFormat === '12'; },
              function () { saveSettings({ timeFormat: '12' }); refreshAll(); }),
            toggleBtn('24 hour', function () { return state.settings.timeFormat === '24'; },
              function () { saveSettings({ timeFormat: '24' }); refreshAll(); }),
            toggleBtn('Seconds', function () { return !!state.settings.showSeconds; },
              function () { saveSettings({ showSeconds: !state.settings.showSeconds }); refreshAll(); })
          ]),
          h('div.row', { style: { marginTop: '0.5rem' } }, ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'].map(function (f) {
            return toggleBtn(f, function () { return state.settings.dateFormat === f; },
              function () { saveSettings({ dateFormat: f }); refreshAll(); });
          }))
        ]),
        h('div.col', { style: { width: '17rem', flex: '0 0 auto', minHeight: 0 } }, [
          h('div.section', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' } }, [
            h('h3', 'Timezone'),
            h('div.grow', { style: { overflowY: 'auto' } }, [ zoneList ])
          ])
        ])
      ])
    ]);

    container.appendChild(view);
    setScope(view);

    refs = { big: big, meta: meta, zoneInfo: zoneInfo, zoneList: zoneList, view: view };
    drawZones();
    untick = onTick(tick);
    tick(new Date());
  },

  unmount: function () {
    if (untick) untick();
    untick = null;
    refs = null;
  }
};

function toggleBtn(label, isOn, onClick) {
  return h('button.btn.focusable', {
    class: 'btn focusable' + (isOn() ? ' btn-primary' : ''),
    onclick: function () { onClick(); }
  }, label);
}

function refreshAll() {
  if (!refs) return;
  // Re-render the toggle states without rebuilding the view.
  const buttons = refs.view.querySelectorAll('.btn.focusable');
  Array.prototype.forEach.call(buttons, function (b) {
    const t = b.textContent;
    let on = false;
    if (t === '12 hour') on = state.settings.timeFormat === '12';
    else if (t === '24 hour') on = state.settings.timeFormat === '24';
    else if (t === 'Seconds') on = !!state.settings.showSeconds;
    else if (t.indexOf('/') > 0 || t.indexOf('-') > 0) on = state.settings.dateFormat === t;
    else return;
    b.classList.toggle('btn-primary', on);
  });
  tick(new Date());
  drawZones();
}

function tick(now) {
  if (!refs) return;
  refs.big.textContent = formatTime(now);
  refs.meta.textContent = formatWeekday(now) + ' \u00B7 ' + formatDate(now);

  const zone = state.settings.timezone;
  const abbrev = currentAbbrev(now, zone);
  refs.zoneInfo.textContent = zone.replace('_', ' ') + ' \u00B7 ' + abbrev +
    (isDST(now, zone) ? ' \u00B7 daylight saving in effect' : '');
}

function drawZones() {
  if (!refs) return;
  clear(refs.zoneList);
  ZONES.forEach(function (z) {
    const selected = state.settings.timezone === z.id;
    refs.zoneList.appendChild(h('div.list-row.focusable', {
      class: 'list-row focusable' + (selected ? ' is-current' : ''),
      onclick: function () {
        saveSettings({ timezone: z.id });
        drawZones();
        tick(new Date());
      }
    }, [
      h('div.lr-main', [
        h('div.lr-title', z.label),
        h('div.lr-sub', z.abbrev + ' \u00B7 ' + currentAbbrev(new Date(), z.id) + ' now')
      ]),
      selected ? h('span.badge.b-accent', 'In use') : null
    ]));
  });
}
