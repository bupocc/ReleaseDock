import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export function loadConfig(overrides = {}) {
  if (fs.existsSync('.env')) process.loadEnvFile('.env');
  const dataDir = path.resolve(process.env.DATA_DIR || '.data');
  const config = {
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 8080),
    dataDir,
    adminKey: process.env.ADMIN_KEY || '',
    adminKeyFile: process.env.ADMIN_KEY_FILE || '',
    cookieSecure: process.env.COOKIE_SECURE === 'true' || (!process.env.COOKIE_SECURE && process.env.NODE_ENV === 'production'),
    publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
    trustProxy: process.env.TRUST_PROXY === '1',
    maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 2048) * 1024 * 1024,
    sessionHours: Number(process.env.SESSION_HOURS || 12),
    loginRateLimit: 5,
    logger: true,
    ...overrides,
  };
  config.dataDir = path.resolve(config.dataDir);
  for (const key of ['port','maxUploadBytes','sessionHours']) {
    if (!Number.isFinite(config[key]) || config[key] <= 0) throw new Error(`${key} 必须为正数`);
  }
  if (config.sessionHours > 168) throw new Error('SESSION_HOURS 不能超过 168 小时');
  if (config.publicUrl && !/^https?:\/\/[^/]+$/.test(config.publicUrl)) throw new Error('PUBLIC_URL 必须是完整的 HTTP/HTTPS 源地址，不能包含路径');
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  if (config.adminKeyFile) config.adminKey = fs.readFileSync(config.adminKeyFile, 'utf8').trim();
  if (!config.adminKey) {
    // 首次启动生成的密钥仅保存在持久目录，不写日志，也不返回浏览器。
    config.adminKeyFile = path.join(config.dataDir, 'admin-key');
    try { fs.writeFileSync(config.adminKeyFile, randomBytes(36).toString('base64url'), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    config.adminKey = fs.readFileSync(config.adminKeyFile, 'utf8').trim();
  }
  if (config.adminKey.length < 32 || config.adminKey.length > 512) throw new Error('管理员密钥长度必须为 32–512 个字符，请使用随机生成的密钥');
  return config;
}
