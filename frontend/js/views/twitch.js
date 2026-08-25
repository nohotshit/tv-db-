/**
 * Twitch.
 *
 * Full site in direct mode, or the official player embed in app mode.
 *
 * The embed requires a `parent` query parameter naming the domain hosting the
 * iframe - that is Twitch policy, not a workaround - so it only works from the
 * deployed Render domain, and is computed from location.hostname rather than
 * hardcoded.
 *
 * Live streams cannot be position-synchronised. Every viewer joins at the live
 * edge and the few seconds of spread between them is inside the player, where
 * nothing outside it can reach. The UI says "Live" instead of drawing a
 * progress bar that would be a lie.
 */

import { makeExternalView } from './external.js';

export function embedUrl(channel) {
  const parent = window.location.hostname || 'localhost';
  return 'https://player.twitch.tv/?channel=' + encodeURIComponent(channel) +
         '&parent=' + encodeURIComponent(parent) + '&muted=false';
}

/** Accept a bare name, a twitch.tv link, or a full url. */
export function channelName(input) {
  const s = String(input || '').trim();
  const m = s.match(/twitch\.tv\/([A-Za-z0-9_]{3,25})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_]{3,25}$/.test(s)) return s;
  return null;
}

export const twitch = makeExternalView({
  id: 'twitch',
  title: 'Twitch',
  icon: '\u{1F4FA}',
  isLive: true,
  subtitle: 'Live channels and categories',
  placeholder: 'Channel name, or search Twitch',
  searchUrl: function (q) {
    return 'https://www.twitch.tv/search?term=' + encodeURIComponent(q);
  },
  shortcuts: [
    { label: 'Home', url: 'https://www.twitch.tv/' },
    { label: 'Browse', url: 'https://www.twitch.tv/directory' },
    { label: 'Music', url: 'https://www.twitch.tv/directory/category/music' },
    { label: 'Following', url: 'https://www.twitch.tv/directory/following' }
  ],
  notes: [
    'Live streams are already close to synchronised because everyone watches the live edge, but the last few seconds of difference between viewers cannot be corrected from outside the player.',
    'The embedded player only loads from the deployed domain, because Twitch requires the parent domain to be declared.',
    'Chat, subscriptions and sign-in belong to Twitch and stay inside each viewer own browser session.'
  ]
});
