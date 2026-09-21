import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createGameServer } from '../server.js';

test('real two-client online game, authentication, sync, reconnect and rematch', async t => {
  const { server } = createGameServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const controllers = [];
  t.after(async () => { controllers.forEach(c => c.abort()); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  async function api(action, data = {}, token, headers = {}) {
    const response = await fetch(`${base}/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(data), signal: AbortSignal.timeout(5000) });
    return { status: response.status, ...await response.json() };
  }
  async function events(code, token) {
    const controller = new AbortController(); controllers.push(controller);
    const response = await fetch(`${base}/api/events?room=${code}&token=${token}`, { signal: controller.signal });
    assert.equal(response.status, 200);
    const states = [], waiters = [];
    (async () => {
      let buffer = ''; const decoder = new TextDecoder();
      try {
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let split;
          while ((split = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, split); buffer = buffer.slice(split + 2);
            if (frame.startsWith('data: ')) { states.push(JSON.parse(frame.slice(6))); for (const fn of waiters) fn(); }
          }
        }
      } catch (error) { if (error.name !== 'AbortError') throw error; }
    })();
    return { controller, states, waitFor: predicate => new Promise((resolve, reject) => {
      const check = () => { const match = states.findLast(predicate); if (match) { clearTimeout(timer); resolve(match); } };
      const timer = setTimeout(() => reject(new Error('Timed out waiting for server event')), 4000);
      waiters.push(check); check();
    }) };
  }
  const page = await fetch(base); assert.equal(page.status, 200); assert.match(await page.text(), /落一子/);
  assert.equal((await fetch(`${base}/server.js`)).status, 404);
  assert.equal((await api('create', {}, null, { Origin: 'https://evil.example' })).status, 403);
  const host = await api('create'); assert.match(host.code, /^[A-Z2-9]{6}$/); assert.equal(host.yourColor, 1);
  assert.equal((await api('move', { room: host.code, x: 7, y: 7 }, host.token)).status, 400);
  const guest = await api('join', { room: host.code.toLowerCase() }); assert.equal(guest.yourColor, 2);
  assert.equal((await api('join', { room: host.code })).status, 400);
  assert.equal((await api('move', { room: host.code, x: 7, y: 7 }, 'fake-token')).status, 401);
  const a = await events(host.code, host.token), b = await events(host.code, guest.token);
  await a.waitFor(s => s.players.every(p => p?.connected));
  assert.equal((await api('move', { room: host.code, x: 7, y: 7 }, guest.token)).status, 400);
  const move = (token, x, y) => api('move', { room: host.code, x, y }, token);
  assert.equal((await move(host.token, 0, 0)).status, 200);
  const first = await b.waitFor(s => s.game.moves.length === 1); assert.equal(first.game.board[0], 1); assert.equal(first.yourColor, 2);
  assert.equal((await move(guest.token, 0, 0)).status, 400);
  assert.equal((await move(guest.token, 15, 1)).status, 400);
  b.controller.abort();
  await a.waitFor(s => s.game.moves.length === 1 && !s.players[1].connected);
  assert.equal((await move(guest.token, 0, 1)).status, 400);
  const b2 = await events(host.code, guest.token); await b2.waitFor(s => s.players.every(p => p?.connected));
  assert.equal((await api('sync', { room: host.code }, guest.token)).game.moves.length, 1);
  for (let i = 0; i < 4; i++) {
    assert.equal((await move(guest.token, i, 2)).status, 200);
    assert.equal((await move(host.token, i + 1, 0)).status, 200);
  }
  const won = await b2.waitFor(s => s.game.status === 'finished'); assert.equal(won.game.winner, 1); assert.equal(won.game.moves.length, 9);
  assert.equal((await move(guest.token, 4, 2)).status, 400);
  const ready = await api('rematch', { room: host.code }, host.token); assert.equal(ready.round, 1); assert.deepEqual(ready.ready, [1]);
  const reset = await api('rematch', { room: host.code }, guest.token); assert.equal(reset.round, 2); assert.equal(reset.yourColor, 1); assert.equal(reset.game.moves.length, 0);
  const hostReset = await a.waitFor(s => s.round === 2); assert.equal(hostReset.yourColor, 2);
  assert.equal((await move(host.token, 7, 7)).status, 400); assert.equal((await move(guest.token, 7, 7)).status, 200);
  const resigned = await api('resign', { room: host.code }, host.token); assert.equal(resigned.game.winner, 1); assert.equal(resigned.game.reason, 'resign');
  const other = await api('create'); assert.notEqual(other.code, host.code);
  assert.equal((await api('sync', { room: other.code }, host.token)).status, 401);
  await api('rematch', { room: host.code }, host.token); await api('rematch', { room: host.code }, guest.token);
  assert.equal((await api('leave', { room: host.code }, guest.token)).status, 200);
  const left = await a.waitFor(s => s.closed); assert.equal(left.game.reason, 'leave'); assert.equal(left.game.winner, 1);
  assert.equal((await api('join', { room: host.code })).status, 400);
  assert.equal((await api('rematch', { room: host.code }, host.token)).status, 400);
});
