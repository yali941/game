import { SIZE, newGame, playMove, resign, undoMove, agreeDraw } from './game.js';

const $ = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';
let mode = 'online', room = null, session = null, localGame = newGame(), stream = null;
let transport = false, pending = false, sound = false, audioContext, toastTimer, hover = null;
let lastMoveCount = 0, confirmAction = null;
let lastNoticeId = null, nextReactionAt = 0, reactionTimer, feedbackTimer;
const reactions = { poop: { emoji: '💩', label: '扔了一个大便', impact: '💩' }, heart: { emoji: '❤️', label: '送来一颗爱心', impact: '💕' }, bomb: { emoji: '💣', label: '扔了一颗炸弹', impact: '💥' } };
const cells = [], labels = 'ABCDEFGHJKLMNOP';
const game = () => mode === 'local' ? localGame : room?.game || newGame();
const myColor = () => mode === 'local' ? localGame.turn : room?.yourColor;
const bothOnline = () => room?.players.every(p => p?.connected && !p.gone);
const canPlay = () => !pending && game().status === 'playing' && (mode === 'local' || (transport && room && !room.closed && !room.request && bothOnline() && game().turn === myColor()));

function element(tag, attrs = {}, text = '') {
  const el = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (text) el.textContent = text;
  return el;
}
function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4200);
}
function persist() {
  try { if (session) sessionStorage.setItem('yiju-session', JSON.stringify(session)); else sessionStorage.removeItem('yiju-session'); } catch { /* The live game still works when storage is unavailable. */ }
}
function confirm(title, description, action, label = '确定') {
  $('confirm-title').textContent = title; $('confirm-description').textContent = description;
  $('confirm-ok').textContent = label; confirmAction = action; $('confirm-dialog').showModal();
}
function soundMove() {
  if (!sound) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioContext.createOscillator(), gain = audioContext.createGain();
    osc.connect(gain); gain.connect(audioContext.destination); osc.type = 'sine';
    const t = audioContext.currentTime; osc.frequency.setValueAtTime(560, t); osc.frequency.exponentialRampToValueAtTime(190, t + .07);
    gain.gain.setValueAtTime(.12, t); gain.gain.exponentialRampToValueAtTime(.001, t + .12); osc.start(t); osc.stop(t + .13);
  } catch { /* Audio is optional. */ }
}
async function api(action, data = {}) {
  const response = await fetch(`/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) }, body: JSON.stringify({ room: session?.room, ...data }), signal: AbortSignal.timeout(10000) });
  const value = await response.json();
  if (!response.ok) { const error = new Error(value.error || '操作失败，请重试'); error.status = response.status; throw error; }
  return value;
}
function friendly(error) { return error.name === 'TimeoutError' || error.name === 'TypeError' ? '暂时连接不上服务器，请检查网络后重试。' : error.message; }
async function action(fn) {
  if (pending) return;
  pending = true; render();
  try { await fn(); } catch (error) { toast(friendly(error)); }
  finally { pending = false; render(); }
}
function applyRoom(next, silent = false) {
  if (!silent && next.game.moves.length > lastMoveCount) soundMove();
  if (!silent && next.notice && next.notice.id !== lastNoticeId) toast(next.notice.text);
  lastNoticeId = next.notice?.id || null;
  lastMoveCount = next.game.moves.length; room = next; render();
}
function connect() {
  stream?.close(); transport = false;
  const activeSession = session;
  stream = new EventSource(`/api/events?room=${encodeURIComponent(session.room)}&token=${encodeURIComponent(session.token)}`);
  stream.onmessage = event => { if (session !== activeSession) return; transport = true; applyRoom(JSON.parse(event.data)); };
  stream.addEventListener('reaction', event => { if (session === activeSession && mode === 'online') showReaction(JSON.parse(event.data)); });
  stream.onerror = async () => {
    if (session !== activeSession) return;
    transport = false; render();
    try { await api('sync'); } catch (error) {
      if (session !== activeSession) return;
      if (error.status === 401 || error.status === 404) { clearRoom(); render(); toast('房间已失效，请创建或加入新房间。'); }
    }
  };
}
function enter(value) {
  session = { room: value.code, token: value.token }; persist();
  applyRoom(value, true); history.replaceState(null, '', `?room=${value.code}`); connect(); render();
}
function clearRoom() {
  stream?.close(); stream = null; session = null; room = null; transport = false; lastMoveCount = 0;
  lastNoticeId = null; resetReactions();
  persist(); history.replaceState(null, '', location.pathname);
}

function resetReactions() {
  clearTimeout(reactionTimer); clearTimeout(feedbackTimer); nextReactionAt = 0;
  $('reaction-stage').replaceChildren(); $('reaction-feedback').textContent = '小小互动，不影响棋局';
}
function showReaction(reaction) {
  const effect = reactions[reaction.kind];
  if (!effect || ![1, 2].includes(reaction.from)) return;
  const stage = $('reaction-stage');
  const batch = document.createElement('div');
  batch.className = `reaction-batch from-${reaction.from === 1 ? 'black' : 'white'} kind-${reaction.kind}`;
  const flight = document.createElement('span'); flight.className = 'reaction-flight'; flight.textContent = effect.emoji;
  const impact = document.createElement('span'); impact.className = 'reaction-impact'; impact.textContent = effect.impact;
  const caption = document.createElement('span'); caption.className = 'reaction-caption';
  caption.textContent = `${reaction.from === 1 ? '黑棋 → 白棋' : '白棋 → 黑棋'} ${effect.emoji}`;
  batch.append(flight, impact, caption); stage.append(batch);
  while (stage.children.length > 4) stage.firstElementChild.remove();
  setTimeout(() => batch.remove(), 2200);
  const sender = mode === 'local' ? reaction.from === 1 ? '黑棋' : '白棋' : reaction.from === myColor() ? '你' : '对手';
  $('reaction-feedback').textContent = `${sender}${effect.label} ${effect.emoji}`;
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => { $('reaction-feedback').textContent = '小小互动，不影响棋局'; }, 6000);
}
function requestAction(kind) {
  if (mode === 'local') {
    if (kind === 'undo') confirm('双方同意悔棋？', '撤回最近一手，由刚才落子的一方重新落子。', () => { undoMove(localGame, localGame.moves.at(-1).color); render(); }, '同意悔棋');
    else confirm('双方同意和棋？', '确认后本局以和棋结束，可以再来一局。', () => { agreeDraw(localGame); render(); }, '同意和棋');
  } else action(async () => { await api('request', { kind }); });
}
function respondToRequest(accept) {
  const request = room?.request;
  if (request) action(async () => { await api('respond', { id: request.id, accept }); });
}
function sendReaction(kind) {
  if (pending || Date.now() < nextReactionAt) return;
  action(async () => {
    if (mode === 'local') showReaction({ kind, from: localGame.turn });
    else await api('reaction', { kind });
    nextReactionAt = Date.now() + 2000;
    clearTimeout(reactionTimer); reactionTimer = setTimeout(render, 2050);
  });
}
async function leaveRoom() {
  if (session) await api('leave');
  clearRoom(); render();
}

function setupBoard() {
  const board = $('board');
  const defs = element('defs');
  for (const [id, light, dark] of [['black-stone', '#50594c', '#252c26'], ['white-stone', '#ffffff', '#eeeDE5']]) {
    const gradient = element('radialGradient', { id, cx: '32%', cy: '25%', r: '75%' });
    gradient.append(element('stop', { offset: '0%', 'stop-color': light }), element('stop', { offset: '100%', 'stop-color': dark })); defs.append(gradient);
  }
  const filter = element('filter', { id: 'stone-shadow', x: '-50%', y: '-50%', width: '200%', height: '220%', 'color-interpolation-filters': 'sRGB' });
  filter.append(element('feDropShadow', { dx: '1.5', dy: '3.5', stdDeviation: '2.3', 'flood-color': '#263021', 'flood-opacity': '.32' })); defs.append(filter); board.append(defs);
  for (let n = 0; n < SIZE; n++) {
    const pos = 40 + n * 40;
    board.append(element('line', { x1: 40, y1: pos, x2: 600, y2: pos, class: n === 0 || n === 14 ? 'grid-edge' : 'grid-line' }), element('line', { x1: pos, y1: 40, x2: pos, y2: 600, class: n === 0 || n === 14 ? 'grid-edge' : 'grid-line' }));
    board.append(element('text', { x: pos, y: 22, 'text-anchor': 'middle', class: 'board-coordinate' }, labels[n]), element('text', { x: 19, y: pos + 3, 'text-anchor': 'middle', class: 'board-coordinate' }, String(15 - n)));
  }
  for (const [x, y] of [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]]) board.append(element('circle', { cx: 40 + x * 40, cy: 40 + y * 40, r: 3.1, class: 'star-point' }));
  board.append(element('g', { id: 'stones' }), element('g', { id: 'hover' }));
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const cell = element('circle', { cx: 40 + x * 40, cy: 40 + y * 40, r: 19.8, class: 'intersection', role: 'button', tabindex: x === 7 && y === 7 ? '0' : '-1', 'aria-label': `${labels[x]}${15 - y}，空位` });
    cell.addEventListener('click', () => move(x, y));
    cell.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') { hover = [x, y]; renderHover(); } });
    cell.addEventListener('focus', () => {
      for (const c of cells) c.setAttribute('tabindex', c === cell ? '0' : '-1');
      hover = [x, y]; renderHover();
    });
    cell.addEventListener('keydown', event => {
      let [nx, ny] = [x, y];
      if (event.key === 'ArrowLeft') nx--; else if (event.key === 'ArrowRight') nx++;
      else if (event.key === 'ArrowUp') ny--; else if (event.key === 'ArrowDown') ny++;
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); move(x, y); return; } else return;
      event.preventDefault(); nx = Math.max(0, Math.min(14, nx)); ny = Math.max(0, Math.min(14, ny));
      cell.setAttribute('tabindex', '-1'); cells[ny * SIZE + nx].setAttribute('tabindex', '0'); cells[ny * SIZE + nx].focus();
    });
    cells.push(cell); board.append(cell);
  }
  board.addEventListener('pointerleave', () => { hover = null; renderHover(); });
}
function renderHover() {
  $('hover').replaceChildren();
  if (!hover || !canPlay()) return;
  const [x, y] = hover;
  if (game().board[y * SIZE + x]) return;
  $('hover').append(element('circle', { cx: 40 + x * 40, cy: 40 + y * 40, r: 16.5, fill: game().turn === 1 ? '#27362b' : '#fff', stroke: '#8e9b82', class: 'hover-stone' }));
}
function renderBoard() {
  const g = game(), stones = $('stones'); stones.replaceChildren();
  g.board.forEach((color, index) => {
    const x = index % SIZE, y = Math.floor(index / SIZE);
    cells[index].setAttribute('aria-label', `${labels[x]}${15 - y}，${color ? color === 1 ? '黑棋' : '白棋' : '空位'}`);
    cells[index].setAttribute('aria-disabled', String(Boolean(color) || !canPlay()));
    if (color) stones.append(element('circle', { cx: 40 + x * 40, cy: 40 + y * 40, r: 16.5, fill: `url(#${color === 1 ? 'black' : 'white'}-stone)`, stroke: color === 2 ? '#d9ddcf' : '#252e26', 'stroke-width': '.7', class: 'game-stone' }));
  });
  for (const [x, y] of g.line) stones.append(element('circle', { cx: 40 + x * 40, cy: 40 + y * 40, r: 19.5, class: 'win-ring' }));
  const last = g.moves.at(-1);
  if (last) stones.append(element('circle', { cx: 40 + last.x * 40, cy: 40 + last.y * 40, r: 3, class: 'last-point' }));
  $('board').classList.toggle('playable', canPlay());
  $('move-counter').replaceChildren(document.createTextNode('第 '), Object.assign(document.createElement('b'), { textContent: String(g.moves.length).padStart(2, '0') }), document.createTextNode(' 手'));
  $('coordinate').textContent = last ? `最近落子 ${labels[last.x]}${15 - last.y}` : '黑先 · 白后';
  renderHover();
}
function render() {
  const local = mode === 'local', seated = local || Boolean(room), g = game();
  $('online-tab').classList.toggle('selected', !local); $('local-tab').classList.toggle('selected', local);
  $('online-tab').setAttribute('aria-pressed', String(!local)); $('local-tab').setAttribute('aria-pressed', String(local));
  document.querySelector('.sidebar').classList.toggle('local-mode', local);
  $('lobby').hidden = local || Boolean(room); $('room-panel').hidden = !room || local;
  $('board-mode').textContent = local ? '同屏对弈' : room ? `棋室 ${room.code}` : '好友对弈';
  $('mode-dot').classList.toggle('active', local || transport);
  $('connection').textContent = local ? '同屏' : !room ? '未入座' : transport ? '已连接' : '重连中';
  $('connection').classList.toggle('online', local || transport);
  if (room) {
    $('room-code').textContent = room.code; $('round-label').textContent = `第 ${room.round} 局`;
    $('copy-button').disabled = room.closed;
    $('invite-note').textContent = room.closed ? '棋室已关闭，离开后可以创建新房间。' : room.players[1] ? '两位棋手已入座，享受这一局。' : '把链接或房间码发给朋友，即可入座。';
  }
  let title = '棋盘已备好', detail = '邀请朋友，开始你们的第一步。', symbol = '○';
  if (seated) {
    if (g.status === 'finished') {
      title = g.winner ? `${g.winner === 1 ? '黑棋' : '白棋'}获胜${!local && g.winner === myColor() ? ' · 好棋！' : ''}` : '和棋 · 旗鼓相当';
      detail = g.reason === 'resign' ? `${g.winner === 1 ? '白棋' : '黑棋'}认输，本局结束。` : g.reason === 'leave' ? '一方离开了棋室，本局结束。' : g.reason === 'draw' ? '棋盘已满，不妨再来一局。' : '五子连珠，胜负已定。';
      if (g.reason === 'agreement') detail = '双方同意和棋，握手言和。';
      if (!local && g.reason === 'resign') detail = g.winner === myColor() ? '对手认输，本局结束。' : '你已认输，再来一局吧。';
      if (!local && room.ready.length) detail = room.ready.includes(myColor()) ? '你已准备，等待对手再来一局。' : '对手想再来一局，轮到你确认了。';
      symbol = g.winner ? '✳' : '＝';
    } else if (!local && room.closed) { title = '棋室已关闭'; detail = '离开后可以创建新的房间。'; }
    else if (!local && !transport) { title = '正在重新连接…'; detail = '棋局已保留，连接恢复后继续。'; }
    else if (!local && !room.players[1]) { title = '等一位朋友入座'; detail = '分享邀请链接，朋友加入即可开局。'; }
    else if (!local && !bothOnline()) { title = '对手暂时离线'; detail = '棋局已保留，等朋友回来再继续。'; }
    else if (!local && room.request) {
      title = room.request.from === myColor() ? '等待对手回应' : room.request.kind === 'undo' ? '对手申请悔棋' : '对手向你求和';
      detail = '请求处理后继续，双方仍然不限时。'; symbol = '⇄';
    }
    else {
      title = local ? `轮到${g.turn === 1 ? '黑棋' : '白棋'}落子` : g.turn === myColor() ? '轮到你落子' : '等对手落子';
      detail = '没有倒计时，慢慢想就好。'; symbol = g.turn === 1 ? '●' : '○';
    }
  }
  $('status-title').textContent = title; $('status-detail').textContent = detail; $('status-symbol').textContent = symbol;
  $('board-turn').textContent = seated ? title : '';
  for (const [color, key] of [[1, 'black'], [2, 'white']]) {
    const p = room?.players.find(p => p?.color === color);
    $(`${key}-name`).textContent = !local && room ? color === myColor() ? '你' : '好友' : color === 1 ? '先手' : '后手';
    $(`${key}-state`).textContent = local ? '已入座' : p?.gone ? '已离开' : p ? p.connected ? '已入座' : '暂时离线' : '等待入座';
    $(`${key}-player`).classList.toggle('active', seated && g.status === 'playing' && g.turn === color && (local || (transport && bothOnline())));
  }
  $('game-actions').hidden = !seated;
  const readyForAction = seated && !pending && (local || (transport && bothOnline() && !room.closed));
  const request = local ? null : room?.request;
  const ownRequest = request?.from === myColor();
  $('negotiation-buttons').hidden = !seated || g.status !== 'playing' || Boolean(room?.closed);
  $('undo-button').disabled = !readyForAction || Boolean(request) || !(local ? g.moves.length : g.moves.some(move => move.color === myColor()));
  $('draw-button').disabled = !readyForAction || Boolean(request);
  $('request-panel').hidden = !request;
  if (request) {
    const name = request.kind === 'undo' ? '悔棋' : '求和';
    $('request-title').textContent = ownRequest ? `已发送${name}请求` : `对手申请${name}`;
    $('request-detail').textContent = request.kind === 'undo' ? `同意后撤回${g.moves.at(-1)?.color === request.from ? '最近一手' : '双方最近各一手'}，由${request.from === 1 ? '黑棋' : '白棋'}重下。` : '同意后以和棋结束本局。';
    $('request-accept').hidden = ownRequest; $('request-reject').hidden = ownRequest; $('request-cancel').hidden = !ownRequest;
    $('request-accept').disabled = !readyForAction; $('request-reject').disabled = !readyForAction;
    $('request-cancel').disabled = pending || !transport;
  }
  $('reactions-panel').hidden = !seated;
  for (const button of document.querySelectorAll('[data-reaction]')) button.disabled = !readyForAction || Date.now() < nextReactionAt;
  $('resign-button').disabled = pending || g.status !== 'playing' || (!local && (!transport || !bothOnline() || room.closed));
  $('resign-button').hidden = g.status === 'finished' || Boolean(room?.closed);
  $('leave-button').textContent = local ? '重新开局 ↻' : '离开房间 ↗'; $('leave-button').disabled = pending;
  $('rematch-button').hidden = !seated || g.status !== 'finished' || Boolean(room?.closed);
  $('rematch-button').disabled = pending || (!local && (!transport || !bothOnline() || room.ready.includes(myColor())));
  $('rematch-button').textContent = !local && room?.ready.includes(myColor()) ? '等待对手确认…' : '再来一局 ↻';
  $('create-button').disabled = pending; $('join-button').disabled = pending;
  $('online-tab').disabled = pending; $('local-tab').disabled = pending;
  renderBoard();
}
function move(x, y) {
  if (!canPlay()) return;
  if (mode === 'local') {
    try { playMove(localGame, localGame.turn, x, y); soundMove(); render(); } catch (error) { toast(error.message); }
  } else action(async () => { await api('move', { x, y }); });
}
function switchMode(next) {
  if (mode === next || pending) return;
  const change = () => action(async () => { if (session) await leaveRoom(); resetReactions(); mode = next; render(); });
  if (room) confirm('离开这间棋室？', '切换模式会关闭当前房间。进行中的对局将判对方获胜。', change, '离开并切换');
  else change();
}

$('create-button').addEventListener('click', () => action(async () => enter(await api('create'))));
$('join-form').addEventListener('submit', event => { event.preventDefault(); const code = $('room-input').value.trim().toUpperCase(); if (!/^[A-Z2-9]{6}$/.test(code)) return toast('请输入 6 位房间码。'); action(async () => enter(await api('join', { room: code }))); });
$('room-input').addEventListener('input', () => { $('room-input').value = $('room-input').value.replace(/[^a-zA-Z2-9]/g, '').toUpperCase(); });
$('online-tab').addEventListener('click', () => switchMode('online'));
$('local-tab').addEventListener('click', () => switchMode('local'));
$('undo-button').addEventListener('click', () => requestAction('undo'));
$('draw-button').addEventListener('click', () => requestAction('draw'));
$('request-accept').addEventListener('click', () => respondToRequest(true));
$('request-reject').addEventListener('click', () => respondToRequest(false));
$('request-cancel').addEventListener('click', () => { const request = room?.request; if (request) action(async () => { await api('cancel-request', { id: request.id }); }); });
document.querySelectorAll('[data-reaction]').forEach(button => button.addEventListener('click', () => sendReaction(button.dataset.reaction)));
$('rules-button').addEventListener('click', () => $('rules-dialog').showModal());
document.querySelectorAll('.dialog-close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$('confirm-cancel').addEventListener('click', () => $('confirm-dialog').close());
$('confirm-ok').addEventListener('click', () => { $('confirm-dialog').close(); const fn = confirmAction; confirmAction = null; fn?.(); });
$('sound-button').addEventListener('click', async () => { sound = !sound; $('sound-button').setAttribute('aria-pressed', String(sound)); $('sound-button').title = sound ? '关闭落子音效' : '开启落子音效'; $('sound-wave').setAttribute('d', sound ? 'M15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14' : 'm16 9 6 6m0-6-6 6'); if (sound) { soundMove(); await audioContext?.resume(); } });
$('copy-button').addEventListener('click', async () => {
  const invite = `${location.origin}/?room=${room.code}`;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || !navigator.clipboard) {
    $('share-note').textContent = location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? '当前是本机地址。请先用启动窗口显示的局域网地址打开游戏，再把邀请链接发给同一 Wi-Fi 下的朋友。' : '长按或选中下方链接，复制给朋友。';
    $('share-url').value = invite; $('share-dialog').showModal(); $('share-url').select();
  } else {
    try { await navigator.clipboard.writeText(invite); toast('邀请链接已复制，发给朋友吧。'); }
    catch { $('share-note').textContent = '选中下方链接，复制给朋友。'; $('share-url').value = invite; $('share-dialog').showModal(); $('share-url').select(); }
  }
});
$('resign-button').addEventListener('click', () => confirm('这一局，先认输？', '确认后本局结束，对方获胜。', () => action(async () => { if (mode === 'local') resign(localGame, localGame.turn); else await api('resign'); }), '确认认输'));
$('leave-button').addEventListener('click', () => {
  if (mode === 'local') confirm('重新开始这一局？', '棋盘将清空，由黑棋先行。', () => { localGame = newGame(); render(); }, '重新开局');
  else confirm('离开这间棋室？', room.game.status === 'playing' && room.players[1] ? '进行中的对局将判对方获胜，房间会关闭。' : '离开后房间将关闭，可以重新创建棋室。', () => action(leaveRoom), '离开房间');
});
$('rematch-button').addEventListener('click', () => action(async () => { if (mode === 'local') localGame = newGame(); else await api('rematch'); }));

setupBoard(); render();
try { const stored = JSON.parse(sessionStorage.getItem('yiju-session') || 'null'); if (stored?.room && stored?.token) session = stored; } catch { /* Start a fresh session. */ }
const invitation = new URLSearchParams(location.search).get('room')?.toUpperCase();
if (session) {
  await action(async () => {
    try { applyRoom(await api('sync'), true); connect(); if (invitation && invitation !== session.room) toast('已恢复你正在进行的棋局。离开后可加入其他房间。'); }
    catch (error) { if (error.status === 401 || error.status === 404) clearRoom(); else connect(); throw error; }
  });
} else if (invitation && /^[A-Z2-9]{6}$/.test(invitation)) { $('room-input').value = invitation; toast('邀请已收到，点击箭头加入好友的棋室。'); }
