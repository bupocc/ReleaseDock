import { createHash, randomBytes } from 'node:crypto';
import { transaction, audit } from './db.js';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const ENROLLMENT_TTL_MS = 15 * 60 * 1000;

// 无正式域名时只信任本机 localhost；端口来自服务器监听配置，而不是请求头。
export function authOrigin(config, listeningPort) {
  return config.publicUrl || `http://localhost:${listeningPort || config.port}`;
}

export function issueEnrollment(db, { origin, mode = 'setup' }) {
  if (!['setup', 'recovery'].includes(mode)) throw new Error('只支持 setup 或 recovery');
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + ENROLLMENT_TTL_MS;
  transaction(db, () => {
    const initialized = !!db.prepare('SELECT 1 FROM passkeys LIMIT 1').get();
    if (mode === 'setup' && initialized) throw new Error('管理员已初始化，请在站点设置中添加凭据；全部丢失时使用 passkey:recover');
    if (mode === 'recovery' && !initialized) throw new Error('尚未初始化，请先使用 passkey:setup');
    // 签发新链接立即作废之前的链接，现有凭据在恢复成功之前仍可使用。
    db.prepare('DELETE FROM webauthn_challenges WHERE enrollment_hash IS NOT NULL').run();
    db.prepare('DELETE FROM passkey_enrollments').run();
    db.prepare('INSERT INTO passkey_enrollments(token_hash,mode,origin,expires_at) VALUES(?,?,?,?)').run(digest(token), mode, origin, expiresAt);
    audit(db, `passkey.${mode}.issued`);
  });
  return { token, expiresAt, mode, url: `${origin}/?page=login#enroll=${token}` };
}
