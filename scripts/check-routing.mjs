import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildApp } from '../server/app.js';
import { bootstrapAdmin, createAuthenticator } from '../tests/helpers/passkeys.mjs';
import { addVirtualAuthenticator } from './browser-passkeys.mjs';

const require = createRequire(import.meta.url);
const modules = process.env.DESIGN_NODE_MODULES || 'C:/Users/ASUS/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(require.resolve('playwright', { paths: [modules] }));
const output = path.resolve('test-results');
await fs.mkdir(output, { recursive: true });
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'releasedock-navigation-'));
const app = await buildApp({ dataDir, logger: false, loginRateLimit: 100 });
const base = (await app.listen({ host: '127.0.0.1', port: 0 })).replace('127.0.0.1', 'localhost');
const browser = await chromium.launch({ headless: true, executablePath: process.env.DESIGN_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const deadline = setTimeout(() => browser.close(), 55000);
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
context.setDefaultTimeout(10000);
const page = await context.newPage();
const errors = [];
context.on('page', target => target.on('pageerror', error => errors.push(error.message)));
page.on('pageerror', error => errors.push(error.message));
const checks = [];
const checkpoint = message => { checks.push(message); console.log(`通过：${message}`); };
let headers;
async function call(method, url, payload, extra = {}) {
  const result = await app.inject({ method, url, payload, headers: { ...headers, ...extra } });
  assert.ok(result.statusCode >= 200 && result.statusCode < 300, result.body);
  return result.json();
}
async function ready(target, name, params = {}) {
  await target.waitForFunction(({ name, params }) => {
    const route = history.state?.releaseDockRoute;
    return document.documentElement.dataset.ready === 'true' && route?.page === name && Object.entries(params).every(([key, value]) => String(route.params[key]) === String(value));
  }, { name, params });
  assert.equal(await target.locator('.error-page').count(), 0, await target.locator('body').innerText());
  if (name !== 'project') assert.equal(target.url(), `${base}/`);
}
async function visit(address, name, params = {}, target = page) {
  await target.goto(new URL(address, `${base}/`).href, { waitUntil: 'domcontentloaded' });
  await ready(target, name, params);
}
async function release(project, version, title) {
  const { release } = await call('POST', '/api/admin/releases', { projectId: project.id, version, title, channel: 'stable', notes: '## 更新说明\n> 指定版本的说明。\n\n' + '- 改进功能与下载体验。\n'.repeat(8) });
  const payload = Buffer.from('--navigation-boundary\r\nContent-Disposition: form-data; name="file"; filename="fixture.apk"\r\n\r\nnavigation-package\r\n--navigation-boundary--\r\n');
  await call('POST', `/api/admin/releases/${release.id}/assets?platform=Android&arch=universal`, payload, { 'content-type': 'multipart/form-data; boundary=navigation-boundary' });
  await call('POST', `/api/admin/releases/${release.id}/publish`, { setLatest: false });
  return release;
}
try {
  const session = await bootstrapAdmin(app, { authenticator: createAuthenticator({ backedUp: false }) });
  headers = session.headers;
  await addVirtualAuthenticator(context, page, session.authenticator);
  const { project } = await call('POST', '/api/admin/projects', { name: 'DeskBox 路由验收', slug: 'deskbox', subtitle: '刷新和历史导航验收', platforms: ['Windows', 'Android', 'iOS', 'HarmonyOS', 'Web', 'FreeBSD'], isPublic: true });
  const numeric = await release(project, '1.5.1', '数字版本内容');
  const prefixed = await release(project, 'v1.5.1', '带 v 版本内容');

  await visit('/?page=catalog#projects', 'catalog');
  assert.equal(await page.locator('#project-search').count(), 1);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page, 'catalog');
  await page.locator('.brand').first().click();
  await ready(page, 'home');
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await ready(page, 'catalog');
  await page.goForward({ waitUntil: 'domcontentloaded' });
  await ready(page, 'home');
  const fresh = await context.newPage();
  await visit('/', 'home', {}, fresh);
  await fresh.close();
  checkpoint('普通页面收起参数与锚点，刷新、后退、前进恢复正确页面，新标签根地址仍为首页');

  await visit(`/?page=project-edit&id=${project.id}`, 'login');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page, 'login');
  await page.locator('#passkey-login').click();
  await ready(page, 'project-edit', { id: project.id });
  assert.equal(await page.locator('#af-project-name').inputValue(), project.name);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page, 'project-edit', { id: project.id });
  assert.equal(await page.locator('input[name="platforms"][value="FreeBSD"]').isChecked(), true);
  checkpoint('管理页登录前后地址均为根路径，刷新登录页仍可回到原项目编辑页，自定义平台保持选中');

  await page.locator('#af-project-summary').fill('取消离开后仍保留的内容');
  const beforeLeave = page.waitForEvent('dialog');
  const leaving = page.getByRole('link', { name: '返回项目列表', exact: true }).click({ noWaitAfter: true });
  const leaveDialog = await beforeLeave;
  assert.equal(leaveDialog.type(), 'beforeunload');
  await leaveDialog.dismiss();
  await leaving;
  assert.equal(page.url(), `${base}/`);
  assert.equal(await page.locator('#af-project-summary').inputValue(), '取消离开后仍保留的内容');
  assert.equal(await page.evaluate(() => history.state.releaseDockRoute.page), 'project-edit');
  const projectSaved = page.waitForResponse(response => response.url().endsWith(`/api/admin/projects/${project.id}`) && response.request().method() === 'PATCH');
  await page.locator('#af-save-project').click();
  assert.equal((await projectSaved).status(), 200);
  await page.waitForFunction(() => document.querySelector('#af-project-form').getAttribute('aria-busy') === 'false');
  await ready(page, 'project-edit', { id: project.id });
  assert.ok((await call('GET', `/api/admin/projects/${project.id}`)).project.platforms.includes('FreeBSD'));
  await page.getByRole('link', { name: '返回项目列表', exact: true }).click();
  await ready(page, 'projects');
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await ready(page, 'project-edit', { id: project.id });
  assert.equal(await page.locator('#af-project-summary').inputValue(), '取消离开后仍保留的内容');
  checkpoint('未保存时取消离开不会改变页面或历史状态，保存后前后导航和自定义平台继续正确');

  const child = await context.newPage();
  await visit(`/?page=publish&id=${prefixed.id}`, 'publish', { id: prefixed.id }, child);
  assert.equal(await child.locator('#af-release-version').inputValue(), prefixed.version);
  await child.reload({ waitUntil: 'domcontentloaded' });
  await ready(child, 'publish', { id: prefixed.id });
  await child.close();
  checkpoint('旧管理链接在新标签打开后隐藏参数，刷新仍定位到指定版本');

  await visit(`/deskbox/${prefixed.version}`, 'project', { version: prefixed.version });
  assert.equal(await page.locator('.release-notes h3').innerText(), prefixed.title);
  assert.equal(await page.getByRole('link', { name: '项目介绍', exact: true }).count(), 0);
  assert.equal(await page.locator('#about-project').count(), 1);
  await page.locator('.project-actions a').click();
  assert.equal(page.url(), `${base}/deskbox/${prefixed.version}`);
  assert.equal(await page.evaluate(() => history.state.releaseDockRoute.params.anchor), 'downloads');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page, 'project', { version: prefixed.version });
  assert.equal(await page.evaluate(() => history.state.releaseDockRoute.params.anchor), 'downloads');
  await page.locator(`.version-nav a[href="/deskbox/${numeric.version}"]`).click();
  await ready(page, 'project', { version: numeric.version });
  assert.equal(page.url(), `${base}/deskbox/${numeric.version}`);
  assert.equal(await page.locator('.release-notes h3').innerText(), numeric.title);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await ready(page, 'project', { version: prefixed.version });
  assert.equal(await page.locator('.release-notes h3').innerText(), prefixed.title);
  checkpoint('公开版本支持直达、刷新、历史版本切换和后退，带 v 与不带 v 的版本不混淆，页内滚动不添加参数');

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedReleaseAddress = value; } } });
  });
  await page.locator('#share-project').click();
  await page.waitForFunction(() => !!window.copiedReleaseAddress);
  const shared = await page.evaluate(() => window.copiedReleaseAddress);
  assert.equal(shared, `${base}/deskbox/${prefixed.version}`);
  const visitor = await browser.newContext();
  const sharedPage = await visitor.newPage();
  await visit(shared, 'project', { version: prefixed.version }, sharedPage);
  assert.equal(await sharedPage.locator('.release-notes h3').innerText(), prefixed.title);
  await visitor.close();
  await visit(`/?page=project&slug=deskbox&release=${prefixed.id}#downloads`, 'project', { version: prefixed.version });
  assert.equal(page.url(), shared);
  await page.locator('.header-nav').getByRole('link', { name: '全部项目', exact: true }).click();
  await ready(page, 'catalog');
  checkpoint('分享链接可在未登录的新浏览器直达准确版本，旧公开参数链接转换为项目和版本路径');

  await visit(`/?page=publish&id=${prefixed.id}`, 'publish', { id: prefixed.id });
  const browserSession = await (await context.request.get(`${base}/api/session`)).json();
  assert.equal((await context.request.post(`${base}/api/logout`, { headers: { 'X-CSRF-Token': browserSession.csrfToken } })).status(), 200);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page, 'login');
  await page.locator('#passkey-login').click();
  await ready(page, 'publish', { id: prefixed.id });
  assert.equal(await page.locator('#af-release-version').inputValue(), prefixed.version);
  checkpoint('会话失效后刷新管理页可重新登录，并返回隐藏参数前的同一版本编辑页');

  await call('PATCH', `/api/admin/releases/${prefixed.id}`, { version: 'v1.5.2' });
  await visit(`/?page=project&slug=deskbox&release=${prefixed.id}`, 'project', { version: 'v1.5.2' });
  assert.equal(page.url(), `${base}/deskbox/v1.5.2`);
  const missing = await page.goto(`${base}/deskbox/v1.5.1`, { waitUntil: 'domcontentloaded' });
  assert.equal(missing.status(), 404);
  await page.locator('.error-page').waitFor();
  assert.equal(await page.locator('.release-detail').count(), 0);
  await page.getByRole('link', { name: '返回项目', exact: true }).click();
  await ready(page, 'project', { version: numeric.version });
  checkpoint('编辑版本号后旧 ID 链接自动使用新路径，过期路径显示不可用并可返回项目，不误下载其他版本');

  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'routing-report.json'), JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'routing-failure.png'), fullPage: true }).catch(() => {});
  console.error('路由验收失败：', error.message);
  throw error;
} finally {
  clearTimeout(deadline);
  await browser.close();
  await app.close();
  const target = path.resolve(dataDir);
  assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('releasedock-navigation-'));
  await fs.rm(target, { recursive: true, force: true });
}
