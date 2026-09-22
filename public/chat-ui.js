import { chooseAutoMove } from './auto-play.js';
import { refreshRankings } from './profile.js';

export function createRoomUI({kind,send,refresh,playLocal}) {
  const panel=document.createElement('section');panel.className='panel club-panel chat-panel';panel.setAttribute('aria-label','棋室聊天');
  panel.innerHTML='<h2>棋室聊天</h2><p id="chat-identity" class="chat-identity"></p><div id="chat-members" class="chat-members"></div><ol id="chat-messages" class="chat-messages" role="log" aria-live="polite" aria-label="聊天记录"></ol><form id="chat-form" class="chat-form"><input id="chat-input" aria-label="聊天内容" maxlength="200" autocomplete="off" placeholder="说点什么…"><button id="chat-send" type="submit">发送</button></form><p id="chat-status" class="chat-status" role="status"></p>';
  const ranking=document.querySelector('.ranking-panel'),roomPanel=document.getElementById('room-panel');
  roomPanel.before(panel);ranking.before(roomPanel);
  const controls=document.createElement('div');controls.className='auto-controls';controls.id='auto-controls';controls.setAttribute('aria-label','托管控制');document.querySelector('.board-dock').append(controls);
  const el=id=>panel.querySelector('#'+id);
  let state,scope,lastMessages='',lastPlayers='',sending=false,changing=false,timer=null,taskKey='',localAuto=new Set();
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('close',refresh));
  const isAuto=seat=>state?.mode==='local' ? localAuto.has(seat) : Boolean(state?.room?.players.find(p=>p && (p.seat||p.color)===seat)?.auto);
  const cancel=()=>{clearTimeout(timer);timer=null;taskKey='';};
  el('chat-form').addEventListener('submit',async event=>{
    event.preventDefault(); const text=el('chat-input').value.trim(),activeScope=scope;
    if(!text || sending || !state?.room || !state.transport || state.room.closed || state.mode!=='online') return;
    sending=true;el('chat-status').textContent='';sync(state);
    try {await send('chat',{text});if(scope===activeScope) el('chat-input').value='';}
    catch(error) {if(scope===activeScope) el('chat-status').textContent=error.message||'发送失败，请重试';}
    finally {sending=false;sync(state);}
  });
  function sync(next) {
    state=next;
    const {mode,room,transport,game,team,busy}=next,local=mode==='local';
    const nextScope=local ? game : room?.code||'lobby';
    if(scope!==nextScope) {scope=nextScope;localAuto.clear();cancel();lastMessages='';el('chat-input').value='';el('chat-status').textContent='';}
    for(const seat of game.finishOrder||[]) localAuto.delete(seat);
    const players=local ? Array.from({length:game.count||2},(_,i)=>({seat:i+1,name:team(i+1).name,id:'',auto:localAuto.has(i+1)})) : (room?.players||[]).filter(Boolean);
    const mine=players.find(p=>(p.seat||p.color)===(room?.yourSeat||room?.yourColor));
    el('chat-identity').textContent=local ? '同屏对弈 · 联机后可聊天' : mine ? `我的昵称：${mine.name}` : '加入棋室后，与朋友聊天';
    el('chat-identity').title=mine ? `玩家 ID：${mine.id} · 与胜场榜共用昵称` : '';
    const playerNames=JSON.stringify(players.map(p=>[p.id,p.name]));
    if(!local && playerNames!==lastPlayers) {lastPlayers=playerNames;refreshRankings();}
    el('chat-members').replaceChildren();
    for(const player of players) {
      const member=document.createElement('div'),name=document.createElement('strong'),id=document.createElement('small');
      member.className='chat-member team-'+team(player.seat||player.color).color;
      name.textContent=`${team(player.seat||player.color).name} · ${player.name}${player.auto?' · 托管':''}`;
      member.title=player.id ? `玩家 ID：${player.id}` : '同屏玩家';member.append(name);el('chat-members').append(member);
    }
    const messages=local ? [] : room?.chat||[],key=JSON.stringify([scope===game?'local':scope,messages]);
    if(key!==lastMessages) {
      lastMessages=key;const log=el('chat-messages'),nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<50;
      log.replaceChildren();
      if(!messages.length) {const empty=document.createElement('li');empty.className='chat-empty';empty.textContent=local?'选择好友联机即可发送消息。':'还没有消息，和朋友打个招呼吧。';log.append(empty);}
      for(const message of messages) {
        const item=document.createElement('li'),head=document.createElement('div'),name=document.createElement('strong'),id=document.createElement('small'),body=document.createElement('p');
        item.className='chat-message team-'+team(message.seat).color+(message.playerId===mine?.id?' is-mine':'');
        name.textContent=message.name;name.title=`玩家 ID：${message.playerId}`;id.textContent=team(message.seat).name;head.append(name,id);body.textContent=message.text;item.append(head,body);log.append(item);
      }
      if(nearBottom) log.scrollTop=log.scrollHeight;
    }
    const writable=!local && room && !room.closed && transport && !sending;
    el('chat-input').disabled=!writable;el('chat-send').disabled=!writable;
    controls.replaceChildren();controls.hidden=!local && !room;
    const seats=local ? players.map(p=>p.seat) : mine ? [mine.seat||mine.color] : [];
    for(const seat of seats) {
      const button=document.createElement('button'),active=isAuto(seat),rank=(game.finishOrder||[]).indexOf(seat)+1;
      button.className='auto-button team-'+team(seat).color;button.setAttribute('aria-pressed',String(active));
      button.textContent=local ? `${team(seat).name} · ${active?'取消托管':'托管'}` : active?'取消托管':'开启托管';
      if(rank) button.textContent=`${team(seat).name} · 第 ${rank} 名`;
      button.disabled=Boolean(rank) || changing || game.status==='finished' || (!local && (!transport||room.closed));
      button.addEventListener('click',async()=>{
        if(local) {active?localAuto.delete(seat):localAuto.add(seat);cancel();refresh();return;}
        changing=true;sync(state);
        try {await send('auto',{enabled:!active});}catch(error){el('chat-status').textContent=error.message||'托管设置失败';}
        finally {changing=false;refresh();}
      });controls.append(button);
    }
    if(local && game.status==='playing' && localAuto.has(game.turn) && !busy && !document.querySelector('dialog[open]')) {
      const key=[game.turn,game.moves.length,game.rolls||0].join(':');
      if(timer && taskKey===key) return;
      cancel();taskKey=key;const activeScope=scope;
      timer=setTimeout(()=>{timer=null;taskKey='';if(scope!==activeScope || !localAuto.has(game.turn) || state.busy || document.querySelector('dialog[open]')) return; const move=chooseAutoMove(game);if(move) playLocal(move);},1100);
    } else cancel();
  }
  return {sync,isAuto:(seat,game)=>game && scope!==game ? false : isAuto(seat)};
}
