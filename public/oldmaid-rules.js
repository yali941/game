// One standard deck plus one turtle. Only oldMaidSnapshot may leave the server.
export const OLDMAID_SUITS = ['♠', '♥', '♣', '♦'];
export function oldMaidDeck() {
  return [...OLDMAID_SUITS.flatMap((suit, s) => Array.from({length:13}, (_, i) => ({id:`${s}-${i+1}`, rank:i+1, suit}))), {id:'turtle', rank:0, suit:'🐢'}];
}
function shuffle(cards, random) {
  for (let i=cards.length-1;i>0;i--) {const j=random(i+1);[cards[i],cards[j]]=[cards[j],cards[i]];}
}
function removePairs(hand, pairs) {
  const kept=[];
  for(const card of hand) {
    const index=card.rank ? kept.findIndex(c=>c.rank===card.rank) : -1;
    if(index<0) kept.push(card); else pairs.push([kept.splice(index,1)[0],card]);
  }
  return kept;
}
export function waitingOldMaid(count=1) {
  return {kind:'oldmaid',count,hands:Array.from({length:count},()=>[]),pairs:[],finishOrder:[],winners:[],loser:0,winner:0,turn:0,status:'waiting',moves:[],last:null,message:'2～8 人入座，最后留下乌龟的人输。'};
}
export function oldMaidTarget(g, seat=g.turn) {
  for(let n=1;n<g.count;n++) {const next=(seat-1+n)%g.count+1;if(g.hands[next-1].length) return next;}
  return 0;
}
function settle(g) {
  for(let seat=1;seat<=g.count;seat++) if(!g.hands[seat-1].length&&!g.finishOrder.includes(seat)) g.finishOrder.push(seat);
  const remaining=g.hands.map((h,i)=>h.length?i+1:0).filter(Boolean);
  if(remaining.length===1) {
    g.status='finished';g.loser=remaining[0];g.winners=[...g.finishOrder];g.winner=g.winners[0]||0;g.turn=0;
    g.message=`${g.loser} 号位留下了乌龟，其他玩家都安全啦！`;
  }
}
export function newOldMaid(count, random, first=1) {
  if(!Number.isInteger(count)||count<2||count>8) throw new Error('抽乌龟支持 2～8 人');
  const g=waitingOldMaid(count),deck=oldMaidDeck();shuffle(deck,random);
  deck.forEach((c,i)=>g.hands[i%count].push(c));
  g.hands=g.hands.map(h=>{const kept=removePairs(h,g.pairs);shuffle(kept,random);return kept;});
  g.status='playing';g.turn=first;g.message='对子已自动收好。轮流从下一位有牌的玩家手里抽一张。';
  settle(g);if(g.status==='playing'&&!g.hands[g.turn-1].length) g.turn=oldMaidTarget(g);
  return g;
}
export function actOldMaid(g,seat,move,random) {
  if(g.status!=='playing') throw new Error('本局还未开始或已经结束');
  if(!Number.isInteger(seat)||seat<1||seat>g.count||!g.hands[seat-1].length) throw new Error('你已安全，可以观看其他玩家继续');
  if(move?.action==='shuffle') {shuffle(g.hands[seat-1],random);return;}
  if(move?.action==='reorder') {
    const hand=g.hands[seat-1],order=move.order;
    if(!Array.isArray(order)||order.length!==hand.length||new Set(order).size!==hand.length||order.some(id=>!hand.some(c=>c.id===id))) throw new Error('手牌已变化，请重新调整顺序');
    g.hands[seat-1]=order.map(id=>hand.find(c=>c.id===id));return;
  }
  if(move?.action!=='draw') throw new Error('请选择一张牌来抽');
  if(seat!==g.turn) throw new Error('还没轮到你抽牌');
  const target=oldMaidTarget(g,seat),source=g.hands[target-1],index=move.index;
  if(!Number.isInteger(index)||index<0||index>=source.length) throw new Error('这张牌已变动，请重新选择');
  const card=source.splice(index,1)[0],hand=g.hands[seat-1],match=card.rank?hand.findIndex(c=>c.rank===card.rank):-1;
  const pair=match>=0?[hand.splice(match,1)[0],card]:null;
  // Insert the new card unpredictably while preserving the player's arranged cards.
  if(pair) g.pairs.push(pair);else hand.splice(random(hand.length+1),0,card);
  // No drawn identity or new position is published, even to spectators.
  g.last={number:g.moves.length+1,action:'draw',seat,target,index,pair};g.moves.push({...g.last});
  g.message=pair?`${seat} 号位抽到一对，轻松放下！`:`${seat} 号位抽了一张牌。`;
  settle(g);if(g.status==='playing') g.turn=oldMaidTarget(g,seat);
}
export function oldMaidSnapshot(g,seat) {
  return {kind:g.kind,count:g.count,status:g.status,turn:g.turn,target:g.status==='playing'?oldMaidTarget(g):0,
    hand:g.hands[seat-1].map(c=>({...c})),handCounts:g.hands.map(h=>h.length),pairCount:g.pairs.length,
    finishOrder:[...g.finishOrder],winners:[...g.winners],loser:g.loser,winner:g.winner,
    last:g.last?structuredClone(g.last):null,moveCount:g.moves.length,message:g.message};
}
