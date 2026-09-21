import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, playMove, winningLine, resign } from '../public/game.js';

test('black opens, alternate turns, reject wrong turns and occupied or invalid points', () => {
  const game = newGame();
  assert.equal(game.turn, 1);
  assert.throws(() => playMove(game, 2, 7, 7), /轮到/);
  for (const [x, y] of [[-1, 0], [15, 0], [0, 15], [.5, 3], ['1', 1], [NaN, 1]]) assert.throws(() => playMove(game, 1, x, y), /交叉点/);
  playMove(game, 1, 7, 7);
  assert.equal(game.turn, 2);
  assert.throws(() => playMove(game, 2, 7, 7), /已经/);
  assert.equal(game.moves.length, 1);
  playMove(game, 2, 8, 7);
  assert.equal(game.turn, 1);
});

for (const [name, x, y, dx, dy] of [['horizontal', 0, 0, 1, 0], ['vertical', 14, 10, 0, 1], ['diagonal', 0, 0, 1, 1], ['anti diagonal', 0, 14, 1, -1]]) {
  test(`five connected stones win: ${name}, including board edges`, () => {
    const game = newGame();
    for (let i = 0; i < 4; i++) game.board[(y + i * dy) * 15 + x + i * dx] = 1;
    playMove(game, 1, x + 4 * dx, y + 4 * dy);
    assert.equal(game.winner, 1); assert.equal(game.line.length, 5); assert.equal(game.status, 'finished');
    const before = JSON.stringify(game);
    assert.throws(() => playMove(game, 2, 7, 7), /结束/);
    assert.equal(JSON.stringify(game), before);
  });
}
test('bridging a gap into six is a win under unrestricted Gomoku rules', () => {
  const game = newGame(); game.turn = 2;
  for (const x of [2, 3, 4, 6, 7]) game.board[7 * 15 + x] = 2;
  playMove(game, 2, 5, 7); assert.equal(game.winner, 2); assert.equal(game.line.length, 6);
});
test('rows do not wrap, and opposing stones interrupt a line', () => {
  const game = newGame();
  for (const i of [13, 14, 15, 16, 17]) game.board[i] = 1;
  assert.deepEqual(winningLine(game.board, 2, 1, 1), []);
  game.board.fill(0);
  for (let x = 0; x < 6; x++) game.board[x] = x === 3 ? 2 : 1;
  assert.deepEqual(winningLine(game.board, 2, 0, 1), []);
});
test('full board without five is a draw', () => {
  const game = newGame();
  for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) {
    const color = (x + 2 * y) % 4 < 2 ? 1 : 2;
    game.board[y * 15 + x] = color; game.moves.push({ x, y, color });
  }
  for (const m of game.moves) assert.deepEqual(winningLine(game.board, m.x, m.y, m.color), []);
  const last = game.moves.pop(); game.board[224] = 0; game.turn = last.color;
  playMove(game, last.color, 14, 14);
  assert.equal(game.status, 'finished'); assert.equal(game.reason, 'draw'); assert.equal(game.winner, 0);
});
test('resigning awards victory to the opponent', () => {
  const game = newGame(); resign(game, 1); assert.equal(game.winner, 2); assert.equal(game.reason, 'resign');
  assert.throws(() => resign(game, 2), /结束/);
});
