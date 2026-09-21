export const SIZE = 15;

export function newGame() {
  return { board: Array(SIZE * SIZE).fill(0), turn: 1, moves: [], status: 'playing', winner: 0, line: [], reason: '' };
}

export function winningLine(board, x, y, color) {
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const line = [[x, y]];
    for (const sign of [-1, 1]) {
      let nx = x + dx * sign, ny = y + dy * sign;
      while (nx >= 0 && ny >= 0 && nx < SIZE && ny < SIZE && board[ny * SIZE + nx] === color) {
        if (sign < 0) line.unshift([nx, ny]); else line.push([nx, ny]);
        nx += dx * sign; ny += dy * sign;
      }
    }
    if (line.length >= 5) return line;
  }
  return [];
}

export function playMove(game, color, x, y) {
  if (game.status !== 'playing') throw new Error('本局已结束');
  if (color !== game.turn) throw new Error('还没有轮到你');
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= SIZE || y >= SIZE) throw new Error('请选择棋盘内的交叉点');
  if (game.board[y * SIZE + x]) throw new Error('这里已经有棋子了');
  game.board[y * SIZE + x] = color;
  game.moves.push({ x, y, color });
  game.line = winningLine(game.board, x, y, color);
  if (game.line.length) {
    game.status = 'finished'; game.winner = color; game.reason = 'five';
  } else if (game.moves.length === SIZE * SIZE) {
    game.status = 'finished'; game.reason = 'draw';
  } else game.turn = 3 - color;
  return game;
}

export function resign(game, color) {
  if (game.status !== 'playing') throw new Error('本局已结束');
  if (color !== 1 && color !== 2) throw new Error('无效的执棋方');
  game.status = 'finished'; game.winner = 3 - color; game.reason = 'resign';
}

// Return to just before the requesting player's most recent move. If the
// opponent has already replied, both moves are removed so the requester moves.
export function undoMove(game, color) {
  if (game.status !== 'playing') throw new Error('本局已结束，不能悔棋');
  const index = game.moves.findLastIndex(move => move.color === color);
  if (index < 0) throw new Error('你还没有落子，暂时不能悔棋');
  const removed = game.moves.splice(index);
  for (const move of removed) game.board[move.y * SIZE + move.x] = 0;
  game.turn = color; game.winner = 0; game.line = []; game.reason = '';
  return removed.length;
}

export function agreeDraw(game) {
  if (game.status !== 'playing') throw new Error('本局已结束');
  game.status = 'finished'; game.winner = 0; game.line = []; game.reason = 'agreement';
}
