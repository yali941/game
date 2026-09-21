import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { newGame, playMove, resign, undoMove, agreeDraw } from './public/game.js';
import { createTableService } from './tables.js';
import { createRecords } from './records.js';

const publicDir = new URL('./public/', import.meta.url);
const TYPES = { '/': ['index.html', 'text/html; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/game.js': ['game.js', 'text/javascript; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
for (const file of ['hall.html', 'table.html', 'table.css', 'table-app.js', 'table-rules.js', 'flight-path.js', 'profile.js']) TYPES[`/${file}`] = [file, file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8'];
TYPES['/gomoku'] = TYPES['/']; TYPES['/play'] = TYPES['/table.html'];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => Array.from(randomBytes(6), b => ALPHABET[b % ALPHABET.length]).join('');
const seat = color => ({ color, token: randomBytes(32).toString('hex'), streams: new Set(), gone: false, nextReactionAt: 0 });

export function createGameServer(options = {}) {
  const rooms = new Map(), rates = new Map();
  const records = createRecords(options);
  const tables = createTableService({ ...options, records });
  const connected = p => Boolean(p && !p.gone && p.streams.size);
  const snapshot = (room, player) => ({ code: room.code, yourColor: player?.color, game: room.game, round: room.round, closed: room.closed, ready: room.ready, request: room.request, notice: room.notice, players: room.players.map(p => p ? { color: p.color, connected: connected(p), gone: p.gone } : null) });
  function notifyRoom(room, text) { room.notice = { id: randomBytes(8).toString('hex'), text }; }
  function broadcast(room) {
    records.victory(room, 'gomoku', p => p.color);
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
      if (req.method === 'GET' && url.pathname === '/api/rankings') return json(res, 200, records.board(url.searchParams.get('kind'), req));
      if (req.method === 'GET' && TYPES[url.pathname]) {
        const [file, type] = url.pathname === '/' && !url.searchParams.has('room') ? TYPES['/hall.html'] : TYPES[url.pathname];
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        return res.end(await readFile(new URL(file, publicDir)));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/table/')) return await tables.handle(req, res, url);
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
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('请求格式错误');
      if (url.pathname === '/api/profile') return json(res, 200, records.profile(req, data));
      if (url.pathname.startsWith('/api/table/')) return await tables.handle(req, res, url, data);
      if (url.pathname === '/api/create') {
        if (rooms.size >= 500) throw new Error('房间暂时已满，请稍后再试');
        let id; do { id = code(); } while (rooms.has(id));
        const player = seat(1);
        player.profileId = records.lookup(req)?.id;
        const room = { code: id, players: [player, null], game: newGame(), round: 1, ready: [], request: null, notice: null, closed: false, updatedAt: now };
        rooms.set(id, room);
        return json(res, 200, { token: player.token, ...snapshot(room, player) });
      }
      const room = rooms.get(String(data.room || '').toUpperCase());
      if (!room) return json(res, 404, { error: '房间不存在，检查房间码后再试' });
      if (url.pathname === '/api/join') {
        if (room.closed) throw new Error('房间已关闭，请创建新房间');
        if (room.players[1]) throw new Error('房间已满，两位棋手已入座');
        const player = seat(2); player.profileId = records.lookup(req)?.id; room.players[1] = player;
        broadcast(room);
        return json(res, 200, { token: player.token, ...snapshot(room, player) });
      }
      const player = room.players.find(p => p?.token === req.headers.authorization?.replace(/^Bearer /, '') && !p.gone);
      if (!player) return json(res, 401, { error: '身份已失效，请重新加入房间' });
      if (url.pathname === '/api/sync') return json(res, 200, snapshot(room, player));
      if (url.pathname === '/api/leave') {
        player.gone = true; room.closed = true; room.request = null;
        if (room.players.every(Boolean) && room.game.status === 'playing') {
          resign(room.game, player.color); room.game.reason = 'leave';
        }
        broadcast(room);
        for (const stream of player.streams) stream.end();
        return json(res, 200, { ok: true });
      }
      if (room.closed) throw new Error('房间已关闭，请创建新房间');
      // A requester may cancel even if their opponent has disconnected.
      if (url.pathname === '/api/cancel-request') {
        if (!room.request || data.id !== room.request.id || room.request.from !== player.color) throw new Error('这条请求已失效或不属于你');
        notifyRoom(room, `${player.color === 1 ? '黑棋' : '白棋'}取消了${room.request.kind === 'undo' ? '悔棋' : '求和'}请求`);
        room.request = null; broadcast(room);
        return json(res, 200, snapshot(room, player));
      }
      if (!room.players.every(connected)) throw new Error('等待双方连接后再继续');
      if (url.pathname === '/api/reaction') {
        if (!['poop', 'heart', 'bomb'].includes(data.kind)) throw new Error('不支持的互动表情');
        if (now < player.nextReactionAt) return json(res, 429, { error: '慢一点，每 2 秒可以互动一次' });
        player.nextReactionAt = now + 2000;
        const reaction = { id: randomBytes(8).toString('hex'), kind: data.kind, from: player.color, to: 3 - player.color };
        for (const p of room.players) for (const output of p.streams) output.write(`event: reaction\ndata: ${JSON.stringify(reaction)}\n\n`);
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/request') {
        if (room.game.status !== 'playing') throw new Error('本局已结束');
        if (room.request) throw new Error('请先处理当前请求');
        if (!['undo', 'draw'].includes(data.kind)) throw new Error('无效的请求类型');
        if (data.kind === 'undo' && !room.game.moves.some(move => move.color === player.color)) throw new Error('你还没有落子，暂时不能悔棋');
        room.request = { id: randomBytes(16).toString('hex'), kind: data.kind, from: player.color, moveCount: room.game.moves.length, round: room.round };
      } else if (url.pathname === '/api/respond') {
        const request = room.request;
        if (!request || data.id !== request.id || request.round !== room.round || request.moveCount !== room.game.moves.length) throw new Error('这条请求已失效');
        if (request.from === player.color) throw new Error('需要由对手回应请求');
        if (typeof data.accept !== 'boolean') throw new Error('请选择同意或拒绝');
        if (data.accept) {
          if (request.kind === 'undo') {
            const count = undoMove(room.game, request.from);
            notifyRoom(room, `悔棋已同意，撤回 ${count} 手，轮到${request.from === 1 ? '黑棋' : '白棋'}重新落子`);
          } else { agreeDraw(room.game); notifyRoom(room, '双方同意和棋，本局结束'); }
        } else notifyRoom(room, `${request.kind === 'undo' ? '悔棋' : '求和'}请求被拒绝，继续对弈`);
        room.request = null;
      } else if (url.pathname === '/api/move') {
        if (room.request) throw new Error('请先处理悔棋或求和请求');
        playMove(room.game, player.color, data.x, data.y);
      } else if (url.pathname === '/api/resign') { resign(room.game, player.color); room.request = null; }
      else if (url.pathname === '/api/rematch') {
        if (room.game.status !== 'finished') throw new Error('本局尚未结束');
        if (!room.ready.includes(player.color)) room.ready.push(player.color);
        if (room.ready.length === 2) {
          for (const p of room.players) p.color = 3 - p.color;
          room.players.reverse(); room.game = newGame(); room.ready = []; room.request = null; room.notice = null; room.round++;
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
    tables.cleanup();
    const now = Date.now();
    for (const [id, room] of rooms) if (!room.players.some(connected) && now - room.updatedAt > 86400000) rooms.delete(id);
    for (const [ip, rate] of rates) if (now - rate.start > 60000) rates.delete(ip);
  }, 60000);
  cleanup.unref();
  server.on('close', () => clearInterval(cleanup));
  return { server, rooms, tableRooms: tables.rooms };
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
