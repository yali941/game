let token = '';
try { token = localStorage.getItem('yiju-player-token') || ''; } catch { /* Storage is optional. */ }
export const profileHeaders = () => token ? { 'X-Player-Token': token } : {};
let profile = null;
async function saveProfile(name) {
  const response = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json', ...profileHeaders() }, body: JSON.stringify(name === undefined ? {} : { name }), signal: AbortSignal.timeout(10000) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error);
  profile = value;
  if (value.token) { token = value.token; try { localStorage.setItem('yiju-player-token', token); } catch { /* Keep this page's identity. */ } }
  if (document.getElementById('nickname')) document.getElementById('nickname').value = value.name;
  return value;
}
export async function refreshRankings() {
  const panel = document.querySelector('[data-rank-kind]'); if (!panel?.dataset.rankKind) return;
  const status = document.getElementById('rank-status');
  try {
    const response = await fetch(`/api/rankings?kind=${panel.dataset.rankKind}`, { headers: profileHeaders(), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('榜单暂时不可用');
    const board = await response.json(), list = document.getElementById('rank-list'); list.replaceChildren();
    const nickname=document.getElementById('nickname');
    if(board.me && profile?.id===board.me.id) {
      if(nickname && document.activeElement!==nickname && nickname.value===profile.name) nickname.value=board.me.name;
      profile.name=board.me.name;
    }
    for (const entry of board.entries) {
      const item = document.createElement('li'), rank = document.createElement('span'), name = document.createElement('span'), wins = document.createElement('b');
      rank.textContent = String(entry.rank).padStart(2, '0'); name.textContent = entry.name; name.title = `玩家 ID：${entry.id}`; wins.textContent = `${entry.wins} 胜`;
      if (entry.id === board.me?.id) item.classList.add('is-me'); item.append(rank, name, wins); list.append(item);
    }
    if (!board.entries.length) { const item = document.createElement('li'); item.textContent = '第一场胜利，等你来写。'; list.append(item); }
    document.getElementById('my-wins').textContent = board.me ? `我的战绩 · ${board.me.wins} 胜${board.me.rank ? ` · 第 ${board.me.rank} 名` : ''}` : '设置昵称后，联机胜局会记入榜单。';
    status.textContent = `统计自 ${new Date(board.since).toLocaleDateString('zh-CN')} · 前 10 名`;
  } catch { status.textContent = '榜单暂时连接不上，游戏仍可继续。'; }
}
export const profileReady = saveProfile().catch(() => { const status = document.getElementById('rank-status'); if (status) status.textContent = '暂时无法读取玩家身份。'; });
const saveButton = document.getElementById('save-nickname');
saveButton?.addEventListener('click', async () => {
  saveButton.disabled = true;
  try { await saveProfile(document.getElementById('nickname').value); await refreshRankings(); }
  catch (error) { document.getElementById('rank-status').textContent = error.message || '保存失败，请重试'; }
  finally { saveButton.disabled = false; }
});
profileReady.then(refreshRankings);
setInterval(refreshRankings, 30000);
