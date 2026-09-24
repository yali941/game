import test from 'node:test';
import assert from 'node:assert/strict';
import {randomInt} from 'node:crypto';
import {once} from 'node:events';
import {newUno,unoDeck,unoCanPlay,actUno,tickUno,unoSnapshot,unoSeatPositions,chooseUnoMove} from '../public/uno-rules.js';
import {createGameServer} from '../server.js';
let serial=0;
const card=(value,color='red')=>({id:'test'+(++serial),value,color});
const rng=n=>n-1;
function game(count=4) {return {...newUno(count,rng),hands:Array.from({length:count},()=>[card('9','blue')]),deck:Array.from({length:60},()=>card('8','green')),discard:[card('5')],top:card('5'),turn:1,color:'red',pending:null,bombs:[],moves:[]};}
function give(g,seat,value,color='red') {const c=card(value,color);g.hands[seat-1].unshift(c);return c;}
function play(g,seat,c,color='green',random=rng) {actUno(g,seat,{action:'play',id:c.id,color},random,0);}
function total(g) {return [...g.hands.flat(),...g.deck,...g.discard,...g.bombs.map(b=>b.card)];}
test('party deck, opening deal and privacy: no crossbow, arrows or classic +4',()=>{
  const deck=unoDeck();assert.equal(deck.length,120);assert.equal(new Set(deck.map(c=>c.id)).size,120);
  assert.equal(deck.some(c=>['crossbow','arrow','wild4'].includes(c.value)),false);
  for(let count=2;count<=4;count++) {const g=newUno(count,randomInt);assert.deepEqual(g.hands.map(h=>h.length),Array(count).fill(7));assert.match(g.top.value,/^\d$/);assert.equal(total(g).length,120);
    for(let seat=1;seat<=count;seat++){const s=unoSnapshot(g,seat);assert.deepEqual(s.hand,g.hands[seat-1]);assert.equal('hands' in s,false);assert.equal('deck' in s,false);assert.equal('discard' in s,false);assert.equal('resume' in s,false);for(const c of g.hands.flatMap((h,i)=>i===seat-1?[]:h))assert.equal(JSON.stringify(s).includes('"'+c.id+'"'),false);}}
});
test('view rotation keeps every viewer bottom and same physical direction',()=>{
  for(let count=2;count<=4;count++)for(let viewer=1;viewer<=count;viewer++){const seats=unoSeatPositions(count,viewer);assert.equal(seats[viewer-1].position,'bottom');assert.equal(new Set(seats.map(s=>s.position)).size,count);const slots=['bottom','left','top','right'];for(let i=0;i<count;i++){const a=slots.indexOf(seats[i].position),b=slots.indexOf(seats[(i+1)%count].position);assert.ok((b-a+4)%4>0);}}
});
test('illegal cards, foreign cards, wrong turn and invalid color never mutate game',()=>{
  const g=game();const before=JSON.stringify(g);assert.throws(()=>actUno(g,2,{action:'draw'},rng));assert.throws(()=>play(g,1,g.hands[1][0]));assert.throws(()=>play(g,1,g.hands[0][0]));assert.equal(JSON.stringify(g),before);
  const wild=give(g,1,'taser','wild'),next=JSON.stringify(g);assert.throws(()=>play(g,1,wild,'purple'));assert.equal(JSON.stringify(g),next);
});
test('matching color or symbol, reverse direction and two-player reverse extra turn',()=>{
  let g=game();const c=give(g,1,'5','blue');assert.ok(unoCanPlay(g,1,c));play(g,1,c);assert.equal(g.color,'blue');assert.equal(g.turn,2);
  g=game();play(g,1,give(g,1,'reverse'));assert.equal(g.direction,-1);assert.equal(g.turn,4);
  g=game(2);play(g,1,give(g,1,'reverse'));assert.equal(g.direction,-1);assert.equal(g.turn,1);
});
test('cross-color shovel stack and potion preserve accumulated penalty',()=>{
  const g=game();const a=give(g,1,'draw2'),b=give(g,2,'draw2','blue'),p=give(g,3,'potion','wild');play(g,1,a);assert.equal(g.pending.amount,2);assert.equal(unoCanPlay(g,2,give(g,2,'taser','wild')),false);play(g,2,b);assert.equal(g.pending.amount,4);play(g,3,p);assert.equal(g.turn,4);assert.equal(g.pending.amount,4);const n=g.hands[3].length;actUno(g,4,{action:'take-penalty'},rng);assert.equal(g.hands[3].length,n+4);assert.equal(g.turn,1);assert.equal(g.pending,null);
});
test('freeze is skipped immediately without defense, or transferred with potion',()=>{
  let g=game();play(g,1,give(g,1,'skip'));assert.equal(g.turn,3);assert.equal(g.pending,null);
  g=game();const p=give(g,2,'potion','wild');play(g,1,give(g,1,'skip'));assert.equal(g.turn,2);assert.equal(g.pending.type,'skip');play(g,2,p);assert.equal(g.turn,4);
});
test('taser draws until its chosen color or wild and cannot be changed by potion',()=>{
  const g=game();const p=give(g,2,'potion','wild');play(g,1,give(g,1,'taser','wild'),'yellow');play(g,2,p,'blue');assert.equal(g.pending.color,'yellow');g.deck=[card('2','yellow'),card('8','red'),card('9','blue')];const n=g.hands[2].length;actUno(g,3,{action:'take-penalty'},rng);assert.equal(g.hands[2].length,n+3);assert.equal(g.turn,4);
  g.turn=1;play(g,1,give(g,1,'taser','wild'),'red');g.deck=[card('egg','wild')];const before=g.hands[1].length;actUno(g,2,{action:'take-penalty'},rng);assert.equal(g.hands[1].length,before+1);
});
test('banana is hidden in deck, gives three extra cards, never stays armed in hand',()=>{
  const g=game(),c=give(g,1,'banana','wild');play(g,1,c,'green');assert.equal(g.deck.at(-1).id,c.id);assert.equal(g.discard.some(x=>x.id===c.id),false);const n=g.hands[1].length;actUno(g,2,{action:'draw'},rng);assert.equal(g.hands[1].length,n+3);assert.equal(g.hands.flat().some(c=>c.armed),false);assert.equal(g.discard.find(x=>x.id===c.id).armed,undefined);
});
test('drawn card may be played or kept; other cards cannot be played after drawing',()=>{
  let g=game(),c=card('1');g.deck=[c];actUno(g,1,{action:'draw'},rng);assert.equal(g.phase,'drawn');assert.equal(unoCanPlay(g,1,give(g,1,'5')),false);play(g,1,c);assert.equal(g.turn,2);
  g=game();g.deck=[card('1')];actUno(g,1,{action:'draw'},rng);actUno(g,1,{action:'pass'},rng);assert.equal(g.turn,2);assert.equal(g.phase,'play');
});
test('egg resolves each supported outcome without adding banned cards',()=>{
  for(let i=0;i<17;i++){const g=game();play(g,1,give(g,1,'egg','wild'),'blue',n=>i%n);assert.ok(!['arrow','crossbow','egg'].includes(g.last.effect));assert.equal(g.last.card.value,'egg');assert.equal(g.color,'blue');assert.equal(total(g).filter(c=>c.value==='egg').length,1);}
});
test('bomb expires on server clock, adds four and preserves the interrupted turn',()=>{
  const g=game();play(g,1,give(g,1,'bomb','wild'));assert.equal(g.bombs.length,1);assert.equal(tickUno(g,rng,19999),false);const seat=g.turn,n=g.hands[seat-1].length;assert.equal(tickUno(g,rng,35001),true);assert.equal(g.bombs.length,0);assert.equal(g.hands[seat-1].length,n+4);assert.equal(g.turn,seat);assert.equal(g.pending,null);
});
test('bomb can be passed by potion and restores a suspended shovel stack',()=>{
  const g=game();play(g,1,give(g,1,'bomb','wild'));const potion=give(g,3,'potion','wild');play(g,2,give(g,2,'draw2','green'));assert.equal(g.turn,3);tickUno(g,rng,40000);assert.equal(g.pending.type,'bomb');play(g,3,potion,'red');assert.equal(g.turn,4);const n=g.hands[3].length;actUno(g,4,{action:'take-penalty'},rng);assert.equal(g.hands[3].length,n+4);assert.equal(g.turn,3);assert.equal(g.pending.type,'draw2');assert.equal(g.pending.amount,2);
});
test('winning last action ends immediately; no future bombs or moves can change result',()=>{
  const g=game();g.hands[0]=[card('draw2')];play(g,1,g.hands[0][0]);assert.equal(g.status,'finished');assert.equal(g.winner,1);assert.equal(g.pending,null);const before=JSON.stringify(g);assert.equal(tickUno(g,rng,1e12),false);assert.throws(()=>actUno(g,2,{action:'draw'},rng));assert.equal(JSON.stringify(g),before);
});
test('autoplay completes 60 seeded games, conserving unique physical cards after every action',()=>{
  for(let seed=1;seed<=60;seed++){let state=seed;const random=n=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state%n;};const g=newUno(2+seed%3,random);for(let n=0;n<4000&&g.status==='playing';n++){tickUno(g,random,n*1100);if(g.status==='playing')actUno(g,g.turn,chooseUnoMove(g),random,n*1100);const cards=total(g);assert.equal(cards.length,120,`seed ${seed} turn ${n}`);assert.equal(new Set(cards.map(c=>c.id)).size,120);assert.ok(g.turn>=1&&g.turn<=g.count);assert.ok(g.hands.every(h=>!h.some(c=>c.armed)));}assert.equal(g.status,'finished',`seed ${seed} stuck`);assert.ok(g.winner);}
});
test('real UNO API isolates private hands over HTTP/SSE and supports auth, sync, chat, auto, victory, rematch',async t=>{
  const {server,tableRooms}=createGameServer({scoreFile:null,autoDelay:20});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`,controllers=[];
  t.after(async()=>{controllers.forEach(c=>c.abort());server.closeAllConnections();await new Promise(r=>server.close(r));});
  const post=async(path,body={},token,profile)=>{const res=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...(profile?{'X-Player-Token':profile}:{})},body:JSON.stringify(body)});return {http:res.status,...await res.json()};};
  const profiles=[];for(let i=1;i<=4;i++)profiles.push(await post('/api/profile',{name:`牌友${i}`}));
  const players=[await post('/api/table/create',{kind:'uno',count:4},null,profiles[0].token)],h=players[0];
  for(let i=1;i<4;i++)players.push(await post('/api/table/join',{kind:'uno',room:h.code},null,profiles[i].token));
  const r=tableRooms.get(h.code),call=(action,data={},seat=1,version=r.version)=>post('/api/table/'+action,{room:h.code,version,...data},players[seat-1].token);
  const states=Array.from({length:4},()=>[]);
  for(let i=0;i<4;i++){const ctrl=new AbortController();controllers.push(ctrl);const res=await fetch(`${base}/api/table/events?room=${h.code}&token=${players[i].token}`,{signal:ctrl.signal});assert.equal(res.status,200);(async()=>{let buffer='';try{for await(const chunk of res.body){buffer+=new TextDecoder().decode(chunk);let split;while((split=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,split);buffer=buffer.slice(split+2);if(frame.startsWith('data: '))states[i].push(JSON.parse(frame.slice(6)));}}}catch{}})();}
  assert.equal((await call('start')).http,200);
  for(let i=0;i<4;i++){const s=await call('sync',{},i+1);assert.deepEqual(s.game.hand,r.game.hands[i]);assert.equal(s.game.hands,undefined);assert.equal(s.game.deck,undefined);assert.equal(s.players[0].token,undefined);}
  assert.equal((await post('/api/table/uno',{room:h.code,version:r.version,move:{action:'draw'}},'bad')).http,401);
  assert.equal((await call('uno',{move:{action:'draw'}},2)).http,400);
  assert.equal((await call('uno',{move:{action:'play',id:r.game.hands[1][0].id}},1)).http,400);
  assert.equal((await call('chat',{text:'你好，牌友'},2)).http,200);
  assert.equal((await call('sync')).chat[0].name,'牌友2');
  r.game=game(4);r.game.hands[0]=[card('5'),card('8','red')];const c=r.game.hands[0][0],v=r.version;
  assert.equal((await call('uno',{move:{action:'play',id:c.id}})).http,200);assert.equal((await call('uno',{move:{action:'draw'}},2,v)).http,400);
  await new Promise(resolve=>setTimeout(resolve,30));for(let i=0;i<4;i++){const s=states[i].at(-1);assert.equal(s.game.hands,undefined);assert.equal(s.game.deck,undefined);assert.deepEqual(s.game.hand,r.game.hands[i]);}
  r.game.turn=1;assert.equal((await call('auto',{enabled:true})).http,200);assert.equal((await call('uno',{move:{action:'draw'}})).http,400);
  for(let i=0;i<50&&r.game.status!=='finished';i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(r.game.winner,1);
  const board=await (await fetch(base+'/api/rankings?kind=uno')).json();assert.equal(board.entries[0].name,'牌友1');assert.equal(board.entries[0].wins,1);
  for(let i=1;i<=4;i++)assert.equal((await call('rematch',{},i)).http,200);assert.equal(r.round,2);assert.equal(r.game.turn,2);assert.equal(r.game.moves.length,0);assert.ok(r.players.every(p=>!p.auto));
  controllers[3].abort();await new Promise(resolve=>setTimeout(resolve,30));assert.equal((await call('uno',{move:{action:'draw'}},2)).http,400);const before=await call('sync',{},4);assert.equal(before.game.hand.length,7);
  const ctrl=new AbortController();controllers.push(ctrl);const re=await fetch(`${base}/api/table/events?room=${h.code}&token=${players[3].token}`,{signal:ctrl.signal});assert.equal(re.status,200);re.body.cancel();
  for(const path of ['/play?game=uno','/uno-app.js','/uno-rules.js','/uno.css'])assert.equal((await fetch(base+path)).status,200);
  assert.equal((await call('leave',{},3)).http,200);assert.equal(r.closed,true);assert.equal(r.game.winner,0);
});
