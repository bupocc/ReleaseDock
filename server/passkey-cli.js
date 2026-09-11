import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { authOrigin, issueEnrollment } from './passkey-policy.js';

const mode = process.argv[2];
if (!['setup', 'recovery'].includes(mode) || process.argv.length !== 3) {
  console.error('用法：node server/passkey-cli.js setup|recovery');
  process.exitCode = 1;
} else {
  let db;
  try {
    const config = loadConfig();
    db = openDatabase(config.dataDir);
    const grant = issueEnrollment(db, { origin: authOrigin(config), mode });
    const filename = path.join(config.dataDir, `passkey-${mode}-link.txt`);
    fs.writeFileSync(filename, `${grant.url}\n`, { mode: 0o600 });
    console.log(`一次性${mode === 'setup' ? '初始化' : '恢复'}链接已保存：${filename}`);
    console.log(`有效期至 ${new Date(grant.expiresAt).toISOString()}，成功绑定后立即失效。请在本机打开此文件，不要公开链接。`);
    if (mode === 'recovery') console.log('完成新通行密钥验证后，系统才会撤销全部旧通行密钥和会话。');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally { db?.close(); }
}
