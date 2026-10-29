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

test('first collision allows one private retry; second distinct collision consumes the turn', () => {
  const g = fog.newGame(); fog.playMove(g,1,0,0); fog.playMove(g,2,14,14); fog.playMove(g,1,2,0);
  fog.playMove(g,2,0,0,1000);
  assert.equal(g.turn,2); assert.equal(g.moves.length,3);
  assert.equal(fog.fogSnapshot(g,2,1001).retryUsed,true);
  assert.equal(fog.fogSnapshot(g,1,1001).retryUsed,false);
  assert.equal(fog.fogSnapshot(g,2,1001).probe.color,1);
  assert.equal(fog.fogSnapshot(g,2,3400).probe,null);
  assert.equal(fog.fogSnapshot(g,2,3400).retryUsed,true);
  assert.equal(fog.fogSnapshot(g,1,1001).probe,null);
  assert.equal(fog.fogSnapshot(g,2).retrySpot,undefined);
  assert.throws(()=>fog.playMove(g,2,0,0,4000),/换一个点位/);
  assert.equal(g.turn,2); assert.equal(g.moves.length,3);
  fog.playMove(g,2,2,0,5000);
  assert.equal(g.turn,1); assert.equal(g.moves.length,4); assert.equal(g.retrySpot,null);
  assert.equal(fog.fogSnapshot(g,2,5001).probe.retry,false);
  const exposed=fog.fogSnapshot(g,2,10000);
  assert.equal(exposed.probe,null); assert.equal(exposed.board[2],1);
  assert.equal(exposed.board[0],null,'the first collision is not permanently exposed');
  assert.equal(exposed.board[3],null,'the revealed enemy does not grant neighbouring vision');
  assert.equal(exposed.visibility.filter(Boolean).length,5,'four corner points plus one exposed enemy point');
  assert.equal(exposed.revealed,undefined,'do not send either player\'s revelation registry');
  assert.deepEqual(fog.fogSnapshot(g,1).moves.at(-1),{color:2,hidden:true});
  assert.equal(fog.undoMove(g,2),1); assert.equal(g.board[0],1); assert.equal(g.board[2],1);
  assert.equal(g.turn,2); assert.equal(g.retrySpot,null);
  assert.equal(fog.fogSnapshot(g,2,10000).board[2],1,'undo does not erase already exposed information');
  fog.playMove(g,2,1,1); fog.playMove(g,1,3,3);
  assert.throws(()=>fog.playMove(g,2,0,0),/已经有棋子/);
  assert.equal(g.turn,2);
});

test('a successful retry resets the allowance on the next turn, and ending clears the private hint', () => {
  const g=fog.newGame();fog.playMove(g,1,0,0);fog.playMove(g,2,0,0);
  fog.playMove(g,2,14,14);assert.equal(g.turn,1);assert.equal(g.retrySpot,null);assert.equal(g.probes[2],undefined);
  fog.playMove(g,1,2,0);fog.playMove(g,2,0,0);
  assert.equal(g.turn,2);assert.equal(fog.fogSnapshot(g,2).retryUsed,true);
  fog.agreeDraw(g);assert.equal(fog.fogSnapshot(g,2).retryUsed,false);assert.equal(fog.fogSnapshot(g,2).probe,null);
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

test('white scout privately reveals 5x5 for one turn, validates limits and cannot be refunded by undo', () => {
  const g=fog.newGame();
  assert.throws(()=>fog.scout(g,1,7,7),/白方/);
  assert.throws(()=>fog.scout(g,2,7,7),/自己的回合/);
  fog.playMove(g,1,7,7);
  assert.throws(()=>fog.scout(g,2,15,7),/探雾中心/);assert.equal(g.scoutUsed,false);
  const blackBefore=fog.fogSnapshot(g,1);
  fog.scout(g,2,7,7);
  assert.equal(g.turn,2);assert.equal(g.moves.length,1);
  const seen=fog.fogSnapshot(g,2);assert.equal(seen.visibility.filter(Boolean).length,25);assert.equal(seen.board[112],1);assert.equal(seen.scoutActive,true);
  assert.equal(seen.board[7*15+10],null);assert.equal(seen.scoutArea,undefined);
  assert.deepEqual(fog.fogSnapshot(g,1),blackBefore,'opponent snapshot contains no scout information');
  assert.throws(()=>fog.scout(g,2,3,3),/已用完/);
  assert.throws(()=>fog.playMove(g,2,7,7),/已经有棋子/);assert.equal(g.scoutArea.x,7);
  fog.playMove(g,2,14,14);
  assert.equal(fog.fogSnapshot(g,2).board[112],null);assert.equal(fog.fogSnapshot(g,2).scoutActive,false);
  fog.undoMove(g,2);assert.equal(g.scoutUsed,true);assert.equal(g.scoutArea,null);
  assert.throws(()=>fog.scout(g,2,7,7),/已用完/);
  assert.equal(fog.fogSnapshot(fog.newGame(),2).scoutAvailable,true);
});

test('scout lasts through the first collision but expires on the second, preserving permanent revelation', () => {
  const g=fog.newGame();fog.playMove(g,1,0,0);fog.playMove(g,2,14,14);fog.playMove(g,1,2,0);
  fog.scout(g,2,7,7);fog.playMove(g,2,0,0);
  assert.equal(fog.fogSnapshot(g,2).scoutActive,true);
  fog.playMove(g,2,2,0);
  const result=fog.fogSnapshot(g,2);assert.equal(result.scoutActive,false);assert.equal(result.board[112],null);assert.equal(result.board[2],1);
});

test('scout clips at board corners and cannot be used after the game ends', () => {
  const g=fog.newGame();fog.playMove(g,1,14,14);fog.scout(g,2,0,0);
  assert.equal(fog.fogSnapshot(g,2).visibility.filter(Boolean).length,9);
  fog.agreeDraw(g);assert.equal(fog.fogSnapshot(g,2).scoutActive,false);assert.equal(fog.fogSnapshot(g,2).scoutAvailable,false);
  assert.throws(()=>fog.scout(g,2,5,5),/已结束/);
});

test('taunting exposes only an owned stone, preserves turns and scouting, and clears removed stones on undo', () => {
  const g=fog.newGame();fog.playMove(g,1,7,7);fog.playMove(g,2,0,0);
  assert.throws(()=>fog.taunt(g,2,0,0),/自己的回合/);
  assert.throws(()=>fog.taunt(g,1,0,0),/自己的棋子/);
  assert.throws(()=>fog.taunt(g,1,6,7),/自己的棋子/);
  assert.throws(()=>fog.taunt(g,1,-1,7),/棋盘内/);
  const moves=g.moves.length;
  fog.taunt(g,1,7,7);
  const seen=fog.fogSnapshot(g,2);
  assert.equal(seen.board[112],1);assert.equal(seen.board[111],null);assert.equal(seen.board[113],null);
  assert.equal(seen.visibility.filter(Boolean).length,5,'corner vision plus just the taunted point');
  assert.deepEqual(seen.taunted,[112]);assert.equal(g.turn,1);assert.equal(g.moves.length,moves);
  assert.equal(fog.fogSnapshot(g,1).board[0],null,'taunting grants no enemy vision');
  assert.throws(()=>fog.taunt(g,1,7,7),/已经亮出/);
  fog.playMove(g,1,9,7);fog.scout(g,2,7,7);fog.taunt(g,2,0,0);
  assert.equal(g.scoutUsed,true);assert.deepEqual(g.scoutArea,{x:7,y:7});assert.equal(g.turn,2);
  fog.playMove(g,2,0,2);assert.equal(fog.fogSnapshot(g,2).board[112],1);assert.equal(fog.fogSnapshot(g,2).board[114],null);
  fog.undoMove(g,2);assert.deepEqual(g.taunted[2],[0]);
  fog.undoMove(g,2);assert.deepEqual(g.taunted[2],[]);assert.deepEqual(g.taunted[1],[112]);
  fog.undoMove(g,1);assert.deepEqual(g.taunted[1],[]);
  fog.playMove(g,1,7,7);assert.equal(fog.fogSnapshot(g,2).board[112],null,'a new stone at an undone point is hidden');
  fog.agreeDraw(g);assert.throws(()=>fog.taunt(g,2,0,0),/已结束/);
  assert.deepEqual(fog.fogSnapshot(fog.newGame(),1).taunted,[]);
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
  const hit=await call('move',b,{x:0,y:0}); assert.equal(hit.http,200); assert.equal(hit.game.turn,2); assert.ok(hit.game.probe);assert.equal(hit.game.retryUsed,true);
  const privateHit=await sa.wait(s=>s.version===2);assert.equal(privateHit.game.probe,null);assert.equal(privateHit.game.moves.length,1);assert.equal(privateHit.game.retryUsed,false);
  assert.equal((await call('move',b,{x:1,y:0,version:1})).http,400);
  sb.controller.abort();const sb2=await events(b);await sb2.wait(s=>s.players.every(p=>p?.connected));
  const reconnected=await call('sync',b);assert.equal(reconnected.game.board[0],null);assert.equal(reconnected.game.retryUsed,true);
  assert.equal((await call('move',b,{x:0,y:0})).http,400);
  const placed=await call('move',b,{x:14,y:14});assert.equal(placed.game.retryUsed,false);assert.equal(placed.game.turn,1);
  await call('move',a,{x:1,y:0});await call('move',b,{x:0,y:0});
  const second=await call('move',b,{x:1,y:0});assert.equal(second.game.turn,1);assert.equal(second.game.probe.retry,false);
  const exposed=await call('sync',b);assert.equal(exposed.game.board[1],1);assert.equal(exposed.game.board[0],null);assert.equal(exposed.game.board[2],null);
  const freshConnection=await events(b);const refreshed=await freshConnection.wait(s=>s.version===version);
  assert.equal(refreshed.game.board[1],1);assert.equal(refreshed.game.board[0],null);
  assert.equal((await call('move',b,{x:14,y:12})).http,400);
  let request=(await call('request',b,{kind:'undo'})).request;
  const undo=await call('respond',a,{id:request.id,accept:true});assert.equal(undo.game.board[0],1);assert.equal(undo.game.board[1],1);
  assert.equal(rooms.get(a.code).game.retrySpot,null);
  await call('move',b,{x:14,y:12});
  await call('move',a,{x:2,y:0});await call('move',b,{x:14,y:10});
  await call('move',a,{x:3,y:0});await call('move',b,{x:14,y:8});
  const won=await call('move',a,{x:4,y:0});assert.equal(won.game.winner,1);
  const revealed=await sb2.wait(s=>s.game.status==='finished');assert.deepEqual(revealed.game.board,won.game.board);
  const rank=await (await fetch(`${base}/api/rankings?kind=fog`)).json();assert.equal(rank.entries[0].name,'雾黑');assert.equal(rank.entries[0].wins,1);
  const standard=await (await fetch(`${base}/api/rankings?kind=gomoku`)).json();assert.equal(standard.entries.length,0);
  await call('rematch',a);const next=await call('rematch',b);assert.equal(next.game.kind,'fog');assert.equal(next.yourColor,1);assert.ok(next.game.board.every(p=>p===null));
  assert.equal((await call('scout',b,{x:7,y:7})).http,400,'black cannot scout');
  assert.equal((await call('scout',a,{x:7,y:7})).http,400,'white must wait for own turn');
  await call('move',b,{x:7,y:7});
  assert.equal((await call('scout',a,{x:7,y:7,version:version-1})).http,400);
  const scanned=await call('scout',a,{x:7,y:7});assert.equal(scanned.http,200);assert.equal(scanned.game.scoutActive,true);assert.equal(scanned.game.board[112],1);
  assert.equal((await call('sync',a)).game.scoutActive,true);
  assert.equal((await call('sync',b)).game.scoutActive,false);
  assert.equal((await call('scout',a,{x:8,y:8})).http,400);
  await call('move',a,{x:0,y:0});assert.equal((await call('sync',a)).game.board[112],null);
  assert.equal((await call('taunt',a,{x:0,y:0})).http,400,'not own turn');
  assert.equal((await call('taunt',b,{x:7,y:7,version:version-1})).http,400,'stale version');
  request=(await call('request',b,{kind:'undo'})).request;
  assert.equal((await call('taunt',b,{x:7,y:7})).http,400,'negotiation blocks taunt');
  await call('respond',a,{id:request.id,accept:false});
  const taunted=await call('taunt',b,{x:7,y:7});assert.equal(taunted.http,200);assert.equal(taunted.game.turn,1);
  const publicStone=await sa.wait(s=>s.version===version);assert.equal(publicStone.game.board[112],1);assert.equal(publicStone.game.board[111],null);
  assert.deepEqual(publicStone.game.taunted,[112]);
  const rejoined=await events(a);assert.equal((await rejoined.wait(s=>s.version===version)).game.board[112],1);
  assert.equal((await call('sync',a)).game.board[112],1);
  assert.equal((await call('taunt',b,{x:7,y:7})).http,400,'duplicate does not spend a turn');
  request=(await call('request',b,{kind:'draw'})).request;
  const draw=await call('respond',a,{id:request.id,accept:true});assert.equal(draw.game.status,'finished');assert.ok(draw.game.board.every(p=>p!==null));
  await call('rematch',a);await call('rematch',b);await call('move',a,{x:1,y:1});await call('leave',b);
  const left=await call('sync',a);assert.equal(left.game.reason,'leave');assert.ok(left.game.board.every(p=>p!==null));
  assert.equal((await fetch(`${base}/fog-rules.js`)).status,404);
  const normal=await api('create');assert.ok(normal.game.board.every(p=>p===0));
});
