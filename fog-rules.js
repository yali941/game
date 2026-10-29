import { SIZE, newGame as standardGame, winningLine, resign, agreeDraw } from './public/game.js';

export { resign, agreeDraw };
export const PROBE_MS = 2400;
export function newGame() {
  return { ...standardGame(), kind: 'fog', probes: {}, retrySpot: null, revealed: { 1: [], 2: [] } };
}

export function visibility(game, color) {
  const visible = Array(SIZE * SIZE).fill(game.status === 'finished');
  if (color !== 1 && color !== 2) return visible;
  for (const index of game.revealed[color]) visible[index] = true;
  game.board.forEach((stone, index) => {
    if (stone !== color) return;
    const x = index % SIZE, y = Math.floor(index / SIZE);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (x + dx >= 0 && x + dx < SIZE && y + dy >= 0 && y + dy < SIZE) visible[(y + dy) * SIZE + x + dx] = true;
    }
  });
  return visible;
}

export function playMove(game, color, x, y, now = Date.now()) {
  if (game.status !== 'playing') throw new Error('本局已结束');
  if (color !== game.turn) throw new Error('还没有轮到你');
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= SIZE || y >= SIZE) throw new Error('请选择棋盘内的交叉点');
  const index = y * SIZE + x;
  if (game.board[index]) {
    if (visibility(game, color)[index]) throw new Error('这里已经有棋子了');
    if (game.retrySpot?.x === x && game.retrySpot?.y === y) throw new Error('这里已有棋子，请换一个点位再下');
    const retry = !game.retrySpot;
    game.probes[color] = { x, y, color: game.board[index], expiresAt: now + PROBE_MS, retry };
    if (retry) game.retrySpot = { x, y };
    else {
      // One private retry per turn; a second collision consumes that turn.
      game.moves.push({ x, y, color, blocked: true });
      if (!game.revealed[color].includes(index)) game.revealed[color].push(index);
      game.retrySpot = null; game.turn = 3 - color;
    }
    return game;
  }
  delete game.probes[color];
  game.retrySpot = null;
  game.board[index] = color;
  game.moves.push({ x, y, color });
  game.line = winningLine(game.board, x, y, color);
  if (game.line.length) {
    game.status = 'finished'; game.winner = color; game.reason = 'five';
  } else if (game.board.every(Boolean)) {
    game.status = 'finished'; game.reason = 'draw';
  } else game.turn = 3 - color;
  return game;
}

export function undoMove(game, color) {
  if (game.status !== 'playing') throw new Error('本局已结束，不能悔棋');
  const index = game.moves.findLastIndex(move => move.color === color);
  if (index < 0) throw new Error('你还没有落子，暂时不能悔棋');
  const removed = game.moves.splice(index);
  for (const move of removed) if (!move.blocked) game.board[move.y * SIZE + move.x] = 0;
  game.turn = color; game.winner = 0; game.line = []; game.reason = ''; game.probes = {}; game.retrySpot = null;
  return removed.length;
}

// Whitelist the wire format: never serialize the authoritative hidden board.
export function fogSnapshot(game, color, now = Date.now()) {
  const visible = visibility(game, color), finished = game.status === 'finished';
  const probe = game.probes[color];
  return {
    kind: 'fog', board: game.board.map((stone, i) => visible[i] ? stone : null), visibility: visible,
    turn: game.turn, status: game.status, winner: game.winner, reason: game.reason,
    retryUsed: !finished && color === game.turn && Boolean(game.retrySpot),
    line: finished ? game.line.map(p => [...p]) : [],
    moves: game.moves.map(move => finished || move.color === color || (!move.blocked && visible[move.y * SIZE + move.x])
      ? { ...move } : { color: move.color, hidden: true }),
    probe: !finished && probe?.expiresAt > now ? { ...probe, remainingMs: probe.expiresAt - now } : null,
  };
}
