/**
 * YouTube.
 *
 * Two ways in, and they behave differently on purpose:
 *
 *   Full site (direct mode)  - the prim media url goes to youtube.com. Search,
 *     browse, playlists, everything the real site does. Our interface is gone
 *     while it is up and we cannot read what is playing, so no position sync.
 *
 *   Embed (app mode)         - a single video inside our page via the YouTube
 *     IFrame API. Only works for videos the uploader allows to be embedded,
 *     but because the player is ours we can read currentTime and seek, which
 *     is what makes half-second synchronisation possible.
 *
 * Nothing here downloads or stores video. The IFrame API is the same publicly
 * documented embed every website uses.
 */

import { makeExternalView } from './external.js';

/** Pull a video id out of the many url shapes YouTube accepts. */
export function videoId(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}

export const youtube = makeExternalView({
  id: 'youtube',
  title: 'YouTube',
  icon: '\u25B6',
  subtitle: 'Full site on screen, or a synchronised embed',
  placeholder: 'Search YouTube, or paste a video link',
  searchUrl: function (q) {
    return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
  },
  shortcuts: [
    { label: 'Home', url: 'https://www.youtube.com/' },
    { label: 'Trending', url: 'https://www.youtube.com/feed/trending' },
    { label: 'Music', url: 'https://music.youtube.com/' },
    { label: 'Gaming', url: 'https://www.youtube.com/gaming' },
    { label: 'Live', url: 'https://www.youtube.com/live' }
  ],
  notes: [
    'Opening the full site replaces the TV interface on the prim face. Come back with TV Home on the HUD remote.',
    'Paste a video link and choose Watch together to use the embedded player instead, which every viewer stays position-synchronised inside.',
    'Some videos have embedding disabled by the uploader. Those can only be opened as the full site.',
    'Sign-in state lives in each viewer embedded browser, not in the TV.'
  ]
});
