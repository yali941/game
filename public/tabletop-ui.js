const $ = id => document.getElementById(id);
let surface, requestDialog, requestReopen, currentRequestId, dismissedRequestId, diceButton, diceFace;
let diceSnapshot, diceRolling = false, diceAnimations = [], diceGeneration = 0, diceRotation = [0, 0];
export const isDiceRolling = () => diceRolling;
const diceAngles = { 1: [0,0], 2: [-90,0], 3: [0,-90], 4: [0,90], 5: [90,0], 6: [0,180] };
const cubeTransform = (x,y,lift=0,z=0) => `translateY(${lift}px) rotateX(${x}deg) rotateY(${y}deg) rotateZ(${z}deg)`;
function stopDiceAnimation() {
  diceGeneration++; diceAnimations.forEach(animation => animation.cancel()); diceAnimations = []; diceRolling = false;
}
function setDiceResult(value) {
  diceRotation = diceAngles[value] || diceAngles[1];
  diceFace.style.transform = cubeTransform(...diceRotation);
  diceFace.dataset.value = String(value || 1);
}
export function syncDiceState({ scope, rolls, value, onFinish }) {
  if (!diceFace) return;
  const previous = diceSnapshot; diceSnapshot = { scope, rolls };
  if (!previous || previous.scope !== scope || rolls < previous.rolls) {
    stopDiceAnimation(); setDiceResult(value); return;
  }
  if (rolls === previous.rolls) return;
  const from = [...diceRotation]; stopDiceAnimation();
  if (rolls !== previous.rolls + 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) { setDiceResult(value); return; }
  diceRolling = true;
  const generation = diceGeneration, [x,y] = diceAngles[value], duration = 1250;
  const cube = diceFace.animate([
    { transform:cubeTransform(...from), offset:0 },
    { transform:cubeTransform(from[0]+190,from[1]+140,-35,25), offset:.24 },
    { transform:cubeTransform(x+530,y+560,-13,-18), offset:.57 },
    { transform:cubeTransform(x+685,y+697,0,7), offset:.76 },
    { transform:cubeTransform(x+710,y+716,-8,-8), offset:.87 },
    { transform:cubeTransform(x+720,y+720,0), offset:1 }
  ], { duration, easing:'cubic-bezier(.22,.65,.34,1)', fill:'forwards' });
  const shadow = $('dice-shadow').animate([
    {transform:'scale(1)',opacity:.25,offset:0},
    {transform:'scale(.55)',opacity:.1,offset:.24},
    {transform:'scale(.7)',opacity:.15,offset:.57},
    {transform:'scale(1.1)',opacity:.28,offset:.76},
    {transform:'scale(.86)',opacity:.2,offset:.87},
    {transform:'scale(1)',opacity:.25,offset:1}
  ], { duration, easing:'cubic-bezier(.22,.65,.34,1)', fill:'forwards' });
  diceAnimations = [cube, shadow];
  Promise.all(diceAnimations.map(animation => animation.finished)).then(() => {
    if (generation !== diceGeneration) return;
    setDiceResult(value); stopDiceAnimation(); onFinish();
  }).catch(() => { /* Leaving the room cancels the old throw. */ });
}

export function positionBoardDialog(dialog) {
  if (!surface || !dialog.open) return;
  const board = surface.getBoundingClientRect();
  const width = Math.min(360, innerWidth - 32, Math.max(280, board.width - 40));
  dialog.style.width = width + 'px';
  const height = dialog.getBoundingClientRect().height;
  const x = Math.max(16, Math.min(innerWidth - width - 16, board.left + (board.width - width) / 2));
  const visibleTop = Math.max(16, board.top), visibleBottom = Math.min(innerHeight - 16, board.bottom);
  const y = Math.max(16, Math.min(innerHeight - height - 16, (visibleTop + visibleBottom - height) / 2));
  dialog.style.left = x + 'px'; dialog.style.top = y + 'px';
}
export function showBoardDialog(dialog) {
  if (!surface) { dialog.showModal(); return; }
  const rect = surface.getBoundingClientRect();
  if (rect.bottom < 160 || rect.top > innerHeight - 160) surface.scrollIntoView({ block: 'center', behavior: 'instant' });
  if (!dialog.open) dialog.showModal();
  positionBoardDialog(dialog);
}
function leafSprig(flip = false) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 240 200'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('bamboo-sprig');
  if (flip) svg.classList.add('bamboo-sprig-bottom');
  svg.innerHTML = '<path d="M-20 8 Q70 34 218 170" fill="none" stroke="currentColor" stroke-width="2"/><path d="M38 36 Q33 71 71 93 Q70 58 38 36M61 52 Q89 29 123 42 Q99 65 61 52M95 82 Q90 125 126 146 Q129 114 95 82M119 104 Q142 75 181 87 Q162 114 119 104M151 134 Q151 173 185 193 Q187 160 151 134" fill="currentColor"/>';
  return svg;
}

export function setupTabletop(kind) {
  document.body.classList.add('tabletop', kind);
  surface = document.querySelector(kind === 'gomoku' ? '.board-wrap' : '#board-wrap');
  const board = surface.closest('section');
  const dock = document.createElement('div'); dock.className = 'board-dock'; dock.setAttribute('aria-label', '棋盘操作区'); board.append(dock);
  const status = document.createElement('div'); status.className = 'board-status';
  const players = document.querySelector(kind === 'gomoku' ? '.players' : '#players');
  const turn = document.querySelector(kind === 'gomoku' ? '.turn-status' : '.turn-box');
  const oldPanel = players.closest('section');
  status.append(players, turn); board.insertBefore(status, surface);
  const connection = $('connection'); connection.classList.add('board-connection');
  board.querySelector(kind === 'gomoku' ? '.board-heading' : '.table-board-top').append(connection);
  if (kind === 'gomoku') {
    requestDialog = document.createElement('dialog'); requestDialog.id = 'board-request-dialog'; requestDialog.className = 'board-dialog';
    requestDialog.setAttribute('aria-labelledby', 'request-title'); requestDialog.setAttribute('aria-describedby', 'request-detail');
    const close = document.createElement('button'); close.className = 'dialog-close'; close.textContent = '×'; close.setAttribute('aria-label', '收起请求');
    requestDialog.append(close, $('request-panel')); board.append(requestDialog);
    requestReopen = document.createElement('button'); requestReopen.id = 'request-reopen'; requestReopen.className = 'secondary-button'; requestReopen.textContent = '查看待处理请求'; requestReopen.hidden = true;
    const dismissRequest = () => { dismissedRequestId = currentRequestId; requestDialog.close(); requestReopen.hidden = false; requestReopen.focus({ preventScroll: true }); };
    close.addEventListener('click', dismissRequest);
    requestDialog.addEventListener('cancel', e => { e.preventDefault(); dismissRequest(); });
    requestReopen.addEventListener('click', () => { dismissedRequestId = null; requestReopen.hidden = true; showBoardDialog(requestDialog); });
    dock.append($('game-actions'));
    dock.append(requestReopen);
    document.body.append(leafSprig(), leafSprig(true));
  } else {
    dock.append($('start-button'), $('flight-controls'), $('rematch-button'), $('game-actions'));
    if (kind === 'flight') {
      const toolbar = document.createElement('div'); toolbar.id = 'flight-toolbar'; toolbar.className = 'flight-toolbar'; toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', '棋盘右上方操作区');
      toolbar.append($('start-button'), $('rematch-button'), $('game-actions')); board.insertBefore(toolbar, status);
      const shelf = document.createElement('div'); shelf.id = 'dice-shelf'; shelf.className = 'dice-shelf';
      const console = document.createElement('section'); console.id = 'board-dice'; console.className = 'board-dice'; console.setAttribute('aria-label', '左下角掷骰区');
      const label = document.createElement('span'); label.className = 'dice-tray-label'; label.textContent = '掷骰区';
      diceButton = $('roll-button'); diceFace = $('dice');
      const shadow = document.createElement('span'); shadow.id = 'dice-shadow'; shadow.className = 'dice-shadow'; shadow.setAttribute('aria-hidden','true');
      diceButton.replaceChildren(shadow, diceFace); diceButton.className = 'dice-button'; diceButton.title = '点击掷骰';
      diceFace.textContent = ''; diceFace.className = 'dice-cube'; diceFace.setAttribute('aria-hidden', 'true');
      for (let face = 1; face <= 6; face++) {
        const side = document.createElement('span'); side.className = 'cube-face'; side.dataset.face = String(face);
        for (let n = 0; n < 9; n++) { const pip = document.createElement('i'); side.append(pip); }
        diceFace.append(side);
      }
      console.append(label, diceButton);
      const readout = document.createElement('div'); readout.className = 'dice-readout';
      const result = document.createElement('strong'); result.id = 'dice-outcome'; result.setAttribute('aria-live','polite');
      const hint = document.createElement('p'); hint.id = 'dice-hint';
      const actor=document.createElement('strong');actor.id='dice-player';actor.className='dice-player';actor.setAttribute('aria-live','polite');
      turn.classList.add('dice-turn-status');
      const placements=document.createElement('ol');placements.id='flight-placements';placements.className='flight-placements';placements.setAttribute('aria-label','本局名次');placements.setAttribute('aria-live','polite');
      readout.append(actor,turn,result, hint, $('plane-options'),placements); shelf.append(console, readout); board.insertBefore(shelf, surface.nextSibling);
      const diceInfo = document.createElement('section'); diceInfo.id = 'dice-info'; diceInfo.className = 'club-panel dice-info'; diceInfo.hidden = true; diceInfo.setAttribute('aria-label', '模式说明与掷骰记录');
      document.querySelector('.ranking-panel').after(diceInfo);
      const luckNotice = document.createElement('p'); luckNotice.id = 'dice-policy'; luckNotice.className = 'dice-policy'; luckNotice.hidden = true; luckNotice.setAttribute('role', 'status'); diceInfo.append(luckNotice);
      const history = document.createElement('details'); history.id = 'roll-history'; history.className = 'roll-history';
      history.innerHTML = '<summary id="roll-history-summary">掷骰记录 · 0 次</summary><p id="roll-history-note">本局尚未掷骰。</p><button type="button" id="copy-roll-history" class="secondary-button">复制记录</button><ol id="roll-history-list" aria-label="掷骰记录，最新在前"></ol>';
      diceInfo.append(history);
      const exportDialog = document.createElement('dialog'); exportDialog.id = 'roll-history-dialog'; exportDialog.className = 'board-dialog';
      exportDialog.setAttribute('aria-labelledby', 'roll-history-title');
      exportDialog.innerHTML = '<button type="button" class="dialog-close" aria-label="关闭掷骰记录">×</button><h2 id="roll-history-title">复制掷骰记录</h2><p>长按或全选下方文字复制，即可粘贴分享，核对点数。</p><textarea id="roll-history-text" aria-label="可复制的掷骰记录" readonly></textarea>';
      exportDialog.querySelector('button').onclick = () => exportDialog.close(); board.append(exportDialog);
      $('flight-controls').querySelector('.dice-row').remove();
    } else $('flight-controls').hidden = true;
  }
  oldPanel.remove();
  const reactions = $('reactions-panel'); reactions.classList.add('board-reactions'); dock.append(reactions);
  if (kind === 'flight') document.querySelector('.dice-readout').append(reactions);
  for (const dialog of [$('confirm-dialog'), $('share-dialog')]) {
    dialog.classList.add('board-dialog'); board.append(dialog);
  }
  $('confirm-dialog').setAttribute('aria-labelledby', 'confirm-title');
  $('confirm-dialog').setAttribute('aria-describedby', kind === 'gomoku' ? 'confirm-description' : 'confirm-text');
  for (const event of ['resize', 'scroll']) addEventListener(event, () => {
    document.querySelectorAll('.board-dialog[open]').forEach(positionBoardDialog);
  }, { passive: true });
  const toast = $('toast'); surface.append(toast); toast.classList.add('board-toast');
}

export function syncTabletop({ kind, requestId, dice = 0, phase, active = false, moving = false, pending = false } = {}) {
  if (requestDialog) {
    currentRequestId = requestId;
    const hasRequest = !$('request-panel').hidden;
    if (hasRequest && !requestDialog.open && dismissedRequestId !== requestId) showBoardDialog(requestDialog);
    else if (!hasRequest && requestDialog.open) requestDialog.close();
    requestReopen.hidden = !hasRequest || requestDialog.open;
    if (!hasRequest) dismissedRequestId = null;
    if (requestDialog.open) positionBoardDialog(requestDialog);
  }
  if (kind === 'flight' && diceButton) {
    $('board-dice').classList.toggle('is-rolling', diceRolling);
    diceButton.setAttribute('aria-label', diceRolling ? '骰子翻滚中，请等待停稳' : diceButton.disabled ? `骰子${dice ? ' ' + dice + ' 点' : ''}，${moving ? '飞机移动中' : phase === 'move' ? '请选择飞机' : '等待掷骰'}` : `掷骰子${dice ? '，上次 ' + dice + ' 点' : ''}`);
    $('dice-outcome').textContent = diceRolling ? '骰子翻滚中…' : dice ? `掷出 ${dice} 点` : '准备掷骰';
    const options = $('plane-options');
    const canChoosePlane = Boolean(options.querySelector('button:not(:disabled)'));
    $('dice-hint').textContent = diceRolling ? '等它停稳，好运就揭晓。' : !active ? '入座开局后，点击这里掷骰。' : moving ? '飞机正在移动。' : phase === 'move' ? canChoosePlane ? '点击高亮飞机，或用编号选择。' : '等待对方移动飞机。' : diceButton.disabled ? '等待对方掷骰。' : '点击左侧骰子 · 2、4、6 点可出仓';
    options.hidden = !active || phase !== 'move' || moving || diceRolling || !canChoosePlane;
  }
}
