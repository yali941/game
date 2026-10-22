export const SIZE = 19;
export const KOMI = 7.5; // Area-point difference; equivalent to black returning 3.75 Chinese zi.
export function newGame() {
  const board=Array(SIZE*SIZE).fill(0);
  return {kind:'go',board,turn:1,moves:[],status:'playing',phase:'play',winner:0,line:[],reason:'',captures:[0,0],passes:0,positions:[board.join('')],dead:[],confirmed:[],score:null};
}
export function neighbors(i) {
  const x=i%SIZE,y=Math.floor(i/SIZE),out=[];
  if(x>0)out.push(i-1);if(x<SIZE-1)out.push(i+1);if(y>0)out.push(i-SIZE);if(y<SIZE-1)out.push(i+SIZE);return out;
}
export function group(board,index) {
  const color=board[index],stones=new Set(),liberties=new Set(),todo=[index];
  if(!color)return {stones:[],liberties};
  while(todo.length){const i=todo.pop();if(stones.has(i))continue;stones.add(i);for(const j of neighbors(i)){if(!board[j])liberties.add(j);else if(board[j]===color&&!stones.has(j))todo.push(j);}}
  return {stones:[...stones],liberties};
}
function player(color){if(color!==1&&color!==2)throw new Error('无效的执棋方');}
function playing(g){if(g.status!=='playing')throw new Error('本局已结束');}
function turn(g,color){playing(g);player(color);if(g.phase!=='play')throw new Error('正在确认死子，请先继续对局');if(g.turn!==color)throw new Error('还没有轮到你');}
export function simulateMove(g,color,x,y) {
  turn(g,color);
  if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=SIZE||y>=SIZE)throw new Error('请选择棋盘内的交叉点');
  const index=y*SIZE+x;if(g.board[index])throw new Error('这里已经有棋子了');
  const board=[...g.board],captured=[];board[index]=color;
  for(const n of neighbors(index))if(board[n]===3-color){const enemy=group(board,n);if(!enemy.liberties.size){captured.push(...enemy.stones);for(const i of enemy.stones)board[i]=0;}}
  if(!group(board,index).liberties.size)throw new Error('禁入点：落子后没有气，且无法提子');
  const position=board.join('');if(g.positions.includes(position))throw new Error('不能立即回提或重复已经出现过的棋盘局面');
  return {board,captured,position};
}
export function playMove(g,color,x,y) {
  const next=simulateMove(g,color,x,y);g.board=next.board;g.captures[color-1]+=next.captured.length;g.positions.push(next.position);
  g.moves.push({x,y,color,captured:next.captured});g.passes=0;g.turn=3-color;return g;
}
export function pass(g,color) {
  turn(g,color);g.moves.push({color,pass:true});g.turn=3-color;g.passes++;
  if(g.passes===2){g.phase='scoring';g.dead=[];g.confirmed=[];g.score=scoreBoard(g);}
}
export function scoreBoard(g) {
  const board=[...g.board];for(const i of g.dead)board[i]=0;
  const stones=[0,0],territory=[0,0],owners=Array(SIZE*SIZE).fill(0),seen=new Set();let neutral=0;
  for(let i=0;i<board.length;i++){
    if(board[i]){stones[board[i]-1]++;continue;}if(seen.has(i))continue;
    const region=[],boundary=new Set(),todo=[i];seen.add(i);
    while(todo.length){const n=todo.pop();region.push(n);for(const j of neighbors(n)){if(board[j])boundary.add(board[j]);else if(!seen.has(j)){seen.add(j);todo.push(j);}}}
    if(boundary.size===1){const owner=[...boundary][0];territory[owner-1]+=region.length;for(const n of region)owners[n]=owner;}else neutral+=region.length;
  }
  const black=stones[0]+territory[0]+neutral/2,white=stones[1]+territory[1]+neutral/2;
  const difference=black-white-KOMI;
  return {stones,territory,neutral,owners,black,white,komi:KOMI,margin:Math.abs(difference)/2,winner:difference>0?1:2};
}
function scoring(g,color){playing(g);player(color);if(g.phase!=='scoring')throw new Error('请双方先连续停一手，再确认死子');}
export function toggleDead(g,color,x,y) {
  scoring(g,color);if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=SIZE||y>=SIZE)throw new Error('请选择棋盘上的棋子');
  const i=y*SIZE+x;if(!g.board[i])throw new Error('点选一块棋子来标记或取消死子');
  const stones=group(g.board,i).stones,dead=new Set(g.dead),remove=dead.has(i);
  for(const n of stones)remove?dead.delete(n):dead.add(n);
  g.dead=[...dead].sort((a,b)=>a-b);g.confirmed=[];g.score=scoreBoard(g);
}
export function confirmScore(g,color) {
  scoring(g,color);if(g.confirmed.includes(color))throw new Error('你已确认，等待对方确认');g.confirmed.push(color);
  if(g.confirmed.length===2){g.score=scoreBoard(g);g.winner=g.score.winner;g.status='finished';g.reason='score';}
}
export function resume(g,color){scoring(g,color);g.phase='play';g.passes=0;g.dead=[];g.confirmed=[];g.score=null;g.moves.push({color,resume:true});}
export function resign(g,color){playing(g);player(color);g.status='finished';g.winner=3-color;g.reason='resign';g.confirmed=[];}
export function agreeDraw(g){playing(g);g.status='finished';g.winner=0;g.reason='agreement';}
export function undoMove(g,color){
  playing(g);player(color);if(g.phase!=='play')throw new Error('请先继续对局，再申请悔棋');
  const index=g.moves.findLastIndex(m=>m.color===color&&!m.resume);if(index<0)throw new Error('你还没有行棋，暂时不能悔棋');
  const count=g.moves.length-index,rest=g.moves.slice(0,index),restored=newGame();
  for(const m of rest){if(m.resume)resume(restored,m.color);else if(m.pass)pass(restored,m.color);else playMove(restored,m.color,m.x,m.y);}
  Object.assign(g,restored);return count;
}
export function goSnapshot(g){const {positions,...visible}=g;return visible;}
export function chooseGoMove(g){
  if(g.status!=='playing'||g.phase!=='play')return null;
  // Basic assistance, not a Go engine. Never fill a fully surrounded friendly eye.
  let best=null;
  for(let i=0;i<g.board.length;i++)if(!g.board[i]){
    const ns=neighbors(i);if(ns.every(n=>g.board[n]===g.turn))continue;
    const x=i%SIZE,y=Math.floor(i/SIZE);
    try{const next=simulateMove(g,g.turn,x,y),liberties=group(next.board,i).liberties.size;if(liberties<2&&!next.captured.length)continue;
      const score=next.captured.length*100+Math.min(liberties,4)*2+ns.filter(n=>g.board[n]===3-g.turn).length*3-((x-9)**2+(y-9)**2)/100;
      if(!best||score>best.score)best={action:'move',x,y,score};
    }catch{/* Illegal candidates are not played. */}
  }
  return best||{action:'pass'};
}
