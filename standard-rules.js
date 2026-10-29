import * as base from './public/game.js';

// Online standard Gomoku only. Local/AI and fog keep their own turn rules.
export const bonusColors = players => players.filter(p => p?.name?.includes('芽卫兵')).map(p => 3-p.color);
export const newGame = () => ({...base.newGame(), bonus:null});

export function playMove(game, color, x, y, eligible = []) {
  if (game.bonus === 'choice') throw new Error('请先选择再下一颗或结束回合');
  const extra = game.bonus === 'placing';
  base.playMove(game,color,x,y);
  if (extra) game.moves.at(-1).bonusMove = true;
  game.bonus = null;
  if (game.status === 'playing' && !extra && eligible.includes(color)) {
    game.turn = color;
    game.bonus = 'choice';
  }
  return game;
}

export function chooseBonus(game,color,take) {
  if (game.status !== 'playing') throw new Error('本局已结束');
  if (color !== game.turn) throw new Error('还没有轮到你');
  if (typeof take !== 'boolean') throw new Error('请选择再下一颗或结束回合');
  if (!game.bonus || (take && game.bonus !== 'choice')) throw new Error('当前没有可选择的额外落子机会');
  game.bonus = take ? 'placing' : null;
  if (!take) game.turn = 3-color;
}

export function undoMove(game,color) {
  const wasExtra = game.moves.findLast(m=>m.color===color)?.bonusMove;
  const count = base.undoMove(game,color);
  // Undoing an extra stone restores only that extra slot, never a new pair.
  game.bonus = wasExtra ? 'placing' : null;
  return count;
}

export function resign(game,color) { base.resign(game,color); game.bonus=null; }
export function agreeDraw(game) { base.agreeDraw(game); game.bonus=null; }
