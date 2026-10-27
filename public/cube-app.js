import { FACES, FACE_NAMES, FACE_COLORS, newCube, turnLayer, scramble } from './cube-rules.js';
import { NORMALS, AXES, defaultView, alignedView, applyView, orbitView, viewTransform, layerTransform, selectDragLayer, dragAngle } from './cube-rules.js';

const $ = id => document.getElementById(id);
const cube = newCube();
const model = $('cube-model'), stage = document.querySelector('.cube-view');
const faceByNormal = Object.fromEntries(FACES.map(face => [NORMALS[face].join(','), face]));
let view = defaultView(), gesture = null, animation = null, generation = 0, celebrated = false;
let lastMove = '';
const quarter = Math.PI / 2;
const orientation = document.querySelector('.cube-orientation');
const orientationSvg = orientation.querySelector('.orientation-arrows');
const svgNS = 'http://www.w3.org/2000/svg';
const directions = [
  ['R', 'X', '右视图', '#df6759'], ['L', '−X', '左视图', '#df6759'],
  ['U', 'Y', '顶视图', '#83b94e'], ['D', '−Y', '底视图', '#83b94e'],
  ['F', 'Z', '前视图', '#5d92df'], ['B', '−Z', '后视图', '#5d92df'],
].map(([face, label, name, color]) => {
  const arrow = document.createElementNS(svgNS, 'g');
  const shaft = document.createElementNS(svgNS, 'path');
  shaft.setAttribute('stroke', color); shaft.setAttribute('stroke-width', '4'); shaft.setAttribute('stroke-linecap', 'round');
  const cone = document.createElementNS(svgNS, 'path');
  cone.setAttribute('fill', color); cone.setAttribute('stroke', '#ffffff90'); cone.setAttribute('stroke-width', '.8');
  arrow.append(shaft, cone); orientationSvg.append(arrow);
  const button = document.createElement('button');
  button.className = 'orientation-end'; button.type = 'button'; button.dataset.face = face;
  button.textContent = label; button.style.setProperty('--axis-color', color);
  button.setAttribute('aria-label', `${label} 轴：${name}`);
  button.title = `${name} · 再点一次查看反面`;
  button.onclick = () => {
    if (animation || gesture) return;
    const n = NORMALS[face];
    const depth = applyView([n[0], -n[1], n[2]], view)[2];
    const opposite = { R: 'L', L: 'R', U: 'D', D: 'U', F: 'B', B: 'F' };
    view = alignedView(depth > .999 ? opposite[face] : face);
    renderView();
  };
  orientation.append(button);
  return { face, arrow, shaft, cone, button };
});
function renderView() {
  model.style.transform = viewTransform(view);
  for (const item of directions) {
    const n = NORMALS[item.face];
    const [x, y, z] = applyView([n[0], -n[1], n[2]], view);
    const length = Math.hypot(x, y), ux = length > .001 ? x / length : 0, uy = length > .001 ? y / length : -1;
    const tip = [56 + x * 33, 56 + y * 33];
    const base = [tip[0] - ux * 12, tip[1] - uy * 12];
    item.shaft.setAttribute('d', `M56 56 L${base[0]} ${base[1]}`);
    item.cone.setAttribute('d', `M${tip[0]} ${tip[1]} L${base[0] - uy * 6} ${base[1] + ux * 6} Q${base[0] - ux * 3} ${base[1] - uy * 3} ${base[0] + uy * 6} ${base[1] - ux * 6} Z`);
    item.arrow.style.opacity = z < -.01 ? '.4' : '1';
    item.arrow.style.display = length < .08 ? 'none' : '';
    item.arrow.dataset.depth = z;
    // Keep the end-on axis away from the centre and the four edge buttons.
    const front = length < .08 && z > 0;
    item.button.style.left = `${front ? 87 : 56 + x * 43}px`;
    item.button.style.top = `${front ? 87 : 56 + y * 43}px`;
    item.button.style.zIndex = String(Math.round(10 + z * 4));
    item.button.hidden = length < .08 && z < 0;
    item.button.classList.toggle('is-rear', z < -.01);
    item.button.setAttribute('aria-pressed', String(z > .999));
  }
  for (const item of [...directions].sort((a,b) => Number(a.arrow.dataset.depth) - Number(b.arrow.dataset.depth))) orientationSvg.append(item.arrow);
}
orientation.querySelector('.orientation-home').onclick = () => {
  if (animation || gesture) return;
  view = defaultView(); renderView();
};

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
  renderView();
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
  orientation.querySelectorAll('button').forEach(button => { button.disabled = value; });
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
    renderView();
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
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // A damped angular bounce keeps every cubie rigid and settles at the exact
  // quarter turn used by the rules. No scaling or recolouring of stickers.
  const travel = target - g.angle;
  const bounce = cancelled ? 0 : Math.sign(travel || target) * Math.min(.075, Math.abs(travel) * .16 + (target ? .025 : 0));
  const frames = reduceMotion ? [
    { transform: layerTransform(axis, g.angle) }, { transform: layerTransform(axis, target) },
  ] : [
    { offset: 0, transform: layerTransform(axis, g.angle), easing: 'cubic-bezier(.2,.7,.3,1)' },
    { offset: .48, transform: layerTransform(axis, target + bounce), easing: 'ease-in-out' },
    { offset: .72, transform: layerTransform(axis, target - bounce * .38), easing: 'ease-in-out' },
    { offset: .88, transform: layerTransform(axis, target + bounce * .12), easing: 'ease-in-out' },
    { offset: 1, transform: layerTransform(axis, target) },
  ];
  animation = g.layer.animate(frames, { duration: reduceMotion ? 1 : cancelled ? 180 : 420, fill: 'forwards' });
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
// Keep the cube in view when switching tutorial steps in the adjacent panel.
document.querySelector('.cube-guide-nav').addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const page = document.querySelector(link.getAttribute('href'));
  if (!page) return;
  event.preventDefault();
  const pages = document.querySelector('.cube-guide-pages');
  pages.scrollTo({ top: page.offsetTop, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  document.querySelectorAll('.cube-guide-nav a').forEach(item => item.removeAttribute('aria-current'));
  link.setAttribute('aria-current', 'step');
});
reset(true);
