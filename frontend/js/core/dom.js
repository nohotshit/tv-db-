/**
 * Minimal DOM helpers.
 *
 * Deliberately not a framework. The Second Life viewer runs an embedded
 * Chromium (CEF) build whose version we do not control, so the frontend ships
 * as plain ES modules with no build step, no JSX and no polyfills. Syntax is
 * kept to ES2017 - no optional chaining, no nullish coalescing.
 */

/** document.querySelector, scoped. */
export function $(sel, root) {
  return (root || document).querySelector(sel);
}

/** document.querySelectorAll as a real array. */
export function $$(sel, root) {
  return Array.prototype.slice.call((root || document).querySelectorAll(sel));
}

/**
 * Create an element.
 *   h('div.tile.is-locked', { title: 'x' }, ['hello', h('span', 'world')])
 * Attribute keys starting with "on" attach listeners. `text` sets textContent
 * (safe); `html` sets innerHTML and is only ever used with strings we built.
 */
export function h(spec, attrs, children) {
  const parts = String(spec).split(/(?=[.#])/);
  const el = document.createElement(parts.shift() || 'div');

  parts.forEach(function (p) {
    if (p[0] === '.') el.classList.add(p.slice(1));
    else if (p[0] === '#') el.id = p.slice(1);
  });

  // Allow h('div', 'text') and h('div', [children]).
  if (typeof attrs === 'string' || Array.isArray(attrs) || attrs instanceof Node) {
    children = attrs;
    attrs = null;
  }

  if (attrs) {
    Object.keys(attrs).forEach(function (k) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
  }

  append(el, children);
  return el;
}

function append(el, children) {
  if (children === null || children === undefined || children === false) return;
  if (Array.isArray(children)) {
    children.forEach(function (c) { append(el, c); });
  } else if (children instanceof Node) {
    el.appendChild(children);
  } else {
    el.appendChild(document.createTextNode(String(children)));
  }
}

/** Remove every child of an element. */
export function clear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
}

/** Toggle a class and return the element, for chaining. */
export function cls(el, name, on) {
  if (el) el.classList.toggle(name, !!on);
  return el;
}

/** Escape text destined for an `html:` string. */
export function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
