import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newJungle, jungleTargets, moveJungle, newFlight, rollFlight, moveFlight, flightOptions, flightIndex } from '../public/table-rules.js';
import { createGameServer } from '../server.js';
import { createRecords } from '../records.js';

const animal = (owner, rank, x, y) => ({ id: `${owner}-${rank}`, owner, rank, x, y });
const jungle = pieces => ({ ...newJungle(), pieces });
const can = (g, id, x, y) => jungleTargets(g, id).some(p => p.x === x && p.y === y);
test('jungle setup, turns, orthogonal movement and own den', () => {
  const g = newJungle(); assert.equal(g.pieces.length, 16); assert.equal(new Set(g.pieces.map(p => `${p.x},${p.y}`)).size, 16);
  assert.throws(() => moveJungle(g, 2, '2-1', 0, 3));
  assert.throws(() => moveJungle(g, 1, '1-1', 5, 5));
  moveJungle(g, 1, '1-1', 6, 5); assert.equal(g.turn, 2);
  const h = jungle([animal(1, 2, 3, 7), animal(2, 2, 0, 0)]);
  assert.equal(can(h, '1-2', 3, 8), false); assert.equal(can(h, '1-2', 2, 7), true);
});
test('jungle rank, rat/elephant, water boundaries and trap ownership', () => {
  let g = jungle([animal(1, 1, 0, 2), animal(2, 8, 0, 3)]);
  assert.ok(can(g, '1-1', 0, 3)); assert.equal(can(g, '2-8', 0, 2), false);
  g = jungle([animal(1, 1, 1, 3), animal(2, 8, 1, 2), animal(2, 1, 2, 3)]);
  assert.equal(can(g, '1-1', 1, 2), false); assert.ok(can(g, '1-1', 2, 3));
  g = jungle([animal(1, 2, 1, 2), animal(2, 1, 1, 3)]);
  assert.equal(can(g, '1-2', 1, 3), false);
  g = jungle([animal(1, 1, 2, 7), animal(2, 8, 2, 8)]);
  assert.ok(can(g, '1-1', 2, 8));
  g = jungle([animal(1, 8, 2, 7), animal(2, 1, 2, 8)]);
  assert.ok(can(g, '1-8', 2, 8), 'trapped rat can be captured by elephant');
  g = jungle([animal(1, 8, 3, 1), animal(2, 2, 2, 1)]);
  assert.equal(can(g, '1-8', 2, 1), false); assert.ok(can(g, '2-2', 3, 1));
});
test('lion/tiger river jump, both colors of rat blocking, capture and victories', () => {
  const g = jungle([animal(1, 7, 0, 4), animal(2, 4, 3, 4)]);
  assert.ok(can(g, '1-7', 3, 4));
  for (const owner of [1, 2]) { g.pieces.push(animal(owner, 1, 2, 4)); assert.equal(can(g, '1-7', 3, 4), false); g.pieces.pop(); }
  moveJungle(g, 1, '1-7', 3, 4); assert.equal(g.pieces.length, 1); assert.equal(g.winner, 1); assert.equal(g.reason, 'blocked');
  const h = jungle([animal(1, 3, 3, 1), animal(2, 7, 0, 0)]);
  moveJungle(h, 1, '1-3', 3, 0); assert.equal(h.reason, 'den'); assert.equal(h.winner, 1);
  assert.throws(() => moveJungle(h, 2, '2-7', 0, 1));
});
test('flight launch, turns and third-six penalty returns only touched planes', () => {
  const g = newFlight(4); assert.equal(g.planes.length, 16);
  rollFlight(g, 1, 3); assert.equal(g.turn, 2); assert.equal(g.phase, 'roll');
  rollFlight(g, 2, 6); assert.equal(flightOptions(g).length, 4);
  assert.throws(() => rollFlight(g, 2, 6)); assert.throws(() => moveFlight(g, 1, '1-1'));
  moveFlight(g, 2, '2-1'); assert.equal(g.planes.find(p => p.id === '2-1').progress, 0); assert.equal(g.turn, 2);
  g.planes.find(p=>p.id==='2-3').progress=12;g.planes.find(p=>p.id==='2-4').progress=56;
  rollFlight(g, 2, 6); moveFlight(g, 2, '2-2'); rollFlight(g, 2, 6);
  assert.equal(g.turn,3);assert.equal(g.phase,'roll');assert.equal(g.last.penalty,true);
  assert.deepEqual(g.planes.filter(p=>p.owner===2).map(p=>p.progress),[-1,-1,12,56]);
  assert.equal(g.sixes,0);assert.deepEqual(g.touched,[]);assert.throws(()=>moveFlight(g,2,'2-3'));
  const before = JSON.stringify(g); assert.throws(() => rollFlight(g, 3, 7)); assert.equal(JSON.stringify(g), before);
  rollFlight(g,3,6);moveFlight(g,3,'3-1');rollFlight(g,3,1);moveFlight(g,3,'3-1');
  assert.equal(g.turn,4);assert.equal(g.sixes,0);assert.deepEqual(g.touched,[]);
});
function prepareFlight(progress, dice) { const g = newFlight(2); g.planes[0].progress = progress; rollFlight(g, 1, dice); return g; }
test('roll history records the roller before turn changes, including no-move and penalties', () => {
  const g = newFlight(4);
  rollFlight(g, 1, 1);
  assert.deepEqual(g.rollHistory, [{ number: 1, player: 1, dice: 1, outcome: 'no-move' }]);
  assert.equal(g.turn, 2);
  assert.throws(() => rollFlight(g, 1, 6));
  assert.throws(() => rollFlight(g, 2, 0));
  rollFlight(g, 2, 6);
  assert.throws(() => rollFlight(g, 2, 6));
  moveFlight(g, 2, '2-1'); rollFlight(g, 2, 6); moveFlight(g, 2, '2-2'); rollFlight(g, 2, 6);
  assert.deepEqual(g.rollHistory, [
    { number: 1, player: 1, dice: 1, outcome: 'no-move' },
    { number: 2, player: 2, dice: 6, outcome: 'move' },
    { number: 3, player: 2, dice: 6, outcome: 'move' },
    { number: 4, player: 2, dice: 6, outcome: 'penalty' }
  ]);
  assert.equal(g.turn, 3);
});
test('roll history retains the latest 200 accepted rolls without renumbering or hiding repeated ones', () => {
  const g = newFlight(2);
  for (let i = 0; i < 215; i++) rollFlight(g, g.turn, 1);
  assert.equal(g.rollHistory.length, 200); assert.equal(g.rolls, 215);
  assert.equal(g.rollHistory[0].number, 16); assert.equal(g.rollHistory.at(-1).number, 215);
  assert.ok(g.rollHistory.every(entry => entry.dice === 1 && entry.outcome === 'no-move'));
  assert.equal(g.rollHistory.filter(entry => entry.player === 1).length, 100);
  assert.deepEqual(newFlight(2).rollHistory, []);
});
test('only 2, 4 and 6 launch from hangars, and only 6 grants an extra roll', () => {
  for(const dice of [1,2,3,4,5,6]) {
    const g=newFlight(2);rollFlight(g,1,dice);
    if(dice%2===0) {
      assert.equal(flightOptions(g,1).length,4);moveFlight(g,1,'1-1');
      assert.equal(g.planes[0].progress,0);assert.equal(g.turn,dice===6?1:2);assert.equal(g.phase,'roll');
    } else {assert.equal(g.turn,2);assert.throws(()=>moveFlight(g,1,'1-1'));}
  }
  const g=newFlight(2);
  for(const dice of [6,6,2]) {rollFlight(g,1,dice);moveFlight(g,1,'1-1');}
  assert.equal(g.turn,2);assert.equal(g.sixes,0);assert.deepEqual(g.touched,[]);assert.ok(g.planes[0].progress>0);
});
test('flight jumps, chained shortcut, capture stacks and crossing home lane', () => {
  let g = prepareFlight(1, 1); moveFlight(g, 1, '1-1'); assert.equal(g.planes[0].progress, 6);
  g = prepareFlight(13, 1); moveFlight(g, 1, '1-1'); assert.equal(g.planes[0].progress, 30); assert.deepEqual(g.last.landings, [14, 18, 30]);
  g = prepareFlight(17, 1);
  g.planes[4].progress = 53;
  moveFlight(g, 1, '1-1'); assert.equal(g.planes[0].progress, 34); assert.equal(g.planes[4].progress, -1);
  assert.deepEqual(g.last.landings, [18, 30, 34]);
  g = prepareFlight(30, 1);
  const index = flightIndex(0, 31), otherProgress = Array.from({ length: 50 }, (_, i) => i + 1).find(p => flightIndex(2, p) === index);
  g.planes[4].progress = otherProgress; g.planes[5].progress = otherProgress;
  moveFlight(g, 1, '1-1'); assert.equal(g.last.captured.length, 2); assert.equal(g.planes[4].progress, -1); assert.equal(g.planes[5].progress, -1);
});
test('flight bounce, exact landing, victory and no moves after finish', () => {
  let g = prepareFlight(55, 3); moveFlight(g, 1, '1-1'); assert.equal(g.planes[0].progress, 54);
  g = prepareFlight(55, 1); g.planes.slice(1, 4).forEach(p => p.progress = 56);
  moveFlight(g, 1, '1-1'); assert.equal(g.status, 'finished'); assert.equal(g.winner, 1);
  assert.throws(() => rollFlight(g, 1, 6));
});
test('2, 3 and 4 player full flight games reach a legal winner', () => {
  let seed = 932401;
  // Use the upper bits: alternating roll/choice draws make LCG low bits repeat.
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 8; };
  for (const count of [2, 3, 4]) {
    const g = newFlight(count);
    for (let i = 0; g.status === 'playing' && i < 50000; i++) {
      if (g.phase === 'roll') rollFlight(g, g.turn, rand() % 6 + 1);
      else { const choices = flightOptions(g); assert.ok(choices.length); moveFlight(g, g.turn, choices[rand() % choices.length]); }
      assert.ok(g.planes.every(p => p.progress >= -1 && p.progress <= 56));
    }
    assert.equal(g.status, 'finished'); assert.ok(g.planes.filter(p => p.owner === g.winner).every(p => p.progress === 56));
    assert.equal(g.finishOrder.length,count);assert.equal(new Set(g.finishOrder).size,count);
    assert.equal(g.finishOrder[0],g.winner);
    for(const seat of g.finishOrder.slice(0,-1)) assert.ok(g.planes.filter(p=>p.owner===seat).every(p=>p.progress===56));
  }
});

test('flight finishers skip turns, including sixes, and remaining players keep their order', () => {
  const g=newFlight(4);
  const finish=seat=>{
    g.planes.filter(p=>p.owner===seat).forEach(p=>p.progress=56);
    g.planes.find(p=>p.owner===seat).progress=50;
    rollFlight(g,seat,6);moveFlight(g,seat,`${seat}-1`);
  };
  finish(1);assert.equal(g.status,'playing');assert.deepEqual(g.finishOrder,[1]);assert.equal(g.turn,2);assert.equal(g.phase,'roll');
  assert.throws(()=>rollFlight(g,1,6));assert.deepEqual(flightOptions(g,1),[]);
  rollFlight(g,2,1);rollFlight(g,3,1);rollFlight(g,4,1);assert.equal(g.turn,2,'no-move turn skips first finisher');
  rollFlight(g,2,1);assert.equal(g.turn,3);
  finish(3);assert.deepEqual(g.finishOrder,[1,3]);assert.equal(g.turn,4);
  for(let i=1;i<=2;i++) {rollFlight(g,4,6);moveFlight(g,4,`4-${i}`);}
  rollFlight(g,4,6);assert.equal(g.turn,2,'third-six penalty skips finished seat');assert.equal(g.sixes,0);
  finish(2);assert.equal(g.status,'finished');assert.deepEqual(g.finishOrder,[1,3,2,4]);assert.equal(g.winner,1);
  assert.ok(g.planes.filter(p=>p.owner===4).some(p=>p.progress!==56));
  assert.throws(()=>rollFlight(g,4,6));assert.throws(()=>moveFlight(g,2,'2-1'));
});

test('multiplayer table API, 4 seats, reconnect, server dice, stale requests and rankings', async t => {
  let nextDice=6;
  const { server, tableRooms } = createGameServer({ scoreFile: null, roll: () => nextDice, autoDelay:20 }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`, controllers = [];
  t.after(async () => { controllers.forEach(c => c.abort()); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const post = async (path, body = {}, auth, profile) => { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(profile ? { 'X-Player-Token': profile } : {}) }, body: JSON.stringify(body) }); return { status: r.status, ...await r.json() }; };
  async function events(code, token, table = true) {
    const controller = new AbortController(); controllers.push(controller);
    const response = await fetch(`${base}/api/${table ? 'table/' : ''}events?room=${code}&token=${token}`, { signal: controller.signal }); assert.equal(response.status, 200);
    const states = [], waiters = [];
    (async () => { let buffer = ''; try { for await (const chunk of response.body) { buffer += new TextDecoder().decode(chunk); let split; while ((split = buffer.indexOf('\n\n')) >= 0) { const frame = buffer.slice(0, split); buffer = buffer.slice(split + 2); if (frame.startsWith('data: ')) { states.push(JSON.parse(frame.slice(6))); waiters.forEach(fn => fn()); } } } } catch (e) { if (e.name !== 'AbortError') throw e; } })();
    return { controller, wait: predicate => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('SSE timeout')), 3000); const check = () => { const s = states.findLast(predicate); if (s) { clearTimeout(timer); resolve(s); } }; waiters.push(check); check(); }) };
  }
  const profiles = []; for (let i = 0; i < 4; i++) profiles.push(await post('/api/profile', { name: `棋友${i + 1}` }));
  const h = await post('/api/table/create', { kind: 'flight', count: 4 }, null, profiles[0].token), players = [h];
  const call = (action, data = {}, p = players[0], version = tableRooms.get(h.code).version) => post(`/api/table/${action}`, { room: h.code, version, ...data }, p.token);
  assert.equal((await call('start')).status, 400);
  assert.equal((await post('/api/table/join', { room: h.code, kind: 'jungle' })).status, 400);
  for (let i = 1; i < 4; i++) players.push(await post('/api/table/join', { room: h.code, kind: 'flight' }, null, profiles[i].token));
  assert.equal((await post('/api/table/join', { room: h.code, kind: 'flight' })).status, 400);
  const streams = []; for (const p of players) streams.push(await events(h.code, p.token));
  await streams[0].wait(s => s.players.every(p => p?.connected));
  assert.equal((await call('start', {}, players[1])).status, 400); assert.equal((await call('start')).status, 200);
  assert.equal((await call('roll', {}, players[1])).status, 400);
  const version = tableRooms.get(h.code).version;
  const rolled = await call('roll', { dice: 1 }); assert.equal(rolled.game.dice, 6);
  assert.deepEqual(rolled.game.rollHistory, [{ number: 1, player: 1, dice: 6, outcome: 'move' }]);
  assert.equal((await call('roll', {}, players[0], version)).status, 400);
  assert.deepEqual((await call('sync')).game.rollHistory, rolled.game.rollHistory);
  assert.equal((await call('move', { id: '2-1' })).status, 400);
  await call('move', { id: '1-1' }); const synced = await streams[3].wait(s => s.game.moves.length === 1); assert.equal(synced.game.planes[0].progress, 0);
  streams[3].controller.abort(); await streams[0].wait(s => s.started && !s.players[3].connected);
  assert.equal((await call('roll')).status, 400);
  const reconnected = await events(h.code, players[3].token); const restored = await reconnected.wait(s => s.game.moves.length === 1 && s.players.every(p => p?.connected));
  assert.deepEqual(restored.game.rollHistory, rolled.game.rollHistory);
  assert.equal((await call('sync')).game.planes[0].progress, 0);
  await call('roll');await call('move',{id:'1-2'});await call('roll');
  const consecutive=await call('sync');assert.equal(consecutive.game.turn,2);assert.equal(consecutive.game.phase,'roll');
  assert.equal(consecutive.game.last.penalty,true);assert.deepEqual(consecutive.game.planes.slice(0,4).map(p=>p.progress),[-1,-1,-1,-1]);
  assert.equal((await call('move',{id:'1-3'})).status,400);
  for(const [seat,dice] of [[2,2],[3,4]]) {
    nextDice=dice;await call('roll',{},players[seat-1]);const launched=await call('move',{id:`${seat}-1`},players[seat-1]);
    assert.equal(launched.status,200);assert.equal(launched.game.planes.find(p=>p.id===`${seat}-1`).progress,0);assert.equal(launched.game.turn,seat+1);
  }
  nextDice=6;
  // Set up a final legal landing and verify only server adjudication awards it.
  const r = tableRooms.get(h.code); r.game.turn=1; r.game.planes.slice(0, 4).forEach(p => p.progress = 56); r.game.planes[0].progress = 50;
  await call('roll'); const first = await call('move', { id: '1-1' });
  assert.equal(first.game.status,'playing');assert.deepEqual(first.game.finishOrder,[1]);assert.equal(first.game.turn,2);
  assert.equal((await call('auto',{enabled:true})).status,400);
  assert.equal((await (await fetch(`${base}/api/rankings?kind=flight`)).json()).entries.length,0);
  streams[0].controller.abort();await streams[1].wait(s=>s.game.finishOrder.length===1 && !s.players[0].connected);
  // Finished players can disconnect without blocking the remaining three players.
  for(const seat of [2,3]) {
    r.game.planes.filter(p=>p.owner===seat).forEach(p=>p.progress=56);r.game.planes.find(p=>p.owner===seat).progress=50;
    if(seat===2) {
      assert.equal((await call('auto',{enabled:true},players[1])).status,200);
      const completed=await streams[1].wait(s=>s.game.finishOrder.length===2);
      assert.equal(completed.game.rollHistory.at(-1).player, 2); assert.equal(completed.game.rollHistory.at(-1).dice, 6);
      assert.equal(completed.players[1].auto,false);assert.equal(completed.game.turn,3);
    } else {
      assert.equal((await call('roll',{},players[seat-1])).status,200);
      assert.equal((await call('move',{id:`${seat}-1`},players[seat-1])).status,200);
    }
  }
  assert.equal(r.game.status,'finished');assert.deepEqual(r.game.finishOrder,[1,2,3,4]);assert.equal(r.game.winner,1);
  let rankings = await (await fetch(`${base}/api/rankings?kind=flight`)).json(); assert.equal(rankings.entries[0].wins, 1); assert.equal(rankings.entries[0].name, '棋友1');
  await call('sync'); await events(h.code, players[0].token);
  rankings = await (await fetch(`${base}/api/rankings?kind=flight`)).json(); assert.equal(rankings.entries[0].wins, 1);
  for (const p of players) await call('rematch', {}, p);
  assert.equal(r.round, 2); assert.equal(r.game.turn, 2); assert.equal(r.game.moves.length, 0);assert.deepEqual(r.game.finishOrder,[]);
  assert.deepEqual(r.game.rollHistory, []); assert.equal(r.game.rolls, 0);
  await call('leave', {}, players[2]); assert.equal(r.closed, true); assert.equal(r.game.winner, 0);
  assert.equal((await call('roll')).status, 400);
  const jungleHost = await post('/api/table/create', { kind: 'jungle' }, null, profiles[0].token);
  const jungleGuest = await post('/api/table/join', { room: jungleHost.code, kind: 'jungle' }, null, profiles[1].token);
  const ja = await events(jungleHost.code, jungleHost.token); await events(jungleHost.code, jungleGuest.token); await ja.wait(s => s.players.every(p => p?.connected));
  const jc = (action, data = {}, token = jungleHost.token) => post(`/api/table/${action}`, { room: jungleHost.code, version: tableRooms.get(jungleHost.code).version, ...data }, token);
  await jc('start'); assert.equal((await jc('roll')).status, 400);
  await jc('move', { id: '1-1', x: 6, y: 5 }); await jc('resign', {}, jungleGuest.token);
  rankings = await (await fetch(`${base}/api/rankings?kind=jungle`)).json(); assert.equal(rankings.entries[0].wins, 1);
  const old = await (await fetch(`${base}/api/rankings?kind=gomoku`)).json(); assert.deepEqual(old.entries, []);
  const gh = await post('/api/create', {}, null, profiles[0].token), gg = await post('/api/join', { room: gh.code }, null, profiles[1].token);
  const gs = await events(gh.code, gh.token, false); await events(gh.code, gg.token, false); await gs.wait(s => s.players.every(p => p?.connected));
  await post('/api/move', { room: gh.code, x: 7, y: 7 }, gh.token);
  await post('/api/resign', { room: gh.code }, gg.token);
  await post('/api/leave', { room: gh.code }, gg.token);
  const finalScores = await (await fetch(`${base}/api/rankings?kind=gomoku`)).json(); assert.equal(finalScores.entries[0].wins, 1);
});
test('rankings persist to disk, use server identity, distinguish ties and ignore self-play', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yiju-score-')); const file = join(dir, 'scores.json');
  try {
    let records = createRecords({ scoreFile: file });
    const a = records.profile({ headers: {} }, { name: '小木' }), b = records.profile({ headers: {} }, { name: '小河' });
    const room = { round: 1, players: [{ color: 1, profileId: a.id }, { color: 2, profileId: b.id }], game: { status: 'finished', winner: 1, moves: [{}] } };
    records.victory(room, 'gomoku', p => p.color); records.victory(room, 'gomoku', p => p.color);
    room.round++; room.game.winner = 2; records.victory(room, 'gomoku', p => p.color);
    room.round++; room.players[1].profileId = a.id; records.victory(room, 'gomoku', p => p.color);
    records = createRecords({ scoreFile: file });
    const req = { headers: { 'x-player-token': a.token } }, board = records.board('gomoku', req);
    assert.equal(board.me.wins, 1); assert.deepEqual(board.entries.map(p => p.rank), [1, 1]);
    assert.equal(records.profile(req, { name: '木木' }).id, a.id); assert.equal(records.lookup(req).name, '木木');
    assert.equal(records.lookup({ headers: { 'x-player-token': a.id } }), null);
    assert.throws(() => records.profile(req, { name: ' ' }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
