import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {newOldMaid,oldMaidDeck,oldMaidSnapshot,oldMaidTarget,actOldMaid} from '../public/oldmaid-rules.js';
import {createGameServer} from '../server.js';
import {createRecords} from '../records.js';
const rng=seed=>n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/4294967296*n);};
const total=g=>[...g.hands.flat(),...g.pairs.flat()];
test('old maid: 2–8 players conserve 53 unique cards and end with exactly one turtle',()=>{
  assert.equal(oldMaidDeck().length,53);
  for(const count of [1,9,2.5,0])assert.throws(()=>newOldMaid(count,rng(1)));
  for(let count=2;count<=8;count++)for(let seed=1;seed<=20;seed++){
    const random=rng(seed),g=newOldMaid(count,random);let turns=0;
    while(g.status==='playing'&&turns++<2000){
      assert.equal(total(g).length,53);assert.equal(new Set(total(g).map(c=>c.id)).size,53);
      for(const hand of g.hands)assert.equal(new Set(hand.map(c=>c.rank)).size,hand.length);
      assert.ok(!g.finishOrder.includes(g.turn));assert.ok(g.hands[oldMaidTarget(g)-1].length);
      actOldMaid(g,g.turn,{action:'draw',index:random(g.hands[oldMaidTarget(g)-1].length)},random);
    }
    assert.equal(g.status,'finished');assert.equal(g.pairs.length,26);assert.deepEqual(g.hands.flat(),[{id:'turtle',rank:0,suit:'🐢'}]);
    assert.equal(g.winners.length,count-1);assert.equal(g.winners.includes(g.loser),false);
  }
});
test('old maid: snapshots never expose other hands, deck, shuffle order or unpaired draw identity',()=>{
  const random=rng(21),g=newOldMaid(8,random);
  for(let n=0;n<80&&g.status==='playing';n++){
    for(let seat=1;seat<=g.count;seat++){
      const s=oldMaidSnapshot(g,seat),json=JSON.stringify(s);assert.deepEqual(s.hand,g.hands[seat-1]);
      for(const key of ['hands','deck','pairs','moves'])assert.equal(key in s,false);
      for(const card of g.hands.flatMap((h,i)=>i===seat-1?[]:h))assert.equal(json.includes(`"${card.id}"`),false);
    }
    actOldMaid(g,g.turn,{action:'draw',index:0},random);
  }
});
test('old maid: reject invalid actions without mutation; shuffle preserves cards and turn',()=>{
  const random=rng(71),g=newOldMaid(4,random),before=JSON.stringify(g);
  for(const move of [{action:'draw',index:-1},{action:'draw',index:100},{action:'draw',index:0.1},{action:'draw',index:'0'},{action:'cheat'},null])assert.throws(()=>actOldMaid(g,g.turn,move,random));
  assert.throws(()=>actOldMaid(g,oldMaidTarget(g),{action:'draw',index:0},random));assert.equal(JSON.stringify(g),before);
  const seat=oldMaidTarget(g),hand=[...g.hands[seat-1]].sort((a,b)=>a.id.localeCompare(b.id));
  actOldMaid(g,seat,{action:'shuffle'},random);assert.deepEqual([...g.hands[seat-1]].sort((a,b)=>a.id.localeCompare(b.id)),hand);assert.equal(g.turn,JSON.parse(before).turn);
});
test('old maid: pair clears both players, skips safe seats and keeps the turtle as sole loser',()=>{
  const g=newOldMaid(4,rng(3));g.hands=[[{id:'a',rank:1,suit:'♠'}],[{id:'b',rank:1,suit:'♥'}],[{id:'turtle',rank:0,suit:'🐢'}],[]];g.turn=1;g.finishOrder=[4];
  actOldMaid(g,1,{action:'draw',index:0},rng(1));assert.equal(g.status,'finished');assert.equal(g.loser,3);assert.deepEqual(new Set(g.winners),new Set([1,2,4]));assert.equal(g.last.pair.length,2);
});
test('old maid: manual order accepts only a full permutation of own cards, including off turn',()=>{
  const random=rng(51),g=newOldMaid(4,random),seat=oldMaidTarget(g),original=g.hands[seat-1].map(c=>c.id),reversed=[...original].reverse(),turn=g.turn;
  actOldMaid(g,seat,{action:'reorder',order:reversed},random);assert.deepEqual(oldMaidSnapshot(g,seat).hand.map(c=>c.id),reversed);assert.equal(g.turn,turn);
  const before=JSON.stringify(g);
  for(const order of [null,[],reversed.slice(1),[...reversed,'alien'],reversed.map(()=>reversed[0]),reversed.map((id,i)=>i===0?g.hands[turn-1][0].id:id)])assert.throws(()=>actOldMaid(g,seat,{action:'reorder',order},random));
  assert.equal(JSON.stringify(g),before);
  // Drawing without pairing must not undo the order chosen by the player.
  g.hands[turn-1]=[{id:'t1',rank:1,suit:'♠'},{id:'t2',rank:2,suit:'♠'}];g.hands[seat-1]=[{id:'t3',rank:3,suit:'♠'}];
  actOldMaid(g,turn,{action:'draw',index:0},random);assert.deepEqual(g.hands[turn-1].filter(c=>c.id!=='t3').map(c=>c.id),['t1','t2']);
});
test('old maid: award all safe players once; do not award aborted or self-play rounds',()=>{
  const records=createRecords({scoreFile:null}),profiles=Array.from({length:3},(_,i)=>records.profile({headers:{}},{name:'玩家'+i}));
  const room={round:1,players:profiles.map((p,i)=>({seat:i+1,profileId:p.id})),game:{status:'finished',winner:1,winners:[1,2],loser:3,moves:[{}]}};
  records.victory(room,'oldmaid',p=>p.seat);records.victory(room,'oldmaid',p=>p.seat);
  assert.deepEqual(profiles.map(p=>p.wins.oldmaid),[1,1,0]);
  room.round++;room.game.reason='leave';records.victory(room,'oldmaid',p=>p.seat);assert.deepEqual(profiles.map(p=>p.wins.oldmaid),[1,1,0]);
  delete room.game.reason;room.players[1].profileId=room.players[0].profileId;records.victory(room,'oldmaid',p=>p.seat);assert.deepEqual(profiles.map(p=>p.wins.oldmaid),[1,1,0]);
});
test('old maid: HTTP lobby, auth, stale moves, reconnect, finished spectators, rematch and assets',async t=>{
  const {server,tableRooms}=createGameServer({scoreFile:null,autoDelay:60000});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(action,data={},token)=>{const res=await fetch(base+'/api/table/'+action,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});return {http:res.status,...await res.json()};};
  const host=await post('create',{kind:'oldmaid'}),r=tableRooms.get(host.code),players=[host];assert.equal(host.game.status,'waiting');assert.deepEqual(host.game.hand,[]);
  await post('auto',{room:r.code,enabled:true},host.token);assert.equal((await post('start',{room:r.code},host.token)).http,400);
  for(let i=1;i<8;i++)players.push(await post('join',{kind:'oldmaid',room:r.code}));
  assert.equal((await post('join',{kind:'oldmaid',room:r.code})).http,400);
  const sink={write(){}};for(const p of r.players){p.streams.add(sink);p.auto=false;}
  assert.equal((await post('start',{room:r.code},players[1].token)).http,400);
  const started=await post('start',{room:r.code},host.token);assert.equal(started.game.status,'playing');assert.equal(started.game.handCounts.length,8);
  assert.equal((await post('join',{room:r.code,kind:'oldmaid'})).http,400);
  const actor=players[r.game.turn-1],data={room:r.code,version:r.version,move:{action:'draw',index:0}};
  assert.equal((await post('oldmaid',data,'wrong')).http,401);
  assert.equal((await post('oldmaid',{...data,version:-1},actor.token)).http,400);
  assert.equal((await post('move',data,actor.token)).http,400);
  assert.equal((await post('uno',data,actor.token)).http,400);
  const draw=await post('oldmaid',data,actor.token);assert.equal(draw.http,200);assert.equal((await post('oldmaid',data,actor.token)).http,400);
  const reconnected=await post('sync',{room:r.code},actor.token);assert.deepEqual(reconnected.game,draw.game);
  const next=players[r.game.turn-1],version=r.version;
  const order=[...r.game.hands[next.yourSeat-1]].reverse().map(c=>c.id);
  const reordered=await post('oldmaid',{room:r.code,version,move:{action:'reorder',order}},next.token);
  assert.equal(reordered.http,200);assert.deepEqual(reordered.game.hand.map(c=>c.id),order);
  assert.deepEqual((await post('sync',{room:r.code},next.token)).game.hand.map(c=>c.id),order);
  assert.equal((await post('oldmaid',{room:r.code,version,move:{action:'draw',index:0}},next.token)).http,400);
  while(r.game.status==='playing')actOldMaid(r.game,r.game.turn,{action:'draw',index:Math.floor(Math.random()*r.game.hands[oldMaidTarget(r.game)-1].length)},rng(r.game.moves.length));
  for(const p of players)assert.equal((await post('rematch',{room:r.code},p.token)).http,200);
  assert.equal(r.round,2);assert.equal(r.game.count,8);assert.equal(r.game.status,'playing');
  // A safe spectator's dropped connection must not block the remaining players.
  r.game.hands[0]=[];r.game.finishOrder=[1];r.players[0].streams.clear();r.game.turn=2;
  assert.equal((await post('oldmaid',{room:r.code,version:r.version,move:{action:'draw',index:0}},players[1].token)).http,200);
  for(const path of ['/play?game=oldmaid','/oldmaid-app.js','/oldmaid.css','/oldmaid-rules.js','/api/rankings?kind=oldmaid'])assert.equal((await fetch(base+path)).status,200);
  assert.match(await (await fetch(base+'/')).text(),/play\?game=oldmaid/);
});
test('old maid: server autoplay makes progress without connected players or manual turn timers',async t=>{
  const {server,tableRooms}=createGameServer({scoreFile:null,autoDelay:10});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(action,data={},token)=>{const res=await fetch(base+'/api/table/'+action,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});assert.equal(res.status,200);return res.json();};
  const a=await post('create',{kind:'oldmaid'}),b=await post('join',{kind:'oldmaid',room:a.code}),r=tableRooms.get(a.code);
  for(const p of [a,b])await post('auto',{room:a.code,enabled:true},p.token);
  await post('start',{room:a.code},a.token);
  for(let n=0;n<100&&r.game.status==='playing';n++)await new Promise(resolve=>setTimeout(resolve,15));
  assert.ok(r.game.moves.length>0);assert.equal(r.game.status,'finished');assert.equal(r.game.hands.flat().length,1);
});
