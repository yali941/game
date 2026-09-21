import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const kinds = ['gomoku', 'flight', 'jungle'];
const hash = token => createHash('sha256').update(token).digest('hex');
export function createRecords({ scoreFile = process.env.SCORE_FILE || './data/rankings.json' } = {}) {
  let data = { since: new Date().toISOString(), profiles: {} };
  if (scoreFile && existsSync(scoreFile)) data = JSON.parse(readFileSync(scoreFile, 'utf8'));
  const save = () => {
    if (!scoreFile) return;
    mkdirSync(dirname(scoreFile), { recursive: true });
    writeFileSync(`${scoreFile}.tmp`, JSON.stringify(data)); renameSync(`${scoreFile}.tmp`, scoreFile);
  };
  const lookup = req => {
    const token = req.headers['x-player-token'];
    return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? data.profiles[hash(token)] : null;
  };
  const profile = (req, input) => {
    let name;
    if (input.name !== undefined) {
      name = String(input.name).trim().replace(/[\x00-\x1f\x7f]/g, '');
      if (!name || [...name].length > 12) throw new Error('昵称请输入 1～12 个字');
    }
    let p = lookup(req), token;
    if (!p) {
      if (Object.keys(data.profiles).length >= 20000) throw new Error('玩家名额暂时已满');
      token = randomBytes(32).toString('hex');
      p = { id: randomBytes(8).toString('hex'), name: name || `棋友${randomBytes(2).toString('hex').toUpperCase()}`, wins: { gomoku: 0, flight: 0, jungle: 0 } };
      data.profiles[hash(token)] = p; save();
    } else if (name && name !== p.name) { p.name = name; save(); }
    return { token, id: p.id, name: p.name, wins: p.wins };
  };
  const victory = (room, kind, getSeat) => {
    if (room.recordedRound === room.round || room.game.status !== 'finished' || !room.game.winner) return;
    room.recordedRound = room.round;
    const ids = room.players.map(p => p?.profileId);
    // A browser cannot earn wins by playing itself in another tab. Empty games
    // and local play are not ranked. Rooms never accept client-reported wins.
    if (!room.game.moves.length || ids.some(id => !id) || new Set(ids).size !== ids.length) return;
    const winner = room.players.find(p => getSeat(p) === room.game.winner);
    const profile = Object.values(data.profiles).find(p => p.id === winner?.profileId);
    if (profile) { profile.wins[kind]++; save(); }
  };
  const board = (kind, req) => {
    if (!kinds.includes(kind)) throw new Error('未知游戏');
    const sorted = Object.values(data.profiles).filter(p => p.wins[kind] > 0).sort((a, b) => b.wins[kind] - a.wins[kind] || a.id.localeCompare(b.id));
    let previous = -1, rank = 0;
    const ranked = sorted.map((p, i) => { if (p.wins[kind] !== previous) rank = i + 1; previous = p.wins[kind]; return { id: p.id, name: p.name, wins: p.wins[kind], rank }; });
    const me = lookup(req);
    return { kind, since: data.since, entries: ranked.slice(0, 10), me: me ? { id: me.id, name: me.name, wins: me.wins[kind], rank: ranked.find(p => p.id === me.id)?.rank || null } : null };
  };
  return { lookup, profile, victory, board };
}
