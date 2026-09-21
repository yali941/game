import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { newGame, playMove, resign } from './public/game.js';

const publicDir = new URL('./public/', import.meta.url);
const TYPES = { '/': ['index.html', 'text/html; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/game.js': ['game.js', 'text/javascript; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => Array.from(randomBytes(6), b => ALPHABET[b % ALPHABET.length]).join('');
const seat = color => ({ color, token: randomBytes(32).toString('hex'), streams: new Set(), gone: false });

export function createGameServer() {
  const rooms = new Map(), rates = new Map();
  const connected = p => Boolean(p && !p.gone && p.streams.size);
  const snapshot = (room, player) => ({ code: room.code, yourColor: player?.color, game: room.game, round: room.round, closed: room.closed, ready: room.ready, players: room.players.map(p => p ? { color: p.color, connected: connected(p), gone: p.gone } : null) });
  function broadcast(room) {
    room.updatedAt = Date.now();
    for (const player of room.players) if (player) for (const stream of player.streams) stream.write(`data: ${JSON.stringify(snapshot(room, player))}\n\n`);
  }
  function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  }
  async function body(req) {
    let data = '';
    for await (const chunk of req) {
      data += chunk;
      if (data.length > 4096) throw new Error('请求内容过长');
    }
    try { return JSON.parse(data || '{}'); } catch { throw new Error('请求格式错误'); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: '不允许跨站请求' });
      if (req.method === 'GET' && TYPES[url.pathname]) {
        const [file, type] = TYPES[url.pathname];
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        return res.end(await readFile(new URL(file, publicDir)));
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        const room = rooms.get(url.searchParams.get('room'));
        const player = room?.players.find(p => p?.token === url.searchParams.get('token') && !p.gone);
        if (!player) return json(res, 401, { error: '房间已失效，请重新加入' });
        if (player.streams.size >= 4) return json(res, 429, { error: '连接过多' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 1500\n\n');
        player.streams.add(res);
        broadcast(room);
        const ping = setInterval(() => res.write(': heartbeat\n\n'), 20000);
        req.on('close', () => { clearInterval(ping); player.streams.delete(res); broadcast(room); });
        return;
      }
      if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) return json(res, 404, { error: '没有找到这个页面' });
      const ip = req.socket.remoteAddress;
      const now = Date.now();
      const rate = rates.get(ip);
      if (!rate || now - rate.start > 60000) rates.set(ip, { start: now, count: 1 });
      else if (++rate.count > 180) return json(res, 429, { error: '操作太频繁，请稍后重试' });
      const data = await body(req);
      if (url.pathname === '/api/create') {
        if (rooms.size >= 500) throw new Error('房间暂时已满，请稍后再试');
        let id; do { id = code(); } while (rooms.has(id));
        const player = seat(1);
        const room = { code: id, players: [player, null], game: newGame(), round: 1, ready: [], closed: false, updatedAt: now };
        rooms.set(id, room);
        return json(res, 200, { token: player.token, ...snapshot(room, player) });
      }
      const room = rooms.get(String(data.room || '').toUpperCase());
      if (!room) return json(res, 404, { error: '房间不存在，检查房间码后再试' });
      if (url.pathname === '/api/join') {
        if (room.closed) throw new Error('房间已关闭，请创建新房间');
        if (room.players[1]) throw new Error('房间已满，两位棋手已入座');
        const player = seat(2); room.players[1] = player;
        broadcast(room);
        return json(res, 200, { token: player.token, ...snapshot(room, player) });
      }
      const player = room.players.find(p => p?.token === req.headers.authorization?.replace(/^Bearer /, '') && !p.gone);
      if (!player) return json(res, 401, { error: '身份已失效，请重新加入房间' });
      if (url.pathname === '/api/sync') return json(res, 200, snapshot(room, player));
      if (url.pathname === '/api/leave') {
        player.gone = true; room.closed = true;
        if (room.players.every(Boolean) && room.game.status === 'playing') {
          resign(room.game, player.color); room.game.reason = 'leave';
        }
        broadcast(room);
        for (const stream of player.streams) stream.end();
        return json(res, 200, { ok: true });
      }
      if (room.closed) throw new Error('房间已关闭，请创建新房间');
      if (!room.players.every(connected)) throw new Error('等待双方连接后再继续');
      if (url.pathname === '/api/move') playMove(room.game, player.color, data.x, data.y);
      else if (url.pathname === '/api/resign') resign(room.game, player.color);
      else if (url.pathname === '/api/rematch') {
        if (room.game.status !== 'finished') throw new Error('本局尚未结束');
        if (!room.ready.includes(player.color)) room.ready.push(player.color);
        if (room.ready.length === 2) {
          for (const p of room.players) p.color = 3 - p.color;
          room.players.reverse(); room.game = newGame(); room.ready = []; room.round++;
        }
      } else return json(res, 404, { error: '未知操作' });
      broadcast(room);
      return json(res, 200, snapshot(room, player));
    } catch (error) {
      if (!res.headersSent) json(res, 400, { error: error.message || '操作失败，请重试' });
      else res.end();
    }
  });
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) if (!room.players.some(connected) && now - room.updatedAt > 86400000) rooms.delete(id);
    for (const [ip, rate] of rates) if (now - rate.start > 60000) rates.delete(ip);
  }, 60000);
  cleanup.unref();
  server.on('close', () => clearInterval(cleanup));
  return { server, rooms };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const { server } = createGameServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`\n一局 · 五子棋\n本机打开：http://localhost:${port}`);
    for (const list of Object.values(networkInterfaces())) for (const address of list || []) if (address.family === 'IPv4' && !address.internal) console.log(`同一 Wi-Fi 好友打开：http://${address.address}:${port}`);
    console.log('双方落子不限时。按 Ctrl+C 关闭服务器。\n');
  });
  server.on('error', error => { console.error(`启动失败：${error.message}`); process.exitCode = 1; });
}
