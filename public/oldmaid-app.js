import { createRoomUI } from './chat-ui.js';
import { profileReady, profileHeaders, refreshRankings } from './profile.js';
const $=id=>document.getElementById(id),palette=['red','yellow','green','blue'],colors=['#cb6657','#dbb346','#62a783','#689dbc'],faces=['🐻','🐱','🐶','🐰','🦊','🐼','🐨','🐸'];
const empty={kind:'oldmaid',count:4,turn:0,target:0,hand:[],handCounts:[0,0,0,0],finishOrder:[],winners:[],status:'waiting',message:'邀请朋友，开始这一局。',pairCount:0,moveCount:0};
let room=null,token='',stream=null,transport=false,busy=false,toastTimer,refreshing=false,motionUntil=0,motionTimer,selectionKey='',selectedCard=null,draggedCard=null,suppressClickUntil=0;
const team=seat=>({name:`${seat} 号位`,color:palette[(seat-1)%4]});
const name=seat=>room?.players[seat-1]?.name||`${seat} 号位`;
const available=()=>room?.players.every(p=>p&&!p.gone&&(p.connected||p.auto||room.game.status==='playing'&&room.game.finishOrder.includes(p.seat)));
const active=()=>Boolean(room?.started&&!room.closed&&transport&&!busy&&Date.now()>=motionUntil&&room.game.status==='playing'&&available()&&!room.players[room.yourSeat-1]?.auto);
function say(message) {$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
function cache() {try {if(room) sessionStorage.setItem('yiju-oldmaid-room',JSON.stringify({room:room.code,token}));else sessionStorage.removeItem('yiju-oldmaid-room');}catch {}}
async function api(action,data={}) {
  const response=await fetch('/api/table/'+action,{method:'POST',headers:{'Content-Type':'application/json',...profileHeaders(),...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({room:room?.code,kind:'oldmaid',version:room?.version,...data}),signal:AbortSignal.timeout(12000)});
  const value=await response.json();if(!response.ok){const error=new Error(value.error||'操作失败');error.status=response.status;throw error;}return value;
}
function apply(value) {
  if(!value?.game||value.kind!=='oldmaid'||room?.code===value.code&&value.seq<room.seq) return;
  if(value.token)token=value.token;
  const previous=room,changed=previous?.code===value.code&&(previous.round!==value.round||previous.game.status==='waiting'&&value.started||previous.game.moveCount!==value.game.moveCount);
  if(previous?.code!==value.code||previous?.round!==value.round)selectedCard=null;
  room=value;cache();
  if(!room.game.hand.some(c=>c.id===selectedCard))selectedCard=null;
  if(changed){motionUntil=Date.now()+720;clearTimeout(motionTimer);motionTimer=setTimeout(render,750);}
  render();if(changed)animateMove(previous,value);
  if(value.game.status==='finished'&&previous?.game.status!=='finished')refreshRankings();
}
async function send(action,data={}){const value=await api(action,data);apply(value);return value;}
function connect(){stream?.close();transport=false;const source=new EventSource(`/api/table/events?room=${room.code}&token=${encodeURIComponent(token)}`);stream=source;
  source.onopen=()=>{if(stream===source){transport=true;render();}};
  source.onmessage=event=>{if(stream===source){transport=true;apply(JSON.parse(event.data));}};
  source.onerror=()=>{if(stream===source){transport=false;render();}};
  source.addEventListener('reaction',event=>{const effect=JSON.parse(event.data),node=document.createElement('span');node.className='table-effect';node.textContent={poop:'💩',heart:'❤️',cry:'😭',bomb:'💣'}[effect.kind];$('table-effects').append(node);setTimeout(()=>node.remove(),2100);});render();
}
const ui=createRoomUI({kind:'oldmaid',send,refresh:()=>render(),playLocal:()=>{}});
function cardNode(card,button=false){const node=document.createElement(button?'button':'div');if(button)node.type='button';node.className='playing-card'+(card.rank===0?' turtle-card':['♥','♦'].includes(card.suit)?' red-suit':'');
  const corner=document.createElement('span'),symbol=document.createElement('b'),bottom=document.createElement('small');
  corner.textContent=card.rank===0?'★':({1:'A',11:'J',12:'Q',13:'K'}[card.rank]||card.rank);symbol.textContent=card.suit;bottom.textContent=card.rank===0?'乌龟':corner.textContent;
  node.append(corner,symbol,bottom);node.setAttribute('aria-label',card.rank===0?'乌龟牌':`${card.suit} ${corner.textContent}`);return node;
}
function render(){const g=room?.game||empty,mine=room?.yourSeat||1,can=active(),myTurn=g.turn===mine;
  $('lobby').hidden=Boolean(room);$('room-panel').hidden=!room;$('game-actions').hidden=!room;
  $('create-button').disabled=busy;$('join-button').disabled=busy;$('room-code').textContent=room?.code||'';
  $('connection').textContent=room?(transport?'● 已连接':'○ 正在重连…'):'等待入座';
  $('room-note').textContent=room?`${room.count} 人入座 · ${room.started?'第 '+room.round+' 局':'最多 8 人'}${room.closed?' · 已关闭':''}`:'';
  $('start-button').hidden=!room||room.started||room.closed||mine!==1;$('start-button').disabled=busy||!transport||!available()||room.count<2;
  $('rematch-button').hidden=!room||room.closed||g.status!=='finished';$('rematch-button').disabled=busy||!transport||Boolean(room?.ready.includes(mine));
  $('rematch-button').textContent=room?.ready.includes(mine)?`等待再来一局 (${room.ready.length}/${room.count})`:'再来一局 ↻';
  $('reactions-panel').hidden=!room||room.closed;document.querySelectorAll('[data-reaction]').forEach(b=>b.disabled=busy||!transport||!available());
  $('status-title').textContent=!room?'牌桌已备好':room.closed?'房间已关闭':!room.started?`等朋友入座 · 已有 ${room.count} 人`:g.status==='finished'?'游戏结束':!available()?'等待断线玩家重连':myTurn?'轮到你抽牌':`${name(g.turn)} 正在抽牌`;
  $('status-detail').textContent=room?.closed?'本局中断，不计胜场。':(g.message||'').replace(/(\d+) 号位/g,(_,n)=>name(Number(n)));
  $('table-empty').hidden=Boolean(room);$('game-over').hidden=g.status!=='finished';$('game-over').querySelector('strong').textContent=g.loser?`${name(g.loser)} 留下了乌龟 🐢`:'本局中断';$('game-over').querySelector('small').textContent=g.loser?'其他玩家都安全啦！':'本局不计胜场';
  $('pair-count').textContent=room?.started?`已消除 ${g.pairCount} 对`:'一只乌龟，一桌朋友';
  $('table-caption').textContent=room?.started?`剩 ${g.handCounts.filter(n=>n>0).length} 人 · 顺时针 ↻`:'顺时针轮流抽牌 ↻';
  $('pair-pile').replaceChildren();for(const card of g.last?.pair||[]) $('pair-pile').append(cardNode(card));
  $('oldmaid-seats').replaceChildren();
  for(let seat=1;seat<=g.count;seat++){
    const p=room?.players[seat-1],angle=(seat-mine+g.count)%g.count*360/g.count,radians=angle*Math.PI/180,node=document.createElement('div'),safe=g.finishOrder.includes(seat);
    node.className='uno-seat'+(room?.started&&g.status==='playing'&&g.turn===seat?' active':'')+(safe?' is-safe':'');node.dataset.seat=seat;
    node.style.left=`${50-38*Math.sin(radians)}%`;node.style.top=`${50+38*Math.cos(radians)}%`;
    const rack=document.createElement('div'),avatar=document.createElement('div'),label=document.createElement('strong'),note=document.createElement('small');
    rack.className='seat-hand';const count=g.handCounts[seat-1],shown=Math.min(count,8);
    for(let i=0;i<shown;i++){const back=document.createElement('i');back.className='mini-back';back.style.setProperty('--fan-x',`${(i-(shown-1)/2)*4}px`);back.style.setProperty('--fan-r',`${(i-(shown-1)/2)*4}deg`);rack.append(back);}
    const badge=document.createElement('b');badge.className='seat-count';badge.textContent=room?.started?(safe?'✓ 安全':`${count} 张`):'待开局';rack.append(badge);
    avatar.className='seat-avatar';avatar.textContent=g.loser===seat?'🐢':faces[seat-1];avatar.style.borderColor=colors[(seat-1)%4];
    label.textContent=p?`${p.name}${seat===mine?' · 你':''}`:'等待入座';label.title=p?.name||'';
    note.textContent=safe?'已安全':p?.auto?'托管中':p&&!p.connected?'重连中':g.status==='playing'&&g.turn===seat?'正在抽牌':g.status==='playing'&&g.target===seat?'被抽牌':'';
    node.append(rack,avatar,label,note);$('oldmaid-seats').append(node);
  }
  const pointer=$('turn-pointer');pointer.hidden=!room?.started||g.status!=='playing';
  if(!pointer.hidden){const angle=(g.turn-mine+g.count)%g.count*360/g.count,r=angle*Math.PI/180;pointer.style.left=`${50-23*Math.sin(r)}%`;pointer.style.top=`${50+23*Math.cos(r)}%`;pointer.style.setProperty('--point-angle',`${angle+90}deg`);pointer.setAttribute('aria-label',`当前抽牌：${name(g.turn)}`);}
  const drawing=g.status==='playing'&&myTurn&&!room.closed;
  $('draw-label').textContent=drawing?`从 ${name(g.target)} 手中抽一张`:g.status==='finished'?'这一局，结束啦':g.finishOrder.includes(mine)?'你已安全，坐看谁留下乌龟':room?.started?`等待 ${name(g.turn)} 抽牌`:'等待朋友入座';
  $('draw-hint').textContent=drawing?(room.players[mine-1].auto?'托管随机抽牌中':'点一张牌背 · 抽牌不限时'):'只看牌背，凭感觉选一张';
  const nextKey=JSON.stringify([room?.code,room?.version,drawing,can,g.handCounts[g.target-1]]);
  if(selectionKey!==nextKey){selectionKey=nextKey;$('target-hand').replaceChildren();
    if(drawing){const version=room.version;for(let index=0;index<g.handCounts[g.target-1];index++){
      const back=document.createElement('button');back.className='draw-back';back.textContent='✦';back.disabled=!can;back.setAttribute('aria-label',`抽第 ${index+1} 张牌`);
      back.onclick=()=>operate('oldmaid',{version,move:{action:'draw',index}});$('target-hand').append(back);
    }}else{const note=document.createElement('span');note.className='draw-placeholder';note.textContent=g.finishOrder.includes(mine)?'✓ 手牌清空，可以聊天或观看剩余对局。':'轮到你时，对手的牌背会放在这里。';$('target-hand').append(note);}
  }
  $('hand-label').textContent=room?.started?`我的手牌 · ${g.hand.length} 张`:'我的手牌';$('shuffle-button').disabled=!(can&&g.hand.length>1);
  const own=$('oldmaid-hand'),scroll=own.scrollLeft;own.replaceChildren();for(const card of g.hand){
    const node=cardNode(card,true);node.dataset.cardId=card.id;node.disabled=!can;node.classList.toggle('can-reorder',can&&g.hand.length>1);node.classList.toggle('selected',selectedCard===card.id);node.setAttribute('aria-pressed',String(selectedCard===card.id));
    node.onclick=()=>{if(Date.now()<suppressClickUntil)return;selectedCard=selectedCard===card.id?null:card.id;render();};
    // Mouse dragging moves cards; touch keeps native scrolling and uses the arrow controls.
    node.onpointerdown=event=>{if(event.pointerType!=='mouse'||event.button!==0||!can)return;draggedCard={id:card.id,version:room.version,x:event.clientX,moved:false};node.setPointerCapture(event.pointerId);};
    node.onpointermove=event=>{if(!draggedCard||!node.hasPointerCapture(event.pointerId))return;if(Math.abs(event.clientX-draggedCard.x)>7){draggedCard.moved=true;node.classList.add('dragging');node.style.translate=`${event.clientX-draggedCard.x}px -10px`;}};
    node.onpointerup=event=>{if(!draggedCard)return;const from=draggedCard;draggedCard=null;node.style.translate='';node.classList.remove('dragging');if(!from.moved)return;suppressClickUntil=Date.now()+300;selectedCard=from.id;
      const nodes=[...own.querySelectorAll('button')],index=nodes.reduce((best,el,i)=>{const r=el.getBoundingClientRect(),distance=Math.abs(event.clientX-r.left-r.width/2);return distance<best.distance?{index:i,distance}:best;},{index:0,distance:Infinity}).index;reorder(from.id,index,from.version);};
    node.onpointercancel=()=>{draggedCard=null;node.style.translate='';node.classList.remove('dragging');};own.append(node);
  }if(!g.hand.length){const note=document.createElement('span');note.className='small-note';note.textContent=room?.started?'手牌已清空 ✓':'开局后，只在这里显示你的手牌。';own.append(note);}own.scrollLeft=scroll;
  const selectedIndex=g.hand.findIndex(c=>c.id===selectedCard);
  $('hand-order').hidden=!room?.started||g.status!=='playing'||g.hand.length<2;
  $('order-left').disabled=!can||selectedIndex<=0;$('order-right').disabled=!can||selectedIndex<0||selectedIndex>=g.hand.length-1;
  $('order-hint').textContent=selectedIndex<0?'点选手牌，用箭头换位 · 电脑可拖动':'已选中这张牌 · 移到喜欢的位置';
  ui.sync({mode:'online',room,transport,game:g,busy,team});
}
function animateMove(previous,next){if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const board=$('board-wrap'),rect=board.getBoundingClientRect(),center={x:rect.width/2,y:rect.height/2};
  const pos=seat=>{const el=board.querySelector(`[data-seat="${seat}"]`),r=el?.getBoundingClientRect();return r?{x:r.left+r.width/2-rect.left,y:r.top+r.height/2-rect.top}:center;};
  function fly(from,to,delay=0){const node=document.createElement('span');node.className='motion-card';node.textContent='✦';board.append(node);
    const a=node.animate([{transform:`translate(${from.x-12}px,${from.y-17}px) rotate(-12deg)`,opacity:0},{offset:.12,opacity:1},{transform:`translate(${to.x-12}px,${to.y-17}px) rotate(12deg)`,opacity:0}],{duration:650,delay,easing:'ease-in-out'});a.finished.finally(()=>node.remove());}
  if(previous.round!==next.round||!previous.started){for(let seat=1;seat<=next.count;seat++)for(let i=0;i<3;i++)fly(center,pos(seat),i*90);}
  else if(next.game.last){const last=next.game.last;fly(pos(last.target),pos(last.seat));if(last.pair){fly(pos(last.seat),center,350);$('pair-pile').animate([{transform:'scale(.7)',opacity:0},{transform:'scale(1.15)',opacity:1},{transform:'scale(1)',opacity:1}],{duration:600,delay:350});}}
}
async function operate(action,data={}){if(busy)return;busy=true;render();try{await send(action,data);}catch(error){say(error.message);try{if(room)apply(await api('sync'));}catch{}}finally{busy=false;render();}}
$('shuffle-button').onclick=()=>operate('oldmaid',{move:{action:'shuffle'}});
function reorder(id,index,version=room?.version){if(!active())return;const order=room.game.hand.map(c=>c.id),from=order.indexOf(id);if(from<0||index<0||index>=order.length||from===index)return;order.splice(from,1);order.splice(index,0,id);operate('oldmaid',{version,move:{action:'reorder',order}});}
$('order-left').onclick=()=>reorder(selectedCard,room.game.hand.findIndex(c=>c.id===selectedCard)-1);
$('order-right').onclick=()=>reorder(selectedCard,room.game.hand.findIndex(c=>c.id===selectedCard)+1);

$('start-button').onclick=()=>operate('start');$('rematch-button').onclick=()=>operate('rematch');
async function enter(action,data) {if(busy||room)return;busy=true;render();try {await profileReady;apply(await api(action,data));history.replaceState(null,'',`/play?game=oldmaid&room=${room.code}`);connect();}catch(error){say(error.message);}finally{busy=false;render();}}
$('create-button').onclick=()=>enter('create',{});
$('join-form').onsubmit=event=>{event.preventDefault();enter('join',{room:$('room-input').value.trim().toUpperCase()});};
$('invite-entry').onclick=()=>{if(matchMedia('(max-width:700px)').matches)document.querySelector('.mobile-nav [data-pane="room"]').click();else {$('lobby').scrollIntoView({behavior:'smooth',block:'center'});$('create-button').focus();}};
$('copy-button').onclick=async()=>{const url=`${location.origin}/play?game=oldmaid&room=${room.code}`;try{await navigator.clipboard.writeText(url);say('邀请链接已复制');}catch{$('share-url').value=url;$('share-dialog').showModal();$('share-url').select();}};
$('rules-button').onclick=()=>$('rules-dialog').showModal();
$('leave-button').onclick=()=>$('leave-dialog').showModal();$('leave-cancel').onclick=()=>$('leave-dialog').close();
$('leave-ok').onclick=async()=>{if(busy)return;busy=true;try {if(room&&!room.closed)await api('leave');stream?.close();stream=null;room=null;token='';transport=false;cache();history.replaceState(null,'','/play?game=oldmaid');$('leave-dialog').close();refreshRankings();}catch(error){say(error.message);}finally{busy=false;render();}};
document.querySelectorAll('.dialog-close').forEach(button=>button.onclick=()=>button.closest('dialog').close());
document.querySelectorAll('[data-reaction]').forEach(button=>button.onclick=()=>send('reaction',{kind:button.dataset.reaction}).catch(error=>say(error.message)));
async function restore() {
  const code=new URLSearchParams(location.search).get('room');if(code)$('room-input').value=code.toUpperCase();
  let saved;try{saved=JSON.parse(sessionStorage.getItem('yiju-oldmaid-room'));}catch{}
  if(saved&&(!code||code.toUpperCase()===saved.room)) {busy=true;token=saved.token;render();try {apply(await api('sync',{room:saved.room}));connect();}catch(error){if(error.status===401||error.status===404){cache();token='';}say(error.message);}finally{busy=false;render();}}
}
document.addEventListener('visibilitychange',async()=>{if(!document.hidden&&room&&!refreshing){refreshing=true;try{apply(await api('sync'));}catch{}finally{refreshing=false;}}});
render();restore();
