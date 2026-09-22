import { randomBytes, randomInt } from 'node:crypto';
import { newTableGame, moveJungle, moveFlight, rollFlight } from './public/table-rules.js';
import { identifyPlayer, publicPlayer, addChat, setAuto, createAutoScheduler } from './room-tools.js';

export function createTableService({ roll = () => randomInt(1, 7), records, autoDelay } = {}) {
  const rooms = new Map();
  const connected = p => Boolean(p && !p.gone && p.streams.size);
  const snapshot = (r, p) => ({ code: r.code, kind: r.kind, count: r.count, yourSeat: p.seat, host: 1, game: r.game, started: r.started, closed: r.closed, ready: r.ready, round: r.round, version: r.version, seq: r.seq, chat:r.chat||[], players: r.players.map(p => p ? { ...publicPlayer(p), seat: p.seat, connected: connected(p), gone: p.gone } : null) });
  const availablePlayer=p=>Boolean(p && !p.gone && (connected(p)||p.auto));
  const finishedSeat=(r,p)=>Boolean(p && r.game.finishOrder?.includes(p.seat));
  const readyPlayers=r=>r.players.every(p=>availablePlayer(p) || (r.game.status==='playing' && finishedSeat(r,p)));
  const broadcast = r => {
    for(const p of r.players) if(finishedSeat(r,p)) p.auto=false;
    records?.victory(r, r.kind, p => p.seat);
    r.updatedAt = Date.now(); r.seq++;
    for (const p of r.players) if (p) for (const s of p.streams) s.write(`data: ${JSON.stringify(snapshot(r, p))}\n\n`);
    auto.sync(r);
  };
  const auto=createAutoScheduler({delay:autoDelay,ready:r=>!r.closed && r.started && r.game.status==='playing' && readyPlayers(r),execute:(r,p,m)=>{
    if(m.action==='roll') rollFlight(r.game,p.seat,roll());
    else if(r.kind==='flight') moveFlight(r.game,p.seat,m.id);
    else moveJungle(r.game,p.seat,m.id,m.x,m.y);
    r.version++;
  },broadcast});
  const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const seat = n => ({ seat: n, token: randomBytes(32).toString('hex'), streams: new Set(), gone: false, nextReactionAt: 0 });
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  async function handle(req, res, url, data = {}) {
    const action = url.pathname.slice('/api/table/'.length);
    if (req.method === 'GET' && action === 'events') {
      const r = rooms.get(url.searchParams.get('room'));
      const p = r?.players.find(p => p && !p.gone && p.token === url.searchParams.get('token'));
      if (!p) return send(res, 401, { error: '棋室已失效，请重新加入' });
      if (p.streams.size >= 4) return send(res, 429, { error: '连接过多，请关闭多余页面' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 1500\n\n'); p.streams.add(res); broadcast(r);
      const ping = setInterval(() => res.write(': heartbeat\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); p.streams.delete(res); broadcast(r); }); return;
    }
    if (req.method !== 'POST') return send(res, 404, { error: '未知操作' });
    if (action === 'create') {
      if (!['flight', 'jungle'].includes(data.kind)) throw new Error('请选择飞行棋或斗兽棋');
      const count = data.kind === 'jungle' ? 2 : data.count ?? 2;
      if (![2, 3, 4].includes(count)) throw new Error('请选择 2～4 人');
      if (rooms.size >= 500) throw new Error('棋室暂时已满');
      let code; do { code = Array.from(randomBytes(6), b => alphabet[b % alphabet.length]).join(''); } while (rooms.has(code));
      const p = seat(1), r = { code, kind: data.kind, count, players: [p, ...Array(count - 1).fill(null)], game: newTableGame(data.kind, count), started: false, closed: false, ready: [], round: 1, version: 0, seq: 0, updatedAt: Date.now() };
      identifyPlayer(p,records?.lookup(req));
      rooms.set(code, r); return send(res, 200, { token: p.token, ...snapshot(r, p) });
    }
    const r = rooms.get(String(data.room || '').toUpperCase());
    if (!r) return send(res, 404, { error: '棋室不存在，请检查房间码' });
    if (action === 'join') {
      if (r.closed || r.started) throw new Error('棋室已开始或已关闭');
      if (data.kind !== r.kind) throw new Error(`这是${r.kind === 'flight' ? '飞行棋' : '斗兽棋'}房间，请从对应玩法加入`);
      const index = r.players.indexOf(null);
      if (index < 0) throw new Error('棋室已满');
      const p = seat(index + 1); identifyPlayer(p,records?.lookup(req)); r.players[index] = p; broadcast(r);
      return send(res, 200, { token: p.token, ...snapshot(r, p) });
    }
    const p = r.players.find(p => p && !p.gone && req.headers.authorization === `Bearer ${p.token}`);
    if (!p) return send(res, 401, { error: '身份已失效，请重新加入' });
    if (action === 'sync') return send(res, 200, snapshot(r, p));
    if (action === 'leave') {
      p.gone = true; r.closed = true; r.ready = [];
      if (r.started && r.game.status === 'playing') {
        r.game.status = 'finished'; r.game.winner = r.count === 2 ? 3 - p.seat : 0; r.game.reason = 'leave';
      }
      r.version++; broadcast(r); for (const s of p.streams) s.end(); return send(res, 200, { ok: true });
    }
    if (r.closed) throw new Error('棋室已关闭，请重新创建');
    if(action==='chat') {addChat(r,p,data.text,p.seat);broadcast(r);return send(res,200,{ok:true});}
    if(action==='auto') {
      if(data.enabled && finishedSeat(r,p)) throw new Error('你已完成本局排名，可以观看其他玩家继续比赛');
      setAuto(p,data.enabled);broadcast(r);return send(res,200,snapshot(r,p));
    }
    if (!readyPlayers(r)) throw new Error('等待仍在比赛的棋手连接后继续');
    if (action === 'reaction') {
      if (!['poop', 'heart', 'bomb', 'cry'].includes(data.kind)) throw new Error('不支持的互动');
      if (Date.now() < p.nextReactionAt) return send(res, 429, { error: '每 2 秒可以互动一次' });
      p.nextReactionAt = Date.now() + 2000;
      const effect = { from: p.seat, kind: data.kind, id: randomBytes(8).toString('hex') };
      for (const q of r.players) for (const s of q.streams) s.write(`event: reaction\ndata: ${JSON.stringify(effect)}\n\n`);
      return send(res, 200, { ok: true });
    }
    if (['roll', 'move'].includes(action) && data.version !== r.version) throw new Error('棋局已更新，请根据当前棋盘操作');
    if (['roll','move'].includes(action) && p.auto) throw new Error('请先取消托管再手动行棋');
    if (action === 'start') {
      if (p.seat !== 1 || r.started) throw new Error('请由房主开始新局');
      r.started = true;
    } else if (!r.started) throw new Error('请等待房主开始游戏');
    else if (action === 'roll') {
      if (r.kind !== 'flight') throw new Error('斗兽棋不使用骰子');
      // Clients never supply or influence the online dice result.
      rollFlight(r.game, p.seat, roll());
    } else if (action === 'move') {
      if (r.kind === 'flight') moveFlight(r.game, p.seat, data.id);
      else moveJungle(r.game, p.seat, data.id, data.x, data.y);
    } else if (action === 'resign') {
      if (r.kind !== 'jungle' || r.game.status !== 'playing') throw new Error('当前不能认输');
      r.game.status = 'finished'; r.game.winner = 3 - p.seat; r.game.reason = 'resign';
    } else if (action === 'rematch') {
      if (r.game.status !== 'finished') throw new Error('本局尚未结束');
      if (!r.ready.includes(p.seat)) r.ready.push(p.seat);
      if (r.ready.length === r.count) { r.players.forEach(p=>p.auto=false);r.game = newTableGame(r.kind, r.count); r.round++; r.ready = []; r.game.turn = (r.round - 1) % r.count + 1; }
    } else return send(res, 404, { error: '未知操作' });
    r.version++; broadcast(r); return send(res, 200, snapshot(r, p));
  }
  const cleanup = () => { for (const [code, r] of rooms) if (!r.players.some(connected) && Date.now() - r.updatedAt > 86400000) rooms.delete(code); };
  return { handle, cleanup, rooms, close:auto.close };
}
