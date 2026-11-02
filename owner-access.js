import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const COOKIE = 'yiju-owner';
const TTL = 8 * 60 * 60 * 1000;

// Only a hash of a randomly generated, high-entropy key is configured on the server.
export function createOwnerAccess({ownerKeyHash = process.env.OWNER_KEY_HASH || '', ownerSecureCookie = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER), ownerNow = Date.now} = {}) {
  const sessions = new Map(), attempts = new Map();
  const configured = /^[a-f0-9]{64}$/.test(ownerKeyHash);
  const cookieToken = req => String(req.headers.cookie || '').split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  const session = req => {
    const id = cookieToken(req), s = sessions.get(id);
    if (s && s.expires > ownerNow()) return s;
    if (s) sessions.delete(id);
    return null;
  };
  const authorized = (req, p) => Boolean(p?.profileId && session(req)?.profileId === p.profileId);
  const requireOwner = (req, p) => {if (!authorized(req,p)) throw new Error('私人权限未登录或已过期');return session(req);};
  const cookie = (res,value,age) => res.setHeader('Set-Cookie',`${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${ownerSecureCookie?'; Secure':''}`);
  const logout = (req,res) => {sessions.delete(cookieToken(req));cookie(res,'',0);};
  function login(req,res,key,profile) {
    const now=ownerNow(),ip=req.socket.remoteAddress;
    for(const [id,s] of sessions) if(s.expires<=now) sessions.delete(id);
    for(const [id,a] of attempts) if(a.until<=now) attempts.delete(id);
    const a=attempts.get(ip)||{count:0,until:now+15*60*1000};
    if(a.count>=8) throw new Error('尝试过多，请 15 分钟后重试');
    a.count++;attempts.set(ip,a);
    if(!configured || !profile || typeof key!=='string' || key.length>256 || !timingSafeEqual(Buffer.from(digest(key)),Buffer.from(ownerKeyHash))) throw new Error('密钥无效或私人入口尚未启用');
    // One active owner login: signing in elsewhere revokes the previous device.
    sessions.clear();attempts.delete(ip);
    const token=randomBytes(32).toString('hex');sessions.set(token,{profileId:profile.id,expires:now+TTL,armed:new Map()});cookie(res,token,TTL/1000);
  }
  const arm = (req,p,r,type,value) => {const s=requireOwner(req,p);s.armed.set(r,{type,value,round:r.round,version:r.version});};
  const peek = (req,p,r,type) => {
    if(!authorized(req,p)) return undefined;
    const a=session(req).armed.get(r);
    return a?.type===type && a.round===r.round && a.version===r.version ? a.value : undefined;
  };
  const clear = (req,p,r) => {if(authorized(req,p)) session(req).armed.delete(r);};
  return {login,logout,authorized,requireOwner,arm,peek,clear};
}
