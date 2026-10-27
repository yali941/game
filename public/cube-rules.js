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
export function turn(cube, face, direction = 1, { record = true } = {}) {
  if (!FACES.includes(face) || ![1, -1].includes(direction)) throw new Error('无效的魔方面或方向');
  const [axis, sign] = faceAxis(face);
  turnLayer(cube, axis, sign, -sign * direction, { record: false });
  if (record) cube.history.push({ face, direction });
  return cube;
}
// Right-handed, Y-up quarter turns shared by rendering and puzzle state.
export function turnLayer(cube, axis, index, direction, { record = true } = {}) {
  if (!['x', 'y', 'z'].includes(axis) || ![-1, 0, 1].includes(index) || ![-1, 1].includes(direction)) throw new Error('无效的魔方层');
  const coordinate = ['x', 'y', 'z'].indexOf(axis);
  const turns = direction + 4;
  for (const sticker of cube.stickers) if (sticker.position[coordinate] === index) {
    sticker.position = rotateVector(sticker.position, axis, turns);
    sticker.normal = rotateVector(sticker.normal, axis, turns);
  }
  cube.moves++;
  cube.solved = isSolved(cube);
  if (record) cube.history.push({ axis, index, direction });
  return cube;
}
export function isSolved(cube) {
  return FACES.every(face => new Set(cube.stickers.filter(s => same(normals[face], s.normal)).map(s => s.color)).size === 1);
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

// Geometry shared by direct manipulation and its regression tests.
export const AXES = ['x', 'y', 'z'];
export const NORMALS = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
export function rotatePoint([x, y, z], axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  if (axis === 'x') return [x, c * y - s * z, s * y + c * z];
  if (axis === 'y') return [c * x + s * z, y, -s * x + c * z];
  return [c * x - s * y, s * x + c * y, z];
}
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const applyView = (p, m) => [0, 1, 2].map(r => p.reduce((sum, v, c) => sum + m[r * 3 + c] * v, 0));
function rotateView(view, axis, angle) {
  const columns = [0, 1, 2].map(c => rotatePoint([view[c], view[3 + c], view[6 + c]], axis, angle));
  return [0, 1, 2].flatMap(r => columns.map(c => c[r]));
}
export const defaultView = () => rotateView(rotateView(identity, 'y', -36 * Math.PI / 180), 'x', -28 * Math.PI / 180);
// Look straight at a physical face; this changes the camera only.
export function alignedView(face) {
  const rotations = { F: ['y', 0], B: ['y', Math.PI], R: ['y', -Math.PI / 2], L: ['y', Math.PI / 2], U: ['x', -Math.PI / 2], D: ['x', Math.PI / 2] };
  if (!rotations[face]) throw new Error('无效的观察方向');
  return rotateView(identity, ...rotations[face]);
}
// Rotations are applied in screen space, even after turning the cube upside down.
export const orbitView = (view, dx, dy) => rotateView(rotateView(view, 'y', dx * .007), 'x', -dy * .007);
export const viewTransform = m => `matrix3d(${[m[0], m[3], m[6], 0, m[1], m[4], m[7], 0, m[2], m[5], m[8], 0, 0, 0, 0, 1].join(',')})`;
// CSS has Y down. Reflecting Y reverses rotation about X and Z, but not Y.
export const cssAngle = (axis, angle) => axis === 'y' ? angle : -angle;
export const layerTransform = (axis, angle) => `rotate${axis.toUpperCase()}(${cssAngle(axis, angle)}rad)`;
export function projectPoint(point, view, perspective = 850) {
  const [x, y, z] = applyView([point[0], -point[1], point[2]], view);
  const scale = perspective / (perspective - z);
  return [x * scale, y * scale];
}
export function selectDragLayer(position, normal, point, delta, view, perspective = 850) {
  const length = Math.hypot(...delta);
  if (length < 8) return null;
  let best = null;
  for (let i = 0; i < 3; i++) {
    // Slide a row/column along the touched surface, not spin the touched face.
    if (normal[i]) continue;
    const axis = AXES[i];
    const plus = projectPoint(rotatePoint(point, axis, .001), view, perspective);
    const minus = projectPoint(rotatePoint(point, axis, -.001), view, perspective);
    const tangent = plus.map((v, j) => (v - minus[j]) / .002);
    const speed = Math.hypot(...tangent);
    if (speed < 1) continue;
    const score = Math.abs(delta[0] * tangent[0] + delta[1] * tangent[1]) / (length * speed);
    if (!best || score > best.score) best = { axis, index: position[i], tangent, score };
  }
  return best && best.score >= .55 ? best : null;
}
export function dragAngle(delta, tangent) {
  const amount = (delta[0] * tangent[0] + delta[1] * tangent[1]) / (tangent[0] ** 2 + tangent[1] ** 2);
  return Math.max(-Math.PI / 2, Math.min(Math.PI / 2, amount));
}
