import { randomBytes, randomUUID } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { transaction, audit } from './db.js';
import { objectSchema } from './schemas.js';
import { apiError } from './store.js';
import { digest } from './passkey-policy.js';

const CHALLENGE_COOKIE = 'rd_webauthn';
const ENROLLMENT_COOKIE = 'rd_enrollment';
const CHALLENGE_TTL_MS = 120000;
const RECENT_MS = 300000;
const MAX_PASSKEYS = 20;
const labelSchema = { type: 'string', minLength: 1, maxLength: 80 };
const binaryString = maxLength => ({ type: 'string', minLength: 1, maxLength, pattern: '^[A-Za-z0-9_-]+$' });
const responseSchema = objectSchema({
  id: binaryString(1400), rawId: binaryString(1400), type: { const: 'public-key' },
  authenticatorAttachment: { type: ['string', 'null'], maxLength: 32 },
  clientExtensionResults: { type: 'object', maxProperties: 20 },
  response: { type: 'object', maxProperties: 12, properties: {
    clientDataJSON: binaryString(8192), attestationObject: binaryString(140000), authenticatorData: binaryString(16384),
    signature: binaryString(8192), userHandle: { type: ['string', 'null'], maxLength: 128 },
    transports: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 32 } },
    publicKeyAlgorithm: { type: 'integer' }, publicKey: binaryString(16384),
  }, required: ['clientDataJSON'], additionalProperties: false },
}, ['id', 'rawId', 'type', 'response']);

export async function registerPasskeys(app, db, config, auth) {
  db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('_passkey_user_id',?)").run(randomBytes(32).toString('base64url'));
  const userHandle = db.prepare("SELECT value FROM settings WHERE key='_passkey_user_id'").get().value;
  const cookieOptions = { ...auth.cookieOptions, maxAge: CHALLENGE_TTL_MS / 1000 };
  const clearCookie = (reply, name) => reply.clearCookie(name, { path: '/', httpOnly: true, sameSite: 'strict', secure: config.cookieSecure });
  const relyingParty = () => ({ origin: auth.origin(), rpId: new URL(auth.origin()).hostname });
  const limited = body => ({
    ...(body ? { schema: { body } } : {}),
    config: { rateLimit: { max: config.loginRateLimit, timeWindow: '1 minute' } },
    preHandler: async request => { auth.checkOrigin(request, true); },
  });
  const credentialCount = rpId => db.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE rp_id=?').get(rpId).n;
  function enrollment(request) {
    const token = request.cookies[ENROLLMENT_COOKIE];
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return db.prepare('SELECT * FROM passkey_enrollments WHERE token_hash=? AND expires_at>? AND origin=?').get(digest(token), Date.now(), auth.origin()) || null;
  }
  const publicKey = (row, session) => ({
    id: row.id, label: row.label, createdAt: row.created_at, lastUsedAt: row.last_used_at,
    backedUp: !!row.backed_up, current: row.id === session?.passkey_id,
  });
  const cleanLabel = value => {
    const label = value.trim();
    if (!label || /[\x00-\x1f\x7f]/.test(label)) throw apiError(400, 'INVALID_LABEL', '请填写有效的通行密钥名称');
    return label;
  };
  function startChallenge(request, reply, { purpose, options, grant, session, label = null }) {
    const { origin, rpId } = relyingParty();
    const token = randomBytes(32).toString('hex');
    transaction(db, () => {
      db.prepare('DELETE FROM webauthn_challenges WHERE expires_at<=?').run(Date.now());
      db.prepare('DELETE FROM passkey_enrollments WHERE expires_at<=?').run(Date.now());
      const previous = request.cookies[CHALLENGE_COOKIE];
      if (previous) db.prepare('DELETE FROM webauthn_challenges WHERE token_hash=?').run(digest(previous));
      if (db.prepare('SELECT COUNT(*) AS n FROM webauthn_challenges').get().n >= 2048) throw apiError(429, 'RATE_LIMITED', '验证请求较多，请稍后再试');
      db.prepare('INSERT INTO webauthn_challenges(token_hash,challenge,purpose,origin,rp_id,expires_at,enrollment_hash,session_hash,label) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(digest(token), options.challenge, purpose, origin, rpId, Date.now() + CHALLENGE_TTL_MS, grant?.token_hash || null, session?.token_hash || null, label);
    });
    reply.setCookie(CHALLENGE_COOKIE, token, cookieOptions);
    return { options };
  }
  function consumeChallenge(request, reply, purposes) {
    const token = request.cookies[CHALLENGE_COOKIE];
    clearCookie(reply, CHALLENGE_COOKIE);
    if (!token || !/^[0-9a-f]{64}$/.test(token)) throw apiError(401, 'CHALLENGE_EXPIRED', '验证已失效，请重新发起通行密钥操作');
    return transaction(db, () => {
      const row = db.prepare('SELECT * FROM webauthn_challenges WHERE token_hash=? AND expires_at>? AND origin=?').get(digest(token), Date.now(), auth.origin());
      if (!row || !purposes.includes(row.purpose)) throw apiError(401, 'CHALLENGE_EXPIRED', '验证已失效，请重新发起通行密钥操作');
      // 在异步验签前原子消费，失败也必须获取新挑战，同一响应永远不能使用两次。
      db.prepare('DELETE FROM webauthn_challenges WHERE token_hash=?').run(row.token_hash);
      return row;
    });
  }
  function requireTopLevel(response) {
    let data;
    try { data = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8')); }
    catch { throw apiError(400, 'INVALID_CREDENTIAL', '通行密钥响应无效，请重试'); }
    if (data.crossOrigin === true || data.topOrigin !== undefined) throw apiError(403, 'ORIGIN_REJECTED', '请直接打开本站后使用通行密钥');
  }
  function registrationAuthority(request, challenge) {
    if (challenge.enrollment_hash) {
      const grant = enrollment(request);
      if (!grant || grant.token_hash !== challenge.enrollment_hash) throw apiError(403, 'ENROLLMENT_EXPIRED', '一次性注册链接已过期或已使用，请在服务器重新生成');
      if (grant.mode === 'setup' && db.prepare('SELECT 1 FROM passkeys LIMIT 1').get()) throw apiError(409, 'ALREADY_INITIALIZED', '管理员已经完成初始化');
      return grant;
    }
    const session = auth.requireRecent(request);
    if (session.token_hash !== challenge.session_hash) throw apiError(401, 'SESSION_CHANGED', '登录状态已变化，请重新添加通行密钥');
    return null;
  }

  app.get('/api/auth/status', async request => {
    const { origin, rpId } = relyingParty();
    const grant = enrollment(request);
    return {
      initialized: !!db.prepare('SELECT 1 FROM passkeys LIMIT 1').get(),
      ready: `${request.protocol}://${request.headers.host}` === origin,
      origin, rpId, loginUrl: `${origin}/?page=login`,
      enrollment: grant ? { mode: grant.mode, expiresAt: grant.expires_at } : null,
    };
  });

  app.post('/api/auth/enroll', limited(objectSchema({ token: binaryString(43) }, ['token'])), async (request, reply) => {
    const grant = db.prepare('SELECT * FROM passkey_enrollments WHERE token_hash=? AND expires_at>? AND origin=?').get(digest(request.body.token), Date.now(), auth.origin());
    if (!grant) throw apiError(403, 'ENROLLMENT_EXPIRED', '一次性注册链接已过期或已使用，请在服务器重新生成');
    reply.setCookie(ENROLLMENT_COOKIE, request.body.token, { ...cookieOptions, maxAge: Math.max(1, Math.floor((grant.expires_at - Date.now()) / 1000)) });
    return { ok: true, mode: grant.mode, expiresAt: grant.expires_at };
  });

  app.post('/api/auth/register/options', limited(objectSchema({ label: labelSchema }, ['label'])), async (request, reply) => {
    const grant = enrollment(request);
    const session = grant ? null : auth.requireRecent(request);
    const { rpId } = relyingParty();
    if (grant?.mode === 'setup' && db.prepare('SELECT 1 FROM passkeys LIMIT 1').get()) throw apiError(409, 'ALREADY_INITIALIZED', '管理员已经完成初始化');
    if (grant?.mode !== 'recovery' && credentialCount(rpId) >= MAX_PASSKEYS) throw apiError(409, 'PASSKEY_LIMIT', '最多保存 20 把通行密钥，请先移除不用的凭据');
    const label = cleanLabel(request.body.label);
    const options = await generateRegistrationOptions({
      rpName: 'ReleaseDock', rpID: rpId, userID: Buffer.from(userHandle, 'base64url'),
      userName: 'admin', userDisplayName: 'ReleaseDock 管理员',
      timeout: 60000, attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      // 不限制为平台认证器，让 Bitwarden 扩展、手机和硬件凭据都可以参与。
      excludeCredentials: db.prepare('SELECT credential_id,transports FROM passkeys WHERE rp_id=?').all(rpId)
        .map(row => ({ id: row.credential_id, transports: JSON.parse(row.transports) })),
    });
    return startChallenge(request, reply, { purpose: 'registration', options, grant, session, label });
  });

  app.post('/api/auth/register/verify', limited(objectSchema({ response: responseSchema }, ['response'])), async (request, reply) => {
    const challenge = consumeChallenge(request, reply, ['registration']);
    registrationAuthority(request, challenge);
    const response = request.body.response;
    requireTopLevel(response);
    let result;
    try {
      result = await verifyRegistrationResponse({ response, expectedChallenge: challenge.challenge, expectedOrigin: challenge.origin, expectedRPID: challenge.rp_id, requireUserVerification: true, requireUserPresence: true });
    } catch { throw apiError(400, 'INVALID_CREDENTIAL', '无法验证通行密钥，请重新创建并完成身份验证'); }
    if (!result.verified || !result.registrationInfo.userVerified) throw apiError(400, 'INVALID_CREDENTIAL', '通行密钥验证未通过');
    const info = result.registrationInfo;
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const session = transaction(db, () => {
      if (challenge.expires_at <= Date.now()) throw apiError(401, 'CHALLENGE_EXPIRED', '验证已超时，请重试');
      // 验签期间可能发生退出、撤销或另一次恢复，落库前再次检查授权。
      const grant = registrationAuthority(request, challenge);
      if (db.prepare('SELECT 1 FROM passkeys WHERE credential_id=?').get(info.credential.id)) throw apiError(409, 'PASSKEY_EXISTS', '这把通行密钥已经绑定');
      if (grant?.mode === 'recovery') {
        db.prepare('DELETE FROM sessions').run();
        db.prepare('DELETE FROM passkeys').run();
        db.prepare('DELETE FROM webauthn_challenges').run();
        audit(db, 'passkey.recovered');
      } else if (credentialCount(challenge.rp_id) >= MAX_PASSKEYS) throw apiError(409, 'PASSKEY_LIMIT', '通行密钥数量已达上限');
      db.prepare('INSERT INTO passkeys(id,credential_id,public_key,counter,rp_id,label,transports,device_type,backed_up,created_at,last_used_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, info.credential.id, Buffer.from(info.credential.publicKey), info.credential.counter, challenge.rp_id, challenge.label, JSON.stringify(info.credential.transports || []), info.credentialDeviceType, Number(info.credentialBackedUp), createdAt, createdAt);
      if (grant) {
        db.prepare('DELETE FROM passkey_enrollments').run();
        db.prepare('DELETE FROM webauthn_challenges WHERE enrollment_hash IS NOT NULL').run();
      }
      audit(db, 'passkey.registered', id);
      return auth.createSession(request, id);
    });
    clearCookie(reply, ENROLLMENT_COOKIE);
    return { ...auth.sendSession(reply, session), passkey: publicKey(db.prepare('SELECT * FROM passkeys WHERE id=?').get(id), { passkey_id: id }) };
  });

  app.post('/api/auth/login/options', limited(objectSchema({ reauthenticate: { type: 'boolean' } })), async (request, reply) => {
    const session = request.body?.reauthenticate ? auth.requireAdmin(request) : null;
    const { rpId } = relyingParty();
    if (!credentialCount(rpId)) throw apiError(409, 'PASSKEY_NOT_CONFIGURED', '当前域名尚未绑定通行密钥，请使用服务器生成的注册链接');
    const options = await generateAuthenticationOptions({ rpID: rpId, userVerification: 'required', timeout: 60000 });
    return startChallenge(request, reply, { purpose: session ? 'reauthentication' : 'login', options, session });
  });

  app.post('/api/auth/login/verify', limited(objectSchema({ response: responseSchema }, ['response'])), async (request, reply) => {
    const challenge = consumeChallenge(request, reply, ['login', 'reauthentication']);
    const response = request.body.response;
    requireTopLevel(response);
    const credential = db.prepare('SELECT * FROM passkeys WHERE credential_id=? AND rp_id=?').get(response.id, challenge.rp_id);
    if (!credential || response.response.userHandle !== userHandle) throw apiError(401, 'INVALID_CREDENTIAL', '无法使用这把通行密钥登录');
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response, expectedChallenge: challenge.challenge, expectedOrigin: challenge.origin, expectedRPID: challenge.rp_id, requireUserVerification: true,
        credential: { id: credential.credential_id, publicKey: new Uint8Array(credential.public_key), counter: credential.counter, transports: JSON.parse(credential.transports) },
      });
    } catch { throw apiError(401, 'INVALID_CREDENTIAL', '通行密钥验证失败，请重新尝试'); }
    if (!result.verified || !result.authenticationInfo.userVerified) throw apiError(401, 'INVALID_CREDENTIAL', '通行密钥验证失败');
    if (result.authenticationInfo.credentialDeviceType !== credential.device_type) throw apiError(401, 'INVALID_CREDENTIAL', '通行密钥类型与登记信息不一致');
    const outcome = transaction(db, () => {
      if (challenge.expires_at <= Date.now()) throw apiError(401, 'CHALLENGE_EXPIRED', '验证已超时，请重试');
      const current = db.prepare('SELECT * FROM passkeys WHERE id=?').get(credential.id);
      if (!current || current.counter !== credential.counter) throw apiError(401, 'CREDENTIAL_CHANGED', '凭据已变化，请重新验证');
      let session;
      if (challenge.purpose === 'reauthentication') {
        session = auth.requireAdmin(request);
        if (session.token_hash !== challenge.session_hash) throw apiError(401, 'SESSION_CHANGED', '登录状态已变化，请重新登录');
      }
      db.prepare('UPDATE passkeys SET counter=?,backed_up=?,last_used_at=? WHERE id=?')
        .run(result.authenticationInfo.newCounter, Number(result.authenticationInfo.credentialBackedUp), new Date().toISOString(), current.id);
      if (session) {
        db.prepare('UPDATE sessions SET verified_at=? WHERE token_hash=?').run(Date.now(), session.token_hash);
        audit(db, 'session.reverified', current.id);
        return { csrfToken: session.csrf_token };
      }
      return auth.createSession(request, current.id);
    });
    return outcome.token ? auth.sendSession(reply, outcome) : { authenticated: true, csrfToken: outcome.csrfToken };
  });

  app.get('/api/admin/passkeys', async request => ({
    passkeys: db.prepare('SELECT * FROM passkeys WHERE rp_id=? ORDER BY created_at,id').all(relyingParty().rpId).map(row => publicKey(row, request.adminSession)),
    requiresReauthentication: request.adminSession.verified_at < Date.now() - RECENT_MS,
  }));
  app.patch('/api/admin/passkeys/:id', { schema: { body: objectSchema({ label: labelSchema }, ['label']) } }, async request => {
    const session = auth.requireRecent(request);
    const label = cleanLabel(request.body.label);
    transaction(db, () => {
      const row = db.prepare('SELECT * FROM passkeys WHERE id=? AND rp_id=?').get(request.params.id, relyingParty().rpId);
      if (!row) throw apiError(404, 'PASSKEY_NOT_FOUND', '通行密钥不存在');
      db.prepare('UPDATE passkeys SET label=? WHERE id=?').run(label, row.id);
      audit(db, 'passkey.renamed', row.id);
    });
    return { passkey: publicKey(db.prepare('SELECT * FROM passkeys WHERE id=?').get(request.params.id), session) };
  });
  app.delete('/api/admin/passkeys/:id', async (request, reply) => {
    const session = auth.requireRecent(request);
    transaction(db, () => {
      const row = db.prepare('SELECT * FROM passkeys WHERE id=? AND rp_id=?').get(request.params.id, relyingParty().rpId);
      if (!row) throw apiError(404, 'PASSKEY_NOT_FOUND', '通行密钥不存在');
      if (credentialCount(row.rp_id) <= 1) throw apiError(409, 'LAST_PASSKEY', '至少保留一把通行密钥，请先添加备用凭据');
      db.prepare('DELETE FROM webauthn_challenges WHERE session_hash IN (SELECT token_hash FROM sessions WHERE passkey_id=?)').run(row.id);
      db.prepare('DELETE FROM sessions WHERE passkey_id=?').run(row.id);
      db.prepare('DELETE FROM passkeys WHERE id=?').run(row.id);
      audit(db, 'passkey.removed', row.id);
    });
    const sessionRevoked = request.params.id === session.passkey_id;
    if (sessionRevoked) clearCookie(reply, 'rd_session');
    return { ok: true, sessionRevoked };
  });
}
