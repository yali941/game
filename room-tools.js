import { randomBytes } from 'node:crypto';
import { chooseAutoMove } from './public/auto-play.js';
import { flightMotionSteps } from './public/flight-path.js';

export function identifyPlayer(player, profile) {
  player.profileId=profile?.id;
  player.id=profile?.id || randomBytes(8).toString('hex');
  player.name=profile?.name || '棋友'+player.id.slice(0,4).toUpperCase();
  player.auto=false;
}
export const publicPlayer = player => ({ id:player.id,name:player.name,auto:player.auto });
export function updateRoomProfile(room,profile) {
  let changed=false;
  for(const player of room.players) if(player?.profileId===profile.id && player.name!==profile.name) {
    player.name=profile.name;changed=true;
  }
  for(const message of room.chat||[]) if(message.playerId===profile.id && message.name!==profile.name) {
    message.name=profile.name;changed=true;
  }
  return changed;
}
export function addChat(room, player, text, seat) {
  if(typeof text!=='string') throw new Error('请输入聊天内容');
  const clean=text.replace(/[\x00-\x1f\x7f]/g,' ').trim();
  if(!clean || [...clean].length>200) throw new Error('聊天内容请输入 1～200 个字');
  const now=Date.now();
  if(now<(player.nextChatAt||0)) throw new Error('消息发送太快，请稍等一秒');
  player.nextChatAt=now+1000;
  const message={ id:randomBytes(8).toString('hex'),playerId:player.id,name:player.name,seat,text:clean,time:now };
  room.chat ||= [];room.chat.push(message); if(room.chat.length>100) room.chat.shift();
  return message;
}
export function setAuto(player,value) {
  if(typeof value!=='boolean') throw new Error('请选择开启或取消托管');
  player.auto=value;
}
export function createAutoScheduler({ ready, execute, broadcast, delay }) {
  const tasks=new Map();
  const cancel=room=>{ const old=tasks.get(room); if(old) clearTimeout(old.timer);tasks.delete(room); };
  const sync=room=>{
    const player=room.players.find(p=>p && (p.seat||p.color)===room.game.turn);
    if(!player?.auto || !ready(room)) {cancel(room);return;}
    const key=[room.round,room.game.turn,room.game.moves.length,room.game.rolls||0].join(':');
    if(tasks.get(room)?.key===key) return;
    cancel(room);
    const pause=delay ?? (room.game.kind==='flight' ? room.game.last?.penalty ? 2100 : room.game.phase==='move' ? 1500 : room.game.last?.id ? Math.max(1300,flightMotionSteps(room.game.last).reduce((total,step)=>total+step.duration,0)+180) : 1500 : 1100);
    const timer=setTimeout(()=>{
      tasks.delete(room);
      if(!player.auto || !ready(room) || room.game.turn!==(player.seat||player.color)) return;
      const move=chooseAutoMove(room.game);
      if(!move) {player.auto=false;broadcast(room);return;}
      execute(room,player,move);broadcast(room);
    },pause);
    timer.unref?.();tasks.set(room,{key,timer});
  };
  return {sync,close:()=>{for(const room of tasks.keys()) cancel(room);}};
}
