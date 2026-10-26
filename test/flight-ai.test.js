import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createGameServer} from '../server.js';

async function fixture(t) {
  const {server,tableRooms}=createGameServer({scoreFile:null,autoDelay:35,roll:()=>2});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`,controllers=[];
  t.after(async()=>{controllers.forEach(c=>c.abort());server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const post=async(action,data={},token,profile)=>{
    const response=await fetch(base+(action==='profile'?'/api/profile':'/api/table/'+action),{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...(profile?{'X-Player-Token':profile}:{})},body:JSON.stringify(data)});
    return {status:response.status,...await response.json()};
  };
  const connect=async(player)=>{
    const controller=new AbortController();controllers.push(controller);
    const response=await fetch(`${base}/api/table/events?room=${player.code}&token=${player.token}`,{signal:controller.signal});
    assert.equal(response.status,200);
    (async()=>{try {for await (const _ of response.body) { /* Drain SSE. */ }} catch(error) {if(error.name!=='AbortError') throw error;}})();
    return controller;
  };
  return {post,connect,rooms:tableRooms,base};
}
async function until(predicate) {
  for(let i=0;i<100;i++){if(predicate())return;await delay(10);}
  assert.fail('Timed out waiting for AI state');
}

for(const count of [2,3,4]) test(`flight AI: ${count} seats fill on start, automatically roll/move, and stop at human turn`,async t=>{
  const f=await fixture(t),host=await f.post('create',{kind:'flight',roomMode:'ai',count});
  assert.equal(host.roomMode,'ai');assert.equal(host.players.filter(Boolean).length,1);
  const room=f.rooms.get(host.code);await f.connect(host);
  await delay(60);assert.equal(room.game.rolls,0);assert.equal(room.players.filter(Boolean).length,1);
  const started=await f.post('start',{room:host.code},host.token);
  assert.equal(started.status,200);assert.equal(started.players.filter(p=>p.bot).length,count-1);
  assert.ok(started.players.slice(1).every(p=>p.auto && p.name.startsWith('AI')));
  assert.ok(started.players.every(p=>!('token' in p)));
  assert.equal((await f.post('join',{room:host.code,kind:'flight'})).status,400);
  await f.post('roll',{room:host.code,version:room.version},host.token);
  await f.post('move',{room:host.code,version:room.version,id:'1-1'},host.token);
  await until(()=>room.game.moves.length===count);
  assert.equal(room.game.turn,1);assert.equal(room.game.rolls,count);
  await delay(100);assert.equal(room.game.rolls,count,'no timeout or AI takeover of the human');
  assert.ok(room.game.planes.filter(p=>p.number===1).every(p=>p.progress===0));
});

test('flight AI: preserves friends, rejects non-host start and disconnected humans without partial filling',async t=>{
  const f=await fixture(t),host=await f.post('create',{kind:'flight',roomMode:'ai',count:4});await f.connect(host);
  const friend=await f.post('join',{room:host.code,kind:'flight'}),room=f.rooms.get(host.code);
  assert.equal(friend.roomMode,'ai');
  assert.equal((await f.post('start',{room:host.code},friend.token)).status,400);
  assert.equal((await f.post('start',{room:host.code},host.token)).status,400);
  assert.equal(room.players.filter(Boolean).length,2);
  await f.connect(friend);
  assert.equal((await f.post('start',{room:host.code},host.token)).status,200);
  assert.equal(room.players[1].token,friend.token);assert.ok(!room.players[1].bot);
  assert.equal(room.players.filter(p=>p.bot).length,2);
  const snapshot=await f.post('sync',{room:host.code},friend.token);
  assert.equal(snapshot.yourSeat,2);assert.equal(snapshot.roomMode,'ai');
});

test('flight AI: disconnect pauses pending bot turn, reconnect resumes, leaving cancels',async t=>{
  const f=await fixture(t),host=await f.post('create',{kind:'flight',roomMode:'ai',count:4});
  const connection=await f.connect(host),room=f.rooms.get(host.code);
  await f.post('start',{room:host.code},host.token);
  await f.post('roll',{room:host.code,version:room.version},host.token);
  await f.post('move',{room:host.code,version:room.version,id:'1-1'},host.token);
  connection.abort();await until(()=>room.players[0].streams.size===0);
  const rolls=room.game.rolls;await delay(120);assert.equal(room.game.rolls,rolls);
  await f.connect(host);await until(()=>room.game.rolls>rolls);
  await f.post('leave',{room:host.code},host.token);
  const stopped=JSON.stringify(room.game);await delay(120);assert.equal(JSON.stringify(room.game),stopped);
});

test('flight AI: rematch waits only for humans, restores bots, rotates first turn and excludes rankings',async t=>{
  const f=await fixture(t),a=await f.post('profile',{name:'人机测试甲'}),b=await f.post('profile',{name:'人机测试乙'});
  const host=await f.post('create',{kind:'flight',roomMode:'ai',count:2},null,a.token);
  const friend=await f.post('join',{room:host.code,kind:'flight'},null,b.token);
  await f.connect(host);await f.connect(friend);await f.post('start',{room:host.code},host.token);
  const room=f.rooms.get(host.code);
  Object.assign(room.game,{status:'finished',winner:1,finishOrder:[1,2],moves:[{player:1}]});
  await f.post('chat',{room:host.code,text:'本局结束'},host.token);
  const board=await (await fetch(f.base+'/api/rankings?kind=flight', {headers:{'X-Player-Token':a.token}})).json();
  assert.equal(board.me.wins,0,'even an all-human AI-mode room is unranked');
  await f.post('rematch',{room:host.code},host.token);assert.equal(room.round,1);
  await f.post('rematch',{room:host.code},friend.token);assert.equal(room.round,2);
  const solo=await f.post('create',{kind:'flight',roomMode:'ai',count:4});await f.connect(solo);await f.post('start',{room:solo.code},solo.token);
  const mixed=f.rooms.get(solo.code);
  Object.assign(mixed.game,{status:'finished',winner:2,finishOrder:[2,1,3,4]});
  await f.post('chat',{room:solo.code,text:'再来一局'},solo.token);
  assert.ok(mixed.players.slice(1).every(p=>!p.auto));
  assert.equal((await f.post('rematch',{room:solo.code},solo.token)).status,200);
  assert.equal(mixed.round,2);assert.equal(mixed.game.turn,2);
  assert.ok(mixed.players.slice(1).every(p=>p.auto));await until(()=>mixed.game.rolls>0);
});

test('flight AI: regular rooms still require full seats and other games reject the mode',async t=>{
  const f=await fixture(t),host=await f.post('create',{kind:'flight',count:4});await f.connect(host);
  assert.equal((await f.post('start',{room:host.code,roomMode:'ai'},host.token)).status,400);
  assert.equal(f.rooms.get(host.code).players.filter(Boolean).length,1);
  for(const kind of ['jungle','uno','oldmaid']) assert.equal((await f.post('create',{kind,roomMode:'ai'})).status,400);
  assert.equal((await f.post('create',{kind:'flight',roomMode:'ai',diceMode:'unlucky'})).status,400);
});
