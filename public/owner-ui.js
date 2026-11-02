import {profileReady,profileHeaders} from './profile.js';
let context,active=false,checked=false,panel,message,viewButton,extraButton,diceSelect,diceButton,undoButton;
let viewing=false,busy=false,stamp='',viewStamp='',viewData=null,viewLoading='',epoch=0;
const ns='http://www.w3.org/2000/svg';
async function request(path,data={},ctx=context) {
  await profileReady;
  const r=await fetch('/api/owner/'+path,{method:'POST',headers:{'Content-Type':'application/json',...profileHeaders(),...(ctx?.session?{Authorization:`Bearer ${ctx.session.token}`}:{})},body:JSON.stringify(data),signal:AbortSignal.timeout(10000)});
  const s=await r.json();if(!r.ok)throw Error(s.error);return s;
}
function clearView() {
  document.getElementById('owner-overlay')?.remove();
  if(context?.kind==='fog' && context.room?.game.status!=='finished') {
    document.getElementById('fog-layer')?.setAttribute('visibility','visible');
    document.getElementById('board-grid')?.setAttribute('mask','url(#fog-grid-mask)');
  }
}
async function check() {
  try {active=(await request('status')).active;}catch{active=false;}
  if(!active){viewing=false;viewData=null;epoch++;clearView();}
  update();
}
function node(tag,text,parent) {const el=document.createElement(tag);el.textContent=text;parent?.append(el);return el;}
function build() {
  const css=document.createElement('link');css.rel='stylesheet';css.href='/owner.css';document.head.append(css);
  panel=node('section','',document.querySelector('aside')||document.querySelector('main'));panel.className='owner-controls';panel.setAttribute('aria-label','私人控制');
  node('h3','私人控制 · 仅你可用',panel);
  extraButton=node('button','本回合开启额外一步',panel);extraButton.onclick=()=>run('extra',{enabled:true},'已设置。正常落子后可选择再下一颗，最后点击结束回合。');
  viewButton=node('button','查看全盘',panel);viewButton.onclick=()=>{viewing=!viewing;viewData=null;viewStamp='';epoch++;clearView();update();};
  diceSelect=node('select','',panel);diceSelect.setAttribute('aria-label','私人骰子点数');
  for(let i=0;i<=6;i++){const o=node('option',i?`${i} 点`:'随机',diceSelect);o.value=String(i);}
  diceButton=node('button','设置本次骰子',panel);diceButton.onclick=()=>run('dice',{value:Number(diceSelect.value)},Number(diceSelect.value)?`已设置 ${diceSelect.value} 点。点击棋盘上的骰子投掷。`:'已恢复随机投掷。');
  undoButton=node('button','撤回自己上一手',panel);undoButton.onclick=()=>run('go-undo',{},'已撤回自己上一手。');
  message=node('p','',panel);message.setAttribute('role','status');
  const logout=node('button','锁定私人功能',panel);logout.onclick=async()=>{try{await request('logout');active=false;viewing=false;viewData=null;epoch++;clearView();update();}catch(e){message.textContent=e.message;}};
}
async function run(op,data,text) {
  if(busy)return;busy=true;update();
  const ctx=context;
  try{await request('action',{game:ctx.kind,room:ctx.room.code,version:ctx.room.version,op,...data},ctx);message.textContent=text;await ctx.resync();}
  catch(e){message.textContent=e.message;await check();}
  finally{busy=false;update();}
}
function paintView() {
  clearView();
  if(!viewData || !viewing || !active)return;
  const board=document.getElementById('board');if(!board)return;
  const layer=document.createElementNS(ns,'g');layer.id='owner-overlay';layer.classList.add('owner-overlay');layer.setAttribute('aria-label',context.kind==='fog'?'私人全盘视野':'私人合法落点');
  if(context.kind==='fog') {
    document.getElementById('fog-layer')?.setAttribute('visibility','hidden');document.getElementById('board-grid')?.removeAttribute('mask');
    viewData.board.forEach((color,i)=>{
      if(!color || context.room.game.board[i]===color)return;
      const el=document.createElementNS(ns,'circle');for(const [k,v] of Object.entries({cx:40+i%15*40,cy:40+Math.floor(i/15)*40,r:16.5,fill:`url(#${color===1?'black':'white'}-stone)`,class:'game-stone'}))el.setAttribute(k,v);layer.append(el);
    });
  } else for(const [x,y] of viewData.points) {
    const el=document.createElementNS(ns,'circle');for(const [k,v] of Object.entries({cx:40+x*560/18,cy:40+y*560/18,r:3.5,class:'owner-legal'}))el.setAttribute(k,v);layer.append(el);
  }
  board.append(layer);
}
function update() {
  const ctx=context,r=ctx?.room,g=r?.game,visible=active&&ctx?.online&&r&&!r.closed&&['gomoku','fog','flight','go'].includes(ctx.kind);
  if(!visible){if(panel)panel.hidden=true;viewData=null;viewing=false;clearView();return;}
  if(!panel)build();panel.hidden=false;
  const next=[ctx.kind,r.code,r.round,r.version].join(':');
  if(stamp!==next){stamp=next;viewData=null;message.textContent='';}
  const own=r.yourColor??r.yourSeat,turn=g.turn===own,blocked=busy||ctx.busy||Boolean(r.request)||g.status!=='playing'||r.players.find(p=>p?.color===own||p?.seat===own)?.auto;
  extraButton.hidden=ctx.kind!=='gomoku';extraButton.disabled=blocked||!turn||Boolean(g.bonus);
  viewButton.hidden=!['fog','go'].includes(ctx.kind);viewButton.disabled=busy||g.status!=='playing';
  viewButton.textContent=viewing?'关闭私人视野':ctx.kind==='fog'?'查看全盘':'显示合法落点';viewButton.setAttribute('aria-pressed',String(viewing));
  diceButton.hidden=diceSelect.hidden=ctx.kind!=='flight';diceButton.disabled=diceSelect.disabled=blocked||!turn||g.phase!=='roll'||!r.started;
  undoButton.hidden=ctx.kind!=='go';undoButton.disabled=blocked||g.phase!=='play'||g.moves.at(-1)?.color!==own||g.moves.at(-1)?.resume;
  if(viewing && g.status==='playing') {
    if(viewStamp===next&&viewData){paintView();return;}
    clearView();
    if(viewLoading===next)return;
    viewLoading=next;const ticket=epoch;
    request('action',{game:ctx.kind,room:r.code,version:r.version,op:ctx.kind==='fog'?'fog-view':'go-legal'},ctx).then(s=>{
      if(epoch!==ticket||stamp!==next||!viewing||!active)return;
      viewData=s;viewStamp=next;paintView();if(ctx.kind==='go')message.textContent=turn?`绿色点为合法落点，共 ${s.points.length} 处。`:'轮到你时显示合法落点。';
    }).catch(e=>{if(stamp===next){message.textContent=e.message;clearView();}}).finally(()=>{if(viewLoading===next)viewLoading='';});
  }else clearView();
}
export function syncOwnerControls(ctx) {
  if(context && (context.room?.code!==ctx.room?.code||context.kind!==ctx.kind||context.online!==ctx.online)){clearView();viewData=null;viewing=false;epoch++;}
  context=ctx;
  if(!checked){checked=true;check();setInterval(check,15000);window.addEventListener('focus',check);}
  update();
}
