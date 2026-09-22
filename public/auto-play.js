import { SIZE, winningLine } from './game.js';
import { jungleTargets, denOwner, flightOptions } from './table-rules.js';

// Deterministic, legal moves for optional assistance. Rules still validate every move.
export function chooseAutoMove(game) {
  if (game.status !== 'playing') return null;
  if (game.kind === 'flight') {
    if (game.phase === 'roll') return { action:'roll' };
    const options = flightOptions(game);
    const pieces = game.planes.filter(p => options.includes(p.id));
    pieces.sort((a,b) => {
      const score = p => p.progress + game.dice === 56 ? 1000 : p.progress === -1 ? 65 : p.progress + game.dice > 56 ? -10 : p.progress + 20;
      return score(b)-score(a);
    });
    return pieces.length ? { action:'move', id:pieces[0].id } : null;
  }
  if (game.kind === 'jungle') {
    const choices = [];
    for (const p of game.pieces.filter(p => p.owner === game.turn)) for (const target of jungleTargets(game,p.id)) {
      const victim = game.pieces.find(q => q.x===target.x && q.y===target.y);
      const simulated = { ...game, pieces:game.pieces.filter(q => q.id!==victim?.id).map(q => q.id===p.id ? {...q,...target} : q) };
      const threatened = simulated.pieces.some(q => q.owner!==p.owner && jungleTargets(simulated,q.id).some(t => t.x===target.x && t.y===target.y));
      const distance = Math.abs(target.x-3) + Math.abs(target.y-(p.owner===1 ? 0 : 8));
      choices.push({ action:'move',id:p.id,...target,score:denOwner(target.x,target.y)===3-p.owner ? 10000 : (victim?.rank||0)*24-distance*3-(threatened ? p.rank*30 : 0) });
    }
    choices.sort((a,b)=>b.score-a.score);
    return choices[0] || null;
  }
  const choices = [];
  for (let y=0;y<SIZE;y++) for (let x=0;x<SIZE;x++) {
    const index=y*SIZE+x;
    if (game.board[index]) continue;
    const board=[...game.board]; board[index]=game.turn;
    if (winningLine(board,x,y,game.turn).length) return {action:'move',x,y};
    board[index]=3-game.turn;
    let score=winningLine(board,x,y,3-game.turn).length ? 100000 : 0;
    for (const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]) for (const color of [game.turn,3-game.turn]) {
      let count=0,open=0;
      for (const sign of [-1,1]) {
        let nx=x+dx*sign,ny=y+dy*sign;
        while(nx>=0 && nx<SIZE && ny>=0 && ny<SIZE && game.board[ny*SIZE+nx]===color) {count++;nx+=dx*sign;ny+=dy*sign;}
        if(nx>=0 && nx<SIZE && ny>=0 && ny<SIZE && !game.board[ny*SIZE+nx]) open++;
      }
      score += (10**count)*open*(color===game.turn ? 1.2 : 1);
    }
    choices.push({action:'move',x,y,score:score-Math.abs(x-7)-Math.abs(y-7)});
  }
  choices.sort((a,b)=>b.score-a.score);
  return choices[0] || null;
}
