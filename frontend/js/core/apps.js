/**
 * App catalogue.
 *
 * `mode` is the important field, and it encodes a real MOAP constraint:
 *
 *   'app'    - the section renders inside our own page. We keep our UI, we can
 *              embed a player, and we can synchronise position.
 *   'direct' - the section hands the whole TV prim face to an external site.
 *              youtube.com, twitch.tv, kick.com and most of the web send
 *              X-Frame-Options / frame-ancestors headers, so they cannot be
 *              iframed. The only way to show them is to point the MOAP url at
 *              them, which replaces our interface entirely. Control then comes
 *              from the HUD remote, and pressing Home tells LSL to put the
 *              media url back to this app.
 *
 * Sites that DO offer an embeddable player (YouTube IFrame API, Twitch and
 * Kick player embeds) can additionally be shown in 'app' mode inside a frame,
 * which is what makes position sync possible for YouTube.
 */

export const APPS = [
  {
    id: 'movies', icon: '\u{1F3AC}', label: 'Movies', mode: 'direct',
    hint: 'External site', urlKey: 'moviesUrl'
  },
  {
    id: 'youtube', icon: '\u25B6', label: 'YouTube', mode: 'hybrid',
    hint: 'Embed or full site', urlKey: 'youtubeUrl'
  },
  {
    id: 'twitch', icon: '\u{1F4FA}', label: 'Twitch', mode: 'hybrid',
    hint: 'Live channels', urlKey: 'twitchUrl'
  },
  {
    id: 'kick', icon: '\u{1F7E2}', label: 'Kick', mode: 'hybrid',
    hint: 'Live channels', urlKey: 'kickUrl'
  },
  {
    id: 'browser', icon: '\u{1F310}', label: 'Web Browser', mode: 'direct',
    hint: 'Open any address', urlKey: 'browserHome'
  },
  {
    id: 'messages', icon: '\u{1F4AC}', label: 'Messages', mode: 'app',
    hint: 'Nearby avatars'
  },
  {
    id: 'games', icon: '\u{1F3AE}', label: 'Games', mode: 'app',
    hint: '6 games'
  },
  {
    id: 'clock', icon: '\u{1F550}', label: 'Clock', mode: 'app',
    hint: 'Time and timezone'
  },
  {
    id: 'settings', icon: '\u2699', label: 'Settings', mode: 'app',
    hint: 'Configure this TV'
  }
];

export function appById(id) {
  return APPS.filter(function (a) { return a.id === id; })[0] || null;
}
