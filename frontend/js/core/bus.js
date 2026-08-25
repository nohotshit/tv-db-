/**
 * Tiny synchronous event bus.
 *
 * Used for cross-cutting signals that are not application state: user
 * activity (drives the idle timer), remote-control key presses, toast
 * requests, socket lifecycle. Application state itself lives in state.js.
 */

const listeners = Object.create(null);

/** Subscribe. Returns an unsubscribe function. */
export function on(event, fn) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(fn);
  return function off() {
    const arr = listeners[event];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  };
}

/** Subscribe for exactly one delivery. */
export function once(event, fn) {
  const off = on(event, function (payload) {
    off();
    fn(payload);
  });
  return off;
}

/**
 * Publish. A throwing listener must never take down the emitter - a broken
 * view should degrade, not brick the TV.
 */
export function emit(event, payload) {
  const arr = listeners[event];
  if (!arr || !arr.length) return;
  arr.slice().forEach(function (fn) {
    try {
      fn(payload);
    } catch (err) {
      // Late import avoids a cycle: log.js emits nothing.
      if (window.console && console.error) console.error('[bus]', event, err);
    }
  });
}

/** Drop every listener for an event (or all events when omitted). */
export function clearBus(event) {
  if (event) delete listeners[event];
  else Object.keys(listeners).forEach(function (k) { delete listeners[k]; });
}
