import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as gomoku from '../public/game.js';
import * as go from '../public/go-rules.js';
import {chooseAutoMove} from '../public/auto-play.js';

// Run the actual page controller with a fake clock and minimal DOM. Rules and
// event handlers are real; network writes fail if a local action leaks online.
function page(kind) {
  const nodes=new Map(),timers=new Map();let clock=0,nextTimer=0;
  const node=id=>{
    if(!nodes.has(id)) nodes.set(id,{hidden:false,disabled:false,open:false,textContent:'',value:'',events:{},classList:{toggle(){},add(){}},
      addEventListener(event,fn){this.events[event]=fn;},replaceChildren(){},setAttribute(){},close(){this.open=false;},showModal(){this.open=true;}});
    return nodes.get(id);
  };
  const context=vm.createContext({...(kind==='go'?go:gomoku),chooseAutoMove,chooseGoMove:go.chooseGoMove,
    document:{getElementById:node,querySelectorAll:()=>[],querySelector:s=>s==='dialog[open]'?[...nodes.values()].find(n=>n.open):node(s)},
    setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout:id=>timers.delete(id),
    matchMedia:()=>({matches:false}),showBoardDialog:el=>el.open=true,
    profileHeaders:()=>({}),profileReady:Promise.resolve(),refreshRankings(){},
    fetch(){throw Error('Local AI sent an online request');},AbortSignal,console
  });
  let source=readFileSync(new URL('../public/'+(kind==='go'?'go-app.js':'app.js'),import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
  source=source.slice(0,source.lastIndexOf("setupTabletop('gomoku');"));
  vm.runInContext(source+`
    render=()=>{syncBoardInteraction();scheduleAiMove();};
    globalThis.ui={switchMode,move,canPlay,requestAction,render,
      current:()=>localGame,mode:()=>mode,timer:()=>aiTimer,
      online:(g,color)=>{mode='online';transport=true;room={game:g,yourColor:color,players:[{connected:true},{connected:true}]};},
      ${kind==='go'?'goAction,renderGoControls,canScore,':''}
    };`,context);
  return {ui:context.ui,node,async tick(ms){const end=clock+ms;while(true){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;clock=next[1].at;timers.delete(next[0]);next[1].fn();await Promise.resolve();}clock=end;},async settle(){await Promise.resolve();await Promise.resolve();}};
}

for(const kind of ['gomoku','go']) {
  test(`${kind}: AI responds once after double confirmation and preserves same-screen white turns`,async()=>{
    const p=page(kind);p.ui.switchMode('ai');await p.settle();
    p.ui.move(7,7);assert.equal(p.ui.current().moves.length,0);
    p.ui.move(7,7);assert.equal(p.ui.current().moves.length,1);
    p.ui.move(8,8);p.ui.move(8,8);assert.equal(p.ui.current().moves.length,1);
    await p.tick(2200);assert.equal(p.ui.current().moves.length,2);assert.equal(p.ui.current().moves[1].color,2);assert.ok(p.ui.canPlay());
    await p.tick(3000);assert.equal(p.ui.current().moves.length,2);
    p.ui.switchMode('local');await p.settle();p.ui.move(7,7);p.ui.move(7,7);await p.tick(600);
    assert.ok(p.ui.canPlay(),'same-screen white must still be playable');p.ui.move(8,8);p.ui.move(8,8);
    assert.equal(p.ui.current().moves.length,2);assert.equal(p.ui.current().moves[1].color,2);
  });
  test(`${kind}: AI undo removes human move and reply, and resets pending thinking`,async()=>{
    const p=page(kind);p.ui.switchMode('ai');await p.settle();p.ui.move(7,7);p.ui.move(7,7);await p.tick(2200);
    p.ui.requestAction('undo');await p.tick(2000);p.node('confirm-ok').events.click();
    assert.equal(p.ui.current().moves.length,0);assert.equal(p.ui.current().turn,1);
    p.ui.move(7,7);p.ui.move(7,7);await p.tick(530);p.ui.requestAction('undo');await p.tick(2000);
    assert.equal(p.ui.current().moves.length,1,'AI pauses behind confirmation');p.node('confirm-ok').events.click();await p.tick(2500);
    assert.equal(p.ui.current().moves.length,0);
  });
  test(`${kind}: switching, restart, resignation and rematch cancel pending AI`,async()=>{
    const p=page(kind);p.ui.switchMode('ai');await p.settle();p.ui.move(7,7);p.ui.move(7,7);await p.tick(530);
    p.ui.switchMode('online');await p.settle();await p.tick(2500);assert.equal(p.ui.timer(),null);assert.equal(p.ui.current().moves.length,0);
    p.ui.switchMode('ai');await p.settle();p.ui.move(7,7);p.ui.move(7,7);await p.tick(530);
    p.node('leave-button').events.click();p.node('confirm-ok').events.click();await p.tick(2500);assert.equal(p.ui.current().moves.length,0);
    p.ui.move(7,7);p.ui.move(7,7);await p.tick(530);p.node('resign-button').events.click();p.node('confirm-ok').events.click();await p.settle();await p.tick(2500);
    assert.equal(p.ui.current().winner,2,'human always resigns as black, including AI turn');assert.equal(p.ui.current().moves.length,1);
    p.node('rematch-button').events.click();await p.settle();await p.tick(2500);assert.equal(p.ui.current().moves.length,0);assert.ok(p.ui.canPlay());
  });
}
test('go: AI scoring waits for human marks and never hides online confirmation',async()=>{
  const p=page('go');p.ui.switchMode('ai');await p.settle();
  go.playMove(p.ui.current(),1,3,3);go.pass(p.ui.current(),2);go.pass(p.ui.current(),1);p.ui.render();
  await p.tick(2500);assert.equal(p.ui.current().status,'playing');assert.ok(p.ui.canScore());
  p.ui.renderGoControls();assert.equal(p.node('score-confirm-1').hidden,false);assert.equal(p.node('score-confirm-2').hidden,true);
  p.ui.goAction('confirm-score',{color:1});await p.settle();p.ui.goAction('dead',{x:3,y:3});await p.settle();await p.tick(1000);
  assert.equal(p.ui.current().status,'playing','changing marks cancels pending acceptance');
  p.ui.goAction('confirm-score',{color:1});await p.settle();await p.tick(1000);assert.equal(p.ui.current().status,'finished');
  const online=go.newGame();go.pass(online,1);go.pass(online,2);
  for(const color of [1,2]){p.ui.online(online,color);p.ui.renderGoControls();assert.equal(p.node('score-confirm-'+color).hidden,false);assert.equal(p.node('score-confirm-'+(3-color)).hidden,true);}
});
