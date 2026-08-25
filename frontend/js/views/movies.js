/**
 * Movies.
 *
 * A configurable external browser destination and nothing more. The TV points
 * the prim media url at the site and the site is responsible for its own
 * playback. No downloading, no stream capture, no DRM handling of any kind
 * happens anywhere in this project.
 *
 * The destination is `settings.moviesUrl`, editable in Settings and overridable
 * from LSL with `?movies=` in the MOAP url, so the owner can point this tile
 * wherever they want without a redeploy.
 */

import { makeExternalView } from './external.js';
import { state } from '../core/state.js';
import { config } from '../core/config.js';

function moviesUrl() {
  return state.settings.moviesUrl || config.defaults.moviesUrl;
}

export const movies = makeExternalView({
  id: 'movies',
  title: 'Movies',
  icon: '\u{1F3AC}',
  subtitle: 'Opens on the TV screen as a full site',
  placeholder: 'Enter a movie site address',
  get shortcuts() {
    return [
      { label: 'Open movie site', icon: '\u{1F3AC}', url: moviesUrl() }
    ];
  },
  shortcutsLabel: 'Destination',
  notes: [
    'This section is a browser destination. The site handles its own playback, so the TV cannot show a position bar or synchronise a playhead for it.',
    'Everyone in range sees the same page because the script sets the same media url on the prim for all of them. What each viewer sees after that depends on their own viewer settings and login state.',
    'Change the destination in Settings, Media, Movies address.'
  ]
});
