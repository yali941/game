import { FACES, FACE_NAMES, FACE_COLORS, newCube, turnLayer, scramble } from './cube-rules.js';
import { NORMALS, AXES, defaultView, orbitView, viewTransform, layerTransform, selectDragLayer, dragAngle } from './cube-rules.js';

const $ = id => document.getElementById(id);
const cube = newCube();
const model = $('cube-model'), stage = document.querySelector('.cube-view');
const faceByNormal = Object.fromEntries(FACES.map(face => [NORMALS[face].join(','), face]));
let view = defaultView(), gesture = null, animation = null, generation = 0, celebrated = false;
let lastMove = '';
const quarter = Math.PI / 2;

function renderCube() {
  model.replaceChildren();
  const piecesRoot = document.createElement('div');
  piecesRoot.className = 'cube-pieces';
  const pieces = new Map();
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    pieces.set(`${x},${y},${z}`, { position: [x, y, z], colors: {} });
  }
  for (const sticker of cube.stickers) pieces.get(sticker.position.join(',')).colors[faceByNormal[sticker.normal.join(',')]] = sticker.color;
  for (const data of pieces.values()) {
    const piece = document.createElement('div');
    piece.className = 'cube-piece';
    data.position.forEach((v, i) => {
      piece.dataset[AXES[i]] = v;
      piece.style.setProperty(`--piece-${AXES[i]}`, i === 1 ? -v : v);
    });
    for (const face of FACES) {
      const sticker = document.createElement('div');
      sticker.className = 'piece-sticker';
      sticker.dataset.face = face;
      const color = data.colors[face];
      if (color) {
        sticker.dataset.color = color;
        sticker.style.backgroundColor = FACE_COLORS[color];
      } else sticker.classList.add('piece-empty');
      piece.append(sticker);
    }
    piecesRoot.append(piece);
  }
  model.append(piecesRoot);
  model.style.transform = viewTransform(view);
  $('move-count').textContent = `${String(cube.moves).padStart(2, '0')} 步`;
  $('cube-state').textContent = cube.solved ? '已还原' : '未完成';
  $('stage-label').textContent = cube.solved ? '六面归位' : '拖动小块，慢慢拼回来';
  $('last-move').textContent = lastMove || '拖小块转层 · 拖空白转视角';
}

function makeLayer(axis, index) {
  const root = model.querySelector('.cube-pieces');
  const layer = document.createElement('div');
  layer.className = 'cube-turn-layer';
  // Every layer rotates about the same axis through the cube centre.
  layer.style.transformOrigin = '50% 50% 0';
  for (const piece of [...root.children]) if (Number(piece.dataset[axis]) === index) layer.append(piece);
  model.append(layer);
  return layer;
}

function releasePointer(g) {
  g.layer?.classList.remove('is-selected-layer');
  if (stage.hasPointerCapture(g.id)) stage.releasePointerCapture(g.id);
  stage.classList.remove('is-dragging');
}
function setBusy(value) {
  $('scramble-button').disabled = value;
  $('reset-button').disabled = value;
}
function begin(event) {
  if (animation || gesture || event.button !== 0 || !event.isPrimary) return;
  event.preventDefault();
  const sticker = event.target instanceof Element ? event.target.closest('.piece-sticker:not(.piece-empty)') : null;
  const g = { id: event.pointerId, x: event.clientX, y: event.clientY, kind: sticker ? 'layer' : 'orbit', view: [...view], angle: 0 };
  if (sticker) {
    const piece = sticker.parentElement;
    const style = getComputedStyle(model);
    const step = parseFloat(style.getPropertyValue('--piece-step'));
    const half = parseFloat(style.getPropertyValue('--piece-half'));
    g.position = AXES.map(axis => Number(piece.dataset[axis]));
    g.normal = NORMALS[sticker.dataset.face];
    g.point = g.position.map((v, i) => v * step + g.normal[i] * half);
    g.perspective = parseFloat(getComputedStyle(stage).perspective) || 850;
    $('last-move').textContent = '沿着想移动的方向拖动小块';
  }
  gesture = g;
  stage.setPointerCapture(event.pointerId);
  stage.classList.add('is-dragging');
  setBusy(true);
}
function update(event) {
  const g = gesture;
  if (!g || g.id !== event.pointerId) return;
  event.preventDefault();
  const delta = [event.clientX - g.x, event.clientY - g.y];
  if (g.kind === 'orbit') {
    view = orbitView(g.view, ...delta);
    model.style.transform = viewTransform(view);
    return;
  }
  if (!g.selection) {
    g.selection = selectDragLayer(g.position, g.normal, g.point, delta, view, g.perspective);
    if (!g.selection) return;
    g.layer = makeLayer(g.selection.axis, g.selection.index);
    g.layer.classList.add('is-selected-layer');
  }
  g.angle = dragAngle(delta, g.selection.tangent);
  g.layer.style.transform = layerTransform(g.selection.axis, g.angle);
}
function finish(event, cancelled = false) {
  const g = gesture;
  if (!g || g.id !== event.pointerId) return;
  if (!cancelled) update(event);
  gesture = null;
  releasePointer(g);
  if (!g.layer) {
    setBusy(false);
    $('last-move').textContent = '拖小块转层 · 拖空白转视角';
    return;
  }
  const target = !cancelled && Math.abs(g.angle) >= Math.PI / 6 ? Math.sign(g.angle) * quarter : 0;
  const token = generation;
  const { axis, index } = g.selection;
  animation = g.layer.animate([
    { transform: layerTransform(axis, g.angle) },
    { transform: layerTransform(axis, target) },
  ], { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 180, easing: 'cubic-bezier(.2,.8,.25,1)', fill: 'forwards' });
  animation.onfinish = () => {
    if (token !== generation) return;
    animation = null;
    if (target) {
      turnLayer(cube, axis, index, Math.sign(target));
      lastMove = index === 0 ? '中间层已转动' : `${FACE_NAMES[faceByNormal[AXES.map(a => a === axis ? index : 0).join(',')]]}已转动`;
    }
    renderCube();
    setBusy(false);
    if (target && cube.solved && cube.scrambled && !celebrated) { celebrated = true; celebrate(); }
  };
}
function celebrate() {
  const root = $('fireworks'); root.replaceChildren();
  const colors = Object.values(FACE_COLORS);
  for (let i = 0; i < 42; i++) {
    const spark = document.createElement('span'); spark.className = 'firework';
    spark.style.setProperty('--angle', `${i * (360 / 42)}deg`);
    spark.style.setProperty('--distance', `${105 + Math.random() * 110}px`);
    spark.style.setProperty('--color', colors[i % colors.length]);
    spark.style.animationDelay = `${Math.random() * 180}ms`; root.append(spark);
  }
  setTimeout(() => root.replaceChildren(), 1400);
}
function reset(shuffle) {
  generation++;
  if (animation) { animation.onfinish = null; animation.cancel(); animation = null; }
  const oldGesture = gesture; gesture = null;
  if (oldGesture) releasePointer(oldGesture);
  Object.assign(cube, newCube());
  celebrated = false; lastMove = '';
  $('fireworks').replaceChildren();
  if (shuffle) { scramble(cube, Math.random, 22); cube.moves = 0; }
  $('scramble-note').textContent = shuffle ? '已随机打乱 22 步，开始挑战吧。' : '已还原，可直接拖动练习。';
  setBusy(false); renderCube();
}
$('scramble-button').onclick = () => reset(true);
$('reset-button').onclick = () => reset(false);
stage.addEventListener('pointerdown', begin);
stage.addEventListener('pointermove', update);
stage.addEventListener('pointerup', e => finish(e));
stage.addEventListener('pointercancel', e => finish(e, true));
stage.addEventListener('lostpointercapture', e => finish(e, true));
window.addEventListener('blur', () => { if (gesture) finish({ pointerId: gesture.id }, true); });
reset(true);
