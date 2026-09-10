import { createHash, randomBytes, scrypt as scryptCallback, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { apiError } from './store.js';
import { objectSchema } from './schemas.js';
import { audit } from './db.js';

const scrypt=promisify(scryptCallback);
const hash=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
const COOKIE='rd_session';

export async function registerAuth(app,db,config) {
  await app.register(cookie);
  await app.register(rateLimit,{global:false});
  const salt=randomBytes(16);
  const expected=scryptSync(config.adminKey,salt,64);
  const cookieOptions={path:'/',httpOnly:true,sameSite:'strict',secure:config.cookieSecure,maxAge:config.sessionHours*3600};
  const keyFingerprint=hash(config.adminKey);
  const previous=db.prepare("SELECT value FROM settings WHERE key='_key_fingerprint'").get();
  // 更换管理密钥时撤销此前所有会话，避免旧 Cookie 继续有效。
  if(previous?.value!==keyFingerprint) {
    db.prepare('DELETE FROM sessions').run();
    db.prepare("INSERT INTO settings(key,value) VALUES('_key_fingerprint',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(keyFingerprint);
  }
  app.decorateRequest('adminSession',null);

  const findSession=request=>{
    const token=request.cookies[COOKIE];
    if(!token||!/^[0-9a-f]{64}$/.test(token))return null;
    const row=db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(hash(token),Date.now());
    if(!row)return null;
    return row;
  };
  app.decorate('findAdminSession',findSession);

  function checkOrigin(request) {
    if(request.headers['sec-fetch-site']==='cross-site')throw apiError(403,'ORIGIN_REJECTED','此操作不允许跨站提交');
    if(!request.headers.origin)return;
    const expectedOrigin=config.publicUrl||`${request.protocol}://${request.headers.host}`;
    if(request.headers.origin!==expectedOrigin)throw apiError(403,'ORIGIN_REJECTED','请求来源与站点地址不一致');
  }

  const requireAdmin=async request=>{
    const session=findSession(request);
    if(!session)throw apiError(401,'UNAUTHORIZED','请先输入管理员密钥登录');
    request.adminSession=session;
    if(!['GET','HEAD','OPTIONS'].includes(request.method)) {
      checkOrigin(request);
      const csrf=request.headers['x-csrf-token'];
      if(typeof csrf!=='string'||!equal(csrf,session.csrf_token))throw apiError(403,'CSRF_INVALID','登录状态已变化，请刷新页面后重试');
    }
  };
  app.decorate('requireAdmin',requireAdmin);
  app.addHook('onRequest',async request=>{
    // 使用路由器实际匹配的模板，防止百分号编码绕过原始 URL 前缀检查。
    if(request.routeOptions.url?.startsWith('/api/admin/'))await requireAdmin(request);
  });

  app.get('/api/session',async request=>{
    const session=findSession(request);
    return session?{authenticated:true,csrfToken:session.csrf_token}:{authenticated:false};
  });
  app.post('/api/login',{
    schema:{body:objectSchema({key:{type:'string',minLength:1,maxLength:512}},['key'])},
    config:{rateLimit:{max:config.loginRateLimit,timeWindow:'1 minute',errorResponseBuilder:()=>apiError(429,'RATE_LIMITED','尝试次数过多，请一分钟后再试')}},
  },async(request,reply)=>{
    checkOrigin(request);
    const actual=await scrypt(request.body.key,salt,64);
    if(!timingSafeEqual(expected,actual))throw apiError(401,'INVALID_KEY','管理员密钥不正确');
    const token=randomBytes(32).toString('hex');
    const csrfToken=randomBytes(32).toString('base64url');
    const prior=request.cookies[COOKIE];
    if(prior)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(prior));
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    db.prepare('INSERT INTO sessions(token_hash,csrf_token,expires_at) VALUES(?,?,?)').run(hash(token),csrfToken,Date.now()+config.sessionHours*3600000);
    audit(db,'session.login');
    reply.setCookie(COOKIE,token,cookieOptions);
    return {authenticated:true,csrfToken};
  });
  app.post('/api/logout',{preHandler:requireAdmin},async(request,reply)=>{
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(request.adminSession.token_hash);
    reply.clearCookie(COOKIE,{path:'/',httpOnly:true,sameSite:'strict',secure:config.cookieSecure});
    return {ok:true};
  });
}
