import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { apiError } from './store.js';
import { audit } from './db.js';
import { registerPasskeys } from './passkeys.js';
import { authOrigin, digest } from './passkey-policy.js';

const equal=(a,b)=>timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
const COOKIE='rd_session';
export const RECENT_VERIFICATION_MS=5*60*1000;

export async function registerAuth(app,db,config) {
  await app.register(cookie);
  await app.register(rateLimit,{global:false});
  const origin=()=>authOrigin(config,app.server.address()?.port);
  const cookieOptions={path:'/',httpOnly:true,sameSite:'strict',secure:config.cookieSecure,maxAge:config.sessionHours*3600};
  app.decorateRequest('adminSession',null);

  const findSession=request=>{
    const token=request.cookies[COOKIE];
    if(!token||!/^[0-9a-f]{64}$/.test(token))return null;
    const row=db.prepare(`SELECT s.* FROM sessions s JOIN passkeys p ON p.id=s.passkey_id
      WHERE s.token_hash=? AND s.expires_at>? AND s.auth_origin=? AND p.rp_id=?`).get(digest(token),Date.now(),origin(),new URL(origin()).hostname);
    if(!row)return null;
    return row;
  };
  app.decorate('findAdminSession',findSession);

  function checkOrigin(request,required=false) {
    if(request.headers['sec-fetch-site']==='cross-site')throw apiError(403,'ORIGIN_REJECTED','此操作不允许跨站提交');
    if(!request.headers.origin&&!required)return;
    if(request.headers.origin!==origin())throw apiError(403,'ORIGIN_REJECTED','请从配置的站点地址使用通行密钥');
  }

  const requireAdmin=request=>{
    const session=findSession(request);
    if(!session)throw apiError(401,'UNAUTHORIZED','请先使用通行密钥登录');
    request.adminSession=session;
    if(!['GET','HEAD','OPTIONS'].includes(request.method)) {
      checkOrigin(request);
      const csrf=request.headers['x-csrf-token'];
      if(typeof csrf!=='string'||!equal(csrf,session.csrf_token))throw apiError(403,'CSRF_INVALID','登录状态已变化，请刷新页面后重试');
    }
    return session;
  };
  const requireRecent=request=>{
    const session=requireAdmin(request);
    if(session.verified_at<Date.now()-RECENT_VERIFICATION_MS)throw apiError(403,'REAUTH_REQUIRED','请再次验证通行密钥后管理登录凭据');
    return session;
  };
  app.decorate('requireAdmin',async request=>{requireAdmin(request);});
  app.addHook('onRequest',async request=>{
    // 使用路由器实际匹配的模板，防止百分号编码绕过原始 URL 前缀检查。
    if(request.routeOptions.url?.startsWith('/api/admin/'))await requireAdmin(request);
  });

  app.get('/api/session',async request=>{
    const session=findSession(request);
    return session?{authenticated:true,csrfToken:session.csrf_token}:{authenticated:false};
  });
  function createSession(request,passkeyId) {
    const token=randomBytes(32).toString('hex');
    const csrfToken=randomBytes(32).toString('base64url');
    const prior=request.cookies[COOKIE];
    if(prior)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(prior));
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    db.prepare('INSERT INTO sessions(token_hash,csrf_token,expires_at,passkey_id,verified_at,auth_origin) VALUES(?,?,?,?,?,?)')
      .run(digest(token),csrfToken,Date.now()+config.sessionHours*3600000,passkeyId,Date.now(),origin());
    audit(db,'session.login',passkeyId);
    return {token,csrfToken};
  }
  function sendSession(reply,session) {
    reply.setCookie(COOKIE,session.token,cookieOptions);
    return {authenticated:true,csrfToken:session.csrfToken};
  }
  app.post('/api/logout',{preHandler:app.requireAdmin},async(request,reply)=>{
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(request.adminSession.token_hash);
    reply.clearCookie(COOKIE,{path:'/',httpOnly:true,sameSite:'strict',secure:config.cookieSecure});
    return {ok:true};
  });
  await registerPasskeys(app,db,config,{origin,cookieOptions,checkOrigin,requireAdmin,requireRecent,findSession,createSession,sendSession});
}
