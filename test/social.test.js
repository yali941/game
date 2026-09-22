import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createGameServer} from '../server.js';
import {addChat,identifyPlayer} from '../room-tools.js';
import {chooseAutoMove} from '../public/auto-play.js';
import {newGame,playMove} from '../public/game.js';
import {newJungle,jungleTargets,newFlight,rollFlight,flightOptions} from '../public/table-rules.js';

test('autoplay takes a Gomoku win, blocks immediate loss and only selects legal table moves',()=>{
  const g=newGame();for(const [x,y] of [[3,7],[0,0],[4,7],[2,0],[5,7],[4,0],[6,7],[6,0]])playMove(g,g.turn,x,y);
  const win=chooseAutoMove(g);playMove(g,g.turn,win.x,win.y);assert.equal(g.winner,1);
  const block=newGame();for(let x=3;x<7;x++)block.board[7*15+x]=2;block.board[7*15+2]=1;
  assert.deepEqual({x:chooseAutoMove(block).x,y:chooseAutoMove(block).y},{x:7,y:7});
  const j=newJungle(),m=chooseAutoMove(j);assert.ok(jungleTargets(j,m.id).some(t=>t.x===m.x&&t.y===m.y));
  const f=newFlight(4);assert.equal(chooseAutoMove(f).action,'roll');rollFlight(f,1,6);assert.ok(flightOptions(f).includes(chooseAutoMove(f).id));
});
test('chat bounds history, sanitizes control characters, and preserves public identity',()=>{
  const room={},player={};identifyPlayer(player,{id:'public-id',name:'小棋友'});
  for(let i=0;i<105;i++){player.nextChatAt=0;addChat(room,player,'消息'+i,1);}
  assert.equal(room.chat.length,100);assert.equal(room.chat[0].text,'消息5');
  assert.equal(room.chat.at(-1).playerId,'public-id');assert.throws(()=>addChat(room,player,'太快',1));
  player.nextChatAt=0;assert.equal(addChat(room,player,'  你好\n朋友  ',1).text,'你好 朋友');
  assert.throws(()=>addChat(room,player,{},1));assert.throws(()=>addChat(room,player,'x'.repeat(201),1));
});
for(const kind of ['gomoku','flight','jungle']) test(`${kind}: chat isolation and reconnect, crying reaction, authenticated autoplay and cancellation`,async t=>{
  const {server,rooms,tableRooms}=createGameServer({scoreFile:null,autoDelay:120,roll:()=>6});server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`,prefix=kind==='gomoku'?'/api/':'/api/table/',controllers=[];
  t.after(async()=>{controllers.forEach(c=>c.abort());server.closeAllConnections();await new Promise(r=>server.close(r));});
  const post=async(action,body={},token,profile)=>{const r=await fetch(base+(action==='profile'?'/api/profile':prefix+action),{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(profile?{'X-Player-Token':profile}:{})},body:JSON.stringify(body)});return {status:r.status,...await r.json()};};
  const profileA=await post('profile',{name:'红玩家'}),profileB=await post('profile',{name:'蓝玩家'});
  const a=await post('create',{kind},null,profileA.token),b=await post('join',{room:a.code,kind},null,profileB.token),other=await post('create',{kind});
  const room=(kind==='gomoku'?rooms:tableRooms).get(a.code);
  async function stream(token){const c=new AbortController();controllers.push(c);const response=await fetch(base+prefix+`events?room=${a.code}&token=${token}`,{signal:c.signal});assert.equal(response.status,200);const frames=[];
    (async()=>{let buffer='';try{for await(const chunk of response.body){buffer+=new TextDecoder().decode(chunk);let i;while((i=buffer.indexOf('\n\n'))>=0){frames.push(buffer.slice(0,i));buffer=buffer.slice(i+2);}}}catch(e){if(e.name!=='AbortError')throw e;}})();
    return {frames,c};}
  const first=await stream(a.token),second=await stream(b.token);
  const wait=async predicate=>{for(let i=0;i<120;i++){if(predicate())return;await delay(20);}assert.fail('Timed out waiting for synchronized state');};
  const text='<img src=x onerror=alert(1)> 你好😭';
  assert.equal((await post('chat',{room:a.code,text,playerId:'forged',name:'forged'},a.token)).status,200);
  await wait(()=>second.frames.some(f=>f.includes('你好😭')));
  const sync=await post('sync',{room:a.code},b.token);assert.equal(sync.chat[0].playerId,profileA.id);assert.equal(sync.chat[0].name,'红玩家');assert.equal(sync.chat[0].text,text);
  assert.equal(sync.players[0].id,profileA.id);assert.ok(!JSON.stringify(sync).includes(a.token));
  assert.equal((await post('chat',{room:a.code,text:'spam'},a.token)).status,400);
  const version=room.version,oldId=sync.players[0].id;
  const renamed=await post('profile',{name:'竹叶棋友'},null,profileA.token);
  assert.equal(renamed.id,oldId);
  await wait(()=>first.frames.some(f=>f.includes('竹叶棋友')) && second.frames.some(f=>f.includes('竹叶棋友')));
  const updated=await post('sync',{room:a.code},b.token);
  assert.equal(updated.players[0].name,'竹叶棋友');assert.equal(updated.players[0].id,oldId);
  assert.equal(updated.players[1].name,'蓝玩家');assert.equal(updated.chat[0].name,'竹叶棋友');
  assert.equal(updated.chat[0].playerId,oldId);assert.equal(updated.chat[0].text,text);assert.equal(room.version,version);
  const board=await (await fetch(`${base}/api/rankings?kind=${kind}`,{headers:{'X-Player-Token':profileA.token}})).json();
  assert.equal(board.me.name,updated.players[0].name);assert.equal(board.me.id,oldId);
  assert.equal((await post('chat',{room:a.code,text:'attack'},other.token)).status,401);
  assert.equal((await post('sync',{room:other.code},other.token)).chat.length,0);
  second.c.abort();const recovered=await stream(b.token);await wait(()=>recovered.frames.some(f=>f.includes('你好😭')));
  assert.equal((await post('reaction',{room:a.code,kind:'cry'},a.token)).status,200);
  await wait(()=>first.frames.some(f=>f.startsWith('event: reaction')&&f.includes('"cry"'))&&recovered.frames.some(f=>f.startsWith('event: reaction')&&f.includes('"cry"')));
  assert.equal((await post('auto',{room:a.code,enabled:true},other.token)).status,401);
  assert.equal((await post('auto',{room:a.code,enabled:'yes'},a.token)).status,400);
  await post('auto',{room:a.code,enabled:true,seat:2},a.token);assert.equal(room.players[0].auto,true);assert.equal(room.players[1].auto,false);
  await post('auto',{room:a.code,enabled:false},a.token);await delay(160);assert.equal(room.game.moves.length,0);
  if(kind==='gomoku') {
    await post('auto',{room:a.code,enabled:true},a.token);
    const request=await post('request',{room:a.code,kind:'draw'},b.token);
    await delay(160);assert.equal(room.game.moves.length,0,'negotiation pauses autoplay');
    await post('auto',{room:a.code,enabled:false},a.token);
    await post('cancel-request',{room:a.code,id:request.request.id},b.token);
  }
  if(kind!=='gomoku')await post('start',{room:a.code},a.token);
  await post('auto',{room:a.code,enabled:true},a.token);
  const manual=kind==='gomoku'?{x:7,y:7}:kind==='jungle'?{id:'1-1',x:6,y:5,version:room.version}:{version:room.version};
  assert.equal((await post(kind==='flight'?'roll':'move',{room:a.code,...manual},a.token)).status,400);
  await wait(()=>room.game.moves.length>=1);
  await post('auto',{room:a.code,enabled:false},a.token);const count=room.game.moves.length,rolls=room.game.rolls;
  await delay(200);assert.equal(room.game.moves.length,count);assert.equal(room.game.rolls,rolls);
  await post('auto',{room:a.code,enabled:true},b.token);recovered.c.abort();
  if(kind!=='flight')await wait(()=>room.game.moves.length>count);
  await post('auto',{room:a.code,enabled:false},b.token);
  await post('leave',{room:a.code},a.token);assert.equal((await post('chat',{room:a.code,text:'closed'},b.token)).status,400);
});
