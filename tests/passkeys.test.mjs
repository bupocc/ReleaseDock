import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { buildApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { digest, issueEnrollment } from '../server/passkey-policy.js';
import { createAuthenticator, createClient, bootstrapAdmin, registerAuthenticator, authenticate } from './helpers/passkeys.mjs';

async function fixture(t, options = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'releasedock-passkeys-'));
  const app = await buildApp({ dataDir, logger: false, loginRateLimit: 100, publicUrl: '', cookieSecure: false, ...options });
  t.after(async () => {
    await app.close();
    const target = path.resolve(dataDir);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('releasedock-passkeys-'));
    await fs.rm(target, { recursive: true, force: true });
  });
  return app;
}
async function options(client, registration = false) {
  const response = await client.request('POST', registration ? '/api/auth/register/options' : '/api/auth/login/options', registration ? { label: 'Bitwarden' } : {});
  assert.equal(response.statusCode, 200, response.body);
  return response.json().options;
}

test('通行密钥：匿名注册关闭，旧文本密钥入口与文件不可用', { timeout: 10000 }, async t => {
  const app = await fixture(t);
  const client = createClient(app);
  assert.equal((await client.request('POST', '/api/auth/register/options', { label: '未经授权' })).statusCode, 401);
  for (const url of ['/api/login', '/api/%6cogin']) assert.equal((await client.request('POST', url, { key: 'old-text-key' })).statusCode, 404);
  assert.equal((await client.request('POST', '/api/auth/enroll', { token: randomBytes(32).toString('base64url') })).statusCode, 403);
  assert.equal((await app.inject('/assets/../.data/passkey-setup-link.txt')).statusCode, 404);
  assert.equal((await fs.readdir(app.appConfig.dataDir)).includes('admin-key'), false);
  assert.equal((await client.request('GET', '/api/auth/status')).json().initialized, false);
});

test('通行密钥：站点来源固定，拒绝 HTTP 公网、IP、嵌入账号和伪造来源', { timeout: 10000 }, async t => {
  const app = await fixture(t);
  for (const publicUrl of ['http://example.com', 'https://127.0.0.1', 'https://[::1]', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?next=evil']) {
    assert.throws(() => loadConfig({ dataDir: app.appConfig.dataDir, publicUrl }));
  }
  const config = loadConfig({ dataDir: app.appConfig.dataDir, publicUrl: 'https://releases.example.com', cookieSecure: false });
  assert.equal(config.cookieSecure, true);
  const wrongHost = await app.inject({ url: '/api/auth/status', headers: { host: 'evil.example' } });
  assert.equal(wrongHost.json().origin, 'http://localhost:8080');
  assert.equal(wrongHost.json().rpId, 'localhost');
  assert.equal(wrongHost.json().ready, false);
  for (const headers of [{}, { origin: 'https://evil.example' }, { origin: 'http://localhost:8080', 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login/options', payload: {}, headers })).statusCode, 403);
  }
});

test('通行密钥：可信反向代理正确识别 HTTPS 和固定登录域名', { timeout: 10000 }, async t => {
  const origin = 'https://res.bupo.cc';
  const app = await fixture(t, { publicUrl: origin, trustProxy: true });
  const headers = { host: 'res.bupo.cc', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'res.bupo.cc' };
  // 覆盖宿主机 Caddy、Docker 网桥以及 IPv4 映射和 IPv6 私网来源。
  for (const remoteAddress of ['127.0.0.1', '::1', '172.18.0.1', '::ffff:172.18.0.1', 'fd00::2']) {
    const response = await app.inject({ url: '/api/auth/status', remoteAddress, headers });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().ready, true, remoteAddress);
    assert.equal(response.json().origin, origin);
    assert.equal(response.json().rpId, 'res.bupo.cc');
  }
  const wrongHost = await app.inject({ url: '/api/auth/status', remoteAddress: '172.18.0.1', headers: { ...headers, host: 'evil.example' } });
  assert.equal(wrongHost.json().ready, false);
  const wrongOrigin = await app.inject({ method: 'POST', url: '/api/auth/login/options', remoteAddress: '172.18.0.1', headers: { ...headers, origin: 'https://evil.example' }, payload: {} });
  assert.equal(wrongOrigin.statusCode, 403);
  assert.equal(wrongOrigin.json().error.code, 'ORIGIN_REJECTED');
});

test('通行密钥：未启用代理信任或来源不可信时忽略伪造转发头', { timeout: 10000 }, async t => {
  const headers = { host: 'res.bupo.cc', 'x-forwarded-proto': 'https', 'x-forwarded-for': '127.0.0.1', 'x-forwarded-host': 'res.bupo.cc' };
  const direct = await fixture(t, { publicUrl: 'https://res.bupo.cc', trustProxy: false });
  const untrusted = await direct.inject({ url: '/api/auth/status', remoteAddress: '127.0.0.1', headers });
  assert.equal(untrusted.json().ready, false);
  const proxied = await fixture(t, { publicUrl: 'https://res.bupo.cc', trustProxy: true });
  for (const remoteAddress of ['203.0.113.5', '::ffff:203.0.113.5', '2001:db8::5']) {
    const response = await proxied.inject({ url: '/api/auth/status', remoteAddress, headers });
    assert.equal(response.json().ready, false, remoteAddress);
    assert.equal(response.json().origin, 'https://res.bupo.cc');
  }
});

test('通行密钥：自定义代理地址覆盖默认私网允许列表', { timeout: 10000 }, async t => {
  const app = await fixture(t, { publicUrl: 'https://res.bupo.cc', trustProxy: true, trustedProxyCidrs: ['172.18.0.1/32'] });
  const headers = { host: 'res.bupo.cc', 'x-forwarded-proto': 'https' };
  for (const [remoteAddress, ready] of [['172.18.0.1', true], ['172.18.0.2', false], ['127.0.0.1', false], ['192.168.1.1', false]]) {
    const response = await app.inject({ url: '/api/auth/status', remoteAddress, headers });
    assert.equal(response.json().ready, ready, remoteAddress);
  }
});

test('通行密钥：HTTPS 代理下完成绑定、退出和真实签名登录', { timeout: 10000 }, async t => {
  const app = await fixture(t, { publicUrl: 'https://res.bupo.cc', trustProxy: true });
  const client = createClient(app);
  const request = client.request.bind(client);
  client.request = (method, url, payload, headers = {}) => request(method, url, payload, { 'x-forwarded-proto': 'https', ...headers });
  assert.equal((await client.request('GET', '/api/auth/status')).json().ready, true);
  const { authenticator, response } = await registerAuthenticator(app, client);
  assert.match([response.headers['set-cookie']].flat().join(';'), /Secure/);
  assert.equal((await client.request('GET', '/api/auth/status')).json().initialized, true);
  assert.equal((await client.request('POST', '/api/logout')).statusCode, 200);
  await authenticate(app, client, authenticator);
  assert.equal((await client.request('GET', '/api/session')).json().authenticated, true);
});

test('通行密钥：无效代理允许列表会阻止启动', { timeout: 10000 }, async t => {
  const app = await fixture(t);
  assert.throws(() => loadConfig({ ...app.appConfig, trustProxy: true, trustedProxyCidrs: [] }), /TRUSTED_PROXY_CIDRS/);
  await assert.rejects(buildApp({ ...app.appConfig, trustProxy: true, trustedProxyCidrs: ['not-a-proxy-address'] }), /invalid IP address/);
});

test('通行密钥：一次性初始化支持 Bitwarden 可发现凭据和用户验证', { timeout: 10000 }, async t => {
  const app = await fixture(t);
  const client = createClient(app), authenticator = createAuthenticator();
  const issued = issueEnrollment(app.db, { origin: client.origin() });
  const redeemed = await client.request('POST', '/api/auth/enroll', { token: issued.token });
  assert.equal(redeemed.statusCode, 200);
  assert.match(redeemed.headers['set-cookie'], /HttpOnly/);
  const creation = await options(client, true);
  assert.deepEqual(creation.authenticatorSelection, { residentKey: 'required', userVerification: 'required', requireResidentKey: true });
  assert.equal(creation.attestation, 'none');
  assert.equal(creation.rp.id, 'localhost');
  const replayHeaders = client.headers();
  const response = authenticator.registration(creation, client.origin());
  const registered = await client.request('POST', '/api/auth/register/verify', { response });
  assert.equal(registered.statusCode, 200, registered.body);
  const cookies = [registered.headers['set-cookie']].flat().join(';');
  assert.match(cookies, /HttpOnly/);
  assert.match(cookies, /SameSite=Strict/);
  assert.equal(registered.json().authenticated, true);
  assert.equal((await client.request('GET', '/api/auth/status')).json().enrollment, null);
  assert.equal((await client.request('POST', '/api/auth/enroll', { token: issued.token })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/register/verify', payload: { response }, headers: replayHeaders })).statusCode, 401);
  const stored = app.db.prepare('SELECT * FROM passkeys').get();
  assert.equal(stored.backed_up, 1);
  assert.ok(stored.public_key.length > 32);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM passkey_enrollments').get().n, 0);
});

test('通行密钥：过期或被重新签发的初始化链接不能绑定', { timeout: 10000 }, async t => {
  const app = await fixture(t), client = createClient(app);
  const first = issueEnrollment(app.db, { origin: client.origin() });
  const second = issueEnrollment(app.db, { origin: client.origin() });
  assert.equal((await client.request('POST', '/api/auth/enroll', { token: first.token })).statusCode, 403);
  app.db.prepare('UPDATE passkey_enrollments SET expires_at=?').run(Date.now() - 1);
  assert.equal((await client.request('POST', '/api/auth/enroll', { token: second.token })).statusCode, 403);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM passkeys').get().n, 0);
});

test('通行密钥：注册拒绝错误来源、RP、挑战、缺少用户验证和跨框架响应', { timeout: 10000 }, async t => {
  const app = await fixture(t), client = createClient(app);
  const grant = issueEnrollment(app.db, { origin: client.origin() });
  await client.request('POST', '/api/auth/enroll', { token: grant.token });
  for (const changes of [{ client: { origin: 'https://evil.example' } }, { rpId: 'evil.example' }, { client: { challenge: 'wrong' } }, { flags: 0x59 }, { client: { crossOrigin: true } }]) {
    const creation = await options(client, true);
    const response = createAuthenticator().registration(creation, client.origin(), changes);
    const result = await client.request('POST', '/api/auth/register/verify', { response });
    assert.ok([400, 403].includes(result.statusCode), result.body);
  }
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM passkeys').get().n, 0);
  assert.equal((await client.request('GET', '/api/auth/status')).json().enrollment.mode, 'setup');
});

test('通行密钥：重复或跨浏览器使用挑战只允许一个成功', { timeout: 10000 }, async t => {
  const app = await fixture(t), client = createClient(app);
  const grant = issueEnrollment(app.db, { origin: client.origin() });
  await client.request('POST', '/api/auth/enroll', { token: grant.token });
  const creation = await options(client, true);
  const response = createAuthenticator().registration(creation, client.origin());
  assert.equal((await createClient(app).request('POST', '/api/auth/register/verify', { response })).statusCode, 401);
  const headers = client.headers();
  const attempts = await Promise.all([0, 1].map(() => app.inject({ method: 'POST', url: '/api/auth/register/verify', payload: { response }, headers })));
  assert.deepEqual(attempts.map(result => result.statusCode).sort(), [200, 401]);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM passkeys').get().n, 1);
});

test('通行密钥：真实签名登录允许同步凭据的零计数并轮换当前会话', { timeout: 10000 }, async t => {
  const app = await fixture(t), { authenticator, client } = await bootstrapAdmin(app);
  const prior = client.headers();
  await authenticate(app, client, authenticator);
  assert.equal((await app.inject({ url: '/api/session', headers: prior })).json().authenticated, false);
  await authenticate(app, client, authenticator);
  const listing = (await client.request('GET', '/api/admin/passkeys')).json();
  assert.equal(listing.passkeys[0].current, true);
  assert.equal(listing.passkeys[0].backedUp, true);
  assert.deepEqual(Object.keys(listing.passkeys[0]).sort(), ['backedUp', 'createdAt', 'current', 'id', 'label', 'lastUsedAt']);
  assert.equal(app.db.prepare('SELECT counter FROM passkeys').get().counter, 0);
  assert.equal((await client.request('POST', '/api/logout')).statusCode, 200);
  assert.equal((await client.request('GET', '/api/admin/passkeys')).statusCode, 401);
});

test('通行密钥：拒绝坏签名、错误 userHandle、RP、来源、挑战和缺少 UV', { timeout: 10000 }, async t => {
  const app = await fixture(t), { authenticator } = await bootstrapAdmin(app);
  const client = createClient(app);
  for (const changes of [{ userHandle: 'wrong' }, { rpId: 'evil.example' }, { client: { origin: 'https://evil.example' } }, { client: { challenge: 'wrong' } }, { flags: 0x19 }, { flags: 0x05 }, { client: { crossOrigin: true } }, { badSignature: true }]) {
    const request = await options(client);
    const response = authenticator.assertion(request, client.origin(), changes);
    if (changes.badSignature) response.response.signature = randomBytes(70).toString('base64url');
    const result = await client.request('POST', '/api/auth/login/verify', { response });
    assert.ok([401, 403].includes(result.statusCode), result.body);
    assert.equal((await client.request('GET', '/api/session')).json().authenticated, false);
  }
});

test('通行密钥：认证响应不能重放，超时挑战需要重试', { timeout: 10000 }, async t => {
  const app = await fixture(t), { authenticator } = await bootstrapAdmin(app);
  const client = createClient(app);
  const request = await options(client), headers = client.headers();
  const response = authenticator.assertion(request, client.origin());
  assert.equal((await client.request('POST', '/api/auth/login/verify', { response })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login/verify', payload: { response }, headers })).statusCode, 401);
  const expiredOptions = await options(client);
  app.db.prepare('UPDATE webauthn_challenges SET expires_at=?').run(Date.now() - 1);
  assert.equal((await client.request('POST', '/api/auth/login/verify', { response: authenticator.assertion(expiredOptions, client.origin()) })).statusCode, 401);
});

test('通行密钥：非零计数不能回退，重复计数不能再次登录', { timeout: 10000 }, async t => {
  const app = await fixture(t), client = createClient(app), authenticator = createAuthenticator({ zeroCounter: false, backedUp: false });
  await registerAuthenticator(app, client, authenticator);
  await authenticate(app, client, authenticator);
  const request = await options(client);
  assert.equal((await client.request('POST', '/api/auth/login/verify', { response: authenticator.assertion(request, client.origin(), { counter: 1 }) })).statusCode, 401);
});

test('通行密钥：增删改要求 CSRF 和近期验证，最后一把不能删除', { timeout: 10000 }, async t => {
  const app = await fixture(t), { client, authenticator } = await bootstrapAdmin(app);
  const primary = (await client.request('GET', '/api/admin/passkeys')).json().passkeys[0];
  assert.equal((await client.request('DELETE', `/api/admin/passkeys/${primary.id}`)).statusCode, 409);
  assert.equal((await client.request('PATCH', `/api/admin/passkeys/${primary.id}`, { label: '新名称' }, { 'x-csrf-token': '' })).statusCode, 403);
  app.db.prepare('UPDATE sessions SET verified_at=0').run();
  for (const [method, url, payload] of [['PATCH', `/api/admin/passkeys/${primary.id}`, { label: '新名称' }], ['DELETE', `/api/admin/passkeys/${primary.id}`], ['POST', '/api/auth/register/options', { label: '备用' }]]) {
    const result = await client.request(method, url, payload);
    assert.equal(result.statusCode, 403);
    assert.equal(result.json().error.code, 'REAUTH_REQUIRED');
  }
  const before = client.cookies.get('rd_session');
  await authenticate(app, client, authenticator, { reauthenticate: true });
  assert.equal(client.cookies.get('rd_session'), before);
  const renamed = await client.request('PATCH', `/api/admin/passkeys/${primary.id}`, { label: 'Bitwarden 工作电脑' });
  assert.equal(renamed.json().passkey.label, 'Bitwarden 工作电脑');
  await registerAuthenticator(app, client, createAuthenticator(), { grant: false, label: '备用设备' });
  assert.equal((await client.request('GET', '/api/admin/passkeys')).json().passkeys.length, 2);
});

test('通行密钥：删除当前凭据撤销它的所有会话，备用凭据仍能登录', { timeout: 10000 }, async t => {
  const app = await fixture(t), { client, authenticator } = await bootstrapAdmin(app);
  const firstClient = createClient(app);
  await authenticate(app, firstClient, authenticator);
  const second = createAuthenticator();
  await registerAuthenticator(app, client, second, { grant: false });
  await authenticate(app, client, authenticator);
  const first = (await client.request('GET', '/api/admin/passkeys')).json().passkeys.find(item => item.current);
  const removed = await client.request('DELETE', `/api/admin/passkeys/${first.id}`);
  assert.deepEqual(removed.json(), { ok: true, sessionRevoked: true });
  assert.equal((await firstClient.request('GET', '/api/session')).json().authenticated, false);
  assert.equal((await client.request('GET', '/api/session')).json().authenticated, false);
  const request = await options(client);
  assert.equal((await client.request('POST', '/api/auth/login/verify', { response: authenticator.assertion(request, client.origin()) })).statusCode, 401);
  await authenticate(app, client, second);
});

test('通行密钥：恢复完成前保留现有登录，完成后原子撤销旧凭据和挑战', { timeout: 10000 }, async t => {
  const app = await fixture(t), { client, authenticator } = await bootstrapAdmin(app);
  const project = await client.request('POST', '/api/admin/projects', { name: '恢复时保留的项目', slug: 'preserved-project' });
  assert.equal(project.statusCode, 201);
  const recovery = createClient(app), next = createAuthenticator();
  const grant = issueEnrollment(app.db, { origin: recovery.origin(), mode: 'recovery' });
  assert.equal((await client.request('GET', '/api/session')).json().authenticated, true);
  const pendingLogin = createClient(app), pendingOptions = await options(pendingLogin), pendingHeaders = pendingLogin.headers();
  const pendingResponse = authenticator.assertion(pendingOptions, pendingLogin.origin());
  await recovery.request('POST', '/api/auth/enroll', { token: grant.token });
  const badOptions = await options(recovery, true);
  assert.equal((await recovery.request('POST', '/api/auth/register/verify', { response: next.registration(badOptions, recovery.origin(), { flags: 0x59 }) })).statusCode, 400);
  assert.equal((await client.request('GET', '/api/session')).json().authenticated, true);
  const creation = await options(recovery, true);
  assert.equal((await recovery.request('POST', '/api/auth/register/verify', { response: next.registration(creation, recovery.origin()) })).statusCode, 200);
  assert.equal((await client.request('GET', '/api/session')).json().authenticated, false);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login/verify', payload: { response: pendingResponse }, headers: pendingHeaders })).statusCode, 401);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM passkeys').get().n, 1);
  assert.equal((await recovery.request('GET', '/api/admin/projects')).json().projects[0].id, project.json().project.id);
  assert.equal((await recovery.request('POST', '/api/auth/enroll', { token: grant.token })).statusCode, 403);
});

test('通行密钥：旧数据库迁移保留业务数据并撤销文本密钥会话', { timeout: 10000 }, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'releasedock-passkeys-legacy-'));
  t.after(async () => {
    assert.ok(path.resolve(dataDir).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(dataDir).startsWith('releasedock-passkeys-legacy-'));
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const legacy = new DatabaseSync(path.join(dataDir, 'releasedock.sqlite'));
  const oldToken = randomBytes(32).toString('hex');
  legacy.exec("CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,csrf_token TEXT NOT NULL,expires_at INTEGER NOT NULL); CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL); PRAGMA user_version=1;");
  legacy.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(oldToken), 'old-csrf', Date.now() + 3600000);
  legacy.prepare('INSERT INTO settings VALUES(?,?)').run('name', '原有发布站点');
  legacy.prepare('INSERT INTO settings VALUES(?,?)').run('_key_fingerprint', 'old-fingerprint');
  legacy.close();
  const app = await buildApp({ dataDir, logger: false, publicUrl: '', cookieSecure: false });
  try {
    assert.equal((await app.inject({ url: '/api/session', headers: { cookie: `rd_session=${oldToken}` } })).json().authenticated, false);
    assert.equal((await app.inject('/api/site')).json().site.name, '原有发布站点');
    assert.equal(app.db.prepare('PRAGMA user_version').get().user_version, 2);
    assert.equal(app.db.prepare("SELECT 1 FROM settings WHERE key='_key_fingerprint'").get(), undefined);
  } finally { await app.close(); }
});
