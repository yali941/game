import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomBytes,createHash} from 'node:crypto';
import * as rules from '../standard-rules.js';
import {createGameServer} from '../server.js';

test('optional extra move requires a choice and explicit end after at most two stones',()=>{
  for (const color of [1,2]) {
    const eligible=[3-color];
    assert.deepEqual(eligible,[3-color]);
    const game=rules.newGame();game.turn=3-color;
    rules.playMove(game,3-color,7,7,eligible);assert.equal(game.bonus,'choice');
    rules.chooseBonus(game,3-color,true);rules.playMove(game,3-color,8,7,eligible);
    assert.equal(game.bonus,'confirm');assert.equal(game.turn,3-color);
    assert.equal(rules.standardSnapshot(game,color).moves.length,0);
    rules.chooseBonus(game,3-color,false);
    assert.equal(game.turn,color);assert.equal(game.bonus,null);
    const skipped=rules.newGame();skipped.turn=3-color;
    rules.playMove(skipped,3-color,7,7,eligible);rules.chooseBonus(skipped,3-color,false);
    assert.equal(skipped.turn,color);assert.equal(skipped.moves.length,1);assert.equal(skipped.bonus,null);
  }
  const g=rules.newGame();assert.throws(()=>rules.chooseBonus(g,1,true),/没有/);
  rules.playMove(g,1,7,7,[1]);assert.equal(g.turn,1);assert.equal(g.bonus,'choice');
  assert.throws(()=>rules.playMove(g,1,8,7,[1]),/先选择/);
  assert.throws(()=>rules.chooseBonus(g,2,true),/轮到/);
  assert.throws(()=>rules.chooseBonus(g,1,'yes'),/请选择/);
  rules.chooseBonus(g,1,true);assert.equal(g.bonus,'placing');
  assert.throws(()=>rules.chooseBonus(g,1,true),/没有/);
  assert.throws(()=>rules.playMove(g,1,7,7,[1]),/已经/);assert.equal(g.bonus,'placing');
  rules.playMove(g,1,8,7,[1]);assert.equal(g.bonus,'confirm');
  assert.throws(()=>rules.playMove(g,1,9,7,[1]),/结束回合/);
  rules.chooseBonus(g,1,false);assert.equal(g.moves.length,2);assert.equal(g.turn,2);assert.equal(g.bonus,null);
  assert.equal(g.moves[1].bonusMove,true);assert.throws(()=>rules.playMove(g,1,9,7,[1]),/轮到/);
  rules.playMove(g,2,0,0,[1]);assert.equal(g.turn,1);
  rules.playMove(g,1,9,7,[1]);rules.chooseBonus(g,1,false);assert.equal(g.turn,2);assert.equal(g.moves.length,4);
  assert.throws(()=>rules.chooseBonus(g,1,false),/轮到/);
});

test('undo of an extra stone restores just one extra slot; ordinary undo resets the choice',()=>{
  const g=rules.newGame();rules.playMove(g,1,7,7,[1]);rules.chooseBonus(g,1,true);rules.playMove(g,1,8,7,[1]);rules.chooseBonus(g,1,false);rules.playMove(g,2,0,0,[1]);
  assert.equal(rules.undoMove(g,1),2);assert.equal(g.board[112],1);assert.equal(g.board[113],0);assert.equal(g.board[0],0);assert.equal(g.bonus,'placing');
  rules.playMove(g,1,9,7,[1]);rules.chooseBonus(g,1,false);assert.equal(g.turn,2);assert.equal(g.bonus,null);
  rules.undoMove(g,1);rules.chooseBonus(g,1,false);assert.equal(g.turn,2);
  rules.undoMove(g,1);assert.equal(g.moves.length,0);assert.equal(g.bonus,null);
  rules.playMove(g,1,7,7,[1]);rules.chooseBonus(g,1,true);rules.chooseBonus(g,1,false);assert.equal(g.turn,2);
});

test('winning stones wait for explicit end; resign and draw discard unpublished stones',()=>{
  for(const extra of [false,true]) {
    const g=rules.newGame();for(let x=0;x<4;x++){g.board[x]=1;g.moves.push({x,y:0,color:1});}
    if(extra){rules.playMove(g,1,10,10,[1]);rules.chooseBonus(g,1,true);}
    rules.playMove(g,1,4,0,[1]);assert.equal(g.status,'playing');assert.equal(g.bonus,'confirm');
    assert.equal(rules.standardSnapshot(g,2).board[4],0);assert.equal(rules.standardSnapshot(g,2).winner,0);
    assert.throws(()=>rules.chooseBonus(g,1,true),/没有/);
    rules.chooseBonus(g,1,false);assert.equal(g.winner,1);assert.equal(g.status,'finished');assert.equal(g.bonus,null);
    assert.throws(()=>rules.chooseBonus(g,1,true),/已结束/);
  }
  for(const finish of [g=>rules.resign(g,1),rules.agreeDraw]) {const g=rules.newGame();rules.playMove(g,1,7,7,[1]);finish(g);assert.equal(g.bonus,null);assert.equal(g.moves.length,0);assert.equal(g.board[112],0);}
});

async function fixture(t,options={}) {
  const key=randomBytes(32).toString('base64url'),ownerKeyHash=createHash('sha256').update(key).digest('hex'),cookies=new Map();
  const {server,rooms}=createGameServer({scoreFile:null,ownerKeyHash,ownerSecureCookie:false,...options});server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`,controllers=[];
  t.after(async()=>{controllers.forEach(c=>c.abort());server.closeAllConnections();await new Promise(r=>server.close(r));});
  async function api(action,data={},player,profile) {
    const response=await fetch(`${base}/api/${action}`,{method:'POST',headers:{'Content-Type':'application/json',...(cookies.has(player?.token)?{Cookie:cookies.get(player.token)}:{}),...(player?{Authorization:`Bearer ${player.token}`} : {}),...(profile?{'X-Player-Token':profile}: {})},body:JSON.stringify(data)});
    return {http:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0],...await response.json()};
  }
  async function connect(p){
    const c=new AbortController();controllers.push(c);const response=await fetch(`${base}/api/events?room=${p.code}&token=${p.token}`,{signal:c.signal});assert.equal(response.status,200);
    const states=[];
    (async()=>{let buffer='';const decoder=new TextDecoder();try{for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true});let i;while((i=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,i);buffer=buffer.slice(i+2);if(frame.startsWith('data: '))states.push(JSON.parse(frame.slice(6)));}}}catch(e){if(e.name!=='AbortError')throw e;}})();
    return {async wait(fn){for(let i=0;i<150;i++){const s=states.findLast(fn);if(s)return s;await new Promise(r=>setTimeout(r,10));}throw Error('SSE timeout');}};
  }
  const sync=p=>api('sync',{room:p.code},p);
  const call=async(action,p,data={})=>api(action,{room:p.code,version:(await sync(p)).version,...data},p);
  async function arm(p,profile) {
    const login=await api('owner/login',{key},null,profile.token);assert.equal(login.http,200);cookies.set(p.token,login.cookie);
    const result=await api('owner/action',{game:'gomoku',room:p.code,version:(await sync(p)).version,op:'extra',enabled:true},p,profile.token);assert.equal(result.http,200);
  }
  return {api,connect,sync,call,rooms,base,arm};
}

test('draft snapshots hide stones, counters and results until end, including SSE reload and a winning move',async t=>{
  const {api,connect,sync,call,rooms,base,arm}=await fixture(t);
  const pa=await api('profile',{name:'公开测试'}),pb=await api('profile',{name:'测试2202'});
  const a=await api('create',{},null,pa.token),b=await api('join',{room:a.code},null,pb.token);
  const sa=await connect(a);await connect(b);await sa.wait(s=>s.players.every(p=>p?.connected));
  const hidden=async count=>{
    const s=await sync(b);
    assert.equal(s.game.moves.length,count);assert.equal(s.game.bonus,null);assert.equal(s.game.pendingTurn,undefined);
    assert.equal(s.game.winner,0);assert.deepEqual(s.game.line,[]);assert.equal(s.game.status,'playing');
    return s;
  };
  await arm(a,pa);await call('move',a,{x:7,y:7});assert.equal((await hidden(0)).game.board[112],0);
  const draw=await call('request',a,{kind:'draw'});assert.equal((await sync(b)).request.moveCount,0);
  await call('respond',b,{id:draw.request.id,accept:false});
  const end=await call('bonus',a,{take:false});assert.equal(end.game.turn,2);assert.equal((await sync(b)).game.moves.length,1);
  assert.equal((await call('bonus',a,{take:false,version:end.version-1})).http,400);
  await call('move',b,{x:0,y:0});
  const g=rooms.get(a.code).game;
  // A legal position one stone away from a win, with published stones only.
  for(let x=1;x<=4;x++){g.board[2*15+x]=1;g.moves.push({x,y:2,color:1});}
  const publishedCount=g.moves.length;
  await arm(a,pa);await call('move',a,{x:5,y:2});const own=await sync(a);
  assert.equal(own.game.bonus,'confirm');assert.equal(own.game.board[35],1);
  assert.equal((await hidden(publishedCount)).game.board[35],0);
  const reconnect=await connect(b);await reconnect.wait(s=>s.version===own.version && s.game.board[35]===0);
  let ranks=await (await fetch(`${base}/api/rankings?kind=gomoku`)).json();assert.equal(ranks.entries.length,0);
  assert.equal((await call('move',a,{x:6,y:2})).http,400);
  await call('bonus',a,{take:false});const won=await sync(b);
  assert.equal(won.game.status,'finished');assert.equal(won.game.winner,1);assert.equal(won.game.board[35],1);assert.equal(won.game.moves.length,publishedCount+1);
  ranks=await (await fetch(`${base}/api/rankings?kind=gomoku`)).json();assert.equal(ranks.entries[0].wins,1);
});

test('ordinary moves publish immediately and snapshots never mutate the authoritative board',()=>{
  const g=rules.newGame();rules.playMove(g,1,7,7,[]);
  assert.equal(rules.standardSnapshot(g,2).board[112],1);assert.equal(g.turn,2);
  rules.playMove(g,2,8,8,[2]);const view=rules.standardSnapshot(g,1);
  assert.equal(view.board[128],0);assert.equal(view.moves.length,1);assert.equal(g.board[128],2);assert.equal(g.moves.length,2);
  assert.throws(()=>rules.undoMove(g,1),/回合结束/);
  rules.resign(g,2);assert.equal(g.board[128],0);assert.equal(g.board[112],1);assert.equal(g.moves.length,1);
});

test('online choice is authenticated, synchronized, reconnectable and versioned; undo, rematch, rename and modes stay consistent',async t=>{
  const {api,connect,sync,call,base,arm}=await fixture(t);
  const pa=await api('profile',{name:'普通棋友'}),pb=await api('profile',{name:'小郭123'});
  const a=await api('create',{},null,pa.token),b=await api('join',{room:a.code},null,pb.token);
  const sa=await connect(a),sb=await connect(b);await sa.wait(s=>s.players.every(p=>p?.connected));
  await arm(a,pa);const first=await call('move',a,{x:7,y:7});assert.equal(first.http,200);assert.equal(first.game.bonus,'choice');
  const hiddenFirst=await sb.wait(s=>s.version===first.version);assert.equal(hiddenFirst.game.bonus,null);assert.equal(hiddenFirst.game.moves.length,0);assert.equal(hiddenFirst.game.board[112],0);assert.equal(hiddenFirst.game.pendingTurn,undefined);
  assert.equal((await call('bonus',b,{take:true})).http,400);
  assert.equal((await call('move',a,{x:8,y:7})).http,400);
  const reconnected=await connect(a);await reconnected.wait(s=>s.game.bonus==='choice');
  assert.equal((await call('request',a,{kind:'undo'})).http,400);
  let request=(await call('request',a,{kind:'draw'})).request;
  assert.equal((await call('bonus',a,{take:true})).http,400,'negotiation blocks choice');
  await call('respond',b,{id:request.id,accept:false});
  assert.equal((await call('bonus',a,{take:true,version:first.version})).http,400);
  const take=await call('bonus',a,{take:true});assert.equal(take.game.bonus,'placing');
  assert.equal((await call('bonus',a,{take:true})).http,400);
  assert.equal((await call('move',b,{x:0,y:0})).http,400);
  const second=await call('move',a,{x:8,y:7});assert.equal(second.game.turn,1);assert.equal(second.game.bonus,'confirm');assert.equal(second.game.moves.length,2);
  const hiddenSecond=await sync(b);assert.equal(hiddenSecond.game.moves.length,0);assert.equal(hiddenSecond.game.board[113],0);
  const guestReload=await connect(b);await guestReload.wait(s=>s.version===second.version && s.game.moves.length===0);
  assert.equal((await call('auto',a,{enabled:true})).http,400);
  assert.equal((await call('move',b,{x:0,y:0})).http,400);
  await call('bonus',a,{take:false});
  const published=await sb.wait(s=>s.game.moves.length===2);assert.equal(published.game.turn,2);assert.equal(published.game.board[112],1);assert.equal(published.game.board[113],1);
  assert.equal((await call('move',a,{x:9,y:7,version:take.version})).http,400);
  await call('move',b,{x:0,y:0});
  request=(await call('request',a,{kind:'undo'})).request;const undo=await call('respond',b,{id:request.id,accept:true});
  assert.equal(undo.game.moves.length,1);assert.equal(undo.game.bonus,null);assert.equal((await sync(a)).game.bonus,'placing');
  await call('bonus',a,{take:false});assert.equal((await sync(a)).game.turn,2);
  await call('move',b,{x:0,y:0});await arm(a,pa);await call('move',a,{x:9,y:7});
  await api('profile',{name:'普通对手'},null,pb.token);
  assert.equal((await sync(a)).game.bonus,'choice','earned opportunity survives nickname change');
  await call('bonus',a,{take:false});await call('move',b,{x:1,y:0});
  const ordinary=await call('move',a,{x:10,y:7,bonus:true});assert.equal(ordinary.game.bonus,null);assert.equal(ordinary.game.turn,2);
  await api('profile',{name:'起义大王'},null,pb.token);
  await call('resign',b);await call('rematch',a);const rematch=await call('rematch',b);
  assert.equal(rematch.yourColor,1);assert.equal(rematch.game.bonus,null);
  await call('move',b,{x:0,y:0});await arm(a,pa);const white=await call('move',a,{x:7,y:7});assert.equal(white.game.turn,2);assert.equal(white.game.bonus,'choice');
  assert.equal((await fetch(`${base}/standard-rules.js`)).status,404);
  const fogA=await api('create',{mode:'fog'},null,pa.token),fogB=await api('join',{room:fogA.code},null,pb.token);
  const fs=await connect(fogA);await connect(fogB);await fs.wait(s=>s.players.every(p=>p?.connected));
  const fogMove=await call('move',fogA,{x:7,y:7});assert.equal(fogMove.game.turn,2);assert.equal(fogMove.game.bonus,undefined);
  assert.equal((await call('bonus',fogA,{take:true})).http,404);
});

test('autoplay commits its own moves but cannot reveal a manually pending turn',async t=>{
  const {api,connect,call,arm}=await fixture(t,{autoDelay:10});
  const named=await api('profile',{name:'我要造反'});
  const pa=await api('profile',{name:'托管测试'});
  const a=await api('create',{},null,pa.token),b=await api('join',{room:a.code},null,named.token);
  const sa=await connect(a);await connect(b);await sa.wait(s=>s.players.every(p=>p?.connected));
  await call('auto',a,{enabled:true});const autoFirst=await sa.wait(s=>s.game.moves.length===1);assert.equal(autoFirst.game.turn,2);assert.equal(autoFirst.game.bonus,null);
  await call('auto',a,{enabled:false});await call('move',b,{x:0,y:0});await arm(a,pa);await call('move',a,{x:14,y:14});
  assert.equal((await call('auto',a,{enabled:true})).http,400);await call('bonus',a,{take:false});const skipped=await sa.wait(s=>s.game.moves.length===3 && s.game.turn===2);assert.equal(skipped.game.bonus,null);
});

 test('former nickname keywords never grant extra turns, including renamed players and forged payloads',async t=>{
  const {api,connect,call,sync}=await fixture(t);
  const pa=await api('profile',{name:'普通'}),pb=await api('profile',{name:'芽卫兵'});
  const a=await api('create',{},null,pa.token),b=await api('join',{room:a.code},null,pb.token);
  const sa=await connect(a);await connect(b);await sa.wait(s=>s.players.every(p=>p?.connected));
  let i=0;
  for(const word of ['芽卫兵','小郭','起义','造反','大王','9261','2202']) {
    await api('profile',{name:'我是'+word+'123'},null,pb.token);
    const before=(await sync(a)).version;
    await api('profile',{name:word},null,pa.token);assert.equal((await sync(a)).version,before);
    const x=(i*2)%15,y=Math.floor(i*2/15)*3;
    let s=await call('move',a,{x,y,bonus:true,eligible:[1]});assert.equal(s.http,200);assert.equal(s.game.turn,2);assert.equal(s.game.bonus,null);
    assert.equal((await sync(b)).game.board[y*15+x],1);
    s=await call('move',b,{x,y:14-y});assert.equal(s.http,200);assert.equal(s.game.turn,1);assert.equal(s.game.bonus,null);i++;
  }
});
