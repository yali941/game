// Shared, deterministic rules. The server owns turns and generates online dice.
export const ANIMALS = ['', '鼠', '猫', '狗', '狼', '豹', '虎', '狮', '象'];
export const ANIMAL_ICONS = ['', '🐭', '🐱', '🐕', '🐺', '🐆', '🐅', '🦁', '🐘'];
export const FLIGHT_COLORS = ['红', '黄', '蓝', '绿'];
export const FLIGHT_PAINTS = ['#b95d55', '#c69a3c', '#5887ae', '#679879'];
export const flightColors = count => count === 2 ? [0, 2] : Array.from({ length: count }, (_, i) => i);
export const river = (x, y) => y >= 3 && y <= 5 && [1, 2, 4, 5].includes(x);
export const denOwner = (x, y) => x === 3 ? y === 8 ? 1 : y === 0 ? 2 : 0 : 0;
export const trapOwner = (x, y) => (y === 8 && [2, 4].includes(x)) || (x === 3 && y === 7) ? 1 : (y === 0 && [2, 4].includes(x)) || (x === 3 && y === 1) ? 2 : 0;
const inside = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < 7 && y >= 0 && y < 9;
function active(game, player) {
  if (game.status !== 'playing') throw new Error('本局尚未开始或已经结束');
  if (game.turn !== player) throw new Error('还没有轮到你');
}

export function newJungle() {
  // Red at the bottom, Blue at the top. Each side is a 180-degree rotation.
  const top = [[0, 0, 7], [6, 0, 6], [1, 1, 3], [5, 1, 2], [0, 2, 1], [2, 2, 5], [4, 2, 4], [6, 2, 8]];
  const pieces = [];
  for (const [x, y, rank] of top) {
    pieces.push({ id: `2-${rank}`, owner: 2, rank, x, y });
    pieces.push({ id: `1-${rank}`, owner: 1, rank, x: 6 - x, y: 8 - y });
  }
  return { kind: 'jungle', pieces, turn: 1, status: 'playing', winner: 0, reason: '', moves: [], last: null };
}

function captureAllowed(a, b) {
  if (a.owner === b.owner || river(a.x, a.y) !== river(b.x, b.y)) return false;
  if (trapOwner(b.x, b.y) === a.owner) return true;
  const rank = trapOwner(a.x, a.y) === b.owner ? 0 : a.rank;
  if (rank === 0) return false;
  if (rank === 1 && b.rank === 8) return true;
  if (rank === 8 && b.rank === 1) return false;
  return rank >= b.rank;
}
export function jungleTargets(game, id) {
  const p = game.pieces.find(p => p.id === id);
  if (!p) return [];
  const targets = [];
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    let x = p.x + dx, y = p.y + dy;
    if (river(x, y) && [6, 7].includes(p.rank)) {
      let blocked = false;
      while (river(x, y)) {
        if (game.pieces.some(q => q.x === x && q.y === y)) blocked = true;
        x += dx; y += dy;
      }
      if (blocked) continue;
    }
    if (!inside(x, y) || denOwner(x, y) === p.owner || (river(x, y) && p.rank !== 1)) continue;
    const target = game.pieces.find(q => q.x === x && q.y === y);
    if (!target || captureAllowed(p, target)) targets.push({ x, y });
  }
  return targets;
}
export function moveJungle(game, player, id, x, y) {
  active(game, player);
  const piece = game.pieces.find(p => p.id === id && p.owner === player);
  if (!piece || !jungleTargets(game, id).some(t => t.x === x && t.y === y)) throw new Error('这个位置不能走，请选择高亮格');
  const captured = game.pieces.find(p => p.x === x && p.y === y);
  const from = { x: piece.x, y: piece.y };
  if (captured) game.pieces.splice(game.pieces.indexOf(captured), 1);
  piece.x = x; piece.y = y;
  game.last = { id, from, x, y, captured: captured?.rank || 0, player };
  game.moves.push(game.last);
  const opponent = 3 - player;
  if (denOwner(x, y) === opponent) { game.status = 'finished'; game.winner = player; game.reason = 'den'; }
  else if (!game.pieces.some(p => p.owner === opponent && jungleTargets(game, p.id).length)) { game.status = 'finished'; game.winner = player; game.reason = 'blocked'; }
  else game.turn = opponent;
}

export function newFlight(count = 2) {
  if (![2, 3, 4].includes(count)) throw new Error('飞行棋支持 2～4 人');
  const colors = flightColors(count);
  const finishOrder = [];
  return { kind: 'flight', count, colors, finishOrder, planes: colors.flatMap((color, i) => Array.from({ length: 4 }, (_, n) => ({ id: `${i + 1}-${n + 1}`, owner: i + 1, color, number: n + 1, progress: -1 }))), turn: 1, status: 'playing', winner: 0, reason: '', phase: 'roll', dice: 0, sixes: 0, touched: [], rolls: 0, rollHistory: [], moves: [], last: null, message: '红方先掷骰，掷出 2、4、6 点可以出仓。' };
}
// -1 hangar; 0 launch; 1..50 shared track; 51..55 home lane; 56 finished.
export const flightIndex = (color, progress) => progress >= 1 && progress <= 50 ? (color * 13 + 3 + progress - 1) % 52 : -1;
export function flightOptions(game, player = game.turn) {
  if (game.status !== 'playing' || game.phase !== 'move' || player !== game.turn) return [];
  return game.planes.filter(p => p.owner === player && p.progress < 56 && (p.progress >= 0 || [2, 4, 6].includes(game.dice))).map(p => p.id);
}
function nextFlightTurn(game) {
  for (let i = 0; i < game.count; i++) {
    game.turn = game.turn % game.count + 1;
    if (!game.finishOrder.includes(game.turn)) break;
  }
  game.phase = 'roll'; game.sixes = 0; game.touched = [];
}
export function rollFlight(game, player, dice) {
  active(game, player);
  if (game.phase !== 'roll') throw new Error('请先选择一架飞机移动');
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) throw new Error('无效的骰子点数');
  game.dice = dice; game.rolls++; game.sixes = dice === 6 ? game.sixes + 1 : 0;
  // Record the acting seat before a no-move roll or penalty changes the turn.
  const entry = { number: game.rolls, player, dice, outcome: 'move' };
  game.rollHistory ??= [];
  game.rollHistory.push(entry);
  if (game.rollHistory.length > 200) game.rollHistory.splice(0, game.rollHistory.length - 200);
  if (game.sixes === 3) {
    entry.outcome = 'penalty';
    for (const p of game.planes) if (game.touched.includes(p.id)) p.progress = -1;
    game.message = '连续三次掷出 6：本回合动过的飞机返回机库。';
    game.last = { player, dice, penalty: true }; nextFlightTurn(game); return;
  }
  game.phase = 'move';
  game.message = `掷出 ${dice} 点，请选择一架飞机${[2, 4, 6].includes(dice) ? '出仓或前进' : '前进'}。`;
  if (!flightOptions(game).length) { entry.outcome = 'no-move'; game.message = `掷出 ${dice} 点，没有可移动的飞机，轮到下一位。`; nextFlightTurn(game); }
}
export function moveFlight(game, player, id) {
  active(game, player);
  if (!flightOptions(game, player).includes(id)) throw new Error('请选择高亮的飞机');
  const plane = game.planes.find(p => p.id === id), from = plane.progress, dice = game.dice;
  let to = from === -1 ? 0 : from + dice;
  if (to > 56) to = 112 - to;
  const landings = [], captured = [], jumps = [];
  const land = progress => {
    landings.push(progress);
    const index = flightIndex(plane.color, progress);
    if (index < 0) return;
    for (const other of game.planes) if (other.owner !== player && flightIndex(other.color, other.progress) === index) { other.progress = -1; captured.push(other.id); }
  };
  const fly = () => {
    // The long flight crosses the third home-lane square of the opposite color.
    for (const p of game.planes) if (p.color === (plane.color + 2) % 4 && p.progress === 53) { p.progress = -1; captured.push(p.id); }
    to = 30; land(to); jumps.push('飞跃');
  };
  land(to);
  if (to === 18) { fly(); to += 4; land(to); jumps.push('跳格'); }
  else if (to >= 2 && to <= 46 && to % 4 === 2) {
    to += 4; land(to); jumps.push('跳格'); if (to === 18) fly();
  }
  plane.progress = to;
  if (dice === 6 && !game.touched.includes(id)) game.touched.push(id);
  game.last = { player, id, from, to, dice, landings, captured, jumps };
  game.moves.push(game.last);
  game.message = `${FLIGHT_COLORS[plane.color]}方 ${plane.number} 号${from === -1 ? '起飞' : to === 56 ? '抵达终点' : '前进'}${jumps.length ? `，${jumps.join('、')}` : ''}${captured.length ? `，击回 ${captured.length} 架飞机` : ''}。`;
  if (game.planes.filter(p => p.owner === player).every(p => p.progress === 56)) {
    game.finishOrder.push(player);
    game.message += `${FLIGHT_COLORS[plane.color]}方获得第 ${game.finishOrder.length} 名。`;
    if (game.finishOrder.length === game.count - 1) {
      const last = Array.from({ length: game.count }, (_, i) => i + 1).find(n => !game.finishOrder.includes(n));
      game.finishOrder.push(last);
      game.status = 'finished'; game.winner = game.finishOrder[0]; game.reason = 'home';
      game.phase = 'roll'; game.sixes = 0; game.touched = [];
      game.message += `仅剩${FLIGHT_COLORS[game.colors[last - 1]]}方，本局结束。`;
    } else {
      nextFlightTurn(game);
      game.message += '其他玩家继续比赛。';
    }
  }
  else if (dice === 6) { game.phase = 'roll'; game.message += '掷出 6 点，继续掷骰。'; }
  else nextFlightTurn(game);
}

export const newTableGame = (kind, count) => kind === 'jungle' ? newJungle() : kind === 'flight' ? newFlight(count) : (() => { throw new Error('请选择飞行棋或斗兽棋'); })();
