import { ANIMALS, ANIMAL_ICONS, FLIGHT_COLORS, FLIGHT_PAINTS, newTableGame, jungleTargets, moveJungle, moveFlight, rollFlight, flightOptions, flightIndex, river, denOwner, trapOwner } from './table-rules.js';
import { profileReady, profileHeaders, refreshRankings } from './profile.js';
import { flightMotionSteps, sampleFlightLeg } from './flight-path.js';
import { addTabletopDefs, animalPortrait } from './animal-art.js';
import { setupTabletop, showBoardDialog, syncTabletop, syncDiceState, isDiceRolling } from './tabletop-ui.js';

const $ = id => document.getElementById(id), ns = 'http://www.w3.org/2000/svg';
const params = new URLSearchParams(location.search), kind = params.get('game') === 'jungle' ? 'jungle' : 'flight';
const title = kind === 'flight' ? '飞行棋' : '斗兽棋';
let mode = 'online', room = null, session = null, stream = null, transport = false, pending = false;
let localGame = newTableGame(kind, 2), selected = null, toastTimer, confirmAction, nextReactionAt = 0, lastRankedRound = '';
let flightSnapshot = null, flightMotion = null, flightFrame = 0;
let jungleSnapshot = null, jungleMotion = null, jungleFrame = 0;
const game = () => mode === 'local' ? localGame : room?.game || localGame;
const seat = () => mode === 'local' ? game().turn : room?.yourSeat;
const allOnline = () => room?.players.every(p => p?.connected && !p.gone);
const seated = () => mode === 'local' || Boolean(room);
const available = () => !pending && !flightMotion && !jungleMotion && !isDiceRolling() && (mode === 'local' || (transport && room?.started && !room.closed && allOnline()));
const myTurn = () => available() && game().status === 'playing' && game().turn === seat();
const colorOf = n => kind === 'flight' ? game().colors[n - 1] : n === 1 ? 0 : 2;
const playerName = n => `${FLIGHT_COLORS[colorOf(n)]}方`;
const paint = n => (kind === 'flight' ? flightPalette : FLIGHT_PAINTS)[colorOf(n)];
function svg(tag, attrs = {}, text = '') { const el = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); if (text) el.textContent = text; return el; }
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4500); }
function confirm(text, detail, fn, label = '确定') { $('confirm-title').textContent = text; $('confirm-text').textContent = detail; $('confirm-ok').textContent = label; confirmAction = fn; showBoardDialog($('confirm-dialog')); }
function persist() { try { if (session) sessionStorage.setItem(`yiju-${kind}`, JSON.stringify(session)); else sessionStorage.removeItem(`yiju-${kind}`); } catch { /* Current page remains usable. */ } }
async function api(action, data = {}) {
  const response = await fetch(`/api/table/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...profileHeaders(), ...(session ? { Authorization: `Bearer ${session.token}` } : {}) }, body: JSON.stringify({ room: session?.room, kind, version: room?.version, ...data }), signal: AbortSignal.timeout(12000) });
  const value = await response.json(); if (!response.ok) { const e = new Error(value.error || '操作失败'); e.status = response.status; throw e; } return value;
}
async function action(fn) {
  if (pending) return; pending = true; render();
  try { await fn(); } catch (e) { toast(['TypeError', 'TimeoutError'].includes(e.name) ? '暂时连接不上，请检查网络后重试。' : e.message); }
  finally { pending = false; render(); }
}
function apply(next) {
  if (room && room.code === next.code && next.seq < room.seq) return;
  if (room?.version !== next.version) selected = null;
  room = next;
  const finished = `${room.code}-${room.round}`;
  if (room.game.status === 'finished' && lastRankedRound !== finished) { lastRankedRound = finished; refreshRankings(); }
  render();
}
function connect() {
  stream?.close(); transport = false; const active = session;
  stream = new EventSource(`/api/table/events?room=${session.room}&token=${session.token}`);
  stream.onmessage = event => { if (session !== active) return; transport = true; apply(JSON.parse(event.data)); };
  stream.addEventListener('reaction', event => { if (session === active) effect(JSON.parse(event.data)); });
  stream.onerror = async () => {
    if (session !== active) return; transport = false; render();
    try { await api('sync'); } catch (e) { if (session === active && [401, 404].includes(e.status)) { clearRoom(); render(); toast('房间已失效，请重新创建或加入。'); } }
  };
}
function enter(value) { session = { room: value.code, token: value.token }; persist(); apply(value); history.replaceState(null, '', `/play?game=${kind}&room=${value.code}`); connect(); }
function clearRoom() { stream?.close(); stream = null; room = null; session = null; transport = false; selected = null; persist(); history.replaceState(null, '', `/play?game=${kind}`); $('table-effects').replaceChildren(); }
function localDice() { const bytes = new Uint32Array(1); let value; do { crypto.getRandomValues(bytes); value = bytes[0]; } while (value >= 4294967292); return value % 6 + 1; }
function effect(value) {
  const icons = { poop: '💩', heart: '❤️', bomb: '💥' }; if (!icons[value.kind]) return;
  const item = document.createElement('span'); item.className = 'table-effect'; item.textContent = icons[value.kind]; $('table-effects').append(item);
  while ($('table-effects').children.length > 3) $('table-effects').firstElementChild.remove();
  setTimeout(() => item.remove(), 2000); $('reaction-feedback').textContent = `${playerName(value.from)}${value.kind === 'heart' ? '送来爱心' : value.kind === 'bomb' ? '扔来炸弹' : '扔来大便'} ${icons[value.kind]}`;
}

function boardDefs(board) {
  const defs = svg('defs'), shadow = svg('filter', { id: 'piece-shadow', x: '-50%', y: '-50%', width: '200%', height: '210%', 'color-interpolation-filters': 'sRGB' });
  shadow.append(svg('feDropShadow', { dx: 1, dy: 3.5, stdDeviation: 1.5, 'flood-opacity': .3, 'flood-color': '#293c21' })); defs.append(shadow);
  addTabletopDefs(defs);
  for (const [c, colors] of [['0', ['#ffb1ba', '#e6607a']], ['1', ['#fff0a2', '#f0bd32']], ['2', ['#b7eaf7', '#49b4d6']], ['3', ['#c1edb4', '#65b77d']]]) {
    const gradient = svg('radialGradient', { id: 'flight-piece-' + c, cx: '30%', cy: '20%', r: '80%' });
    gradient.append(svg('stop', { offset: '0%', 'stop-color': colors[0] }), svg('stop', { offset: '100%', 'stop-color': colors[1] })); defs.append(gradient);
  }
  board.append(defs);
}
function cellAction(x, y) {
  if (!myTurn()) return;
  const g = game(), piece = g.pieces.find(p => p.x === x && p.y === y);
  if (piece?.owner === seat()) { selected = selected === piece.id ? null : piece.id; renderBoard(); $('board-help').textContent = selected ? `${ANIMALS[piece.rank]} · 选择高亮格行棋` : '先选己方动物，再点高亮格。'; return; }
  if (!selected) return;
  const id = selected;
  if (!jungleTargets(g, id).some(t => t.x === x && t.y === y)) return;
  action(async () => { if (mode === 'local') { moveJungle(g, seat(), id, x, y); selected = null; } else apply(await api('move', { id, x, y })); });
}
function syncJungleMotion() {
  const g = game(), scope = mode === 'local' ? localGame : room ? room.code + ':' + room.round : 'lobby';
  const before = jungleSnapshot;
  jungleSnapshot = { scope, moves: g.moves.length, pieces: g.pieces.map(p => ({ ...p })) };
  if (!before || before.scope !== scope || room?.closed || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    jungleMotion = null; cancelAnimationFrame(jungleFrame); return;
  }
  if (g.moves.length === before.moves) return;
  jungleMotion = null;
  if (g.moves.length !== before.moves + 1 || !g.last) return;
  const last = g.last, from = before.pieces.find(p => p.id === last.id);
  if (!from || from.x !== last.from.x || from.y !== last.from.y) return;
  const leap = Math.abs(last.x - from.x) + Math.abs(last.y - from.y) > 1;
  jungleMotion = { id: last.id, from, to: { x:last.x, y:last.y }, leap,
    captured: before.pieces.find(p => p.x === last.x && p.y === last.y),
    started: performance.now(), duration: leap ? 860 : 540 };
}
function animateJunglePiece(board, piece, victim) {
  cancelAnimationFrame(jungleFrame);
  const motion = jungleMotion;
  if (!motion || !piece) return;
  const shadow = svg('ellipse', { rx:22, ry:8, fill:'#263b25', 'pointer-events':'none' });
  const ripple = svg('ellipse', { cx:59 + motion.to.x*62, cy:62 + motion.to.y*62, rx:24, ry:10, fill:'none', stroke:'#fff3bd', 'stroke-width':2, 'pointer-events':'none' });
  board.append(shadow, ripple, piece);
  piece.style.pointerEvents = 'none';
  piece.setAttribute('data-motion', motion.leap ? 'river-jump' : 'hop');
  const tick = now => {
    if (jungleMotion !== motion) return;
    const t = Math.min(1, (now - motion.started) / motion.duration);
    const travel = Math.min(1, Math.max(0, (t-.1)/.74));
    const progress = travel*travel*(3-2*travel), air = Math.sin(Math.PI*travel);
    const landing = Math.max(0, (t-.84)/.16), squash = t < .1 ? Math.sin(t/.1*Math.PI)*.07 : Math.sin(landing*Math.PI)*.09;
    const x = 59 + (motion.from.x + (motion.to.x-motion.from.x)*progress)*62;
    const y = 58 + (motion.from.y + (motion.to.y-motion.from.y)*progress)*62;
    const scale = 1 + air*.09, lift = air*(motion.leap ? 66 : 30);
    piece.setAttribute('transform', `translate(${x} ${y-lift}) scale(${scale+squash} ${scale-squash}) translate(${-59-motion.to.x*62} ${-58-motion.to.y*62})`);
    shadow.setAttribute('cx', x); shadow.setAttribute('cy', y+9);
    shadow.setAttribute('rx', 22-air*7); shadow.setAttribute('opacity', .2-air*.1);
    ripple.setAttribute('rx', 24+landing*15); ripple.setAttribute('ry', 10+landing*7);
    ripple.setAttribute('opacity', t < .84 ? 0 : (1-landing)*.5);
    victim?.setAttribute('opacity', t < .78 ? 1 : Math.max(0, 1-(t-.78)/.1));
    if (t >= 1) { jungleMotion = null; render(); }
    else jungleFrame = requestAnimationFrame(tick);
  };
  tick(performance.now());
}
function renderJungle(board) {
  const g = game(); board.setAttribute('viewBox', '0 0 490 620'); board.setAttribute('aria-label', '木框草地斗兽棋棋盘，7列9行，两片河流，红蓝动物棋子');
  const unit = 62, offset = 28, targets = selected && myTurn() ? jungleTargets(g, selected) : [];
  // A thick wooden tray, inset field, and the engraved edge of the board.
  board.append(svg('rect', { x: 12, y: 20, width: 466, height: 590, rx: 12, fill: '#7b5935', filter: 'url(#piece-shadow)' }));
  board.append(svg('rect', { x: 12, y: 12, width: 466, height: 590, rx: 12, fill: 'url(#jungle-wood)', stroke: '#edc795', 'stroke-width': 1.5 }));
  board.append(svg('rect', { x: 23, y: 23, width: 444, height: 568, rx: 4, fill: '#6c8545', stroke: '#85663e', 'stroke-width': 3 }));
  for (let i = 0; i < 3; i++) board.append(svg('path', { d: 'M32 ' + (16+i*2) + ' Q150 ' + (18+i*2) + ' 458 ' + (16+i*2) + ' M32 ' + (595+i*2) + ' Q240 ' + (591+i*2) + ' 458 ' + (595+i*2), fill: 'none', stroke: '#7b542b', 'stroke-width': .5, opacity: .18 }));
  let movingPiece, capturedPiece;
  for (let y = 0; y < 9; y++) for (let x = 0; x < 7; x++) {
    const cx = offset + x * unit, cy = offset + y * unit, water = river(x, y), den = denOwner(x, y), trap = trapOwner(x, y), path = y >= 3 && y <= 5;
    board.append(svg('rect', { x: cx, y: cy, width: unit, height: unit, rx: 1.5, class: 'jungle-cell' + (water ? ' jungle-water' : path || den || trap ? ' jungle-path' : '') }));
    board.append(svg('path', { d: 'M' + (cx+1) + ' ' + (cy+61) + ' V' + (cy+1) + ' H' + (cx+61), fill: 'none', stroke: '#fff9d7', 'stroke-width': 1, opacity: water ? .18 : .28 }));
    if (water) {
      board.append(svg('path', { d: 'M'+(cx+13)+' '+(cy+24)+'q5-3 10 0t10 0m-2 15q5-3 10 0t10 0', stroke:'#e1fafa', 'stroke-width':1.2, fill:'none', opacity:.32 }));
    } else if (den) {
      const home = svg('g', { transform: 'translate(' + (cx+31) + ' ' + (cy+30) + ')' });
      home.append(svg('path', { d:'M-23 19V-1Q-23-24 0-24Q23-24 23-1V19Z', fill:'#8d9b87', stroke:'#61745f', 'stroke-width':1.5 }));
      home.append(svg('path', { d:'M-18 17V-1Q-18-19 0-19Q18-19 18-1V17Z', fill:'#b8c4a1', stroke:'#d7dec0', 'stroke-width':1 }));
      home.append(svg('path', { d:'M-11 17V0Q-11-11 0-11Q11-11 11 0V17Z', fill:den===1?'#8b5142':'#426576' }));
      home.append(svg('path', { d:'M-23 18H23M-18-2l-4-2m4-9-4-3m11-4-2-4m22 22 4-2m-4-9 4-3m-11-4 2-4', stroke:'#64765e', 'stroke-width':1, fill:'none' }));
      home.append(svg('text',{ x:0,y:12,'text-anchor':'middle',fill:'#fff4d7','font-size':10 },'穴')); board.append(home);
    } else if (trap) {
      board.append(svg('circle', { cx:cx+31,cy:cy+32,r:22,fill:'#785b32',stroke:'#b99058','stroke-width':2 }));
      board.append(svg('circle', { cx:cx+31,cy:cy+30,r:19,fill:'#9c7946',stroke:'#634b2b','stroke-width':1 }));
      for (let n=0;n<8;n++) {
        const a=n*Math.PI/4; board.append(svg('line',{x1:cx+31+Math.cos(a)*8,y1:cy+30+Math.sin(a)*8,x2:cx+31+Math.cos(a)*16,y2:cy+30+Math.sin(a)*16,stroke:'#d0ab72','stroke-width':2,'stroke-linecap':'round'}));
      }
    } else if ((x+y*3)%5===0) board.append(svg('path',{d:'M'+(cx+9)+' '+(cy+52)+'l-2-4m2 4 1-6m-1 6 4-3',stroke:'#617f3b','stroke-width':.8,fill:'none',opacity:.45}));
    const p = g.pieces.find(p => p.x === x && p.y === y), target = targets.some(t => t.x === x && t.y === y);
    const occupants = p ? [p] : [];
    if (jungleMotion?.captured?.x === x && jungleMotion.captured.y === y) occupants.unshift(jungleMotion.captured);
    for (const p of occupants) {
      const piece = svg('g', { class: 'animal-piece', 'data-animal': p.rank, 'data-piece':p.id, 'data-team':p.owner===1?'red':'blue' });
      const px=cx+31, py=cy+30, team=p.owner===1?'red':'blue';
      piece.append(svg('circle',{cx:px,cy:py+4,r:25,fill:p.owner===1?'#842b34':'#254d83'}));
      piece.append(svg('circle',{cx:px,cy:py-1,r:25,fill:'url(#token-'+team+')',class:'animal-disc'}));
      piece.append(svg('circle',{cx:px,cy:py-3,r:21,fill:'url(#token-'+team+')',stroke:p.owner===1?'#ffaaa2':'#acd4ff','stroke-width':1}));
      piece.append(animalPortrait(p.rank,px,py-2));
      piece.append(svg('rect',{x:px-13,y:py+15,width:26,height:11,rx:5,fill:p.owner===1?'#962e39':'#28558e',stroke:'#fff4d680','stroke-width':.5}));
      piece.append(svg('text',{x:px,y:py+23,class:'jungle-piece-label'},ANIMALS[p.rank]+' '+p.rank));
      piece.append(svg('path',{d:'M'+(px-17)+' '+(py-19)+'Q'+px+' '+(py-30)+' '+(px+16)+' '+(py-19),fill:'none',stroke:'#fff7d5','stroke-width':1,opacity:.65}));
      board.append(piece);
      if (p.id === jungleMotion?.id) movingPiece = piece;
      if (p.id === jungleMotion?.captured?.id) capturedPiece = piece;
      if (p.id === selected) board.append(svg('circle', { cx: px, cy: py, r: 28, class: 'selected-ring' }));
    }
    if (target) board.append(svg('circle', { cx: cx + 31, cy: cy + 31, r: p ? 28 : 8, class: p ? 'target-ring' : 'target-dot' }));
    const enabled = myTurn() && (p?.owner === seat() || target);
    const hit = svg('rect', { x: cx, y: cy, width: unit, height: unit, rx: 3, class: 'cell-hit', role: 'button', tabindex: enabled ? 0 : -1, 'aria-disabled': !enabled, 'aria-label': String.fromCharCode(65 + x) + (9 - y) + '，' + (p ? playerName(p.owner) + ANIMALS[p.rank] : den ? '兽穴' : trap ? '陷阱' : water ? '河流' : '空格') + (target ? '，可走' : '') });
    hit.addEventListener('click', () => cellAction(x, y)); hit.addEventListener('keydown', e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); cellAction(x, y); } }); board.append(hit);
  }
  animateJunglePiece(board, movingPiece, capturedPiece);
}

// Traditional 17 × 17 layout. Index 0 is the red home entrance at the left.
// Each clockwise quarter has 13 cells; keep these indices aligned with flightIndex.
const flightPalette = ['#e60012', '#ffca00', '#007fab', '#009b43'];
const flightUnit = 36, flightMargin = 44;
const flightQuarter = [
  { at: [1, 8.5], rect: [0, 8, 2, 1] },
  { at: [1, 7.5], rect: [0, 7, 2, 1] },
  { at: [1, 6.5], rect: [0, 6, 2, 1] },
  { at: [1.35, 5.35], triangle: [[0, 6], [2, 6], [2, 4]] },
  { at: [2.5, 5], rect: [2, 4, 1, 2] },
  { at: [3.5, 5], rect: [3, 4, 1, 2] },
  { at: [4.5, 5.5], triangle: [[4, 4], [4, 6], [6, 6]] },
  { at: [5.5, 4.5], triangle: [[4, 4], [6, 4], [6, 6]] },
  { at: [5, 3.5], rect: [4, 3, 2, 1] },
  { at: [5, 2.5], rect: [4, 2, 2, 1] },
  { at: [5.35, 1.35], triangle: [[4, 2], [6, 2], [6, 0]] },
  { at: [6.5, 1], rect: [6, 0, 1, 2] },
  { at: [7.5, 1], rect: [7, 0, 1, 2] }
];
function quarterTurn([x, y], color) { for (let i = 0; i < color; i++) [x, y] = [17 - y, x]; return [x, y]; }
const flightPixel = point => point.map(v => flightMargin + v * flightUnit);
const ringPoint = index => flightPixel(quarterTurn(flightQuarter[index % 13].at, Math.floor(index / 13)));
const lanePoint = (color, progress) => flightPixel(quarterTurn([2.5 + progress - 51, 8.5], color));
const airportPoint = (color, number) => flightPixel(quarterTurn([number % 2 ? 1.1 : 2.9, number <= 2 ? 1.1 : 2.9], color));
const launch = color => flightPixel(quarterTurn([.55, 4.55], color));
function planePoint(p) {
  if (p.progress === -1 || p.progress === 56) return airportPoint(p.color, p.number);
  if (p.progress === 0) return launch(p.color);
  if (p.progress >= 51) return lanePoint(p.color, p.progress);
  return ringPoint(flightIndex(p.color, p.progress));
}
function flightGlyph(x, y, size, color, angle = 0) {
  return svg('path', { d: 'M15 0 Q15 -2 10 -2 L3 -3 L-3 -13 L-6 -13 L-4 -3 L-11 -2 L-14 -6 L-16 -6 L-14 0 L-16 6 L-14 6 L-11 2 L-4 3 L-6 13 L-3 13 L3 3 L10 2 Q15 2 15 0Z', fill: flightPalette[color], transform: 'translate(' + x + ' ' + y + ') rotate(' + angle + ') scale(' + size / 32 + ')', 'pointer-events': 'none' });
}
function flyPlane(id) { if (!myTurn() || !flightOptions(game(), seat()).includes(id)) return; action(async () => { if (mode === 'local') moveFlight(game(), seat(), id); else apply(await api('move', { id })); }); }
function syncFlightMotion() {
  const g = game(), scope = mode === 'local' ? localGame : room ? room.code + ':' + room.round : 'lobby';
  const before = flightSnapshot;
  flightSnapshot = { scope, moves: g.moves.length, rolls: g.rolls, planes: g.planes.map(p => ({ ...p })) };
  if (!before || before.scope !== scope || matchMedia('(prefers-reduced-motion: reduce)').matches) { flightMotion = null; return; }
  const moved = g.last?.id && g.moves.length === before.moves + 1;
  const penalty = g.last?.penalty && g.rolls === before.rolls + 1;
  if (!moved && !penalty) return;
  const plans = new Map();
  const position = (p, progress) => progress === 56 ? lanePoint(p.color, 56) : planePoint({ ...p, progress });
  if (moved) {
    const last = g.last, p = before.planes.find(p => p.id === last.id);
    if (!p || p.progress !== last.from) { flightMotion = null; return; }
    let time = 0;
    const legs = flightMotionSteps(last).map(step => {
      const leg = { ...step, start: time, fromProgress: step.from, toProgress: step.to, from: position(p, step.from), to: position(p, step.to) };
      time += step.duration; return leg;
    });
    plans.set(p.id, legs);
    for (const id of last.captured) {
      const victim = before.planes.find(p => p.id === id);
      if (!victim) continue;
      const index = flightIndex(victim.color, victim.progress);
      const impact = legs.find(leg => (leg.type === 'fly' && victim.color === (p.color + 2) % 4 && victim.progress === 53) || (last.landings.includes(leg.toProgress) && index >= 0 && flightIndex(p.color, leg.toProgress) === index));
      const delay = impact ? impact.start + impact.duration * (impact.type === 'fly' && victim.progress === 53 ? .5 : 1) : time;
      plans.set(id, [{ from: planePoint(victim), to: airportPoint(victim.color, victim.number), start: delay, duration: 550, type: 'return' }]);
    }
  } else {
    for (const p of before.planes) if (p.progress >= 0 && g.planes.find(q => q.id === p.id)?.progress === -1) {
      plans.set(p.id, [{ from: planePoint(p), to: airportPoint(p.color, p.number), start: 0, duration: 600, type: 'return' }]);
    }
  }
  flightMotion = plans.size ? { plans, started: performance.now(), duration: Math.max(...[...plans.values()].map(legs => { const last = legs.at(-1); return last.start + last.duration; })) } : null;
}
function animateFlightPieces(nodes) {
  cancelAnimationFrame(flightFrame);
  const motion = flightMotion;
  if (!motion) return;
  const tick = now => {
    if (flightMotion !== motion) return;
    const elapsed = now - motion.started;
    for (const { piece, glyph, shadow, trail, legs, color } of nodes) {
      const leg = legs.find(leg => elapsed < leg.start + leg.duration) || legs.at(-1);
      const point = sampleFlightLeg(leg, elapsed), airborne = Math.sin(Math.PI * point.t);
      const flying = ['fly', 'launch', 'home', 'return'].includes(leg.type), angle = flying ? Math.atan2(leg.to[1] - leg.from[1], leg.to[0] - leg.from[0]) * 180 / Math.PI : color * 90;
      piece.setAttribute('transform', 'translate(' + point.x + ' ' + (point.y - point.lift) + ') scale(' + point.scale + ')');
      piece.setAttribute('data-motion', leg.type);
      glyph?.setAttribute('transform', 'translate(0 -1) rotate(' + angle + ') scale(' + 23 / 32 + ')');
      shadow.setAttribute('cx', point.x); shadow.setAttribute('cy', point.y + 7);
      shadow.setAttribute('rx', 13 - airborne * 4); shadow.setAttribute('opacity', .18 - airborne * .08);
      const radians = angle * Math.PI / 180, x = point.x, y = point.y - point.lift;
      trail.setAttribute('d', 'M' + (x - Math.cos(radians) * 19) + ' ' + (y - Math.sin(radians) * 19) + ' l' + (-Math.cos(radians) * 28) + ' ' + (-Math.sin(radians) * 28));
      trail.setAttribute('opacity', flying && elapsed >= leg.start ? airborne * .6 : 0);
    }
    if (elapsed >= motion.duration) { flightMotion = null; render(); }
    else flightFrame = requestAnimationFrame(tick);
  };
  tick(performance.now());
}
function renderFlight(board) {
  const g = game(), options = myTurn() ? flightOptions(g, seat()) : [];
  board.setAttribute('viewBox', '0 0 700 700'); board.setAttribute('aria-label', '传统飞行棋棋盘：左上红、右上黄、右下蓝、左下绿，52格彩色航线和中央十字终点');
  board.append(svg('rect', { width: 700, height: 700, fill: '#c8e8ef' }));
  const layout = svg('g', { transform: 'translate(44 44) scale(36)', 'aria-hidden': 'true' });
  board.append(layout);
  for (let c = 0; c < 4; c++) {
    const quarter = svg('g', { transform: 'rotate(' + c * 90 + ' 8.5 8.5)' }), color = flightPalette[c];
    layout.append(quarter);
    quarter.append(svg('rect', { x: .03, y: .03, width: 3.94, height: 3.94, rx: .06, fill: color }));
    for (let n = 1; n <= 4; n++) {
      const x = n % 2 ? 1.1 : 2.9, y = n <= 2 ? 1.1 : 2.9;
      quarter.append(svg('circle', { cx: x, cy: y, r: .47, fill: '#fff' }));
      if (!g.colors.includes(c)) { const mark = flightGlyph(x, y, .66, c); mark.setAttribute('opacity', '.28'); quarter.append(mark); }
    }
    quarter.append(svg('rect', { x: 1.95, y: 8.04, width: 5.2, height: .92, fill: color }));
    quarter.append(svg('path', { d: 'M7.15 7.22 Q7.08 7.12 7.08 7.32 V9.68 Q7.08 9.88 7.22 9.76 L8.42 8.58 Q8.5 8.5 8.42 8.42Z', fill: color }));
    for (let p = 51; p <= 56; p++) quarter.append(svg('circle', { cx: 2.5 + p - 51, cy: 8.5, r: .41, fill: '#fff' }));
    quarter.append(flightGlyph(.55, 4.55, .75, c));
    quarter.append(svg('path', { d: 'M.1 5.2 H.55 V5.04 L.86 5.3 L.55 5.56 V5.4 H.1Z', fill: color }));
    // Two arrows straddle the opposite home lane, showing the shortcut direction.
    for (const y of [7, 10]) quarter.append(svg('path', { d: 'M12.45 ' + (y - .28) + ' V' + (y + .1) + ' H12.28 L12.55 ' + (y + .36) + ' L12.82 ' + (y + .1) + ' H12.65 V' + (y - .28) + 'Z', fill: color }));
  }
  for (let i = 0; i < 52; i++) {
    const cell = flightQuarter[i % 13], c = Math.floor(i / 13), color = i % 4;
    const group = svg('g', { transform: 'rotate(' + c * 90 + ' 8.5 8.5)', class: 'flight-track-cell', 'data-index': i });
    if (cell.rect) {
      const [x, y, w, h] = cell.rect;
      group.append(svg('rect', { x: x + .04, y: y + .04, width: w - .08, height: h - .08, rx: .09, fill: flightPalette[color] }));
    } else {
      group.append(svg('polygon', { points: cell.triangle.map(p => p.join(',')).join(' '), fill: flightPalette[color], stroke: '#c8e8ef', 'stroke-width': .08, 'stroke-linejoin': 'round' }));
    }
    group.append(svg('circle', { cx: cell.at[0], cy: cell.at[1], r: .41, fill: '#fff' })); layout.append(group);
    if (i % 13 === 0) group.append(svg('path', { d: 'M.78 8.64 V8.45 H1.13 V8.29 L1.38 8.51 L1.13 8.73 V8.56 H.9 V8.64Z', fill: flightPalette[color] }));
    for (let shortcutColor = 0; shortcutColor < 4; shortcutColor++) {
      if ([18, 30].some(p => flightIndex(shortcutColor, p) === i)) {
        const [x, y] = ringPoint(i); board.append(flightGlyph(x, y, 24, shortcutColor, shortcutColor * 90 + 90));
      }
    }
  }
  const stacks = new Map(), animated = [];
  for (const p of [...g.planes].sort((a, b) => Number(flightMotion?.plans.has(a.id) || false) - Number(flightMotion?.plans.has(b.id) || false))) {
    const [baseX, baseY] = planePoint(p), key = baseX + ',' + baseY;
    const group = g.planes.filter(q => planePoint(q).join(',') === key), index = stacks.get(key) || 0; stacks.set(key, index + 1);
    const dx = group.length > 1 ? (index % 2 ? 7 : -7) : 0, dy = group.length > 2 ? (index < 2 ? -7 : 7) : 0;
    const legs = flightMotion?.plans.get(p.id);
    const x = legs ? 0 : baseX + dx, y = legs ? 0 : baseY + dy, enabled = options.includes(p.id), parked = !legs && (p.progress === -1 || p.progress === 56), r = parked ? 21 : 17;
    const piece = svg('g', { role: 'button', tabindex: enabled ? 0 : -1, 'aria-disabled': !enabled, class: 'flight-plane', 'data-plane': p.id, 'aria-label': FLIGHT_COLORS[p.color] + '方 ' + p.number + ' 号飞机，' + (p.progress === -1 ? '机库' : p.progress === 0 ? '起飞区' : p.progress === 56 ? '已到终点' : '第 ' + p.progress + ' 格') + (enabled ? '，可移动' : '') });
    if (enabled) piece.append(svg('circle', { cx: x, cy: y, r: r + 5, class: 'selected-ring' }));
    piece.append(svg('circle', { cx: x, cy: y + 3, r, fill: ['#bb405d','#c69316','#2b88ad','#41885d'][p.color], class: 'plane-base', filter:'url(#piece-shadow)' }));
    piece.append(svg('path',{ d:'M'+(x-r*.85)+' '+(y+r*.45)+' Q'+x+' '+(y+r*1.2)+' '+(x+r*.85)+' '+(y+r*.45), stroke:'#ffffff45', 'stroke-width':1, fill:'none', transform:'translate(0 4)' }));
    const top = svg('g',{transform:'translate('+x+' '+y+')',class:'plane-top'});
    top.append(svg('circle', { cx:0,cy:0,r,fill:'url(#flight-piece-' + p.color + ')',class:'plane-disc',opacity:p.progress===56?.8:1 }));
    top.append(svg('circle',{cx:0,cy:0,r:r-2.6,fill:'none',stroke:'#fffc','stroke-width':1.2}));
    top.append(svg('circle',{cx:0,cy:0,r:r-4.5,fill:'none',stroke:['#d75a7680','#d6a72680','#349abd80','#60a87580'][p.color],'stroke-width':1.2}));
    top.append(svg('path',{d:'M'+(-r*.72)+' '+(-r*.52)+' Q0 '+(-r*1.15)+' '+(r*.7)+' '+(-r*.52),fill:'none',stroke:'#fff','stroke-width':1.6,'stroke-linecap':'round',opacity:.85}));
    let glyph;
    if (p.progress === 56 && !legs) top.append(svg('text', { x:0, y:5, fill:'#fffaf0', class:'plane-complete' }, '✓'));
    else { glyph = flightGlyph(0, 0, parked ? 28 : 23, p.color, p.color * 90 - 18); glyph.setAttribute('fill', '#fffdf6'); glyph.classList.add('flight-glyph'); top.append(glyph); }
    piece.append(top);
    piece.append(svg('circle', { cx: x + r - 2, cy: y + r - 2, r: 6.5, fill: flightPalette[p.color], stroke: '#fff', 'stroke-width': 1 }));
    piece.append(svg('text', { x: x + r - 2, y: y + r + 1, class: 'plane-number' }, String(p.number)));
    if (legs) {
      const shadow = svg('ellipse', { rx: 13, ry: 5, fill: '#244553', 'pointer-events': 'none' });
      const trail = svg('path', { fill: 'none', stroke: flightPalette[p.color], 'stroke-width': 4, 'stroke-linecap': 'round', 'pointer-events': 'none' });
      board.append(shadow, trail); animated.push({ piece, glyph, shadow, trail, legs, color: p.color });
    }
    piece.addEventListener('click', () => flyPlane(p.id)); piece.addEventListener('keydown', e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); flyPlane(p.id); } }); board.append(piece);
  }
  animateFlightPieces(animated);
}
function renderBoard() { const board = $('table-svg'); board.replaceChildren(); boardDefs(board); if (kind === 'jungle') renderJungle(board); else renderFlight(board); }
function render() {
  if (kind === 'flight') {
    const current = game();
    syncDiceState({ scope:mode==='local'?localGame:room?room.code+':'+room.round:'lobby', rolls:current.rolls, value:current.dice, onFinish:render });
    if (!isDiceRolling()) syncFlightMotion();
  } else syncJungleMotion();
  const local = mode === 'local', g = game(), isSeated = seated(), count = g.count || 2;
  $('online-tab').classList.toggle('selected', !local); $('local-tab').classList.toggle('selected', local); $('online-tab').setAttribute('aria-pressed', !local); $('local-tab').setAttribute('aria-pressed', local);
  $('online-tab').disabled = pending; $('local-tab').disabled = pending;
  $('lobby').hidden = isSeated; $('room-panel').hidden = local || !room;
  $('connection').textContent = local ? '同屏' : !room ? '未入座' : transport ? '已连接' : '重连中';
  if (room) { $('room-code').textContent = room.code; $('room-note').textContent = room.closed ? '棋室已关闭，离开后可重新创建。' : `${room.players.filter(Boolean).length} / ${room.count} 人已入座${!room.started ? '，人齐后由房主开始。' : '，享受这一局。'}`; }
  $('board-label').textContent = local ? `${title} · 同屏对弈` : room ? `棋室 ${room.code}` : `${title} · 好友对弈`;
  $('round-label').textContent = room ? `第 ${room.round} 局` : local ? '同屏不计排名' : '行棋不限时';
  $('players').replaceChildren();
  for (let n = 1; n <= count; n++) {
    const player = document.createElement('div'); player.className = `table-player${isSeated && g.status === 'playing' && g.turn === n ? ' active' : ''}`;
    const token = document.createElement('span'); token.className = 'player-token'; token.style.backgroundColor = paint(n); token.textContent = kind === 'flight' ? '✈' : n === 1 ? '红' : '蓝';
    const name = document.createElement('span'); name.textContent = `${playerName(n)}${!local && room?.yourSeat === n ? ' · 你' : ''}`;
    const note = document.createElement('small'); note.textContent = local ? '已入座' : !room?.players[n - 1] ? '等待入座' : room.players[n - 1].gone ? '已离开' : room.players[n - 1].connected ? '已连接' : '暂时离线';
    player.append(token, name, note); $('players').append(player);
  }
  let status = '棋盘已备好', detail = '邀请朋友，开始这一局。';
  if (isSeated) {
    if (g.status === 'finished') { status = g.winner ? `${playerName(g.winner)}获胜` : '本局结束'; detail = g.reason === 'home' ? '四架飞机全部归航，好运也靠好判断。' : g.reason === 'den' ? '成功进入对方兽穴。' : g.reason === 'blocked' ? '对方已没有合法走法。' : g.reason === 'resign' ? '一方认输，本局结束。' : '一位玩家离开，棋室已关闭。'; }
    else if (!local && room.closed) { status = '棋室已关闭'; detail = '离开后可以创建新的房间。'; }
    else if (!local && !transport) { status = '正在重新连接…'; detail = '棋局已保留，恢复连接后继续。'; }
    else if (!local && !room.started) { status = allOnline() ? '棋手已齐，准备开始' : '等朋友们入座'; detail = room.yourSeat === 1 ? '分享邀请链接，人齐后点击开始。' : '请等待房主开始本局。'; }
    else if (!local && !allOnline()) { status = '有棋手暂时离线'; detail = '棋局已保留，等朋友回来再继续。'; }
    else { status = `轮到${local ? playerName(g.turn) : g.turn === seat() ? '你' : playerName(g.turn)}${kind === 'flight' ? g.phase === 'roll' ? '掷骰子' : '移动飞机' : '行棋'}`; detail = kind === 'flight' ? g.message : '先选己方动物，再点高亮格。不限时。'; }
  }
  if (flightMotion && g.status === 'playing' && !room?.closed) { status = '飞机行进中…'; detail = g.message; }
  if (isDiceRolling()) { status = '骰子翻滚中…'; detail = '停稳后再选择飞机。'; }
  if (jungleMotion) { status = jungleMotion.leap ? '跃过小河…' : '棋子跳跃中…'; detail = '落稳后继续行棋。'; }
  $('status-title').textContent = status; $('status-detail').textContent = detail; $('board-turn').textContent = isSeated ? status : '';
  $('board-help').textContent = kind === 'flight' ? '顺时针前进 · 飞机重叠时可用编号按钮选择。' : selected ? '选择高亮格行棋。' : '象 > 狮 > 虎 > 豹 > 狼 > 狗 > 猫 > 鼠';
  $('start-button').hidden = local || !room || room.started || room.closed || room.yourSeat !== 1; $('start-button').disabled = pending || !allOnline();
  $('flight-controls').hidden = kind !== 'flight' || !isSeated || (!local && !room.started) || g.status === 'finished';
  if (kind === 'flight') {
    $('dice').setAttribute('aria-label', g.dice ? `骰子 ${g.dice} 点` : '尚未掷骰');
    $('roll-button').disabled = !myTurn() || g.phase !== 'roll'; $('plane-options').replaceChildren();
    const owner = local ? g.turn : room?.yourSeat || 1;
    for (const p of g.planes.filter(p => p.owner === owner)) {
      const button = document.createElement('button'); button.textContent = `${p.number} 号 · ${p.progress === -1 ? '待起飞' : p.progress === 56 ? '已抵达' : p.progress === 0 ? '起飞区' : '前进'}`; button.disabled = !myTurn() || !flightOptions(g, owner).includes(p.id); button.addEventListener('click', () => flyPlane(p.id)); $('plane-options').append(button);
    }
  }
  $('game-actions').hidden = !isSeated; $('leave-button').textContent = local ? '重新开局 ↻' : '离开棋室 ↗'; $('leave-button').disabled = pending;
  $('resign-button').hidden = kind !== 'jungle' || g.status !== 'playing' || (!local && (!room?.started || room.closed)); $('resign-button').disabled = !available();
  $('rematch-button').hidden = !isSeated || g.status !== 'finished' || Boolean(room?.closed); $('rematch-button').disabled = pending || (!local && (!allOnline() || room.ready.includes(seat()))); $('rematch-button').textContent = !local && room?.ready.includes(seat()) ? '等待其他玩家确认…' : '再来一局 ↻';
  $('reactions-panel').hidden = !isSeated; document.querySelectorAll('[data-reaction]').forEach(b => b.disabled = pending || Date.now() < nextReactionAt || (!local && (!transport || !allOnline() || room.closed)));
  $('create-button').disabled = pending; $('join-button').disabled = pending; $('copy-button').disabled = Boolean(room?.closed); renderBoard();
  syncTabletop({ kind, dice: g.dice, phase: g.phase, active: !$('flight-controls').hidden, moving: Boolean(flightMotion), pending });
}

document.title = `一局 · ${title}`; document.body.classList.add(kind); document.querySelector('[data-rank-kind]').dataset.rankKind = kind;
$('game-title').textContent = kind === 'flight' ? '下一站，好运。' : '大有力量，小有主张。';
$('game-eyebrow').textContent = kind === 'flight' ? 'FLY TOGETHER. COME HOME FIRST.' : 'A LITTLE WILD. A GOOD STRATEGY.';
$('game-subtitle').textContent = kind === 'flight' ? '传统飞行棋 · 2～4 人 · 让四架飞机平安归航。' : '传统斗兽棋 · 双人对弈 · 越过小河，走进对方兽穴。';
$('count-field').hidden = kind !== 'flight'; $('rules-title').textContent = `${title}，这样玩。`;
const rules = kind === 'flight' ? [
  '2～4 人，每方 4 架飞机。红方先手，之后顺时针轮流。开局采用 6 点起飞版。',
  '掷出 6，可选一架机库内的飞机放到起飞区，或让在途飞机前进 6 格；之后再掷一次。连续第三个 6 会把本回合前两个 6 动过的飞机送回机库，结束本回合。',
  '飞机按骰点顺时针前进。落在自己的颜色格，向前跳 4 格一次；落在带同色飞机标记的飞跃起点，沿箭头飞跃。直接落在起点时，飞跃后再跳 4 格；先跳到起点则只飞跃。',
  '到达、跳到或飞到敌机所在格，会将该格所有敌机击回机库；飞跃会击回飞跃航线经过的对方终点跑道第三格上的飞机。经过普通格不吃子。',
  '自己的飞机可以叠放，但每次只移动一架；重叠时可用编号按钮选择。机库和起飞区不被吃子。',
  '绕到本色入口后进入终点跑道。恰好到终点才算抵达；点数过大则在终点反弹走完余步。最先让四架飞机抵达的一方获胜，本局结束。'
] : [
  '红方先行，每方各有鼠、猫、狗、狼、豹、虎、狮、象八只动物。每次走一只，上下左右一格，不可斜走。',
  '大吃小，同级可以互吃。等级从大到小：象 8、狮 7、虎 6、豹 5、狼 4、狗 3、猫 2、鼠 1。鼠能吃象，象不能吃鼠。',
  '只有鼠可以入河。水中的鼠可以吃水中的鼠；水陆之间不能直接吃子，须先走到同一地形。',
  '狮、虎可沿直线跳过河流，落到对岸第一格，也可吃掉该格不强于自己的敌兽。跳跃路径水中有任何一只鼠，便不能跳。',
  '走入对方陷阱时，动物等级降为 0，可被对方任意动物吃掉；走出陷阱恢复等级。自己的陷阱不降低自己的等级。',
  '不能进入自己的兽穴。进入对方兽穴，或让对方没有合法走法，立即获胜；认输判对方胜。'
];
const ol = document.createElement('ol'); for (const text of rules) { const li = document.createElement('li'); li.textContent = text; ol.append(li); } $('rules-content').append(ol);
const note = document.createElement('p'); note.textContent = '联机双方 / 所有玩家都在线才可行动；断线暂停、刷新原页面恢复。行棋没有时间限制。结束后全员确认再来一局，轮换先手。主动离开将关闭整间棋室；2 人对局判对方胜，3～4 人中途散局不计胜场。'; $('rules-content').append(note);
$('rules-button').onclick = () => $('rules-dialog').showModal(); document.querySelectorAll('.dialog-close').forEach(b => b.onclick = () => b.closest('dialog').close());
$('confirm-cancel').onclick = () => $('confirm-dialog').close(); $('confirm-ok').onclick = () => { $('confirm-dialog').close(); const fn = confirmAction; confirmAction = null; fn?.(); };
$('create-button').onclick = () => action(async () => { await profileReady; enter(await api('create', { count: Number($('player-count').value) })); });
$('join-form').onsubmit = e => { e.preventDefault(); action(async () => { await profileReady; enter(await api('join', { room: $('room-input').value.trim().toUpperCase() })); }); };
$('room-input').oninput = () => $('room-input').value = $('room-input').value.replace(/[^a-zA-Z2-9]/g, '').toUpperCase();
$('start-button').onclick = () => action(async () => apply(await api('start')));
$('roll-button').onclick = () => action(async () => { if (mode === 'local') rollFlight(localGame, localGame.turn, localDice()); else apply(await api('roll')); });
function switchMode(next) {
  if (next === mode) return;
  const go = () => action(async () => { if (session) await api('leave'); clearRoom(); mode = next; localGame = newTableGame(kind, Number($('player-count').value)); });
  if (room) confirm('离开棋室并切换？', '当前棋室会关闭，其他玩家也会结束本局。', go, '离开并切换'); else go();
}
$('online-tab').onclick = () => switchMode('online'); $('local-tab').onclick = () => switchMode('local');
$('leave-button').onclick = () => confirm(mode === 'local' ? '重新开始这一局？' : '离开这间棋室？', mode === 'local' ? '棋盘会恢复到初始状态。' : '棋室将关闭。两人对局进行中离开判对方胜，多人散局不计胜场。', () => action(async () => { if (mode === 'local') { localGame = newTableGame(kind, localGame.count || 2); selected = null; } else { await api('leave'); clearRoom(); refreshRankings(); } }), mode === 'local' ? '重新开局' : '离开棋室');
$('resign-button').onclick = () => confirm('这一局，先认输？', '确认后本局结束，对方获胜。', () => action(async () => { if (mode === 'local') { localGame.status = 'finished'; localGame.winner = 3 - localGame.turn; localGame.reason = 'resign'; } else apply(await api('resign')); }), '确认认输');
$('rematch-button').onclick = () => action(async () => { if (mode === 'local') { localGame = newTableGame(kind, localGame.count || 2); selected = null; } else apply(await api('rematch')); });
$('hall-link').onclick = e => { if (room) { e.preventDefault(); confirm('离开棋室，返回大厅？', '当前棋室会关闭，其他玩家也会结束本局。', () => action(async () => { await api('leave'); clearRoom(); location.href = '/'; }), '返回大厅'); } };
$('copy-button').onclick = async () => {
  const link = `${location.origin}/play?game=${kind}&room=${room.code}`;
  try { if (!navigator.clipboard || location.hostname === 'localhost') throw new Error(); await navigator.clipboard.writeText(link); toast('邀请链接已复制，发给朋友吧。'); }
  catch { $('share-url').value = link; showBoardDialog($('share-dialog')); $('share-url').select(); }
};
document.querySelectorAll('[data-reaction]').forEach(b => b.onclick = () => action(async () => {
  if (Date.now() < nextReactionAt) return;
  if (mode === 'local') effect({ kind: b.dataset.reaction, from: seat() }); else await api('reaction', { kind: b.dataset.reaction });
  nextReactionAt = Date.now() + 2000; setTimeout(render, 2050);
}));
setupTabletop(kind); render(); await profileReady;
try { const saved = JSON.parse(sessionStorage.getItem(`yiju-${kind}`) || 'null'); if (saved?.room && saved?.token) session = saved; } catch { /* Start fresh. */ }
const invitation = params.get('room')?.toUpperCase();
if (session) await action(async () => { try { apply(await api('sync')); connect(); if (invitation && invitation !== session.room) toast('已恢复原来的棋室，离开后可加入新房间。'); } catch (e) { if ([401, 404].includes(e.status)) clearRoom(); else connect(); throw e; } });
if (!session && invitation && /^[A-Z2-9]{6}$/.test(invitation)) { $('room-input').value = invitation; toast('邀请已收到，点击箭头加入。'); }
