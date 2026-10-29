import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import * as fog from '../fog-rules.js';
import { createGameServer } from '../server.js';

test('fog vision includes all eight neighbours, clamps edges and never shares enemy vision', () => {
  const g = fog.newGame();
  assert.ok(fog.fogSnapshot(g, 1).board.every(p => p === null));
  fog.playMove(g, 1, 7, 7); fog.playMove(g, 2, 8, 8);
  assert.equal(fog.visibility(g, 1).filter(Boolean).length, 9);
  assert.equal(fog.fogSnapshot(g, 1).board[8 * 15 + 8], 2);
  assert.equal(fog.fogSnapshot(g, 1).board[9 * 15 + 9], null);
  fog.playMove(g, 1, 0, 0); fog.playMove(g, 2, 14, 14);
  const a = fog.fogSnapshot(g, 1), b = fog.fogSnapshot(g, 2);
  assert.equal(a.visibility.filter(Boolean).length, 13);
  assert.equal(a.board[224], null); assert.equal(b.board[0], null);
  assert.deepEqual(a.moves.at(-1), { color:2, hidden:true });
  assert.equal(a.probes, undefined);
});

test('blind collision commits a turn, expires privately, and undo never deletes the collided stone', () => {
  const g = fog.newGame(); fog.playMove(g, 1, 0, 0);
  fog.playMove(g, 2, 0, 0, 1000);
  assert.equal(g.turn, 1); assert.equal(g.board[0], 1); assert.equal(g.moves.length, 2);
  assert.equal(fog.fogSnapshot(g, 2, 1001).probe.color, 1);
  assert.equal(fog.fogSnapshot(g, 2, 3400).probe, null);
  assert.equal(fog.fogSnapshot(g, 1, 1001).probe, null);
  assert.deepEqual(fog.fogSnapshot(g, 1).moves.at(-1), { color:2, hidden:true });
  assert.equal(fog.undoMove(g, 2), 1); assert.equal(g.board[0], 1); assert.equal(g.turn, 2);
  fog.playMove(g, 2, 1, 1); fog.playMove(g, 1, 3, 3);
  assert.throws(() => fog.playMove(g, 2, 0, 0), /已经有棋子/);
  assert.equal(g.turn, 2); assert.equal(g.moves.length, 3);
  fog.undoMove(g, 2);
  assert.equal(g.board[0], 1); assert.ok(fog.fogSnapshot(g, 2).board.every(p => p === null));
});

test('fog five wins reveal all stones and draw checks occupied points rather than attempted turns', () => {
  const g = fog.newGame();
  for (let i=0;i<4;i++) { fog.playMove(g,1,i,0); fog.playMove(g,2,14,i*2); }
  fog.playMove(g,1,4,0);
  assert.equal(g.status,'finished'); assert.equal(g.winner,1); assert.equal(g.line.length,5);
  for (const c of [1,2]) assert.deepEqual(fog.fogSnapshot(g,c).board,g.board);
  const attempts = fog.newGame(); attempts.moves = Array.from({length:224},()=>({x:0,y:0,color:2,blocked:true}));
  fog.playMove(attempts,1,7,7); assert.equal(attempts.status,'playing');
  for (const end of [g=>fog.resign(g,1),fog.agreeDraw]) {
    const board=fog.newGame(); fog.playMove(board,1,0,0); end(board);
    assert.deepEqual(fog.fogSnapshot(board,2).board,board.board);
  }
});

test('two real clients: private SSE/HTTP/reconnect, stale action rejection, negotiation, ranking and rematch', async t => {
  const {server,rooms}=createGameServer({scoreFile:null,autoDelay:5});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`, controllers=[];
  t.after(async()=>{controllers.forEach(c=>c.abort());server.closeAllConnections();await new Promise(r=>server.close(r));});
  async function api(action,data={},token,profile) {
    const response=await fetch(`${base}/api/${action}`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...(profile?{'X-Player-Token':profile}: {})},body:JSON.stringify(data)});
    return {http:response.status,...await response.json()};
  }
  async function events(player) {
    const c=new AbortController();controllers.push(c);
    const response=await fetch(`${base}/api/events?room=${player.code}&token=${player.token}`,{signal:c.signal});
    assert.equal(response.status,200);
    const states=[];
    (async()=>{let buffer='';const decoder=new TextDecoder();try{for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true});let at;while((at=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,at);buffer=buffer.slice(at+2);if(frame.startsWith('data: '))states.push(JSON.parse(frame.slice(6)));}}}catch(e){if(e.name!=='AbortError')throw e;}})();
    return {states,controller:c,async wait(fn){for(let i=0;i<100;i++){const match=states.findLast(fn);if(match)return match;await new Promise(r=>setTimeout(r,10));}throw Error('SSE timed out');}};
  }
  const pa=await api('profile',{name:'雾黑'}),pb=await api('profile',{name:'雾白'});
  const a=await api('create',{mode:'fog'},null,pa.token),b=await api('join',{room:a.code},null,pb.token);
  const sa=await events(a),sb=await events(b);
  await sa.wait(s=>s.players.every(p=>p?.connected));
  let version=0;
  const call=async(action,player,data={})=>{const s=await api(action,{room:a.code,version,...data},player.token);if(s.version!==undefined)version=s.version;return s;};
  assert.equal((await call('auto',a,{enabled:true})).http,400);
  assert.equal((await call('move',a,{x:0,y:0})).http,200);
  const hidden=await sb.wait(s=>s.version===1);
  assert.ok(hidden.game.board.every(p=>p===null));
  assert.deepEqual(hidden.game.moves,[{color:1,hidden:true}]);
  assert.deepEqual((await call('sync',b)).game,hidden.game);
  assert.equal((await call('move',b,{x:0,y:0,version:0})).http,400);
  const hit=await call('move',b,{x:0,y:0}); assert.equal(hit.http,200); assert.equal(hit.game.turn,1); assert.ok(hit.game.probe);
  const privateHit=await sa.wait(s=>s.version===2);assert.equal(privateHit.game.probe,null);assert.deepEqual(privateHit.game.moves.at(-1),{color:2,hidden:true});
  assert.equal((await call('move',b,{x:1,y:1})).http,400);
  let request=(await call('request',b,{kind:'undo'})).request;
  const undo=await call('respond',a,{id:request.id,accept:true}); assert.equal(undo.game.board[0],1);
  assert.equal(rooms.get(a.code).game.board[0],1);
  await call('move',b,{x:14,y:14});
  sb.controller.abort();const sb2=await events(b);await sb2.wait(s=>s.players.every(p=>p?.connected));
  const reconnected=await call('sync',b);assert.equal(reconnected.game.board[0],null);assert.equal(reconnected.game.board[224],2);
  await call('move',a,{x:1,y:0});await call('move',b,{x:14,y:12});
  await call('move',a,{x:2,y:0});await call('move',b,{x:14,y:10});
  await call('move',a,{x:3,y:0});await call('move',b,{x:14,y:8});
  const won=await call('move',a,{x:4,y:0});assert.equal(won.game.winner,1);
  const revealed=await sb2.wait(s=>s.game.status==='finished');assert.deepEqual(revealed.game.board,won.game.board);
  const rank=await (await fetch(`${base}/api/rankings?kind=fog`)).json();assert.equal(rank.entries[0].name,'雾黑');assert.equal(rank.entries[0].wins,1);
  const standard=await (await fetch(`${base}/api/rankings?kind=gomoku`)).json();assert.equal(standard.entries.length,0);
  await call('rematch',a);const next=await call('rematch',b);assert.equal(next.game.kind,'fog');assert.equal(next.yourColor,1);assert.ok(next.game.board.every(p=>p===null));
  await call('move',b,{x:7,y:7});request=(await call('request',b,{kind:'draw'})).request;
  const draw=await call('respond',a,{id:request.id,accept:true});assert.equal(draw.game.status,'finished');assert.ok(draw.game.board.every(p=>p!==null));
  await call('rematch',a);await call('rematch',b);await call('move',a,{x:1,y:1});await call('leave',b);
  const left=await call('sync',a);assert.equal(left.game.reason,'leave');assert.ok(left.game.board.every(p=>p!==null));
  assert.equal((await fetch(`${base}/fog-rules.js`)).status,404);
  const normal=await api('create');assert.ok(normal.game.board.every(p=>p===0));
});
