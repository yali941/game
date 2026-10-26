import { FACES, FACE_NAMES, FACE_COLORS, newCube, turn, scramble, faceGrid, isSolved } from './cube-rules.js';

const $ = id => document.getElementById(id);
const cube = newCube();
let animating = false, hasStarted = false, lastMove = null;
// The face depth is controlled by CSS so the same animation stays aligned on desktop and mobile.
const transforms = { F: 'translateZ(var(--cube-half))', B: 'rotateY(180deg) translateZ(var(--cube-half))', R: 'rotateY(90deg) translateZ(var(--cube-half))', L: 'rotateY(-90deg) translateZ(var(--cube-half))', U: 'rotateX(90deg) translateZ(var(--cube-half))', D: 'rotateX(-90deg) translateZ(var(--cube-half))' };
function faceTransform(face) { return transforms[face]; }
function renderCube() {
  const model = $('cube-model'); model.replaceChildren();
  for (const face of FACES) {
    const panel = document.createElement('div'); panel.className = 'cube-face'; panel.dataset.face = face; panel.style.setProperty('--face-transform', faceTransform(face));
    for (const color of faceGrid(cube, face)) { const sticker = document.createElement('div'); sticker.className = 'cube-sticker'; sticker.style.background = FACE_COLORS[color]; sticker.title = `${FACE_NAMES[face]} · ${color}`; panel.append(sticker); }
    model.append(panel);
  }
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
    for (const [direction, text] of [[1, '↻ 顺时针'], [-1, '↺ 逆时针']]) { const button = document.createElement('button'); button.textContent = text; button.setAttribute('aria-label', `${FACE_NAMES[face]} ${text}`); button.onclick = () => moveFace(face, direction); item.append(button); }
    root.append(item);
  }
}
function moveFace(face, direction) {
  if (animating || !hasStarted) return;
  animating = true;
  const panel = [...$('cube-model').children].find(el => el.dataset.face === face);
  panel.classList.add(direction === 1 ? 'turn-cw' : 'turn-ccw');
  setTimeout(() => {
    turn(cube, face, direction); lastMove = { face, direction }; animating = false; renderCube();
    if (cube.solved) celebrate();
  }, 430);
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
