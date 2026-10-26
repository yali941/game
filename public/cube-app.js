import { FACES, FACE_NAMES, FACE_COLORS, newCube, turn, scramble, isSolved } from './cube-rules.js';

const $ = id => document.getElementById(id);
const cube = newCube();
const normals = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
const faceAxes = { U: ['y', 1], R: ['x', 1], F: ['z', 1], D: ['y', -1], L: ['x', -1], B: ['z', -1] };
const faceByNormal = Object.fromEntries(FACES.map(face => [normals[face].join(','), face]));
let animating = false, hasStarted = false, lastMove = null;

function faceTransform(face) {
  const [axis, sign] = faceAxes[face];
  const axisName = axis.toUpperCase();
  return `rotate${axisName}(${sign}deg)`;
}
function buildPieces() {
  const pieces = new Map();
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    pieces.set(`${x},${y},${z}`, { x, y, z, colors: {} });
  }
  for (const sticker of cube.stickers) {
    const key = sticker.position.join(',');
    const face = faceByNormal[sticker.normal.join(',')];
    pieces.get(key).colors[face] = sticker.color;
  }
  return pieces;
}
function makeSticker(face, color) {
  const sticker = document.createElement('div');
  sticker.className = 'piece-sticker';
  sticker.dataset.face = face;
  if (color) {
    sticker.style.background = FACE_COLORS[color];
    sticker.title = `${FACE_NAMES[face]} · ${color}`;
  } else {
    sticker.classList.add('piece-empty');
  }
  return sticker;
}
function renderCube() {
  const model = $('cube-model');
  model.replaceChildren();
  const piecesRoot = document.createElement('div');
  piecesRoot.className = 'cube-pieces';
  for (const pieceData of buildPieces().values()) {
    const piece = document.createElement('div');
    piece.className = 'cube-piece';
    piece.dataset.x = pieceData.x;
    piece.dataset.y = pieceData.y;
    piece.dataset.z = pieceData.z;
    piece.style.setProperty('--piece-x', pieceData.x);
    piece.style.setProperty('--piece-y', -pieceData.y);
    piece.style.setProperty('--piece-z', pieceData.z);
    for (const face of FACES) piece.append(makeSticker(face, pieceData.colors[face]));
    piecesRoot.append(piece);
  }
  model.append(piecesRoot);
  $('move-count').textContent = `${String(cube.moves).padStart(2, '0')} 步`;
  $('cube-state').textContent = cube.solved && hasStarted ? '已完成 · 礼花庆祝' : hasStarted ? '未完成' : '准备中';
  $('stage-label').textContent = cube.solved && hasStarted ? '恭喜，还原成功' : hasStarted ? '已随机打乱，轮到你' : '准备开始';
  $('last-move').textContent = lastMove ? `${FACE_NAMES[lastMove.face]} · ${lastMove.direction === 1 ? '顺时针' : '逆时针'}` : '选择一面，再选择顺时针或逆时针。';
}
function renderControls() {
  const root = $('face-controls'); root.replaceChildren();
  for (const face of FACES) {
    const item = document.createElement('div'); item.className = 'face-control';
    const label = document.createElement('strong'); label.textContent = `${face} · ${FACE_NAMES[face]}`; item.append(label);
    for (const [direction, text] of [[1, '↻ 顺时针'], [-1, '↺ 逆时针']]) {
      const button = document.createElement('button'); button.textContent = text; button.setAttribute('aria-label', `${FACE_NAMES[face]} ${text}`); button.onclick = () => moveFace(face, direction); item.append(button);
    }
    root.append(item);
  }
}
function layerOrigin(axis, sign) {
  if (axis === 'x') return `calc(50% ${sign > 0 ? '+' : '-'} var(--piece-step)) 50% 0`;
  if (axis === 'y') return `50% calc(50% ${sign > 0 ? '-' : '+'} var(--piece-step)) 0`;
  return `50% 50% ${sign > 0 ? 'var(--piece-step)' : 'calc(-1 * var(--piece-step))'}`;
}
function moveFace(face, direction) {
  if (animating || !hasStarted) return;
  const model = $('cube-model');
  const piecesRoot = model.querySelector('.cube-pieces');
  if (!piecesRoot) return;
  animating = true;
  const [axis, sign] = faceAxes[face];
  const layer = document.createElement('div');
  layer.className = 'cube-turn-layer';
  layer.style.transformOrigin = layerOrigin(axis, sign);
  const layerIndex = sign;
  for (const piece of [...piecesRoot.children]) if (Number(piece.dataset[axis]) === layerIndex) layer.append(piece);
  model.append(layer);
  const angle = (direction === 1 ? -sign : sign) * 90;
  const animation = layer.animate(
    [{ transform: 'none' }, { transform: `rotate${axis.toUpperCase()}(${angle}deg)` }],
    { duration: 520, easing: 'cubic-bezier(.2,.8,.25,1)', fill: 'forwards' },
  );
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    turn(cube, face, direction);
    lastMove = { face, direction };
    animating = false;
    renderCube();
    if (cube.solved) celebrate();
  };
  animation.onfinish = finish;
  animation.oncancel = finish;
}
function celebrate() {
  const root = $('fireworks'); root.replaceChildren();
  const colors = ['#e95c58', '#f2c84b', '#4fa86b', '#4d83c5', '#f19b54', '#ba7ac9'];
  for (let i = 0; i < 42; i++) { const spark = document.createElement('span'); spark.className = 'firework'; spark.style.setProperty('--angle', `${i * (360 / 42)}deg`); spark.style.setProperty('--distance', `${105 + Math.random() * 110}px`); spark.style.setProperty('--color', colors[i % colors.length]); spark.style.animationDelay = `${Math.random() * 180}ms`; root.append(spark); }
  setTimeout(() => root.replaceChildren(), 1400);
}
function start() {
  cube.stickers = newCube().stickers; cube.moves = 0; cube.history = []; lastMove = null; hasStarted = true;
  const moves = scramble(cube, Math.random, 22); cube.moves = 0; $('scramble-note').textContent = `本次随机打乱 ${moves.length} 步，开始挑战吧。`; renderCube();
}
$('scramble-button').onclick = start;
$('reset-button').onclick = () => { cube.stickers = newCube().stickers; cube.moves = 0; cube.history = []; cube.scrambled = false; cube.solved = true; hasStarted = false; lastMove = null; $('scramble-note').textContent = '魔方已恢复完整状态。点击重新随机打乱开始。'; renderCube(); };
renderControls(); start();