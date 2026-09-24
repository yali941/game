import { UNO_COLORS, UNO_COLOR_NAMES, UNO_LABELS, UNO_ICONS, unoCardLabel, unoSeatPositions } from './uno-rules.js';
import { createRoomUI } from './chat-ui.js';
import { profileReady, profileHeaders, refreshRankings } from './profile.js';
const $=id=>document.getElementById(id), colors={red:'#c2463e',yellow:'#dea62b',green:'#398762',blue:'#4085b3'},faces=['🐻','🐱','🐶','🐰'];
const empty={kind:'uno',count:4,turn:0,direction:1,color:'',hand:[],handCounts:[0,0,0,0],legalIds:[],bombs:[],moves:[],status:'waiting',message:'邀请朋友，开始这一局。'};
let room=null,token='',stream=null,transport=false,busy=false,selected=null,toastTimer,handKey='',seatKey='',lastTop='',lastDirection=1,lastRound='',refreshing=false;
const team=seat=>({name:['红方','黄方','绿方','蓝方'][seat-1]||'牌友',color:UNO_COLORS[seat-1]||'green'});
const name=seat=>room?.players[seat-1]?.name||`${seat} 号位`;
function say(message) {$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
function cache() {try {if(room) sessionStorage.setItem('yiju-uno-room',JSON.stringify({room:room.code,token}));else sessionStorage.removeItem('yiju-uno-room');}catch {}}
async function api(action,data={}) {
  const response=await fetch('/api/table/'+action,{method:'POST',headers:{'Content-Type':'application/json',...profileHeaders(),...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({room:room?.code,kind:'uno',version:room?.version,...data}),signal:AbortSignal.timeout(12000)});
  const value=await response.json();if(!response.ok) {const error=new Error(value.error||'操作失败');error.status=response.status;throw error;}return value;
}
function apply(value) {
  if(!value?.game||value.kind!=='uno'||(room?.code===value.code&&value.seq<room.seq)) return;
  if(value.token) token=value.token;
  room=value;cache();render();
}
async function send(action,data={}) {const value=await api(action,data);apply(value);return value;}
function connect() {
  stream?.close();transport=false;
  const source=new EventSource(`/api/table/events?room=${room.code}&token=${encodeURIComponent(token)}`);stream=source;
  source.onopen=()=>{if(stream===source) {transport=true;render();}};
  source.onmessage=event=>{if(stream===source) {transport=true;apply(JSON.parse(event.data));}};
  source.onerror=()=>{if(stream===source) {transport=false;render();}};
  source.addEventListener('reaction',event=>{const effect=JSON.parse(event.data);animateEffect({poop:'💩',heart:'❤️',cry:'😭',bomb:'💣'}[effect.kind]);});
  render();
}
function animateEffect(symbol) {const node=document.createElement('span');node.className='table-effect';node.textContent=symbol;$('table-effects').append(node);setTimeout(()=>node.remove(),2100);}
const ui=createRoomUI({kind:'uno',send,refresh:()=>render(),playLocal:()=>{}});
const active=()=>Boolean(room?.started&&!room.closed&&transport&&!busy&&room.game.status==='playing'&&room.players.every(p=>p&&!p.gone&&(p.connected||p.auto))&&!room.players[room.yourSeat-1]?.auto);
function cardNode(card,button=false) {
  const node=document.createElement(button?'button':'div');node.className='uno-card';node.dataset.color=card.color;node.dataset.cardId=card.id;
  const corner=document.createElement('span'),symbol=document.createElement('b'),caption=document.createElement('small');
  corner.className='card-corner';corner.textContent=UNO_ICONS[card.value]||card.value;
  symbol.className='card-symbol';symbol.textContent=UNO_ICONS[card.value]||card.value;
  caption.className='card-caption';caption.textContent=UNO_LABELS[card.value]||`${UNO_COLOR_NAMES[card.color]}色`;
  node.append(corner,symbol,caption);node.setAttribute('aria-label',unoCardLabel(card));node.title=unoCardLabel(card);return node;
}
function render() {
  const g=room?.game||empty,mine=room?.yourSeat||1,isTurn=g.turn===mine,can=active()&&isTurn;
  $('lobby').hidden=Boolean(room);$('room-panel').hidden=!room;$('game-actions').hidden=!room;
  $('create-button').disabled=busy;$('join-button').disabled=busy;
  $('room-code').textContent=room?.code||'';
  $('connection').textContent=room?(transport?'● 已连接':'○ 正在重连…'):'等待入座';
  const present=room?.players.filter(p=>p&&!p.gone).length||0;
  $('room-note').textContent=room?`${present} / ${room.count} 人入座 · 第 ${room.round} 局${room.closed?' · 房间已关闭':''}`:'';
  $('start-button').hidden=!room||room.started||room.closed||mine!==1;
  $('start-button').disabled=!transport||busy||!room?.players.every(p=>p&&(p.connected||p.auto));
  $('rematch-button').hidden=!room||room.closed||g.status!=='finished';
  $('rematch-button').disabled=busy||!transport||Boolean(room?.ready.includes(mine));
  $('rematch-button').textContent=room?.ready.includes(mine)?`等待再来一局 (${room.ready.length}/${room.count})`:'再来一局 ↻';
  $('reactions-panel').hidden=!room||room.closed;
  document.querySelectorAll('[data-reaction]').forEach(b=>b.disabled=!transport||busy||!room?.players.every(p=>p&&(p.connected||p.auto)));
  $('status-title').textContent=!room?'牌桌已备好':room.closed?'房间已关闭':!room.started?`等朋友入座 · ${present}/${room.count}`:g.status==='finished'?(g.winner?`${name(g.winner)} 获胜`:'本局结束'):!room.players.every(p=>p&&(p.connected||p.auto))?'等待断线玩家重连':isTurn?'轮到你出牌':`${name(g.turn)} 的回合`;
  $('status-detail').textContent=(g.message||'').replace(/(\d) 号位/g,(_,n)=>name(Number(n)));
  $('table-empty').hidden=Boolean(room);$('direction').querySelector('span').textContent=g.direction===1?'顺时针出牌':'逆时针出牌';
  const arrow=$('direction').querySelector('b');arrow.textContent=g.direction===1?'↻':'↺';
  if(lastDirection!==g.direction) {arrow.classList.remove('direction-flip');void arrow.offsetWidth;arrow.classList.add('direction-flip');lastDirection=g.direction;}
  $('active-color').textContent=g.color?`当前 · ${UNO_COLOR_NAMES[g.color]}色`:'等待开局';$('active-color').style.setProperty('--chip',colors[g.color]||'#c7c9a4');
  $('bomb-status').hidden=!g.bombs.length;$('bomb-status').textContent=`💣 ${g.bombs.length>1?g.bombs.length+' 枚 · ':''}引信燃烧中`;
  const p=g.pending;
  $('penalty-note').textContent=!p?'':p.type==='draw2'?`累计 +${p.amount} · 接铲子 / 隐身可传递`:p.type==='taser'?`电击 · 摸到${UNO_COLOR_NAMES[p.color]}色或万能牌`:p.type==='bomb'?'炸弹爆炸 · +4 / 隐身传递':'冰冻 · 跳过 / 隐身传递';
  $('take-button').hidden=!(room?.started&&p&&isTurn&&g.status==='playing');$('take-button').disabled=!can;
  $('take-button').textContent=p?.type==='skip'?'接受冰冻 · 跳过':p?.type==='taser'?'接受电击 · 摸牌':`摸 ${p?.amount||0} 张罚牌`;
  $('pass-button').hidden=!(room?.started&&isTurn&&g.phase==='drawn');$('pass-button').disabled=!can;
  $('draw-button').disabled=!(can&&g.phase==='play'&&!p);$('draw-button').setAttribute('aria-label',`摸一张牌，牌堆剩余 ${g.deckCount??0} 张`);
  $('draw-button').querySelector('small').textContent=room?`摸牌 · ${g.deckCount}`:'摸牌堆';
  $('hand-label').textContent=room?`我的手牌 · ${room.started?g.hand.length:'待开局'}${room.players[mine-1]?.auto?' · 托管中':''}`:'你的手牌';
  $('hand-hint').textContent=!room?'可出的牌会微微上挑':!room.started?'等待房主开始':g.status==='finished'?'本局结束':room.players[mine-1]?.auto?'取消托管后可手动出牌':isTurn?(p?'处理当前效果后继续':'点上挑的牌出牌 · 万能牌先选色'):'等待对手 · 出牌不限时';
  const positions=unoSeatPositions(g.count,mine),nextSeatKey=JSON.stringify([positions,room?.players,g.handCounts,g.turn,room?.started,g.status]);
  if(seatKey!==nextSeatKey) {seatKey=nextSeatKey;$('uno-seats').replaceChildren();for(const {seat,position} of positions) {
    const player=room?.players[seat-1],node=document.createElement('div');node.className=`uno-seat ${position}${room?.started&&g.status==='playing'&&g.turn===seat?' active':''}${player&&!player.connected&&!player.auto?' offline':''}`;node.dataset.seat=seat;
    const avatar=document.createElement('div'),label=document.createElement('strong'),note=document.createElement('small'),count=document.createElement('b');avatar.className='seat-avatar';avatar.textContent=faces[seat-1];avatar.style.borderColor=colors[team(seat).color];
    label.textContent=player?`${player.name}${seat===mine?' · 你':''}`:'等待入座';label.title=player?.name||'空座位';
    note.textContent=!player?`${seat} 号位`:player.gone?'已离开':player.auto?'托管中':!player.connected?'重连中':!room.started?'已就座':g.status==='finished'?(g.winner===seat?'本局获胜':'本局结束'):g.turn===seat?'正在行动':g.handCounts[seat-1]===1?'最后一张！':'等待出牌';
    count.className='seat-count';count.textContent=room?.started?g.handCounts[seat-1]:'—';count.setAttribute('aria-label',`剩余 ${count.textContent} 张牌`);node.append(avatar,label,note,count);$('uno-seats').append(node);
  }}
  const currentTop=JSON.stringify([room?.code,room?.round,g.top,g.last?.number]);
  if(currentTop!==lastTop) {const animate=lastTop&&lastRound===`${room?.code}:${room?.round}`&&g.last?.action==='play';lastTop=currentTop;lastRound=`${room?.code}:${room?.round}`;$('discard').replaceChildren();if(g.top) {const card=cardNode(g.top);if(animate)card.classList.add('card-arrive');$('discard').append(card);}if(g.last?.action==='explosion')animateEffect('💥');}
  const visibleHand=room?.started?g.hand:[],nextHandKey=JSON.stringify([visibleHand,g.legalIds,can,room?.started]);
  if(nextHandKey!==handKey) {handKey=nextHandKey;const scroll=$('uno-hand').scrollLeft;$('uno-hand').replaceChildren();for(const card of visibleHand) {
    const node=cardNode(card,true),legal=g.legalIds.includes(card.id);node.disabled=!(can&&legal);node.classList.toggle('playable',can&&legal);node.addEventListener('click',()=>play(card));$('uno-hand').append(node);
  }if(!visibleHand.length) {const note=document.createElement('span');note.className='small-note';note.textContent=room?.started?'手牌已出完':'入座开局后，在这里查看自己的手牌。';$('uno-hand').append(note);}$('uno-hand').scrollLeft=scroll;}
  if(selected&&(!can||!g.legalIds.includes(selected.id)||selected.version!==room.version)) {$('color-dialog').close();selected=null;}
  ui.sync({mode:'online',room,transport,game:g,busy,team});
}
async function operate(action,data={}) {
  if(busy)return;busy=true;render();try {await send(action,data);}catch(error){say(error.message);try {if(room) apply(await api('sync'));}catch {}}finally {busy=false;render();}
}
function play(card) {if(!active())return;if(card.color==='wild') {selected={id:card.id,version:room.version};$('color-description').textContent=`打出${UNO_LABELS[card.value]}，选择接下来的颜色。`;$('color-dialog').showModal();}else operate('uno',{move:{action:'play',id:card.id}});}
$('color-dialog').querySelectorAll('[data-color]').forEach(button=>button.onclick=()=>{const card=selected;if(!card)return;selected=null;$('color-dialog').close();operate('uno',{move:{action:'play',id:card.id,color:button.dataset.color}});});
$('draw-button').onclick=()=>operate('uno',{move:{action:'draw'}});$('take-button').onclick=()=>operate('uno',{move:{action:'take-penalty'}});$('pass-button').onclick=()=>operate('uno',{move:{action:'pass'}});
$('start-button').onclick=()=>operate('start');$('rematch-button').onclick=()=>operate('rematch');
async function enter(action,data) {if(busy||room)return;busy=true;render();try {await profileReady;apply(await api(action,data));history.replaceState(null,'',`/play?game=uno&room=${room.code}`);connect();}catch(error){say(error.message);}finally{busy=false;render();}}
$('create-button').onclick=()=>enter('create',{count:Number($('player-count').value)});
$('join-form').onsubmit=event=>{event.preventDefault();enter('join',{room:$('room-input').value.trim().toUpperCase()});};
$('invite-entry').onclick=()=>{if(matchMedia('(max-width:700px)').matches)document.querySelector('.mobile-nav [data-pane="room"]').click();else {$('lobby').scrollIntoView({behavior:'smooth',block:'center'});$('create-button').focus();}};
$('copy-button').onclick=async()=>{const url=`${location.origin}/play?game=uno&room=${room.code}`;try{await navigator.clipboard.writeText(url);say('邀请链接已复制');}catch{$('share-url').value=url;$('share-dialog').showModal();$('share-url').select();}};
$('rules-button').onclick=()=>$('rules-dialog').showModal();
$('leave-button').onclick=()=>$('leave-dialog').showModal();$('leave-cancel').onclick=()=>$('leave-dialog').close();
$('leave-ok').onclick=async()=>{if(busy)return;busy=true;try {if(room&&!room.closed)await api('leave');stream?.close();stream=null;room=null;token='';transport=false;cache();history.replaceState(null,'','/play?game=uno');$('leave-dialog').close();refreshRankings();}catch(error){say(error.message);}finally{busy=false;render();}};
document.querySelectorAll('.dialog-close').forEach(button=>button.onclick=()=>button.closest('dialog').close());
document.querySelectorAll('[data-reaction]').forEach(button=>button.onclick=()=>send('reaction',{kind:button.dataset.reaction}).catch(error=>say(error.message)));
async function restore() {
  const code=new URLSearchParams(location.search).get('room');if(code)$('room-input').value=code.toUpperCase();
  let saved;try{saved=JSON.parse(sessionStorage.getItem('yiju-uno-room'));}catch{}
  if(saved&&(!code||code.toUpperCase()===saved.room)) {busy=true;token=saved.token;render();try {apply(await api('sync',{room:saved.room}));connect();}catch(error){if(error.status===401||error.status===404){cache();token='';}say(error.message);}finally{busy=false;render();}}
}
document.addEventListener('visibilitychange',async()=>{if(!document.hidden&&room&&!refreshing){refreshing=true;try{apply(await api('sync'));}catch{}finally{refreshing=false;}}});
render();restore();
