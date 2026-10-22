import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import * as go from '../public/go-rules.js';
import {createGameServer} from '../server.js';
import {createRecords} from '../records.js';

const idx=(x,y)=>y*19+x;
function fixture(black=[],white=[],turn=1){const g=go.newGame();for(const [x,y] of black)g.board[idx(x,y)]=1;for(const [x,y] of white)g.board[idx(x,y)]=2;g.turn=turn;g.positions=[g.board.join('')];return g;}
function stone(g,x,y){go.playMove(g,g.turn,x,y);}

test('go: 19 lines, turn and bounds validation, rejected moves do not mutate',()=>{
 const g=go.newGame();assert.equal(g.board.length,361);assert.equal(g.turn,1);
 for(const args of [[2,0,0],[1,-1,0],[1,19,0],[1,0,19],[1,.1,0],[1,'0',0],[3,0,0]]){const before=JSON.stringify(g);assert.throws(()=>go.playMove(g,...args));assert.equal(JSON.stringify(g),before);}
 stone(g,3,3);assert.throws(()=>stone(g,3,3));assert.equal(g.turn,2);
});
test('go: orthogonal groups share liberties, diagonal groups do not; edges never wrap',()=>{
 const g=fixture([[0,0],[1,0],[2,1],[18,0]]);
 assert.deepEqual(new Set(go.group(g.board,0).stones),new Set([0,1]));assert.equal(go.group(g.board,0).liberties.size,3);
 assert.deepEqual(go.neighbors(0),[1,19]);assert.deepEqual(go.neighbors(18),[17,37]);assert.equal(go.group(g.board,18).stones.length,1);
});
test('go: capture connected, corner and multiple independent groups in one move',()=>{
 const corner=fixture([[1,0]],[[0,0]]);stone(corner,0,1);assert.equal(corner.board[0],0);assert.deepEqual(corner.captures,[1,0]);
 const chain=fixture([[0,1],[1,0],[2,0],[3,1],[1,2]],[[1,1],[2,1]]);stone(chain,2,2);assert.equal(chain.captures[0],2);
 const multi=fixture([[0,0],[2,0],[0,2],[2,2],[3,1]],[[1,0],[0,1],[2,1]]);stone(multi,1,1);assert.equal(multi.captures[0],3);
});
test('go: suicide is forbidden but capturing first can provide liberties',()=>{
 const g=fixture([],[[1,0],[0,1]]),before=JSON.stringify(g);assert.throws(()=>stone(g,0,0),/没有气/);assert.equal(JSON.stringify(g),before);
 const capture=fixture([[2,0],[1,1],[0,2]],[[1,0],[0,1]]);stone(capture,0,0);assert.equal(capture.captures[0],2);assert.ok(go.group(capture.board,0).liberties.size);
});
test('go: ko recapture rejected, threat and reply permit recapture, all earlier positions protected',()=>{
 const g=fixture([[0,1],[1,0],[1,2]],[[1,1],[2,0],[2,2],[3,1]]),initial=g.board.join('');
 stone(g,2,1);const before=JSON.stringify(g);assert.throws(()=>stone(g,1,1),/重复/);assert.equal(JSON.stringify(g),before);
 stone(g,10,10);stone(g,11,10);stone(g,1,1);assert.equal(g.board[idx(2,1)],0);assert.notEqual(g.board.join(''),initial);
 const repeat=go.newGame(),next=go.simulateMove(repeat,1,4,4);repeat.positions.unshift(next.position);assert.throws(()=>stone(repeat,4,4),/重复/);
});
test('go: five in a row never ends a game and passes are exempt from superko',()=>{
 const g=go.newGame();for(let n=0;n<5;n++){stone(g,n,0);stone(g,n,18);}assert.equal(g.status,'playing');
 const positions=[...g.positions];go.pass(g,1);go.pass(g,2);assert.equal(g.phase,'scoring');assert.deepEqual(g.positions,positions);assert.throws(()=>stone(g,9,9),/确认死子/);
});
test('go: marking an entire group resets both confirmations; both sides must agree',()=>{
 const g=fixture([[0,0],[1,0]],[[18,18]]);go.pass(g,1);go.pass(g,2);go.confirmScore(g,1);
 assert.throws(()=>go.confirmScore(g,1),/已确认/);assert.equal(g.status,'playing');go.toggleDead(g,2,1,0);
 assert.deepEqual(g.dead,[0,1]);assert.deepEqual(g.confirmed,[]);assert.equal(g.score.stones[0],0);assert.equal(g.board[0],1);
 go.toggleDead(g,1,0,0);assert.deepEqual(g.dead,[]);go.confirmScore(g,2);go.confirmScore(g,1);assert.equal(g.status,'finished');assert.equal(g.reason,'score');assert.throws(()=>go.toggleDead(g,1,0,0));
});
test('go: resume clears provisional scoring and preserves next turn and repetition history',()=>{
 const g=fixture([[0,0]],[[18,18]],2);go.pass(g,2);go.pass(g,1);go.toggleDead(g,1,0,0);go.confirmScore(g,2);const positions=[...g.positions];
 go.resume(g,1);assert.equal(g.turn,2);assert.equal(g.passes,0);assert.equal(g.phase,'play');assert.equal(g.score,null);assert.deepEqual(g.confirmed,[]);assert.deepEqual(g.dead,[]);assert.deepEqual(g.positions,positions);stone(g,10,10);
});
test('go: Chinese area score counts stones, territory, split neutral and 3.75 zi komi',()=>{
 const empty=go.scoreBoard(go.newGame());assert.equal(empty.neutral,361);assert.equal(empty.black,180.5);assert.equal(empty.margin,3.75);assert.equal(empty.winner,2);
 const g=fixture([[1,0],[0,1]],[[17,18],[18,17]]),s=go.scoreBoard(g);
 assert.deepEqual(s.territory,[1,1]);assert.deepEqual(s.stones,[2,2]);assert.equal(s.neutral,355);assert.equal(s.black+s.white,361);assert.equal(s.owners[0],1);assert.equal(s.owners[360],2);
 g.captures=[999,0];assert.deepEqual(go.scoreBoard(g),s);g.dead=[1,19];const dead=go.scoreBoard(g);assert.equal(dead.stones[0],0);assert.equal(dead.black+dead.white,361);
 const black=go.scoreBoard(fixture([[0,0]]));assert.equal(black.black,361);assert.equal(black.margin,176.75);assert.equal(black.winner,1);
});
test('go: undo restores captured stones, liberties, turn and repetition history by replay',()=>{
 const g=go.newGame();for(const [x,y] of [[1,0],[0,0],[8,8],[18,18]])stone(g,x,y);const before=structuredClone(g);
 stone(g,0,1);assert.equal(g.captures[0],1);assert.equal(go.undoMove(g,1),1);assert.deepEqual(g,before);
 stone(g,0,1);stone(g,17,18);assert.equal(go.undoMove(g,1),2);assert.deepEqual(g,before);
});
test('go: undo handles passes and earlier resume events',()=>{
 const g=go.newGame();stone(g,3,3);go.pass(g,2);go.pass(g,1);go.resume(g,2);const before=structuredClone(g);
 stone(g,15,15);stone(g,4,3);go.undoMove(g,2);assert.deepEqual(g,before);
 go.undoMove(g,1);assert.equal(g.phase,'play');assert.equal(g.turn,1);assert.equal(g.moves.length,2);assert.equal(g.passes,1);
});
test('go: autoplay chooses legal moves, can pass, never confirms life or death',()=>{
 const g=go.newGame(),move=go.chooseGoMove(g);assert.doesNotThrow(()=>go.playMove(g,1,move.x,move.y));
 const full=fixture();full.board.fill(1);assert.deepEqual(go.chooseGoMove(full),{action:'pass'});
 go.pass(g,2);go.pass(g,1);assert.equal(go.chooseGoMove(g),null);assert.equal('positions' in go.goSnapshot(g),false);
});

test('go: passing on an empty board does not earn a ranked victory',()=>{
 const records=createRecords({scoreFile:null}),profiles=[1,2].map(n=>records.profile({headers:{}},{name:'玩家'+n})),g=go.newGame();
 go.pass(g,1);go.pass(g,2);go.confirmScore(g,1);go.confirmScore(g,2);
 const room={round:1,game:g,players:profiles.map((p,i)=>({color:i+1,profileId:p.id}))};records.victory(room,'go',p=>p.color);assert.deepEqual(profiles.map(p=>p.wins.go),[0,0]);
});

test('go: server autoplay moves while offline and stops for manual scoring confirmation',async t=>{
 const {server,rooms}=createGameServer({scoreFile:null,autoDelay:10});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const post=async(action,data={},token)=>{const r=await fetch(base+'/api/go/'+action,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});assert.equal(r.status,200);return r.json();};
 const a=await post('create'),b=await post('join',{room:a.code}),room=rooms.get(a.code);
 await post('auto',{room:a.code,enabled:true},a.token);await post('auto',{room:a.code,enabled:true},b.token);
 for(let n=0;n<50&&!room.game.moves.length;n++)await new Promise(r=>setTimeout(r,10));assert.ok(room.game.moves.length>0);
 room.game.board.fill(1);room.game.passes=0;
 for(let n=0;n<50&&room.game.phase!=='scoring';n++)await new Promise(r=>setTimeout(r,10));
 assert.equal(room.game.phase,'scoring');assert.equal(room.game.status,'playing');assert.deepEqual(room.game.confirmed,[]);assert.ok(room.players.every(p=>!p.auto));
});

test('go: real HTTP/SSE room isolation, stale operations, scoring agreement, undo, chat, ranking and rematch',async t=>{
 const {server}=createGameServer({scoreFile:null,autoDelay:60000});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`,controllers=[];
 t.after(async()=>{controllers.forEach(c=>c.abort());server.closeAllConnections();await new Promise(r=>server.close(r));});
 const post=async(path,data={},token,profile)=>{const res=await fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(profile?{'X-Player-Token':profile}:{})},body:JSON.stringify(data)});return {http:res.status,...await res.json()};};
 const profiles=await Promise.all(['黑方','白方'].map(name=>post('profile',{name}))),a=await post('go/create',{},null,profiles[0].token),code=a.code;
 assert.equal((await post('join',{room:code})).http,400);const gomoku=await post('create');assert.equal((await post('go/join',{room:gomoku.code})).http,400);
 const b=await post('go/join',{room:code},null,profiles[1].token);assert.equal((await post('go/join',{room:code})).http,400);
 const states=[[],[]];
 for(const [n,p] of [a,b].entries()){
  const ctl=new AbortController();controllers.push(ctl);const res=await fetch(`${base}/api/go/events?room=${code}&token=${p.token}`,{signal:ctl.signal});assert.equal(res.status,200);
  const reader=res.body.getReader(),decoder=new TextDecoder();let buffer='';
  (async()=>{try{while(true){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});let end;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);if(frame.startsWith('data: '))states[n].push(JSON.parse(frame.slice(6)));}}}catch(e){if(e.name!=='AbortError')throw e;}})();
 }
 let current=await post('go/sync',{room:code},a.token);
 const action=async(path,p=a,data={})=>{const r=await post('go/'+path,{room:code,version:current.version,...data},p.token);if(r.http===200&&r.game)current=r;return r;};
 assert.equal((await post('go/move',{room:code,version:current.version,x:0,y:0},'fake')).http,401);
 assert.equal((await action('move',b,{x:0,y:0})).http,400);
 const v=current.version;assert.equal((await action('move',a,{x:0,y:0})).http,200);assert.equal((await action('move',b,{x:18,y:18,version:v})).http,400);
 assert.equal((await action('move',b,{x:18,y:18})).http,200);const req=await action('request',a,{kind:'undo'});assert.ok(req.request.id);
 assert.equal((await action('pass')).http,400);await action('respond',b,{id:req.request.id,accept:true});assert.equal(current.game.moves.length,0);
 await action('move',a,{x:0,y:0});await action('move',b,{x:18,y:18});await action('chat',a,{text:'围棋测试'});assert.equal((await action('sync')).chat.at(-1).text,'围棋测试');
 await action('pass',a);await action('pass',b);assert.equal(current.game.phase,'scoring');assert.equal((await action('auto',a,{enabled:true})).http,400);
 await action('confirm-score',a);const stale=current.version;await action('dead',b,{x:18,y:18});assert.deepEqual(current.game.confirmed,[]);
 assert.equal((await action('confirm-score',a,{version:stale})).http,400);await action('dead',b,{x:18,y:18});await action('resume',b);assert.equal(current.game.turn,1);
 await action('pass',a);await action('pass',b);await action('confirm-score',a);await action('confirm-score',b);assert.equal(current.game.status,'finished');assert.equal(current.game.winner,2);
 const ranks=await (await fetch(base+'/api/rankings?kind=go')).json();assert.equal(ranks.entries[0].name,'白方');assert.equal(ranks.entries[0].wins,1);assert.deepEqual((await (await fetch(base+'/api/rankings?kind=gomoku')).json()).entries,[]);
 assert.equal((await action('sync')).game.reason,'score');assert.equal('positions' in current.game,false);
 await action('rematch',a);await action('rematch',b);assert.equal(current.game.kind,'go');assert.equal(current.game.board.length,361);assert.equal(current.round,2);assert.equal(current.yourColor,1);assert.equal(current.game.moves.length,0);
 for(let i=0;i<30&&!states.every(s=>s.some(v=>v.round===2));i++)await new Promise(r=>setTimeout(r,10));assert.ok(states.every(s=>s.some(v=>v.round===2)));
 for(const path of ['/go','/play?game=go','/go-app.js','/go-rules.js','/go.css'])assert.equal((await fetch(base+path)).status,200);
 assert.match(await (await fetch(base+'/')).text(),/href="\/go"/);
});
