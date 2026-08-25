/**
 * Boot and idle screens.
 *
 * Boot: logo, product name, a progress line that reports what is actually
 * happening rather than a fake bar - branding loaded, cloud reached, state
 * received - then hands over to the shell.
 *
 * Idle: after a configurable period with no activity the TV returns to the
 * logo, the clock and a prompt. Any remote key, click or incoming command
 * wakes it. This is also the screen a TV sits on for days, so the logo drifts
 * very slowly rather than sitting burned in one place.
 */

import { $, cls } from '../core/dom.js';
import { state, patch } from '../core/state.js';
import { branding } from '../core/branding.js';
import { formatTime, formatDate, formatWeekday, currentAbbrev, onTick } from '../core/clock.js';
import { on, emit } from '../core/bus.js';

let idleTimer = null;
let untick = null;

/* ---- boot --------------------------------------------------------------- */

export function bootProgress(percent, message) {
  const fill = $('#boot-bar-fill');
  const status = $('#boot-status');
  if (fill) fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
  if (status && message) status.textContent = message;
}

export function finishBoot() {
  const boot = $('#boot');
  const shell = $('#shell');
  if (shell) shell.classList.remove('hidden');
  if (boot) {
    boot.classList.add('is-hidden');
    setTimeout(function () { boot.style.display = 'none'; }, 300);
  }
  patch({ ui: { booted: true } });
  resetIdleTimer();
}

/* ---- idle --------------------------------------------------------------- */

export function initIdle() {
  const prompt = $('#idle-prompt');
  if (prompt && branding.idle && branding.idle.prompt) {
    prompt.textContent = branding.idle.prompt;
  }

  untick = onTick(function (now) {
    if (!state.ui.idle) return;
    const clock = $('#idle-clock');
    const meta = $('#idle-meta');
    if (clock && branding.idle.showClock !== false) clock.textContent = formatTime(now);
    if (meta) {
      const bits = [];
      if (branding.idle.showDate !== false) bits.push(formatWeekday(now) + ', ' + formatDate(now));
      if (branding.idle.showTimezone !== false) bits.push(currentAbbrev(now));
      meta.textContent = bits.join('  \u00B7  ');
    }
  });

  // Any of these count as activity.
  ['mousedown', 'mousemove', 'wheel', 'keydown', 'touchstart'].forEach(function (evt) {
    document.addEventListener(evt, noteActivity, { passive: true });
  });
  on('remote:key', noteActivity);
  on('sync:command', noteActivity);
  on('view:changed', noteActivity);

  resetIdleTimer();
}

export function noteActivity() {
  if (state.ui.idle) wake();
  resetIdleTimer();
}

export function resetIdleTimer() {
  clearTimeout(idleTimer);
  if (!state.settings.idleEnabled) return;
  const seconds = Math.max(15, Number(state.settings.idleTimeoutS) || 300);
  idleTimer = setTimeout(sleep, seconds * 1000);
}

export function sleep() {
  if (state.ui.idle) return;
  // Never idle out over a running programme - a TV that blanks mid-film is
  // a broken TV.
  if (state.media.playback === 'playing') { resetIdleTimer(); return; }

  patch({ ui: { idle: true } });
  cls($('#idle'), 'is-hidden', false);
  emit('idle:enter');
}

export function wake() {
  if (!state.ui.idle) return;
  patch({ ui: { idle: false } });
  cls($('#idle'), 'is-hidden', true);
  emit('idle:exit');
}
