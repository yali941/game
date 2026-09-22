import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createGameServer } from '../server.js';
import { unluckyDice } from '../tables.js';

test('entertainment dice use the declared weights without removing any face', () => {
  const counts = Array(6).fill(0);
  for (let ticket = 0; ticket < 100; ticket++) counts[unluckyDice(ticket) - 1]++;
  assert.deepEqual(counts, [35, 10, 25, 10, 15, 5]);
  for (const invalid of [-1, 100, 1.5, NaN]) assert.throws(() => unluckyDice(invalid));
});

test('entertainment is opt-in, matches exact server names, covers autoplay and never awards wins', async t => {
  let tickets = 0;
  const { server, tableRooms } = createGameServer({ scoreFile: null, roll: () => 4, luckTicket: () => { tickets++; return 0; }, autoDelay: 30 });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`, controllers = [];
  t.after(async () => { controllers.forEach(c => c.abort()); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  async function post(action, data = {}, token, profile) {
    const response = await fetch(base + (action === 'profile' ? '/api/profile' : '/api/table/' + action), {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(profile ? { 'X-Player-Token': profile } : {}) }, body: JSON.stringify(data)
    });
    return { status: response.status, ...await response.json() };
  }
  async function connect(player) {
    const controller = new AbortController(); controllers.push(controller);
    const response = await fetch(`${base}/api/table/events?room=${player.code}&token=${player.token}`, { signal: controller.signal });
    assert.equal(response.status, 200);
    (async () => { try { for await (const chunk of response.body) { /* Drain SSE. */ } } catch (e) { if (e.name !== 'AbortError') throw e; } })();
  }
  const a = await post('profile', { name: '芽卫兵' }), b = await post('profile', { name: '普通棋友' });
  assert.equal((await post('create', { kind: 'flight', diceMode: 'invalid' }, null, a.token)).status, 400);
  assert.equal((await post('create', { kind: 'jungle', diceMode: 'unlucky' }, null, a.token)).status, 400);
  async function makeRoom(diceMode) {
    const host = await post('create', { kind: 'flight', diceMode }, null, a.token);
    const guest = await post('join', { kind: 'flight', room: host.code }, null, b.token);
    await connect(host); await connect(guest);
    const r = tableRooms.get(host.code);
    const call = (action, data = {}, player = host) => post(action, { room: host.code, version: r.version, ...data }, player.token);
    assert.equal((await call('start')).status, 200);
    return { host, guest, r, call };
  }
  const normal = await makeRoom(undefined);
  const fair = await normal.call('roll');
  assert.equal(fair.game.dice, 4); assert.equal(fair.dicePolicy, null); assert.equal(tickets, 0);
  await normal.call('leave');

  const { host, guest, r, call } = await makeRoom('unlucky');
  const first = await call('roll', { dice: 6, name: '普通棋友', diceMode: 'fair' });
  assert.equal(first.game.dice, 1); assert.equal(first.game.turn, 2);
  assert.deepEqual(first.dicePolicy.seats, [1]); assert.equal(first.dicePolicy.name, '芽卫兵');
  assert.equal(first.game.rollHistory[0].luck, 'unlucky'); assert.equal(tickets, 1);
  assert.equal((await call('roll')).status, 400);
  assert.equal(r.game.rollHistory.length, 1);
  assert.equal((await call('roll', {}, guest)).game.dice, 4);
  await call('move', { id: '2-1' }, guest);
  await call('auto', { enabled: true });
  for (let i = 0; i < 100 && r.game.rolls < 3; i++) await delay(10);
  assert.equal(r.game.rolls, 3); assert.equal(r.game.rollHistory.at(-1).player, 1);
  assert.equal(r.game.rollHistory.at(-1).luck, 'unlucky'); assert.equal(r.game.rollHistory.at(-1).dice, 1);
  await call('auto', { enabled: false });
  await call('roll', {}, guest); await call('move', { id: '2-1' }, guest);
  await post('profile', { name: '芽卫兵朋友' }, null, a.token);
  const renamed = await call('roll');
  assert.equal(renamed.game.dice, 4); assert.deepEqual(renamed.dicePolicy.seats, []);
  assert.equal(renamed.game.rollHistory.at(-1).luck, undefined);
  await call('move', { id: '1-1' });
  // A settled entertainment win must not leak into the standard leaderboard.
  r.game.status = 'finished'; r.game.winner = 1;
  await post('profile', { name: '芽卫兵' }, null, a.token);
  const rankings = await (await fetch(base + '/api/rankings?kind=flight')).json();
  assert.deepEqual(rankings.entries, []);
  await call('rematch'); const rematch = await call('rematch', {}, guest);
  assert.equal(rematch.round, 2); assert.deepEqual(rematch.game.rollHistory, []);
  assert.equal(rematch.dicePolicy.mode, 'unlucky'); assert.deepEqual(rematch.dicePolicy.seats, [1]);
  controllers.at(-1).abort(); await connect(guest);
  const restored = await call('sync', {}, guest);
  assert.deepEqual(restored.dicePolicy, rematch.dicePolicy);
  await call('leave');
});
