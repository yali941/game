import test from 'node:test';
import assert from 'node:assert/strict';
import { newCube, turn, scramble, faceGrid, isSolved, inverseSequence } from '../public/cube-rules.js';

test('cube starts solved with six traditional face colours', () => {
  const cube = newCube(); assert.equal(isSolved(cube), true);
  for (const face of ['U','R','F','D','L','B']) assert.equal(new Set(faceGrid(cube, face)).size, 1);
});
test('every face turn is reversible and four turns restore the cube', () => {
  for (const face of ['U','R','F','D','L','B']) {
    const cube = newCube(); turn(cube, face, 1); turn(cube, face, -1); assert.equal(isSolved(cube), true, `${face} inverse`);
    for (let i = 0; i < 4; i++) turn(cube, face, 1); assert.equal(isSolved(cube), true, `${face} four turns`);
  }
});
test('scramble changes the puzzle and inverse sequence solves it', () => {
  const cube = newCube(), moves = scramble(cube, () => .37, 22); assert.equal(moves.length, 22); assert.equal(isSolved(cube), false);
  for (const move of inverseSequence(moves)) turn(cube, move.face, move.direction); assert.equal(isSolved(cube), true);
});
test('face grids always contain nine visible stickers', () => {
  const cube = newCube(); scramble(cube, Math.random, 12);
  for (const face of ['U','R','F','D','L','B']) assert.equal(faceGrid(cube, face).length, 9);
});
test('turns only move existing stickers and preserve nine of every colour', () => {
  const cube = newCube();
  for (const move of [
    ['F', 1], ['R', -1], ['U', 1], ['B', -1], ['D', 1], ['L', -1],
    ['F', -1], ['R', 1], ['U', -1], ['B', 1], ['D', -1], ['L', 1],
  ]) turn(cube, move[0], move[1]);
  const counts = Object.fromEntries(['U', 'R', 'F', 'D', 'L', 'B'].map(color => [color, 0]));
  for (const sticker of cube.stickers) counts[sticker.color]++;
  assert.deepEqual(counts, { U: 9, R: 9, F: 9, D: 9, L: 9, B: 9 });
  assert.equal(cube.stickers.length, 54);
});
