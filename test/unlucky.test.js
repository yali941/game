import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createGameServer } from '../server.js';

test('removed nickname mode is rejected and all names use the same dice for manual and automatic rolls', async t => {
  const { server, tableRooms } = createGameServer({ scoreFile: null, roll: () => 4, autoDelay: 30 });
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
  for(const diceMode of ['invalid','unlucky']) assert.equal((await post('create',{kind:'flight',diceMode},null,a.token)).status,400);
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

  const {host,guest,r,call}=await makeRoom();
  const first=await call('roll',{dice:6,name:'普通',diceMode:'unlucky'});
  assert.equal(first.game.dice,4);assert.equal(first.dicePolicy,undefined);assert.equal(first.game.rollHistory[0].luck,undefined);
  await call('move',{id:'1-1'});await call('roll',{},guest);await call('move',{id:'2-1'},guest);
  await call('auto',{enabled:true});
  for(let i=0;i<100&&r.game.turn!==2;i++)await delay(10);
  assert.equal(r.game.turn,2);assert.equal(r.game.rollHistory.length,3);
  assert.equal(r.game.rollHistory.at(-1).dice,4);assert.equal(r.game.rollHistory.at(-1).luck,undefined);
  await call('auto',{enabled:false});await call('roll',{},guest);await call('move',{id:'2-1'},guest);
  await post('profile',{name:'小芽卫兵大王92612202'},null,a.token);
  const renamed=await call('roll');assert.equal(renamed.game.dice,4);assert.equal(renamed.dicePolicy,undefined);
  await call('move',{id:'1-1'});
  const restored=await call('sync',{},guest);assert.equal(restored.dicePolicy,undefined);
  assert.ok(restored.game.rollHistory.every(entry=>entry.dice===4&&entry.luck===undefined));
  await call('leave');
});
