import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildApp } from '../server/app.js';
import { bootstrapAdmin } from './helpers/passkeys.mjs';

test('公开版本地址保持准确，并与公开接口遵守同一可见性规则', { timeout: 55000 }, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'releasedock-routes-'));
  const app = await buildApp({ dataDir, logger: false });
  t.after(async () => {
    await app.close();
    const target = path.resolve(dataDir);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('releasedock-routes-'));
    await fs.rm(target, { recursive: true, force: true });
  });
  const { headers } = await bootstrapAdmin(app);
  const call = async (method, url, payload, extra = {}) => {
    const result = await app.inject({ method, url, payload, headers: { ...headers, ...extra } });
    assert.ok(result.statusCode >= 200 && result.statusCode < 300, result.body);
    return result.json();
  };
  const { project } = await call('POST', '/api/admin/projects', { name: '路由测试', slug: 'route-test', isPublic: true });
  const createRelease = async (version, publish = true) => {
    const { release } = await call('POST', '/api/admin/releases', { projectId: project.id, version, title: version, notes: '这是一条独立版本记录。', channel: 'stable' });
    const payload = Buffer.from('--routes-boundary\r\nContent-Disposition: form-data; name="file"; filename="package.txt"\r\n\r\nroute-test-package\r\n--routes-boundary--\r\n');
    await call('POST', `/api/admin/releases/${release.id}/assets?platform=Web&arch=universal`, payload, { 'content-type': 'multipart/form-data; boundary=routes-boundary' });
    if (publish) await call('POST', `/api/admin/releases/${release.id}/publish`, { setLatest: false });
    return release;
  };
  const numeric = await createRelease('1.5.1');
  let prefixed;

  await t.test('直接访问项目和版本路径返回可启动页面，API 按实际版本解析', async () => {
    const page = await app.inject('/route-test/1.5.1');
    assert.equal(page.statusCode, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.match(page.body, /src="\/assets\/app.js"/);
    assert.equal((await app.inject('/api/projects/route-test/releases/1.5.1')).json().release.id, numeric.id);
  });
  await t.test('不存在的带 v 版本不会回退到另一数字版本', async () => {
    assert.equal((await app.inject('/route-test/v1.5.1')).statusCode, 404);
    assert.equal((await app.inject('/api/projects/route-test/releases/v1.5.1')).statusCode, 404);
  });
  await t.test('数字版本和带 v 版本共存时，两个路径精确指向不同记录', async () => {
    prefixed = await createRelease('v1.5.1');
    assert.equal((await app.inject('/api/projects/route-test/releases/1.5.1')).json().release.id, numeric.id);
    assert.equal((await app.inject('/api/projects/route-test/releases/v1.5.1')).json().release.id, prefixed.id);
  });
  await t.test('版本下架后路径返回 404，不能回退到另一数字版本', async () => {
    await call('POST', `/api/admin/releases/${prefixed.id}/withdraw`);
    assert.equal((await app.inject('/route-test/v1.5.1')).statusCode, 404);
    assert.equal((await app.inject('/api/projects/route-test/releases/v1.5.1')).statusCode, 404);
    assert.equal((await app.inject('/route-test/1.5.1')).statusCode, 200);
  });
  await t.test('草稿、隐藏项目和不存在版本不能通过新路径读取', async () => {
    await createRelease('2.0.0');
    await createRelease('v2.0.0', false);
    assert.equal((await app.inject('/route-test/v2.0.0')).statusCode, 404);
    assert.equal((await app.inject('/api/projects/route-test/releases/v2.0.0')).statusCode, 404);
    assert.equal((await app.inject('/route-test/missing')).statusCode, 404);
    await call('PATCH', `/api/admin/projects/${project.id}`, { isPublic: false });
    assert.equal((await app.inject('/route-test/1.5.1')).statusCode, 404);
    assert.equal((await app.inject('/api/projects/route-test/releases/1.5.1')).statusCode, 404);
    await call('PATCH', `/api/admin/projects/${project.id}`, { isPublic: true });
  });
  await t.test('版本号修改后使用新路径，旧路径不会指向最新版本', async () => {
    await call('PATCH', `/api/admin/releases/${numeric.id}`, { version: '1.5.1.1+build.7' });
    assert.equal((await app.inject('/route-test/1.5.1')).statusCode, 404);
    assert.equal((await app.inject('/api/projects/route-test/releases/1.5.1')).statusCode, 404);
    assert.equal((await app.inject('/route-test/1.5.1.1%2Bbuild.7')).statusCode, 200);
    assert.equal((await app.inject('/api/projects/route-test/releases/1.5.1.1%2Bbuild.7')).json().release.id, numeric.id);
  });
  await t.test('旧查询链接仍提供页面，未知 API 和静态资源保持 404', async () => {
    for (const address of ['/', '/?page=project-edit&id=legacy-id', `/?page=project&slug=route-test&release=${numeric.id}`]) {
      assert.equal((await app.inject(address)).statusCode, 200);
    }
    for (const address of ['/api/missing', '/assets/missing.js']) {
      const response = await app.inject(address);
      assert.equal(response.statusCode, 404);
      assert.match(response.headers['content-type'], /application\/json/);
    }
  });
});
