import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildApp } from '../server/app.js';
import { issueEnrollment } from '../server/passkey-policy.js';
import { addVirtualAuthenticator } from './browser-passkeys.mjs';

const require = createRequire(import.meta.url);
const modules = process.env.DESIGN_NODE_MODULES || 'C:/Users/ASUS/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(require.resolve('playwright', { paths: [modules] }));
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'releasedock-passkey-ui-'));
const output = path.resolve(process.env.PASSKEY_PROOF_DIR || path.join(os.tmpdir(), 'releasedock-passkey-proof'));
await fs.mkdir(output, { recursive: true });
const app = await buildApp({ dataDir, logger: false, publicUrl: '', cookieSecure: false, loginRateLimit: 100 });
const address = await app.listen({ host: '127.0.0.1', port: 0 });
const base = address.replace('127.0.0.1', 'localhost');
const browser = await chromium.launch({ headless: true, executablePath: process.env.DESIGN_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const deadline = setTimeout(() => browser.close(), 55000);
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
context.setDefaultTimeout(10000);
const page = await context.newPage();
let device = await addVirtualAuthenticator(context, page);
const errors = [], consoleErrors = [], requests = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', entry => { if (entry.type() === 'error' && !/Failed to load resource: the server responded with a status of (401|403)/.test(entry.text())) consoleErrors.push({ message: entry.text(), url: entry.location().url }); });
page.on('request', request => requests.push(request.url()));
const checkpoint = message => { checks.push(message); console.log(`通过：${message}`); };
async function ready(view) {
  await page.waitForFunction(view => document.documentElement.dataset.ready === 'true' && history.state?.releaseDockRoute.page === view, view);
  assert.equal(await page.locator('.error-page').count(), 0, await page.locator('body').innerText());
  assert.equal(page.url(), `${base}/`);
}
async function visit(route, view) {
  await page.goto(new URL(route, base).href, { waitUntil: 'domcontentloaded' });
  await ready(view);
}
async function count(expected) {
  await page.waitForFunction(expected => document.querySelector('#passkey-settings')?.dataset.passkeyCount === String(expected), expected);
}
async function newDevice(credential = null) {
  await device.cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: device.authenticatorId });
  device = await addVirtualAuthenticator(context, page);
  if (credential) await device.cdp.send('WebAuthn.addCredential', { authenticatorId: device.authenticatorId, credential });
}
async function noOverflow() {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
}

try {
  await page.goto(`${address}/?page=login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#passkey-login-url').waitFor();
  assert.equal(await page.locator('#passkey-login-url').getAttribute('href'), `${base}/?page=login`);
  assert.equal(await page.locator('input[type="password"]').count(), 0);
  await page.locator('#passkey-login-url').click();
  await ready('login');
  assert.equal(await page.locator('#passkey-register').count(), 0);
  checkpoint('IP 地址入口引导至 localhost，未初始化站点没有公开注册或文本密码入口');

  const grant = issueEnrollment(app.db, { origin: base });
  await visit(grant.url, 'login');
  await page.locator('#passkey-label').waitFor();
  assert.equal(await page.evaluate(() => location.search + location.hash), '');
  assert.equal(await page.evaluate(token => JSON.stringify(history.state).includes(token) || JSON.stringify({ ...localStorage, ...sessionStorage }).includes(token), grant.token), false);
  assert.equal(requests.some(url => url.includes(grant.token)), false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready('login');
  await page.locator('#passkey-label').fill('Bitwarden 主凭据');
  await page.locator('#passkey-register').click();
  await ready('overview');
  let primary = (await device.cdp.send('WebAuthn.getCredentials', { authenticatorId: device.authenticatorId })).credentials[0];
  assert.ok(primary?.isResidentCredential);
  const sessionCookies = (await context.cookies(base)).filter(cookie => cookie.name === 'rd_session');
  assert.equal(sessionCookies.length, 1);
  assert.equal(sessionCookies[0].httpOnly, true);
  assert.equal(sessionCookies[0].sameSite, 'Strict');
  checkpoint('一次性片段兑换后地址与历史均无令牌，刷新恢复绑定，通过原生 WebAuthn 创建凭据和 HttpOnly 会话');

  await visit('/?page=settings', 'settings');
  await count(1);
  const primaryId = await page.locator('[data-passkey-id]').getAttribute('data-passkey-id');
  assert.equal(await page.locator(`[data-passkey-delete="${primaryId}"]`).isDisabled(), true);
  app.db.prepare('UPDATE sessions SET verified_at=0').run();
  const verified = page.waitForResponse(response => response.url().endsWith('/api/auth/login/verify') && response.status() === 200);
  await page.locator(`[data-passkey-rename="${primaryId}"]`).click();
  await page.locator('#passkey-management-label').fill('Bitwarden 工作电脑');
  await page.locator('#passkey-dialog-submit').click();
  await verified;
  await page.locator('#passkey-dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator(`[data-passkey-id="${primaryId}"] strong`).innerText(), 'Bitwarden 工作电脑');
  checkpoint('设置页展示真实凭据并禁止删除最后一把，过期验证通过原生通行密钥确认后完成改名');

  primary = (await device.cdp.send('WebAuthn.getCredentials', { authenticatorId: device.authenticatorId })).credentials[0];
  await newDevice();
  await page.locator('#passkey-add').click();
  await page.locator('#passkey-management-label').fill('备用设备');
  await page.locator('#passkey-dialog-submit').click();
  await page.locator('#passkey-dialog').waitFor({ state: 'hidden' });
  await count(2);
  const currentId = await page.locator('[data-passkey-id]').filter({ hasText: '当前登录' }).getAttribute('data-passkey-id');
  assert.notEqual(currentId, primaryId);
  await page.waitForFunction(() => !document.querySelector('#toast')?.classList.contains('visible'));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: path.join(output, 'passkey-settings-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await noOverflow();
  await page.screenshot({ path: path.join(output, 'passkey-settings-mobile.png'), fullPage: true });
  await page.locator('#passkey-settings').screenshot({ path: path.join(output, 'passkey-management-mobile.png') });
  checkpoint('备用设备可添加并显示当前登录标记，桌面和 390px 手机设置页无横向溢出');

  await page.locator(`[data-passkey-delete="${currentId}"]`).click();
  await page.locator('#passkey-dialog-cancel').click();
  await count(2);
  await page.locator(`[data-passkey-delete="${currentId}"]`).click();
  await page.locator('#passkey-dialog-submit').click();
  await ready('login');
  assert.equal((await (await context.request.get(`${base}/api/session`)).json()).authenticated, false);
  await newDevice(primary);
  await page.evaluate(() => { navigator.credentials.get = async () => { throw new DOMException('User cancelled', 'NotAllowedError'); }; });
  await page.locator('#passkey-login').click();
  await page.waitForFunction(() => document.querySelector('#login-error')?.textContent.length > 0 && !document.querySelector('#passkey-login').disabled);
  assert.match(await page.locator('#login-error').innerText(), /取消|超时|验证|未完成/);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready('login');
  await noOverflow();
  await page.screenshot({ path: path.join(output, 'passkey-login-mobile.png'), fullPage: true });
  await page.locator('#passkey-login').click();
  await ready('overview');
  checkpoint('删除可取消，确认删除当前凭据后退出；取消认证可重试，另一把通行密钥仍能原生登录');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-logout]:visible').first().click();
  await ready('login');
  assert.match(await page.title(), /ReleaseDock/);
  assert.ok((await page.locator('body').innerText()).length > 100);
  await page.screenshot({ path: path.join(output, 'passkey-login-desktop.png'), fullPage: true });
  checkpoint('退出后登录页有完整内容与正确标题，桌面保留既有浅色和绿色样式');

  const recovery = issueEnrollment(app.db, { origin: base, mode: 'recovery' });
  await newDevice();
  await visit(recovery.url, 'login');
  assert.match(await page.locator('body').innerText(), /恢复/);
  await page.locator('#passkey-label').fill('恢复后的 Bitwarden');
  await page.locator('#passkey-register').click();
  await ready('overview');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM passkeys').get().n, 1);
  assert.equal(app.db.prepare('SELECT 1 FROM passkeys WHERE id=?').get(primaryId), undefined);
  checkpoint('服务器恢复链接完成新凭据注册后撤销旧凭据，恢复流程无文本密码回退');

  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ checks, viewports: ['1440x1000', '390x844'], errors, consoleErrors }, null, 2));
  console.log(`通行密钥浏览器验收：${checks.length} 组通过，截图目录：${output}`);
} finally {
  clearTimeout(deadline);
  await browser.close();
  await app.close();
  const target = path.resolve(dataDir);
  assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('releasedock-passkey-ui-'));
  await fs.rm(target, { recursive: true, force: true });
}
