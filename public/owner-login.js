import {profileReady,profileHeaders} from './profile.js';
const status=document.getElementById('owner-login-status'),form=document.getElementById('owner-login'),logout=document.getElementById('owner-logout');
async function call(action,data={}) {await profileReady;const r=await fetch('/api/owner/'+action,{method:'POST',headers:{'Content-Type':'application/json',...profileHeaders()},body:JSON.stringify(data)});const s=await r.json();if(!r.ok)throw Error(s.error);return s;}
function show(active){form.hidden=active;logout.hidden=!active;status.textContent=active?'已解锁。选择下方游戏，入座后即可使用。':'尚未登录。';}
form.addEventListener('submit',async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await call('login',{key:document.getElementById('owner-key').value});document.getElementById('owner-key').value='';show(true);}catch(e){status.textContent=e.message;}finally{button.disabled=false;}});
logout.addEventListener('click',async()=>{try{await call('logout');show(false);}catch(e){status.textContent=e.message;}});
call('status').then(s=>show(s.active)).catch(e=>{status.textContent=e.message;});
