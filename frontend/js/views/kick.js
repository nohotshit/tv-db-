/**
 * Kick.
 *
 * Same shape as Twitch: full site in direct mode, official player embed in app
 * mode. Kick serves its player from player.kick.com, and like every live
 * source it cannot be position-synchronised - only pointed at.
 */

import { makeExternalView } from './external.js';

export function embedUrl(channel) {
  return 'https://player.kick.com/' + encodeURIComponent(channel);
}

export function channelName(input) {
  const s = String(input || '').trim();
  const m = s.match(/kick\.com\/([A-Za-z0-9_-]{3,30})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{3,30}$/.test(s)) return s;
  return null;
}

export const kick = makeExternalView({
  id: 'kick',
  title: 'Kick',
  icon: '\u{1F7E2}',
  isLive: true,
  subtitle: 'Live channels',
  placeholder: 'Channel name, or search Kick',
  searchUrl: function (q) {
    return 'https://kick.com/search?searched_word=' + encodeURIComponent(q);
  },
  shortcuts: [
    { label: 'Home', url: 'https://kick.com/' },
    { label: 'Browse', url: 'https://kick.com/browse' },
    { label: 'Categories', url: 'https://kick.com/categories' }
  ],
  notes: [
    'Live only, so there is no playhead to synchronise. Everyone joins at the live edge.',
    'Kick renders heavily in the browser. On a slow connection the embedded viewer browser can take a while to show the first frame.',
    'Nothing is captured, recorded or redistributed by the TV.'
  ]
});
