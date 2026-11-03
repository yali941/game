import * as base from './public/game.js';

// Online standard Gomoku only. Local/AI and fog keep their own turn rules.
export const newGame = () => ({...base.newGame(), bonus:null, pendingTurn:null});

// Draft coordinates and results never leave the server in an opponent snapshot.
export function standardSnapshot(game, color) {
  const {pendingTurn, ...view} = game;
  const hidden = pendingTurn && pendingTurn.color !== color;
  view.board = [...game.board];
  view.moves = game.moves.slice(0, hidden ? pendingTurn.start : undefined).map(move => {
    const {bonusMove, ...publicMove} = move;
    return move.color === color ? {...move} : publicMove;
  });
  if (hidden) for (const move of game.moves.slice(pendingTurn.start)) view.board[move.y * base.SIZE + move.x] = 0;
  if (game.turn !== color) view.bonus = null;
  return view;
}

export function playMove(game, color, x, y, eligible = []) {
  if (game.status !== 'playing') throw new Error('本局已结束');
  if (color !== game.turn) throw new Error('还没有轮到你');
  if (game.bonus === 'choice') throw new Error('请先选择再下一颗或结束回合');
  if (game.bonus === 'confirm') throw new Error('请点击结束回合');
  const extra = game.bonus === 'placing';
  const start = game.moves.length;
  base.playMove(game,color,x,y);
  if (extra) game.moves.at(-1).bonusMove = true;
  game.bonus = null;
  if (extra || eligible.includes(color)) {
    game.pendingTurn ??= {color, start};
    if (game.status === 'finished') {
      game.pendingTurn.outcome = {status:game.status, winner:game.winner, line:game.line, reason:game.reason};
      game.status = 'playing'; game.winner = 0; game.line = []; game.reason = '';
    }
    game.turn = color;
    game.bonus = extra || game.pendingTurn.outcome ? 'confirm' : 'choice';
  }
  return game;
}

export function chooseBonus(game,color,take) {
  if (game.status !== 'playing') throw new Error('本局已结束');
  if (color !== game.turn) throw new Error('还没有轮到你');
  if (typeof take !== 'boolean') throw new Error('请选择再下一颗或结束回合');
  if (!game.bonus || (take && game.bonus !== 'choice')) throw new Error('当前没有可选择的额外落子机会');
  game.bonus = take ? 'placing' : null;
  if (!take) {
    const outcome = game.pendingTurn?.outcome;
    game.pendingTurn = null;
    if (outcome) Object.assign(game,outcome);
    else game.turn = 3-color;
  }
}

export function undoMove(game,color) {
  if (game.pendingTurn) throw new Error('请等待当前回合结束后再申请悔棋');
  const wasExtra = game.moves.findLast(m=>m.color===color)?.bonusMove;
  const count = base.undoMove(game,color);
  // Undoing an extra stone restores only that extra slot, never a new pair.
  game.bonus = wasExtra ? 'placing' : null;
  game.pendingTurn = wasExtra ? {color,start:game.moves.length} : null;
  return count;
}

function discardDraft(game) {
  if (game.pendingTurn) for (const move of game.moves.splice(game.pendingTurn.start)) game.board[move.y*base.SIZE+move.x] = 0;
  game.pendingTurn = null; game.bonus = null;
}
export function resign(game,color) { base.resign(game,color); discardDraft(game); }
export function agreeDraw(game) { base.agreeDraw(game); discardDraft(game); }
