// Animation is presentation only. The server remains authoritative for hands and turns.
export function createUnoMotion({board,cardNode}) {
  const running=new Set();
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const seat=n=>board.querySelector(`[data-seat="${n}"] .seat-hand`);
  const deck=()=>board.querySelector('#draw-button');
  const center=node=>{const r=node.getBoundingClientRect(),b=board.getBoundingClientRect();return {x:r.left+r.width/2-b.left-board.clientLeft,y:r.top+r.height/2-b.top-board.clientTop};};
  function fly(from,to,{card,delay=0,insert=false}={}) {
    if(!from||!to||reduced()||document.hidden) return;
    const a=center(from),b=center(to),node=card?cardNode(card):document.createElement('div');
    node.classList.add('uno-flying-card');if(!card) {node.classList.add('mini-back');node.textContent='一局';}
    node.setAttribute('aria-hidden','true');board.append(node);
    const transform=(p,rotate,scale)=>`translate(${p.x}px,${p.y}px) translate(-50%,-50%) rotate(${rotate}deg) scale(${scale})`;
    const animation=node.animate([
      {transform:transform(a,-12,1),opacity:0},
      {transform:transform({x:a.x+(b.x-a.x)*.45,y:Math.min(a.y,b.y)-22},9,1.12),opacity:1,offset:.45},
      {transform:transform(b,insert?90:0,insert?.35:.8),opacity:insert?0:1}
    ],{duration:insert?800:480,delay,easing:'cubic-bezier(.2,.65,.35,1)',fill:'both'});
    const cleanup=()=>{node.remove();running.delete(animation);};running.add(animation);animation.onfinish=cleanup;animation.oncancel=cleanup;
  }
  function effect(target,type,delay=0) {
    if(!['taser','skip','bomb'].includes(type)||reduced()||document.hidden) return;
    const node=board.querySelector(`[data-seat="${target}"]`);if(!node)return;
    const flash=document.createElement('span');flash.className=`uno-hit hit-${type}`;flash.textContent={taser:'ϟ',skip:'❄',bomb:'💥'}[type];flash.setAttribute('aria-hidden','true');node.append(flash);
    const animation=flash.animate(type==='taser'?
      [{opacity:0,transform:'translateX(0)'},{opacity:1,transform:'translateX(-5px)',offset:.15},{opacity:.35,transform:'translateX(5px)',offset:.3},{opacity:1,transform:'translateX(-3px)',offset:.5},{opacity:.5,transform:'translateX(3px)',offset:.7},{opacity:0,transform:'translateX(0)'}]:
      [{opacity:0,transform:'scale(.6)'},{opacity:1,transform:'scale(1.06)',offset:.25},{opacity:.9,transform:'scale(1)',offset:.75},{opacity:0,transform:'scale(1.2)'}],
      {duration:type==='skip'?1800:1200,delay,fill:'both'});
    const cleanup=()=>{flash.remove();running.delete(animation);};running.add(animation);animation.onfinish=cleanup;animation.oncancel=cleanup;
  }
  function clear(){for(const animation of running)animation.cancel();running.clear();}
  function update(previous,next) {
    if(!previous||previous.code!==next.code||document.hidden) {clear();return;}
    const freshRound=(!previous.started&&next.started)||(previous.round!==next.round);
    if(freshRound) {
      clear();
      // Deal clockwise around the visible table, seven cards per player.
      const seats=[...board.querySelectorAll('[data-seat]')];
      for(let n=0;n<7;n++) seats.forEach((node,i)=>fly(deck(),node.querySelector('.seat-hand'),{delay:(n*seats.length+i)*35}));
      return;
    }
    if(!next.started||!previous.started)return;
    const after=previous.game.last?.number||0;
    const moves=next.game.moves.filter(m=>m.number>after);
    // A restored/background tab shows current state, without replaying a long backlog.
    if(moves.length>8)return;
    moves.forEach((move,index)=>{
      const delay=index*160;
      if(move.action==='play') {
        fly(seat(move.player),move.effect==='banana'?deck():board.querySelector('#discard'),{card:move.card,delay,insert:move.effect==='banana'});
        if(move.target)effect(move.target,move.targetEffect,delay+220);
      }
      if(move.amount>0)for(let i=0;i<Math.min(move.amount,12);i++)fly(deck(),seat(move.player),{delay:delay+i*75});
      if(move.action==='take-penalty')effect(move.player,move.effect,delay);
      if(move.action==='explosion')effect(move.player,'bomb',delay);
    });
  }
  return {update,clear};
}
