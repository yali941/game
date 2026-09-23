// Move the existing panels, preserving their listeners, messages and draft text.
export function createMobileUI(chat) {
  const $ = id => document.getElementById(id);
  const narrow = matchMedia('(max-width: 700px)');
  const nav = document.createElement('nav');
  nav.className = 'mobile-nav'; nav.setAttribute('aria-label', '棋室快捷操作');
  nav.innerHTML = '<button type="button" data-pane="chat" aria-controls="mobile-sheet" aria-expanded="false"><span aria-hidden="true">💬</span>聊天<b id="mobile-unread" hidden></b></button><button type="button" data-pane="room" aria-controls="mobile-sheet" aria-expanded="false"><span aria-hidden="true">⌂</span>房间</button><button type="button" data-pane="more" aria-controls="mobile-sheet" aria-expanded="false"><span aria-hidden="true">•••</span>更多</button>';
  const sheet = document.createElement('dialog');
  sheet.id = 'mobile-sheet'; sheet.className = 'mobile-sheet'; sheet.setAttribute('aria-labelledby', 'mobile-sheet-title');
  sheet.innerHTML = '<header class="mobile-sheet-header"><div class="mobile-grip" aria-hidden="true"></div><div><h2 id="mobile-sheet-title">棋室聊天</h2><button type="button" id="mobile-expand" aria-label="展开面板" aria-expanded="false">展开</button><button type="button" id="mobile-close" aria-label="收起面板">收起 ↓</button></div></header><button type="button" id="mobile-turn" hidden>轮到你了 · 返回棋盘 →</button><div class="mobile-sheet-body"><section data-content="chat"></section><section data-content="room" hidden></section><section data-content="more" hidden></section></div>';
  document.body.append(nav, sheet);
  const liveChat = document.createElement('div');
  liveChat.id = 'mobile-live-chat'; liveChat.className = 'mobile-live-chat';
  // The full chat log remains the accessible source; this preview never takes input.
  liveChat.setAttribute('aria-hidden', 'true'); document.body.append(liveChat);
  const liveDuration = 16000;
  let liveMessages = [], liveTimer;
  function renderLiveChat() {
    clearTimeout(liveTimer);
    liveMessages = liveMessages.filter(entry => entry.expires > Date.now());
    const ids = new Set(liveMessages.map(entry => entry.message.id));
    for (const row of [...liveChat.children]) if (!ids.has(row.dataset.messageId)) row.remove();
    for (const entry of liveMessages) {
      let row = [...liveChat.children].find(row => row.dataset.messageId === entry.message.id);
      if (!row) {
        row = document.createElement('div'); row.className = 'mobile-live-message team-' + entry.color;
        row.dataset.messageId = entry.message.id;
        const line = document.createElement('div'), name = document.createElement('strong'), text = document.createElement('span');
        line.className = 'mobile-live-line'; line.append(name, text); row.append(line); liveChat.append(row);
      }
      row.querySelector('strong').textContent = entry.message.name + '：';
      row.querySelector('span').textContent = entry.message.text;
    }
    if (liveMessages.length) liveTimer = setTimeout(renderLiveChat, Math.max(0, Math.min(...liveMessages.map(entry => entry.expires)) - Date.now()));
  }
  const pane = key => sheet.querySelector(`[data-content="${key}"]`);
  const placements = [];
  const remember = (element, destination) => {
    if (!element) return;
    const marker = document.createComment('mobile panel home'); element.before(marker);
    placements.push({element, marker, destination});
  };
  remember(chat, pane('chat'));
  remember(document.querySelector('.mode-tabs'), pane('room'));
  remember($('lobby'), pane('room'));
  remember($('room-panel'), pane('room'));
  const localNote = document.createElement('p'); localNote.className = 'mobile-local-note';
  localNote.textContent = '正在同屏对弈。切换到好友联机后，可创建房间邀请朋友。'; localNote.hidden = true; pane('room').append(localNote);
  remember($('rules-button'), pane('more'));
  remember(document.querySelector('.ranking-panel'), pane('more'));
  remember($('dice-info'), pane('more'));
  remember($('leave-button'), pane('more'));
  let current = '', lastScope, seen = new Set(), unread = 0, state, savedScroll = 0, restoring = false;
  const badge = $('mobile-unread');
  function updateBadge() {
    badge.hidden = !unread; badge.textContent = unread > 99 ? '99+' : String(unread);
    nav.querySelector('[data-pane="chat"]').setAttribute('aria-label', unread ? `聊天，${unread} 条未读消息` : '聊天');
  }
  function acknowledge() { unread = 0; updateBadge(); }
  function viewport() {
    const view = window.visualViewport;
    const height = view?.height || innerHeight;
    sheet.style.setProperty('--mobile-view-height', height + 'px');
    sheet.style.setProperty('--mobile-keyboard', Math.max(0, innerHeight - height - (view?.offsetTop || 0)) + 'px');
    sheet.classList.toggle('keyboard-open', innerHeight - height > 140);
  }
  function close() { if (sheet.open) sheet.close(); }
  function finishClose() {
    current = ''; document.body.classList.remove('mobile-sheet-open');
    document.body.style.removeProperty('--mobile-scroll');
    nav.querySelectorAll('button').forEach(button => button.setAttribute('aria-expanded', 'false'));
    if (!restoring) window.scrollTo(0, savedScroll);
  }
  sheet.addEventListener('close', finishClose);
  $('mobile-close').onclick = close;
  $('mobile-turn').onclick = () => { close(); requestAnimationFrame(() => document.querySelector('.board-status').scrollIntoView({block:'start', behavior:'smooth'})); };
  function expand(value) {
    sheet.classList.toggle('expanded', value);
    $('mobile-expand').textContent = value ? '半屏' : '展开';
    $('mobile-expand').setAttribute('aria-label', value ? '缩回半屏' : '展开面板');
    $('mobile-expand').setAttribute('aria-expanded', String(value));
  }
  $('mobile-expand').onclick = () => expand(!sheet.classList.contains('expanded'));
  function open(key) {
    if (!narrow.matches) return;
    current = key; sheet.dataset.pane = key;
    for (const section of sheet.querySelectorAll('[data-content]')) section.hidden = section.dataset.content !== key;
    $('mobile-sheet-title').textContent = {chat:'棋室聊天',room:'房间与邀请',more:'更多'}[key];
    nav.querySelectorAll('button').forEach(button => button.setAttribute('aria-expanded', String(button.dataset.pane === key)));
    expand(key !== 'chat'); viewport();
    if (!sheet.open) {
      savedScroll = window.scrollY; document.body.style.setProperty('--mobile-scroll', `-${savedScroll}px`);
      document.body.classList.add('mobile-sheet-open'); sheet.showModal();
    }
    $('mobile-close').focus({preventScroll:true});
    if (key === 'chat') { acknowledge(); const log = $('chat-messages'); log.scrollTop = log.scrollHeight; }
  }
  nav.addEventListener('click', event => { const button=event.target.closest('[data-pane]'); if(button) open(button.dataset.pane); });
  sheet.addEventListener('click', event => {
    if (event.target === sheet) {
      const rect=sheet.getBoundingClientRect();
      if(event.clientY < rect.top || event.clientY > rect.bottom || event.clientX < rect.left || event.clientX > rect.right) close();
    }
  });
  // Close the sheet before opening the game's existing confirmations/share dialogs.
  sheet.addEventListener('click', event => {
    if(event.target.closest('#leave-button, #rules-button, #copy-button, #copy-roll-history')) close();
  }, true);
  const header = sheet.querySelector('.mobile-sheet-header'); let touchStart;
  header.addEventListener('touchstart', event => { if(!event.target.closest('button')) touchStart=event.touches[0].clientY; }, {passive:true});
  header.addEventListener('touchend', event => {
    if(touchStart === undefined) return;
    const distance=event.changedTouches[0].clientY-touchStart; touchStart=undefined;
    if(distance < -40) expand(true);
    else if(distance > 50) sheet.classList.contains('expanded') ? expand(false) : close();
  }, {passive:true});
  function layout() {
    if (!narrow.matches) { restoring=true; close(); finishClose(); restoring=false; }
    for (const {element,marker,destination} of placements) {
      if(narrow.matches) destination.append(element); else marker.after(element);
    }
    document.body.classList.toggle('mobile-layout', narrow.matches);
    $('leave-button').hidden = narrow.matches ? !(state?.mode==='local' || state?.room) : false;
    if(!narrow.matches) acknowledge();
    viewport();
  }
  narrow.addEventListener('change', layout);
  window.visualViewport?.addEventListener('resize', viewport);
  window.visualViewport?.addEventListener('scroll', viewport);
  window.addEventListener('resize', viewport);
  document.addEventListener('visibilitychange', () => { if(document.visibilityState==='visible' && sheet.open && current==='chat') acknowledge(); });
  layout();
  function sync(next) {
    state=next;
    const {mode,room,game,transport,busy,team}=next;
    const scope=mode==='local' ? 'local' : room?.code || 'lobby';
    const messages=mode==='local' ? [] : room?.chat || [];
    const mySeat=room?.yourSeat || room?.yourColor;
    if(scope!==lastScope) {
      if(lastScope!==undefined && sheet.open) close();
      lastScope=scope;seen=new Set(messages.map(message=>message.id));acknowledge();
      liveMessages=[];renderLiveChat();
    } else {
      for(const message of messages) if(!seen.has(message.id)) {
        if(message.seat!==mySeat) unread++;
        if(narrow.matches && document.visibilityState==='visible') liveMessages.push({message,color:team(message.seat).color,expires:Date.now()+liveDuration});
      }
      liveMessages=liveMessages.slice(-3);
      // Keep renamed players consistent with the full log without replaying the entry.
      for(const entry of liveMessages) entry.message=messages.find(message=>message.id===entry.message.id)||entry.message;
      renderLiveChat();
      seen=new Set(messages.map(message=>message.id));
      if(!narrow.matches || (sheet.open && current==='chat' && document.visibilityState==='visible')) acknowledge();
      else updateBadge();
    }
    localNote.hidden=mode!=='local';
    if(narrow.matches) $('leave-button').hidden=!(mode==='local'||room);
    const mine=room?.players.find(player=>player && (player.seat||player.color)===mySeat);
    $('mobile-turn').hidden=!(mode==='online' && room && !room.closed && transport && !busy && !room.request && !mine?.auto && game.status==='playing' && game.turn===mySeat);
  }
  return {sync};
}
