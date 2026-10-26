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
