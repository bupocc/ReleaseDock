import fs from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';

export function loadConfig(overrides = {}) {
  if (fs.existsSync('.env')) process.loadEnvFile('.env');
  const dataDir = path.resolve(process.env.DATA_DIR || '.data');
  const config = {
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 8080),
    dataDir,
    cookieSecure: process.env.COOKIE_SECURE === 'true' || (!process.env.COOKIE_SECURE && process.env.NODE_ENV === 'production'),
    publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
    trustProxy: process.env.TRUST_PROXY === '1',
    trustedProxyCidrs: (process.env.TRUSTED_PROXY_CIDRS ?? 'loopback,uniquelocal').split(',').map(value => value.trim()).filter(Boolean),
    maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 2048) * 1024 * 1024,
    sessionHours: Number(process.env.SESSION_HOURS || 12),
    loginRateLimit: 10,
    logger: true,
    ...overrides,
  };
  config.dataDir = path.resolve(config.dataDir);
  if (config.trustProxy && (!Array.isArray(config.trustedProxyCidrs) || !config.trustedProxyCidrs.length)) {
    throw new Error('启用 TRUST_PROXY 时，TRUSTED_PROXY_CIDRS 必须包含可信代理的 IP、CIDR 或地址范围名称');
  }
  for (const key of ['port','maxUploadBytes','sessionHours']) {
    if (!Number.isFinite(config[key]) || config[key] <= 0) throw new Error(`${key} 必须为正数`);
  }
  if (config.sessionHours > 168) throw new Error('SESSION_HOURS 不能超过 168 小时');
  if (config.publicUrl) {
    let address;
    try { address = new URL(config.publicUrl); } catch { throw new Error('PUBLIC_URL 必须是完整的 HTTPS 源地址'); }
    if (address.origin !== config.publicUrl || address.username || address.password || isIP(address.hostname.replace(/^\[|\]$/g, ''))) {
      throw new Error('PUBLIC_URL 必须是域名源地址，不能包含路径、参数、账号或 IP 地址');
    }
    if (address.protocol !== 'https:' && !(address.protocol === 'http:' && address.hostname === 'localhost')) {
      throw new Error('通行密钥要求 HTTPS；仅 localhost 可使用 HTTP');
    }
    if (address.protocol === 'https:') config.cookieSecure = true;
  }
  // 历史 ADMIN_KEY 环境变量与密钥文件不再参与认证，也不再生成文本密钥。
  delete config.adminKey;
  delete config.adminKeyFile;
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  return config;
}
