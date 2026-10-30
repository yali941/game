import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import * as rules from '../standard-rules.js';
import {createGameServer} from '../server.js';

test('optional extra move requires a choice, validates turns and ends after exactly one extra stone',()=>{
  for (const word of ['芽卫兵','小郭','起义','造反']) for (const color of [1,2]) {
    const eligible=rules.bonusColors([{name:`我是${word}123`,color},null,{}]);
    assert.deepEqual(eligible,[3-color]);
    const game=rules.newGame();game.turn=3-color;
    rules.playMove(game,3-color,7,7,eligible);assert.equal(game.bonus,'choice');
    rules.chooseBonus(game,3-color,true);rules.playMove(game,3-color,8,7,eligible);
    assert.equal(game.turn,color);assert.equal(game.bonus,null);
  }
  assert.deepEqual(rules.bonusColors([{name:'小郭起义造反芽卫兵',color:2}]),[1],'multiple matches still grant one extra');
  assert.deepEqual(rules.bonusColors([{name:'小 郭起 义造 反',color:2}]),[]);
  assert.deepEqual(rules.bonusColors([{name:'小芽卫兵123',color:2},null]),[1]);
  assert.deepEqual(rules.bonusColors([{name:'芽卫',color:2},{name:'普通',color:1}]),[]);
  assert.deepEqual(rules.bonusColors([{name:'芽卫兵',color:1},{name:'芽卫兵2',color:2}]),[2,1]);
  const g=rules.newGame();assert.throws(()=>rules.chooseBonus(g,1,true),/没有/);
  rules.playMove(g,1,7,7,[1]);assert.equal(g.turn,1);assert.equal(g.bonus,'choice');
  assert.throws(()=>rules.playMove(g,1,8,7,[1]),/先选择/);
  assert.throws(()=>rules.chooseBonus(g,2,true),/轮到/);
  assert.throws(()=>rules.chooseBonus(g,1,'yes'),/请选择/);
  rules.chooseBonus(g,1,true);assert.equal(g.bonus,'placing');
  assert.throws(()=>rules.chooseBonus(g,1,true),/没有/);
  assert.throws(()=>rules.playMove(g,1,7,7,[1]),/已经/);assert.equal(g.bonus,'placing');
  rules.playMove(g,1,8,7,[1]);assert.equal(g.moves.length,2);assert.equal(g.turn,2);assert.equal(g.bonus,null);
  assert.equal(g.moves[1].bonusMove,true);assert.throws(()=>rules.playMove(g,1,9,7,[1]),/轮到/);
  rules.playMove(g,2,0,0,[1]);assert.equal(g.turn,1);
  rules.playMove(g,1,9,7,[1]);rules.chooseBonus(g,1,false);assert.equal(g.turn,2);assert.equal(g.moves.length,4);
  assert.throws(()=>rules.chooseBonus(g,1,false),/轮到/);
});

test('undo of an extra stone restores just one extra slot; ordinary undo resets the choice',()=>{
  const g=rules.newGame();rules.playMove(g,1,7,7,[1]);rules.chooseBonus(g,1,true);rules.playMove(g,1,8,7,[1]);rules.playMove(g,2,0,0,[1]);
  assert.equal(rules.undoMove(g,1),2);assert.equal(g.board[112],1);assert.equal(g.board[113],0);assert.equal(g.board[0],0);assert.equal(g.bonus,'placing');
  rules.playMove(g,1,9,7,[1]);assert.equal(g.turn,2);assert.equal(g.bonus,null);
  rules.undoMove(g,1);rules.chooseBonus(g,1,false);assert.equal(g.turn,2);
  rules.undoMove(g,1);assert.equal(g.moves.length,0);assert.equal(g.bonus,null);
  rules.playMove(g,1,7,7,[1]);rules.chooseBonus(g,1,true);rules.chooseBonus(g,1,false);assert.equal(g.turn,2);
});

test('first or extra winning stone finishes immediately; resign and draw clear the choice',()=>{
  for(const extra of [false,true]) {
    const g=rules.newGame();for(let x=0;x<4;x++){g.board[x]=1;g.moves.push({x,y:0,color:1});}
    if(extra){rules.playMove(g,1,10,10,[1]);rules.chooseBonus(g,1,true);}
    rules.playMove(g,1,4,0,[1]);assert.equal(g.winner,1);assert.equal(g.status,'finished');assert.equal(g.bonus,null);
    assert.throws(()=>rules.chooseBonus(g,1,true),/已结束/);
  }
  for(const finish of [g=>rules.resign(g,1),rules.agreeDraw]) {const g=rules.newGame();rules.playMove(g,1,7,7,[1]);finish(g);assert.equal(g.bonus,null);}
});

async function fixture(t,options={}) {
  const {server,rooms}=createGameServer({scoreFile:null,...options});server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`,controllers=[];
  t.after(async()=>{controllers.forEach(c=>c.abort());server.closeAllConnections();await new Promise(r=>server.close(r));});
  async function api(action,data={},player,profile) {
    const response=await fetch(`${base}/api/${action}`,{method:'POST',headers:{'Content-Type':'application/json',...(player?{Authorization:`Bearer ${player.token}`} : {}),...(profile?{'X-Player-Token':profile}: {})},body:JSON.stringify(data)});
    return {http:response.status,...await response.json()};
  }
  async function connect(p){
    const c=new AbortController();controllers.push(c);const response=await fetch(`${base}/api/events?room=${p.code}&token=${p.token}`,{signal:c.signal});assert.equal(response.status,200);
    const states=[];
    (async()=>{let buffer='';const decoder=new TextDecoder();try{for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true});let i;while((i=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,i);buffer=buffer.slice(i+2);if(frame.startsWith('data: '))states.push(JSON.parse(frame.slice(6)));}}}catch(e){if(e.name!=='AbortError')throw e;}})();
    return {async wait(fn){for(let i=0;i<150;i++){const s=states.findLast(fn);if(s)return s;await new Promise(r=>setTimeout(r,10));}throw Error('SSE timeout');}};
  }
  const sync=p=>api('sync',{room:p.code},p);
  const call=async(action,p,data={})=>api(action,{room:p.code,version:(await sync(p)).version,...data},p);
  return {api,connect,sync,call,rooms,base};
}

test('online choice is authenticated, synchronized, reconnectable and versioned; undo, rematch, rename and modes stay consistent',async t=>{
  const {api,connect,sync,call,base}=await fixture(t);
  const pa=await api('profile',{name:'普通棋友'}),pb=await api('profile',{name:'小郭123'});
  const a=await api('create',{},null,pa.token),b=await api('join',{room:a.code},null,pb.token);
  const sa=await connect(a),sb=await connect(b);await sa.wait(s=>s.players.every(p=>p?.connected));
  const first=await call('move',a,{x:7,y:7});assert.equal(first.http,200);assert.equal(first.game.bonus,'choice');
  await sb.wait(s=>s.game.bonus==='choice');
  assert.equal((await call('bonus',b,{take:true})).http,400);
  assert.equal((await call('move',a,{x:8,y:7})).http,400);
  const reconnected=await connect(a);await reconnected.wait(s=>s.game.bonus==='choice');
  let request=(await call('request',a,{kind:'undo'})).request;
  assert.equal((await call('bonus',a,{take:true})).http,400,'negotiation blocks choice');
  await call('respond',b,{id:request.id,accept:false});
  assert.equal((await call('bonus',a,{take:true,version:first.version})).http,400);
  const take=await call('bonus',a,{take:true});assert.equal(take.game.bonus,'placing');
  assert.equal((await call('bonus',a,{take:true})).http,400);
  assert.equal((await call('move',b,{x:0,y:0})).http,400);
  const second=await call('move',a,{x:8,y:7});assert.equal(second.game.turn,2);assert.equal(second.game.moves.length,2);
  assert.equal((await call('move',a,{x:9,y:7,version:take.version})).http,400);
  await call('move',b,{x:0,y:0});
  request=(await call('request',a,{kind:'undo'})).request;const undo=await call('respond',b,{id:request.id,accept:true});
  assert.equal(undo.game.moves.length,1);assert.equal(undo.game.bonus,'placing');
  await call('bonus',a,{take:false});assert.equal((await sync(a)).game.turn,2);
  await call('move',b,{x:0,y:0});await call('move',a,{x:9,y:7});
  await api('profile',{name:'普通对手'},null,pb.token);
  assert.equal((await sync(a)).game.bonus,'choice','earned opportunity survives nickname change');
  await call('bonus',a,{take:false});await call('move',b,{x:1,y:0});
  const ordinary=await call('move',a,{x:10,y:7,bonus:true});assert.equal(ordinary.game.bonus,null);assert.equal(ordinary.game.turn,2);
  await api('profile',{name:'起义大王'},null,pb.token);
  await call('resign',b);await call('rematch',a);const rematch=await call('rematch',b);
  assert.equal(rematch.yourColor,1);assert.equal(rematch.game.bonus,null);
  await call('move',b,{x:0,y:0});const white=await call('move',a,{x:7,y:7});assert.equal(white.game.turn,2);assert.equal(white.game.bonus,'choice');
  assert.equal((await fetch(`${base}/standard-rules.js`)).status,404);
  const fogA=await api('create',{mode:'fog'},null,pa.token),fogB=await api('join',{room:fogA.code},null,pb.token);
  const fs=await connect(fogA);await connect(fogB);await fs.wait(s=>s.players.every(p=>p?.connected));
  const fogMove=await call('move',fogA,{x:7,y:7});assert.equal(fogMove.game.turn,2);assert.equal(fogMove.game.bonus,undefined);
  assert.equal((await call('bonus',fogA,{take:true})).http,404);
});

test('autoplay skips optional extras and does not get stuck at a pending choice',async t=>{
  const {api,connect,call}=await fixture(t,{autoDelay:10});
  const named=await api('profile',{name:'我要造反'});
  const a=await api('create'),b=await api('join',{room:a.code},null,named.token);
  const sa=await connect(a);await connect(b);await sa.wait(s=>s.players.every(p=>p?.connected));
  await call('auto',a,{enabled:true});const autoFirst=await sa.wait(s=>s.game.moves.length===1);assert.equal(autoFirst.game.turn,2);assert.equal(autoFirst.game.bonus,null);
  await call('auto',a,{enabled:false});await call('move',b,{x:0,y:0});await call('move',a,{x:14,y:14});
  await call('auto',a,{enabled:true});const skipped=await sa.wait(s=>s.game.moves.length===3 && s.game.turn===2);assert.equal(skipped.game.bonus,null);
});
