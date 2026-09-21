import { ANIMALS, ANIMAL_ICONS, FLIGHT_COLORS, FLIGHT_PAINTS, newTableGame, jungleTargets, moveJungle, moveFlight, rollFlight, flightOptions, flightIndex, river, denOwner, trapOwner } from './table-rules.js';
import { profileReady, profileHeaders, refreshRankings } from './profile.js';

const $ = id => document.getElementById(id), ns = 'http://www.w3.org/2000/svg';
const params = new URLSearchParams(location.search), kind = params.get('game') === 'jungle' ? 'jungle' : 'flight';
const title = kind === 'flight' ? '飞行棋' : '斗兽棋';
let mode = 'online', room = null, session = null, stream = null, transport = false, pending = false;
let localGame = newTableGame(kind, 2), selected = null, toastTimer, confirmAction, nextReactionAt = 0, lastRankedRound = '';
const game = () => mode === 'local' ? localGame : room?.game || localGame;
const seat = () => mode === 'local' ? game().turn : room?.yourSeat;
const allOnline = () => room?.players.every(p => p?.connected && !p.gone);
const seated = () => mode === 'local' || Boolean(room);
const available = () => !pending && (mode === 'local' || (transport && room?.started && !room.closed && allOnline()));
const myTurn = () => available() && game().status === 'playing' && game().turn === seat();
const colorOf = n => kind === 'flight' ? game().colors[n - 1] : n === 1 ? 0 : 2;
const playerName = n => `${FLIGHT_COLORS[colorOf(n)]}方`;
const paint = n => FLIGHT_PAINTS[colorOf(n)];
function svg(tag, attrs = {}, text = '') { const el = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); if (text) el.textContent = text; return el; }
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4500); }
function confirm(text, detail, fn, label = '确定') { $('confirm-title').textContent = text; $('confirm-text').textContent = detail; $('confirm-ok').textContent = label; confirmAction = fn; $('confirm-dialog').showModal(); }
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
  shadow.append(svg('feDropShadow', { dx: 1, dy: 2.5, stdDeviation: 2, 'flood-opacity': .22, 'flood-color': '#293c21' })); defs.append(shadow); board.append(defs);
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
function renderJungle(board) {
  const g = game(); board.setAttribute('viewBox', '0 0 490 620'); board.setAttribute('aria-label', '7列9行斗兽棋棋盘，选择己方动物，再选择高亮格');
  const unit = 62, offset = 28, targets = selected && myTurn() ? jungleTargets(g, selected) : [];
  for (let y = 0; y < 9; y++) for (let x = 0; x < 7; x++) {
    const cx = offset + x * unit, cy = offset + y * unit, water = river(x, y), den = denOwner(x, y), trap = trapOwner(x, y);
    board.append(svg('rect', { x: cx, y: cy, width: unit, height: unit, rx: 3, class: `jungle-cell${water ? ' jungle-water' : den ? ' jungle-den' : trap ? ' jungle-trap' : ''}` }));
    if (water || den || trap) board.append(svg('text', { x: cx + unit / 2, y: cy + unit / 2 + 5, class: `terrain-label${water ? ' river-label' : ''}` }, water ? '≈' : den ? `${den === 1 ? '红' : '蓝'}穴` : '陷阱'));
    const p = g.pieces.find(p => p.x === x && p.y === y), target = targets.some(t => t.x === x && t.y === y);
    if (p) {
      const piece = svg('g', { class: 'animal-piece' });
      piece.append(svg('circle', { cx: cx + 31, cy: cy + 31, r: 24, stroke: paint(p.owner), class: 'animal-disc' }));
      piece.append(svg('text', { x: cx + 31, y: cy + 28, fill: paint(p.owner), class: 'animal-label' }, ANIMALS[p.rank]));
      piece.append(svg('text', { x: cx + 31, y: cy + 47, fill: paint(p.owner), class: 'animal-rank' }, String(p.rank))); board.append(piece);
      if (p.id === selected) board.append(svg('circle', { cx: cx + 31, cy: cy + 31, r: 28, class: 'selected-ring' }));
    }
    if (target) board.append(svg('circle', { cx: cx + 31, cy: cy + 31, r: p ? 28 : 8, class: p ? 'target-ring' : 'target-dot' }));
    const enabled = myTurn() && (p?.owner === seat() || target);
    const hit = svg('rect', { x: cx, y: cy, width: unit, height: unit, rx: 3, class: 'cell-hit', role: 'button', tabindex: enabled ? 0 : -1, 'aria-disabled': !enabled, 'aria-label': `${String.fromCharCode(65 + x)}${9 - y}，${p ? `${playerName(p.owner)}${ANIMALS[p.rank]}` : den ? '兽穴' : trap ? '陷阱' : water ? '河流' : '空格'}${target ? '，可走' : ''}` });
    hit.addEventListener('click', () => cellAction(x, y)); hit.addEventListener('keydown', e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); cellAction(x, y); } }); board.append(hit);
  }
}

const center = 350, radius = 235;
const ringPoint = index => { const a = (-90 + index * 360 / 52) * Math.PI / 180; return [center + Math.cos(a) * radius, center + Math.sin(a) * radius]; };
const lanePoint = (color, progress) => { const r = [220, 201, radius * Math.cos(6 * Math.PI / 26), 137, 95, 48][progress - 51], a = (-90 + color * 90) * Math.PI / 180; return [center + Math.cos(a) * r, center + Math.sin(a) * r]; };
const airport = color => [[590, 110], [590, 590], [110, 590], [110, 110]][color];
const launch = color => { const [x, y] = ringPoint(color * 13 + 2); return [center + (x - center) * 1.18, center + (y - center) * 1.18]; };
function planePoint(p) {
  if (p.progress === -1 || p.progress === 56) { const [x, y] = airport(p.color); return [x + (p.number % 2 ? -25 : 25), y + (p.number <= 2 ? -20 : 25)]; }
  if (p.progress === 0) return launch(p.color);
  if (p.progress >= 51) return lanePoint(p.color, p.progress);
  return ringPoint(flightIndex(p.color, p.progress));
}
function flyPlane(id) { if (!myTurn() || !flightOptions(game(), seat()).includes(id)) return; action(async () => { if (mode === 'local') moveFlight(game(), seat(), id); else apply(await api('move', { id })); }); }
function renderFlight(board) {
  const g = game(), options = myTurn() ? flightOptions(g, seat()) : [];
  board.setAttribute('viewBox', '0 0 700 700'); board.setAttribute('aria-label', '飞行棋棋盘，四座机场、52格环形航线和各色终点跑道');
  board.append(svg('circle', { cx: center, cy: center, r: radius, fill: 'none', stroke: '#d6decc', 'stroke-width': 32 }));
  for (let c = 0; c < 4; c++) {
    const [ax, ay] = airport(c), enabled = g.colors.includes(c);
    board.append(svg('rect', { x: ax - 69, y: ay - 63, width: 138, height: 134, rx: 25, fill: FLIGHT_PAINTS[c], opacity: enabled ? .12 : .045, stroke: FLIGHT_PAINTS[c], 'stroke-width': 1.5 }));
    board.append(svg('text', { x: ax, y: ay < center ? ay - 76 : ay + 91, fill: FLIGHT_PAINTS[c], class: 'airport-label' }, `${FLIGHT_COLORS[c]}方机场${enabled ? '' : ' · 空席'}`));
    const [sx, sy] = launch(c); board.append(svg('circle', { cx: sx, cy: sy, r: 18, fill: FLIGHT_PAINTS[c], opacity: .16 }));
    board.append(svg('text', { x: sx, y: sy + 4, fill: FLIGHT_PAINTS[c], 'font-size': 11, 'text-anchor': 'middle' }, '起'));
    for (let p = 51; p <= 56; p++) { const [x, y] = lanePoint(c, p); board.append(svg('circle', { cx: x, cy: y, r: p === 56 ? 20 : p < 54 ? 10 : 14, fill: FLIGHT_PAINTS[c], opacity: p === 56 ? .7 : .27, stroke: '#fffdf5', 'stroke-width': 2 })); board.append(svg('text', { x, y: y + 4, 'text-anchor': 'middle', fill: p === 56 ? '#fff' : FLIGHT_PAINTS[c], 'font-size': 10 }, p === 56 ? '终' : ['↓', '←', '↑', '→'][c])); }
    const [x1, y1] = ringPoint(flightIndex(c, 18)), [x2, y2] = ringPoint(flightIndex(c, 30));
    board.append(svg('path', { d: `M ${x1} ${y1} L ${x2} ${y2}`, stroke: FLIGHT_PAINTS[c], class: 'flight-route' }));
  }
  for (let i = 0; i < 52; i++) {
    const [x, y] = ringPoint(i), color = i % 4; // Each entry square is color*13, hence color i%4.
    board.append(svg('circle', { cx: x, cy: y, r: 14, fill: FLIGHT_PAINTS[color], opacity: .68, class: 'flight-cell' }));
    const shortcut = [0, 1, 2, 3].some(c => flightIndex(c, 18) === i);
    if (shortcut) board.append(svg('text', { x, y: y + 4, fill: '#fff', 'font-size': 13, 'text-anchor': 'middle' }, '✦'));
  }
  board.append(svg('text', { x: center, y: center + 5, class: 'flight-home' }, '归航'));
  board.append(svg('text', { x: center, y: 30, class: 'flight-hint' }, '顺时针前进 ↻ · 掷 6 起飞'));
  board.append(svg('text', { x: center, y: 679, class: 'flight-hint' }, '✦ 飞跃起点 · 同色跳 4 格 · 四架归航即胜'));
  const stacks = new Map();
  for (const p of g.planes) {
    const [baseX, baseY] = planePoint(p), key = `${baseX},${baseY}`;
    const group = g.planes.filter(q => planePoint(q).join(',') === key), index = stacks.get(key) || 0; stacks.set(key, index + 1);
    const dx = group.length > 1 ? (index % 2 ? 9 : -9) : 0, dy = group.length > 2 ? (index < 2 ? -8 : 8) : 0;
    const x = baseX + dx, y = baseY + dy, enabled = options.includes(p.id);
    const piece = svg('g', { role: 'button', tabindex: enabled ? 0 : -1, 'aria-disabled': !enabled, class: 'flight-plane', 'aria-label': `${FLIGHT_COLORS[p.color]}方 ${p.number} 号飞机，${p.progress === -1 ? '机库' : p.progress === 0 ? '起飞区' : p.progress === 56 ? '已到终点' : `第 ${p.progress} 格`}${enabled ? '，可移动' : ''}` });
    if (enabled) piece.append(svg('circle', { cx: x, cy: y, r: 24, class: 'selected-ring' }));
    piece.append(svg('circle', { cx: x, cy: y, r: 18, fill: FLIGHT_PAINTS[p.color], class: 'plane-disc', opacity: p.progress === 56 ? .45 : 1 }));
    piece.append(svg('text', { x, y: y - 3, class: 'plane-glyph' }, p.progress === 56 ? '✓' : '✈'));
    piece.append(svg('text', { x, y: y + 13, class: 'plane-number' }, String(p.number)));
    piece.addEventListener('click', () => flyPlane(p.id)); piece.addEventListener('keydown', e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); flyPlane(p.id); } }); board.append(piece);
  }
}
function renderBoard() { const board = $('table-svg'); board.replaceChildren(); boardDefs(board); if (kind === 'jungle') renderJungle(board); else renderFlight(board); }
function render() {
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
  $('status-title').textContent = status; $('status-detail').textContent = detail; $('board-turn').textContent = isSeated ? status : '';
  $('board-help').textContent = kind === 'flight' ? '飞机重叠时，也可点右侧编号选择。' : selected ? '选择高亮格行棋。' : '象 > 狮 > 虎 > 豹 > 狼 > 狗 > 猫 > 鼠';
  $('start-button').hidden = local || !room || room.started || room.closed || room.yourSeat !== 1; $('start-button').disabled = pending || !allOnline();
  $('flight-controls').hidden = kind !== 'flight' || !isSeated || (!local && !room.started) || g.status === 'finished';
  if (kind === 'flight') {
    $('dice').textContent = g.dice ? ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][g.dice - 1] : '⚄'; $('dice').setAttribute('aria-label', g.dice ? `骰子 ${g.dice} 点` : '尚未掷骰');
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
}

document.title = `一局 · ${title}`; document.body.classList.add(kind); document.querySelector('[data-rank-kind]').dataset.rankKind = kind;
$('game-title').textContent = kind === 'flight' ? '下一站，好运。' : '大有力量，小有主张。';
$('game-eyebrow').textContent = kind === 'flight' ? 'FLY TOGETHER. COME HOME FIRST.' : 'A LITTLE WILD. A GOOD STRATEGY.';
$('game-subtitle').textContent = kind === 'flight' ? '传统飞行棋 · 2～4 人 · 让四架飞机平安归航。' : '传统斗兽棋 · 双人对弈 · 越过小河，走进对方兽穴。';
$('count-field').hidden = kind !== 'flight'; $('rules-title').textContent = `${title}，这样玩。`;
const rules = kind === 'flight' ? [
  '2～4 人，每方 4 架飞机。红方先手，之后顺时针轮流。开局采用 6 点起飞版。',
  '掷出 6，可选一架机库内的飞机放到起飞区，或让在途飞机前进 6 格；之后再掷一次。连续第三个 6 会把本回合前两个 6 动过的飞机送回机库，结束本回合。',
  '飞机按骰点顺时针前进。落在自己的颜色格，向前跳 4 格一次；落在同色 ✦ 星格，沿虚线飞跃。直接落在星格时，飞跃后再跳 4 格；先跳到星格则只飞跃。',
  '到达、跳到或飞到敌机所在格，会将该格所有敌机击回机库；飞跃会击回虚线经过的对方终点跑道第三格上的飞机。经过普通格不吃子。',
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
  catch { $('share-url').value = link; $('share-dialog').showModal(); $('share-url').select(); }
};
document.querySelectorAll('[data-reaction]').forEach(b => b.onclick = () => action(async () => {
  if (Date.now() < nextReactionAt) return;
  if (mode === 'local') effect({ kind: b.dataset.reaction, from: seat() }); else await api('reaction', { kind: b.dataset.reaction });
  nextReactionAt = Date.now() + 2000; setTimeout(render, 2050);
}));
render(); await profileReady;
try { const saved = JSON.parse(sessionStorage.getItem(`yiju-${kind}`) || 'null'); if (saved?.room && saved?.token) session = saved; } catch { /* Start fresh. */ }
const invitation = params.get('room')?.toUpperCase();
if (session) await action(async () => { try { apply(await api('sync')); connect(); if (invitation && invitation !== session.room) toast('已恢复原来的棋室，离开后可加入新房间。'); } catch (e) { if ([401, 404].includes(e.status)) clearRoom(); else connect(); throw e; } });
if (!session && invitation && /^[A-Z2-9]{6}$/.test(invitation)) { $('room-input').value = invitation; toast('邀请已收到，点击箭头加入。'); }
