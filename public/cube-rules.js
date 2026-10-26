export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
export const FACE_NAMES = { U: '上面', R: '右面', F: '前面', D: '下面', L: '左面', B: '后面' };
export const FACE_COLORS = { U: '#f7f1db', R: '#dc4438', F: '#31a55f', D: '#f2c84b', L: '#ee8c3f', B: '#3473c5' };
const normals = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
const same = (a, b) => a.every((v, i) => v === b[i]);
const rotateVector = (v, axis, turns) => {
  let [x, y, z] = v;
  for (let i = 0; i < (turns + 4) % 4; i++) {
    if (axis === 'x') [y, z] = [-z, y];
    else if (axis === 'y') [x, z] = [z, -x];
    else [x, y] = [-y, x];
  }
  return [x, y, z];
};
const faceAxis = face => {
  const n = normals[face];
  return n[0] ? ['x', n[0]] : n[1] ? ['y', n[1]] : ['z', n[2]];
};
const stickersForFace = face => {
  const n = normals[face], stickers = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    if (n[0] && x !== n[0] || n[1] && y !== n[1] || n[2] && z !== n[2]) continue;
    stickers.push({ position: [x, y, z], normal: [...n], color: face });
  }
  return stickers;
};
export function newCube() {
  return { stickers: FACES.flatMap(stickersForFace), moves: 0, history: [], scrambled: false, solved: true };
}
export function cloneCube(cube) {
  return { ...cube, stickers: cube.stickers.map(s => ({ position: [...s.position], normal: [...s.normal], color: s.color })), history: [...cube.history] };
}
function isLayer(sticker, face) {
  const [axis, sign] = faceAxis(face);
  const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  return sticker.position[index] === sign;
}
export function turn(cube, face, direction = 1, { record = true } = {}) {
  if (!FACES.includes(face) || ![1, -1].includes(direction)) throw new Error('无效的魔方面或方向');
  const [axis, sign] = faceAxis(face);
  const turns = (direction === 1 ? -sign : sign) + 4;
  for (const sticker of cube.stickers) if (isLayer(sticker, face)) {
    sticker.position = rotateVector(sticker.position, axis, turns);
    sticker.normal = rotateVector(sticker.normal, axis, turns);
  }
  cube.moves++;
  cube.solved = isSolved(cube);
  if (record) cube.history.push({ face, direction });
  return cube;
}
export function isSolved(cube) {
  return cube.stickers.every(sticker => {
    const face = FACES.find(key => same(normals[key], sticker.normal));
    return sticker.color === face;
  });
}
export function faceGrid(cube, face) {
  const n = normals[face], grid = Array(9).fill(face);
  for (const sticker of cube.stickers) {
    if (!same(sticker.normal, n)) continue;
    const [x, y, z] = sticker.position;
    let row, col;
    if (face === 'U') [row, col] = [z + 1, x + 1];
    else if (face === 'D') [row, col] = [1 - z, x + 1];
    else if (face === 'F') [row, col] = [1 - y, x + 1];
    else if (face === 'B') [row, col] = [1 - y, 1 - x];
    else if (face === 'R') [row, col] = [1 - y, 1 - z];
    else [row, col] = [1 - y, z + 1];
    grid[row * 3 + col] = sticker.color;
  }
  return grid;
}
export function scramble(cube, random = Math.random, length = 22) {
  let previous = '';
  const moves = [];
  for (let i = 0; i < length; i++) {
    let face = FACES[Math.floor(random() * FACES.length)];
    if (face === previous) face = FACES[(FACES.indexOf(face) + 1) % FACES.length];
    previous = face;
    const direction = random() < .5 ? 1 : -1;
    turn(cube, face, direction, { record: false });
    moves.push({ face, direction });
  }
  cube.history = [];
  cube.scrambled = true;
  cube.solved = isSolved(cube);
  return moves;
}
export function inverseSequence(sequence) {
  return [...sequence].reverse().map(move => ({ face: move.face, direction: -move.direction }));
}
