import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {once} from 'node:events';
import {createGameServer} from '../server.js';
import {createOwnerAccess} from '../owner-access.js';

test('owner key fails closed, cookie is private, expiry and replacement revoke previous login',()=>{
  const key=randomBytes(32).toString('base64url'),ownerKeyHash=createHash('sha256').update(key).digest('hex');let now=1000,cookie;
  const req={headers:{},socket:{remoteAddress:'unit'}},res={setHeader:(k,v)=>cookie=v},profile={id:'one'},p={profileId:'one'};
  assert.throws(()=>createOwnerAccess().login(req,res,key,profile));
  const owner=createOwnerAccess({ownerKeyHash,ownerSecureCookie:true,ownerNow:()=>now});
  assert.throws(()=>owner.login(req,res,'wrong',profile));owner.login(req,res,key,profile);
  assert.match(cookie,/HttpOnly; SameSite=Strict/);assert.match(cookie,/; Secure/);const first={...req,headers:{cookie}};
  assert.equal(owner.authorized(first,p),true);assert.equal(owner.authorized(first,{profileId:'other'}),false);
  owner.login(req,res,key,profile);assert.equal(owner.authorized(first,p),false);
  const second={...req,headers:{cookie}};assert.equal(owner.authorized(second,p),true);
  now+=8*60*60*1000;assert.equal(owner.authorized(second,p),false);
  for(let i=0;i<8;i++)assert.throws(()=>owner.login(req,res,'wrong',profile));assert.throws(()=>owner.login(req,res,key,profile),/尝试过多/);
});

async function fixture(t) {
  const key=randomBytes(32).toString('base64url'),ownerKeyHash=createHash('sha256').update(key).digest('hex');
  const {server,rooms,tableRooms}=createGameServer({scoreFile:null,ownerKeyHash,ownerSecureCookie:false,roll:()=>1});server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`,controllers=[];
  t.after(async()=>{controllers.forEach(c=>c.abort());server.closeAllConnections();await new Promise(r=>server.close(r));});
  async function api(path,data={},profile,player,cookie,headers={}) {
    const r=await fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(profile?{'X-Player-Token':profile.token}:{}),...(player?{Authorization:`Bearer ${player.token}`} : {}),...(cookie?{Cookie:cookie}:{}),...headers},body:JSON.stringify(data)});
    return {http:r.status,cookie:r.headers.get('set-cookie')?.split(';')[0],...await r.json()};
  }
  const aProfile=await api('profile',{name:'同名测试'}),bProfile=await api('profile',{name:'同名测试'});
  const login=await api('owner/login',{key},aProfile);assert.equal(login.http,200);const cookie=login.cookie;
  async function connect(p,prefix='') {const c=new AbortController();controllers.push(c);const r=await fetch(`${base}/api/${prefix}events?room=${p.code}&token=${p.token}`,{signal:c.signal});assert.equal(r.status,200);(async()=>{try{for await(const chunk of r.body){}}catch(e){if(e.name!=='AbortError')throw e;}})();}
  async function room(kind) {
    const prefix=kind==='go'?'go/':kind==='flight'?'table/':'';
    const a=await api(prefix+'create',kind==='flight'?{kind,count:2}:kind==='fog'?{mode:'fog'}:{},aProfile);
    const b=await api(prefix+'join',{room:a.code,...(kind==='flight'?{kind}:{})},bProfile);
    await connect(a,prefix);await connect(b,prefix);
    const sync=p=>api(prefix+'sync',{room:a.code},p===a?aProfile:bProfile,p,p===a?cookie:null);
    const call=async(action,p,data={})=>api(prefix+action,{room:a.code,version:(await sync(p)).version,...data},p===a?aProfile:bProfile,p,p===a?cookie:null);
    const owner=async(op,data={})=>api('owner/action',{game:kind,room:a.code,version:(await sync(a)).version,op,...data},aProfile,a,cookie);
    return {a,b,sync,call,owner,prefix};
  }
  return {api,key,cookie,aProfile,bProfile,room,rooms,tableRooms};
}

test('private operations reject same-name impostors, wrong seats, stale versions and cross-origin requests',async t=>{
  const {api,key,cookie,aProfile,bProfile,room}=await fixture(t),{a,b,owner,sync}=await room('gomoku');
  assert.equal((await api('owner/status',{},bProfile,null,cookie)).active,false);
  const data={game:'gomoku',room:a.code,version:(await sync(a)).version,op:'extra',enabled:true};
  assert.equal((await api('owner/action',data,bProfile,b)).http,400);
  assert.equal((await api('owner/action',data,bProfile,b,cookie)).http,400);
  assert.equal((await api('owner/action',data,aProfile,b,cookie)).http,403);
  assert.equal((await api('owner/action',{...data,version:-1},aProfile,a,cookie)).http,400);
  assert.equal((await api('owner/login',{key},aProfile,null,null,{Origin:'https://attacker.example'})).http,403);
  assert.equal((await owner('extra',{enabled:true})).http,200);
  await api('owner/logout',{},aProfile,null,cookie);assert.equal((await owner('extra',{enabled:true})).http,400);
});

test('owner extra move works without nickname trigger, is optional, private and limited to one turn',async t=>{
  const {room}=await fixture(t),{a,b,call,sync,owner}=await room('gomoku');
  assert.equal((await owner('extra',{enabled:true})).http,200);
  let s=await call('move',a,{x:7,y:7});assert.equal(s.game.bonus,'choice');assert.equal((await sync(b)).game.moves.length,0);
  await call('bonus',a,{take:true});await call('move',a,{x:8,y:7});assert.equal((await sync(b)).game.moves.length,0);
  await call('bonus',a,{take:false});assert.equal((await sync(b)).game.moves.length,2);
  assert.equal((await owner('extra',{enabled:true})).http,400);
  await call('move',b,{x:0,y:0});s=await call('move',a,{x:7,y:9});assert.equal(s.game.bonus,null);assert.equal(s.game.turn,2);
});

test('flight owner selects one own roll only; foreign clients cannot force dice and failed rolls do not consume it',async t=>{
  const {room,api,cookie,aProfile,bProfile}=await fixture(t),{a,b,call,sync,owner}=await room('flight');
  await call('start',a);
  for(const value of [-1,7,1.5,'6'])assert.equal((await owner('dice',{value})).http,400);
  assert.equal((await owner('dice',{value:6})).http,200);
  assert.equal((await call('roll',b,{dice:6})).http,400);
  const forged=await api('owner/action',{game:'flight',room:a.code,version:(await sync(b)).version,op:'dice',value:6},bProfile,b,cookie);assert.equal(forged.http,400);
  let s=await call('roll',a);assert.equal(s.game.dice,6);assert.equal(s.game.rollHistory.at(-1).dice,6);
  await call('move',a,{id:'1-1'});s=await call('roll',a,{dice:6});assert.equal(s.game.dice,1,'normal payload cannot reuse or forge private result');
  assert.equal(JSON.stringify(await sync(b)).includes('armed'),false);
});

test('fog full-board view is private, does not modify normal vision and is revoked on logout',async t=>{
  const {room,api,aProfile,cookie}=await fixture(t),{a,b,call,sync,owner}=await room('fog');
  await call('move',a,{x:7,y:7});await call('move',b,{x:0,y:0});
  const before=await sync(a),opponent=await sync(b);assert.equal(before.game.board[0],null);
  const view=await owner('fog-view');assert.equal(view.board[0],2);assert.equal(view.board[112],1);
  assert.deepEqual((await sync(a)).game,before.game);assert.deepEqual((await sync(b)).game,opponent.game);
  await api('owner/logout',{},aProfile,null,cookie);assert.equal((await owner('fog-view')).http,400);
});

test('go legal hints respect suicide and superko; private undo restores captured stones and refuses opponent replies',async t=>{
  const {room,rooms}=await fixture(t),{a,b,call,sync,owner}=await room('go');
  let legal=await owner('go-legal');assert.equal(legal.points.length,361);
  await call('move',a,{x:0,y:0});assert.equal((await owner('go-legal')).points.length,0);
  assert.equal((await owner('go-undo')).http,200);assert.equal((await sync(b)).game.moves.length,0);
  await call('move',a,{x:1,y:0});await call('move',b,{x:0,y:0});await call('move',a,{x:0,y:1});
  assert.equal((await sync(a)).game.board[0],0);assert.equal((await sync(a)).game.captures[0],1);
  assert.equal((await owner('go-undo')).http,200);
  let restored=(await sync(a)).game;assert.equal(restored.board[0],2);assert.equal(restored.board[19],0);assert.equal(restored.captures[0],0);assert.equal(restored.turn,1);
  await call('move',a,{x:5,y:5});await call('move',b,{x:6,y:6});assert.equal((await owner('go-undo')).http,400);
  const g=rooms.get(a.code).game;
  g.board.fill(0);g.board[1]=2;g.board[19]=2;g.positions=[g.board.join('')];
  legal=await owner('go-legal');assert.equal(legal.points.some(([x,y])=>x===0&&y===0),false);
  const candidate=[...g.board];candidate[40]=1;g.positions.push(candidate.join(''));
  legal=await owner('go-legal');assert.equal(legal.points.some(([x,y])=>x===2&&y===2),false);
});
