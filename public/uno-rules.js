export const UNO_COLORS = ['red','yellow','green','blue'];
export const UNO_COLOR_NAMES = {red:'红',yellow:'黄',green:'绿',blue:'蓝',wild:'万能'};
export const UNO_LABELS = {skip:'冰冻枪',reverse:'回旋镖',draw2:'铲子 +2',taser:'电击枪',bomb:'炸弹',banana:'香蕉',egg:'惊喜蛋',potion:'隐身药水'};
export const UNO_ICONS = {skip:'❄',reverse:'⇄',draw2:'+2',taser:'ϟ',bomb:'💣',banana:'🍌',egg:'🥚',potion:'⚗'};
export const unoCardLabel = c => `${UNO_COLOR_NAMES[c.color]}${c.color==='wild'?'':'色'} ${UNO_LABELS[c.value] || c.value}`;
export function unoDeck() {
  const cards=[],add=(color,value)=>cards.push({id:`u${cards.length}`,color,value});
  for(const color of UNO_COLORS) {
    add(color,'0');
    for(const value of ['1','2','3','4','5','6','7','8','9','skip','reverse','draw2']) for(let i=0;i<2;i++) add(color,value);
  }
  for(const value of ['taser','bomb','banana','egg','potion']) for(let i=0;i<4;i++) add('wild',value);
  return cards;
}
function shuffle(cards,rng) {for(let i=cards.length-1;i>0;i--) {const j=rng(i+1);[cards[i],cards[j]]=[cards[j],cards[i]];}return cards;}
export const unoNext = (g,seat,steps=1)=>((seat-1+g.direction*steps)%g.count+g.count)%g.count+1;
export function unoSeatPositions(count,viewer) {
  const slots=count===2?[0,2]:count===3?[0,1,3]:[0,1,2,3],origin=slots[viewer-1]??0;
  return slots.map((slot,i)=>({seat:i+1,position:['bottom','left','top','right'][(slot-origin+4)%4]}));
}
const publicCard=c=>c?{id:c.id,color:c.color,value:c.value}:null;
function drawOne(g,rng) {
  if(!g.deck.length) {
    const recycle=g.discard.filter(c=>c.id!==g.top?.id);
    g.discard=g.discard.filter(c=>c.id===g.top?.id);g.deck=shuffle(recycle,rng);
  }
  return g.deck.pop();
}
function take(g,seat,amount,rng) {
  const drawn=[];let remaining=amount,bananas=0;
  while(remaining>0) {
    const card=drawOne(g,rng);if(!card) break;
    remaining--;
    if(card.armed) {delete card.armed;g.discard.push(card);remaining+=3;bananas++;}
    else {g.hands[seat-1].push(card);drawn.push(card);}
  }
  if(bananas) g.message+=` 踩中 ${bananas} 张香蕉，额外摸牌。`;
  return drawn;
}
function record(g,seat,action,extra={}) {const entry={number:g.moves.length+1,player:seat,action,...extra};g.moves.push(entry);g.last=entry;}
export function newUno(count=4,rng,first=1) {
  if(![2,3,4].includes(count)||typeof rng!=='function') throw new Error('需要 2～4 人和洗牌随机源');
  const g={kind:'uno',count,hands:Array.from({length:count},()=>[]),deck:shuffle(unoDeck(),rng),discard:[],top:null,turn:first,direction:1,color:'red',phase:'play',drawnId:null,pending:null,resume:null,bombs:[],status:'playing',winner:0,reason:'',moves:[],last:null,message:'每人七张，先出完手牌获胜。',stalled:0};
  for(let n=0;n<7;n++) for(let seat=1;seat<=count;seat++) take(g,seat,1,rng);
  // Start on a number card so no player is penalized before their first turn.
  let top=g.deck.pop();while(UNO_LABELS[top.value]) {g.deck.unshift(top);top=g.deck.pop();}
  g.top=publicCard(top);g.discard.push(top);g.color=top.color;return g;
}
export function unoCanPlay(g,seat,card) {
  if(g.status!=='playing'||seat!==g.turn||!card||!g.hands[seat-1]?.some(c=>c.id===card.id)) return false;
  if(g.pending) return card.value==='potion'||(g.pending.type==='draw2'&&card.value==='draw2');
  if(g.phase==='drawn'&&card.id!==g.drawnId) return false;
  return card.color==='wild'||card.color===g.color||card.value===g.top.value;
}
function finish(g,seat) {
  if(g.hands[seat-1].length) return;
  g.status='finished';g.phase='finished';g.winner=seat;g.reason='empty';g.pending=null;g.resume=null;
  g.message+=` ${seat} 号位出完手牌，赢得本局！`;
}
function accept(g,seat,rng) {
  const p=g.pending;let amount=0;
  if(p.type==='taser') {
    // Each successful iteration consumes a card; recycle cannot loop over cards in hands.
    for(;;) {const cards=take(g,seat,1,rng);amount+=cards.length;if(!cards.length||cards.some(c=>c.color===p.color||c.color==='wild')) break;}
  } else amount=take(g,seat,p.amount||0,rng).length;
  g.message+=p.type==='skip'?` ${seat} 号位被冻结，跳过回合。`:` ${seat} 号位摸了 ${amount} 张罚牌。`;
  g.pending=null;g.drawnId=null;g.phase='play';
  if(g.resume) {Object.assign(g,g.resume);g.resume=null;}
  else g.turn=unoNext(g,seat);
  return amount;
}
// Server time drives bombs. Normal turns never have a deadline.
export function tickUno(g,rng,now=Date.now()) {
  if(g.status!=='playing'||g.pending?.type==='bomb') return false;
  const index=g.bombs.findIndex(b=>b.deadline<=now);if(index<0) return false;
  const [bomb]=g.bombs.splice(index,1);g.discard.push(bomb.card);
  g.resume={turn:g.turn,phase:g.phase,pending:g.pending,drawnId:g.drawnId};
  g.pending={type:'bomb',amount:4};g.phase='penalty';
  g.message=`炸弹在 ${g.turn} 号位面前爆炸！摸四张，或用隐身药水传递。`;
  // No response is needed when there is no defensive card; keep the interrupted turn.
  if(!g.hands[g.turn-1].some(c=>c.value==='potion')) {const target=g.turn;const amount=accept(g,target,rng);record(g,target,'explosion',{amount});}
  else record(g,g.turn,'explosion',{amount:0});
  return true;
}
export function actUno(g,seat,input,rng,now=Date.now()) {
  if(g.status!=='playing') throw new Error('本局已经结束');
  if(g.turn!==seat) throw new Error('还没有轮到你');
  const action=input?.action;
  if(action==='take-penalty') {
    if(!g.pending) throw new Error('当前没有待处理的效果');
    g.message='';const type=g.pending.type,amount=accept(g,seat,rng);record(g,seat,action,{amount,effect:type});return;
  }
  if(action==='draw') {
    if(g.pending||g.phase!=='play') throw new Error('请先处理当前效果');
    g.message=`${seat} 号位摸牌。`;const cards=take(g,seat,1,rng),card=cards.at(-1);
    g.stalled=cards.length?0:g.stalled+1;
    if(card&&unoCanPlay(g,seat,card)) {g.phase='drawn';g.drawnId=card.id;g.message+=' 可以出刚摸到的牌，或保留并跳过。';}
    else {g.phase='play';g.turn=unoNext(g,seat);g.drawnId=null;g.message+=' 本回合结束。';}
    record(g,seat,action,{amount:cards.length});
    if(g.stalled>=g.count&&!g.hands.some((h,i)=>h.some(c=>unoCanPlay({...g,turn:i+1},i+1,c)))) {g.status='finished';g.phase='finished';g.reason='blocked';g.message='所有人都无牌可出或可摸，本局和局。';}
    return;
  }
  if(action==='pass') {
    if(g.phase!=='drawn'||g.pending) throw new Error('只能保留刚摸到的牌');
    g.phase='play';g.drawnId=null;g.turn=unoNext(g,seat);g.message=`${seat} 号位保留手牌，结束回合。`;record(g,seat,action);return;
  }
  if(action!=='play') throw new Error('未知出牌操作');
  const hand=g.hands[seat-1],index=hand.findIndex(c=>c.id===input.id),card=hand[index];
  if(!unoCanPlay(g,seat,card)) throw new Error('这张牌当前不能出');
  if(card.color==='wild'&&!UNO_COLORS.includes(input.color)) throw new Error('请选择一种颜色');
  const pending=g.pending;hand.splice(index,1);g.color=card.color==='wild'?input.color:card.color;g.drawnId=null;g.phase='play';g.stalled=0;
  g.message=`${seat} 号位打出${unoCardLabel(card)}。`;
  let value=card.value;
  if(value==='egg') {
    const outcomes=['0','1','2','3','4','5','6','7','8','9','skip','reverse','draw2','taser','bomb','banana','potion'];
    value=outcomes[rng(outcomes.length)];g.message+=` 惊喜蛋变为${UNO_LABELS[value]||value}！`;
  }
  g.top={...publicCard(card),value};
  if(value==='banana') {card.armed=true;g.deck.splice(rng(g.deck.length+1),0,card);g.message+=' 香蕉已埋入摸牌堆。';}
  else if(value==='bomb') {g.bombs.push({card,deadline:now+20000+rng(15001)});g.message+=' 引信已点燃。';}
  else g.discard.push(card);
  if(pending&&value==='potion') {
    g.pending=pending;g.phase='penalty';g.turn=unoNext(g,seat);g.message+=' 将效果传给下一位。';
  } else if(value==='draw2') {
    g.pending={type:'draw2',amount:(pending?.amount||0)+2};g.phase='penalty';g.turn=unoNext(g,seat);g.message+=` 累计罚牌 ${g.pending.amount} 张。`;
  } else if(value==='taser'||value==='skip') {
    g.pending={type:value,color:g.color,amount:0};g.phase='penalty';g.turn=unoNext(g,seat);
  } else {
    g.pending=null;
    if(value==='reverse') {g.direction*=-1;g.message+=g.direction===1?' 改为顺时针。':' 改为逆时针。';}
    g.turn=unoNext(g,seat,value==='reverse'&&g.count===2?2:1);
  }
  record(g,seat,action,{card:publicCard(card),effect:value,color:g.color,direction:g.direction});
  finish(g,seat);
  if(g.status==='playing'&&g.pending?.type==='skip'&&!g.hands[g.turn-1].some(c=>c.value==='potion')) accept(g,g.turn,rng);
}
export function unoSnapshot(g,seat) {
  const hand=g.hands[seat-1]||[];
  return {kind:'uno',count:g.count,hand:hand.map(publicCard),handCounts:g.hands.map(h=>h.length),deckCount:g.deck.length,top:publicCard(g.top),turn:g.turn,direction:g.direction,color:g.color,phase:g.phase,drawnId:g.turn===seat?g.drawnId:null,pending:g.pending?{...g.pending}:null,bombs:g.bombs.map(b=>({id:b.card.id})),status:g.status,winner:g.winner,reason:g.reason,message:g.message,moves:g.moves.map(m=>({...m})),last:g.last,legalIds:hand.filter(c=>unoCanPlay(g,seat,c)).map(c=>c.id)};
}
export function chooseUnoMove(g) {
  if(g.status!=='playing') return null;
  const hand=g.hands[g.turn-1],color=[...UNO_COLORS].sort((a,b)=>hand.filter(c=>c.color===b).length-hand.filter(c=>c.color===a).length)[0];
  const cards=hand.filter(c=>unoCanPlay(g,g.turn,c));
  cards.sort((a,b)=>(a.color==='wild')-(b.color==='wild') || Boolean(UNO_LABELS[b.value])-Boolean(UNO_LABELS[a.value]));
  return cards.length?{action:'play',id:cards[0].id,color}:{action:g.pending?'take-penalty':g.phase==='drawn'?'pass':'draw'};
}
