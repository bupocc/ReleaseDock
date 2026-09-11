import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { authOrigin, issueEnrollment } from '../../server/passkey-policy.js';

const hash = value => createHash('sha256').update(value).digest();
const encode = value => Buffer.from(value).toString('base64url');

// 测试认证器持有独立 P-256 私钥，服务端仍执行真实 CBOR、来源和签名验证。
export function createAuthenticator({ backedUp = true, zeroCounter = true } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const publicBytes = isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]]));
  const idBytes = randomBytes(32);
  let userHandle;
  let counter = 0;
  function authenticatorData(rpId, flags, count) {
    const number = Buffer.alloc(4);
    number.writeUInt32BE(count);
    return Buffer.concat([hash(rpId), Buffer.from([flags]), number]);
  }
  return {
    id: encode(idBytes),
    privateKey,
    get userHandle() { return userHandle; },
    registration(options, origin, changes = {}) {
      userHandle = options.user.id;
      const client = { type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false, ...changes.client };
      const flags = changes.flags ?? (0x45 | (backedUp ? 0x18 : 0));
      const length = Buffer.alloc(2);
      length.writeUInt16BE(idBytes.length);
      const authData = Buffer.concat([authenticatorData(changes.rpId || options.rp.id, flags, 0), Buffer.alloc(16), length, idBytes, Buffer.from(publicBytes)]);
      const attestation = isoCBOR.encode(new Map([['fmt', 'none'], ['authData', new Uint8Array(authData)], ['attStmt', new Map()]]));
      return { id: encode(idBytes), rawId: encode(idBytes), type: 'public-key', clientExtensionResults: { credProps: { rk: true } }, response: { clientDataJSON: encode(JSON.stringify(client)), attestationObject: encode(attestation), transports: ['internal'] } };
    },
    assertion(options, origin, changes = {}) {
      if (!zeroCounter) counter++;
      const client = { type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false, ...changes.client };
      const clientBytes = Buffer.from(JSON.stringify(client));
      const authData = authenticatorData(changes.rpId || options.rpId, changes.flags ?? (0x05 | (backedUp ? 0x18 : 0)), changes.counter ?? counter);
      const signature = sign('sha256', Buffer.concat([authData, hash(clientBytes)]), privateKey);
      return { id: encode(idBytes), rawId: encode(idBytes), type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: encode(clientBytes), authenticatorData: encode(authData), signature: encode(signature), userHandle: changes.userHandle ?? userHandle } };
    },
  };
}

export function createClient(app) {
  const cookies = new Map();
  let csrfToken = '';
  const origin = () => authOrigin(app.appConfig, app.server.address()?.port);
  const headers = () => ({ origin: origin(), host: new URL(origin()).host, cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '), ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) });
  return {
    cookies, origin, headers,
    async request(method, url, payload, extra = {}) {
      const response = await app.inject({ method, url, payload, headers: { ...headers(), ...extra } });
      for (const cookie of [response.headers['set-cookie'] || []].flat()) {
        const pair = cookie.split(';')[0];
        const separator = pair.indexOf('=');
        const name = pair.slice(0, separator), value = pair.slice(separator + 1);
        if (!value || /Max-Age=0/i.test(cookie)) cookies.delete(name); else cookies.set(name, value);
      }
      let json;
      try { json = response.json(); } catch { /* 非 JSON 响应不更新认证状态。 */ }
      if (json?.csrfToken) csrfToken = json.csrfToken;
      if (url === '/api/logout' && response.statusCode === 200) csrfToken = '';
      return response;
    },
  };
}

export async function registerAuthenticator(app, client, authenticator = createAuthenticator(), { mode = 'setup', label = '测试通行密钥', grant = true } = {}) {
  if (grant) {
    const issued = issueEnrollment(app.db, { origin: client.origin(), mode });
    const redeemed = await client.request('POST', '/api/auth/enroll', { token: issued.token });
    assert.equal(redeemed.statusCode, 200, redeemed.body);
  }
  const options = await client.request('POST', '/api/auth/register/options', { label });
  assert.equal(options.statusCode, 200, options.body);
  const response = await client.request('POST', '/api/auth/register/verify', { response: authenticator.registration(options.json().options, client.origin()) });
  assert.equal(response.statusCode, 200, response.body);
  return { authenticator, response };
}

export async function authenticate(app, client, authenticator, { reauthenticate = false } = {}) {
  const options = await client.request('POST', '/api/auth/login/options', { reauthenticate });
  assert.equal(options.statusCode, 200, options.body);
  const response = await client.request('POST', '/api/auth/login/verify', { response: authenticator.assertion(options.json().options, client.origin()) });
  assert.equal(response.statusCode, 200, response.body);
  return response;
}

export async function bootstrapAdmin(app, { authenticator = createAuthenticator() } = {}) {
  const client = createClient(app);
  const { response } = await registerAuthenticator(app, client, authenticator);
  return { client, authenticator, response, headers: client.headers() };
}
