'use strict';
/**
 * End to end test of the paths that matter most: the Second Life bridge, host
 * permission, playback synchronisation fan-out, and the hidden-information
 * guarantee in the games layer.
 *
 * Run with:  npm test
 * No database required - the backend is designed to work without one.
 */

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const WebSocket = require('ws');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-000000000000';
process.env.LSL_SHARED_SECRET = process.env.LSL_SHARED_SECRET || 'test-lsl-secret-0000000000000000';
process.env.PORT = process.env.PORT || '4123';
process.env.LOG_LEVEL = 'error';

const server = require('../src/server');
const BASE = 'http://127.0.0.1:' + process.env.PORT;
const WS_BASE = 'ws://127.0.0.1:' + process.env.PORT + '/rt';

const TV_ID = '00000000-1111-2222-3333-444444444444';
const OWNER = 'aaaaaaaa-1111-2222-3333-444444444444';
const GUEST = 'bbbbbbbb-1111-2222-3333-444444444444';

let deviceSecret = process.env.LSL_SHARED_SECRET;

/** Sign and send a request the way the LSL scripts do. */
async function slPost(path, body, secretOverride) {
  const raw = JSON.stringify(body);
  const ts = Date.now();
  const sig = crypto.createHmac('sha256', secretOverride || deviceSecret)
    .update(ts + '\n' + raw).digest('hex');

  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MI-Timestamp': String(ts),
      'X-MI-Signature': sig,
      'X-SecondLife-Object-Key': TV_ID,
      'X-SecondLife-Owner-Key': OWNER,
      'X-SecondLife-Owner-Name': 'Owner Resident',
      'X-SecondLife-Region': 'Testing Sim (256, 256)'
    },
    body: raw
  });
  return { status: res.status, body: await res.json().catch(function () { return null; }) };
}

function connect(query) {
  return new Promise(function (resolve, reject) {
    const ws = new WebSocket(WS_BASE + '?' + new URLSearchParams(query).toString());
    ws.frames = [];
    ws.on('message', function (data) { ws.frames.push(JSON.parse(data.toString())); });
    ws.on('open', function () { resolve(ws); });
    ws.on('error', reject);
  });
}

/**
 * Wait for a frame of a given type.
 *
 * `opts.fresh` ignores frames that already arrived, which matters whenever a
 * test triggers a second broadcast of a type it has already seen - otherwise
 * the stale one is returned and the assertion tests nothing.
 */
function waitFor(ws, type, timeoutMs, opts) {
  return new Promise(function (resolve, reject) {
    const fresh = !!(opts && opts.fresh);
    const found = fresh ? null : ws.frames.filter(function (f) { return f.type === type; })[0];
    if (found) return resolve(found);
    const timer = setTimeout(function () {
      reject(new Error('timed out waiting for "' + type + '"'));
    }, timeoutMs || 3000);
    ws.on('message', function handler(data) {
      const frame = JSON.parse(data.toString());
      if (frame.type === type) { clearTimeout(timer); ws.off('message', handler); resolve(frame); }
    });
  });
}

test('an unsigned request from a supposed object is rejected', async function () {
  const res = await fetch(BASE + '/api/lsl/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-SecondLife-Object-Key': TV_ID },
    body: JSON.stringify({ name: 'Impostor TV' })
  });
  assert.strictEqual(res.status, 401);
});

test('a signed register call pairs the TV and returns a device secret', async function () {
  const res = await slPost('/api/lsl/register', {
    name: 'Musical Impact TV',
    url: 'https://sim.example.invalid/cap/none',
    mode: 'owner'
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.ok, 1);
  assert.ok(res.body.sec && res.body.sec.length >= 32, 'device secret issued');
  assert.ok(res.body.st, 'state included');
  deviceSecret = res.body.sec;
});

test('a replayed old signature is rejected', async function () {
  const raw = JSON.stringify({ name: 'Stale' });
  const ts = Date.now() - 10 * 60 * 1000;
  const sig = crypto.createHmac('sha256', deviceSecret).update(ts + '\n' + raw).digest('hex');
  const res = await fetch(BASE + '/api/lsl/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MI-Timestamp': String(ts),
      'X-MI-Signature': sig,
      'X-SecondLife-Object-Key': TV_ID
    },
    body: raw
  });
  assert.strictEqual(res.status, 401);
});

test('pairing a HUD issues a token for that avatar', async function () {
  const res = await slPost('/api/lsl/pair', { k: OWNER, n: 'Owner Resident', g: 1 });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.t, 'token returned');
  global.__ownerToken = res.body.t;

  const guest = await slPost('/api/lsl/pair', { k: GUEST, n: 'Guest Resident', g: 0 });
  global.__guestToken = guest.body.t;
});

test('the owner can play, and every connected screen is told', async function () {
  const screen = await connect({ tv: TV_ID, surface: 'tv' });
  const hud = await connect({ tv: TV_ID, surface: 'hud', t: global.__ownerToken });

  await waitFor(screen, 'snapshot');
  await waitFor(hud, 'snapshot');

  hud.send(JSON.stringify({
    type: 'sync',
    payload: {
      action: 'select',
      media: { title: 'Test Stream', url: 'https://example.com/stream', source: 'music', isLive: true }
    }
  }));

  const fanout = await waitFor(screen, 'sync');
  assert.strictEqual(fanout.payload.media.title, 'Test Stream');
  assert.ok(fanout.payload.media.updatedAtServer > 0, 'server stamped the command');
  assert.ok(fanout.payload.serverTime > 0, 'snapshot carries server time');

  screen.close(); hud.close();
});

test('a viewer cannot control a TV set to owner only', async function () {
  const guest = await connect({ tv: TV_ID, surface: 'hud', t: global.__guestToken });
  await waitFor(guest, 'snapshot');

  guest.send(JSON.stringify({ type: 'sync', payload: { action: 'stop' } }));

  const err = await waitFor(guest, 'error');
  assert.match(err.payload.error, /control/i);
  guest.close();
});

test('an anonymous TV screen cannot control an owner-only TV either', async function () {
  const screen = await connect({ tv: TV_ID, surface: 'tv' });
  await waitFor(screen, 'snapshot');

  screen.send(JSON.stringify({ type: 'sync', payload: { action: 'play' } }));

  const err = await waitFor(screen, 'error');
  assert.match(err.payload.error, /control/i);
  screen.close();
});

test('opening the TV to everyone lets an anonymous screen control it', async function () {
  const owner = await connect({ tv: TV_ID, surface: 'hud', t: global.__ownerToken });
  await waitFor(owner, 'snapshot');
  owner.send(JSON.stringify({ type: 'config', payload: { key: 'permission_mode', value: 'everyone' } }));
  // Must be a FRESH snapshot: the one buffered at connect time would return
  // immediately and we would race ahead of the config being applied.
  const applied = await waitFor(owner, 'snapshot', 3000, { fresh: true });
  assert.strictEqual(applied.payload.tv.permissionMode, 'everyone');

  const screen = await connect({ tv: TV_ID, surface: 'tv' });
  await waitFor(screen, 'snapshot');
  screen.send(JSON.stringify({ type: 'sync', payload: { action: 'play' } }));

  const fanout = await waitFor(screen, 'sync');
  assert.strictEqual(fanout.payload.media.playback, 'playing');

  owner.close(); screen.close();
});

test('a private address cannot be pushed onto the prim', async function () {
  const owner = await connect({ tv: TV_ID, surface: 'hud', t: global.__ownerToken });
  await waitFor(owner, 'snapshot');

  owner.send(JSON.stringify({ type: 'moap', payload: { url: 'http://192.168.1.1/admin' } }));
  const err = await waitFor(owner, 'error');
  assert.match(err.payload.error, /cannot be opened/i);

  owner.send(JSON.stringify({ type: 'moap', payload: { url: 'file:///etc/passwd' } }));
  const err2 = await waitFor(owner, 'error');
  assert.ok(err2);
  owner.close();
});

test('the number guessing answer never leaves the server', async function () {
  const owner = await connect({ tv: TV_ID, surface: 'hud', t: global.__ownerToken });
  await waitFor(owner, 'snapshot');

  owner.send(JSON.stringify({ type: 'game', payload: { action: 'start', game: 'numberguess' } }));
  const started = await waitFor(owner, 'game');

  const wire = JSON.stringify(started.payload);
  assert.ok(!/_secret/.test(wire), 'secret key stripped from the broadcast');
  assert.strictEqual(started.payload.session.state.answer, null, 'answer withheld until found');
  owner.close();
});

test('an unrevealed rock paper scissors pick is hidden from the opponent', async function () {
  const owner = await connect({ tv: TV_ID, surface: 'hud', t: global.__ownerToken });
  const guest = await connect({ tv: TV_ID, surface: 'hud', t: global.__guestToken });
  await waitFor(owner, 'snapshot');
  await waitFor(guest, 'snapshot');

  owner.send(JSON.stringify({ type: 'game', payload: { action: 'start', game: 'rps' } }));
  await waitFor(guest, 'game');

  owner.send(JSON.stringify({ type: 'game', payload: { action: 'move', move: { pick: 'rock' } } }));
  const update = await waitFor(guest, 'game', 3000, { fresh: true });

  const picks = update.payload.session.state.picks;
  assert.strictEqual(picks[0], 'hidden', 'the pick is masked before the reveal');
  owner.close(); guest.close();
});

test('the object can poll for commands it missed', async function () {
  const res = await slPost('/api/lsl/poll', {});
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.q), 'queued commands returned as an array');
  assert.ok(res.body.st, 'compact state included');
  assert.ok(JSON.stringify(res.body).length < 2048, 'response fits the LSL body limit');
});

test('presence from the object populates the viewer list', async function () {
  const res = await slPost('/api/lsl/presence', {
    a: [OWNER + '|Owner Resident|1', GUEST + '|Guest Resident|0']
  });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.n >= 2, 'both avatars counted');
});

test.after(function () {
  // Terminate any socket still open, then close the listener. Without this a
  // half-open WebSocket would hold the test process up.
  const wsServer = server.__wss;
  if (wsServer) wsServer.clients.forEach(function (c) { c.terminate(); });
  server.close();
});
