import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildApp } from '../server/app.js';

const require=createRequire(import.meta.url);
const modules=process.env.DESIGN_NODE_MODULES||'C:/Users/ASUS/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(require.resolve('playwright',{paths:[modules]}));
const output=path.resolve('test-results');
await fs.mkdir(output,{recursive:true});
const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'releasedock-ui-'));
const adminKey='browser-acceptance-only-key-2026-no-production';
const app=await buildApp({dataDir,adminKey,logger:false,loginRateLimit:100});
const base=await app.listen({host:'127.0.0.1',port:0});
const browser=await chromium.launch({headless:true,executablePath:process.env.DESIGN_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const deadline=setTimeout(()=>browser.close(),55000);
const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,acceptDownloads:true});
context.setDefaultTimeout(12000);
context.setDefaultNavigationTimeout(15000);
const page=await context.newPage();
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('dialog',dialog=>dialog.accept());
const checks=[];
const checkpoint=message=>{checks.push(message);console.log(`通过：${message}`);};
async function visit(target) {
  await page.goto(`${base}/${target}`,{waitUntil:'networkidle',timeout:15000});
  await page.waitForSelector('html[data-ready="true"]',{timeout:10000});
  assert.equal(await page.locator('.error-page').count(),0,await page.locator('body').innerText());
}
try {
  await visit('');
  assert.ok((await page.locator('body').innerText()).length>100);
  await page.screenshot({path:path.join(output,'production-home-empty.png'),fullPage:true});
  checkpoint('空站点可正常浏览，无空白页面');

  await page.goto(`${base}/?page=overview`,{waitUntil:'networkidle'});
  await page.waitForURL(/page=login/);
  await page.locator('#admin-key').fill(adminKey);
  await page.locator('#login-form button[type="submit"]').click();
  await page.waitForURL(/page=overview/);
  await page.waitForSelector('html[data-ready="true"]');
  assert.equal(await page.locator('.error-page').count(),0);
  checkpoint('未登录访问后台跳转登录，真实密钥可建立会话');

  await visit('?page=project-edit&new=1');
  await page.locator('#af-project-name').fill('验收项目');
  await page.locator('#af-project-slug').fill('acceptance-demo');
  await page.locator('#af-project-summary').fill('验证软件发布与公开下载的临时项目');
  await page.locator('#af-project-description').fill('仅用于浏览器验收，不写入正式站点数据。');
  await page.locator('input[name="platforms"][value="Windows"]').check();
  await page.locator('input[name="platforms"][value="macOS"]').check();
  const savedProject=page.waitForResponse(response=>response.url().endsWith('/api/admin/projects')&&response.request().method()==='POST');
  await page.locator('#af-project-form button[type="submit"]').click();
  const projectResponse=await savedProject;
  assert.equal(projectResponse.status(),201,await projectResponse.text());
  const project=(await projectResponse.json()).project;
  await page.waitForURL(/page=project-edit.*id=/);
  checkpoint('项目表单成功创建并保存真实项目');

  await visit(`?page=publish&project=${project.id}`);
  await page.locator('#af-release-version').fill('1.0.0');
  await page.locator('#af-release-title').fill('第一个可下载的正式版本');
  await page.locator('#af-release-notes').fill('## 新增功能\n- 支持软件版本发布与下载。\n\n<script>window.__release_xss = true</script>');
  const packageBytes=Buffer.from('ReleaseDock browser acceptance package.\n');
  const uploaded=page.waitForResponse(response=>/\/api\/admin\/releases\/[^/]+\/assets\?/.test(response.url())&&response.request().method()==='POST');
  await page.locator('#af-package-input').setInputFiles({name:'acceptance-1.0.0.txt',mimeType:'text/plain',buffer:packageBytes});
  const uploadResponse=await uploaded;
  assert.equal(uploadResponse.status(),201,await uploadResponse.text());
  const asset=(await uploadResponse.json()).asset;
  await page.waitForSelector('[data-af-asset]');
  await page.screenshot({path:path.join(output,'production-release-editor.png'),fullPage:true});
  const anonymous=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
  const draftDownload=await anonymous.request.get(`${base}/api/downloads/${asset.id}`);
  assert.equal(draftDownload.status(),404);
  checkpoint('文件真实上传并生成草稿，未登录无法下载草稿附件');

  await page.locator('#af-preview-release').click();
  await page.waitForSelector('#af-preview-dialog[open]');
  await page.keyboard.press('Escape');
  await page.locator('#af-publish-release').click();
  await page.waitForURL(/page=releases/);
  await page.waitForSelector('html[data-ready="true"]');
  await page.screenshot({path:path.join(output,'production-release-list.png'),fullPage:true});
  checkpoint('发布前预览可用，确认后版本进入真实已发布列表');

  const publicPage=await anonymous.newPage();
  publicPage.on('pageerror',error=>errors.push(error.message));
  await publicPage.goto(`${base}/?page=project&slug=${project.slug}`,{waitUntil:'networkidle'});
  await publicPage.waitForSelector('html[data-ready="true"]');
  assert.equal(await publicPage.locator('.error-page').count(),0,await publicPage.locator('body').innerText());
  assert.ok((await publicPage.locator('body').innerText()).includes('第一个可下载的正式版本'));
  assert.equal(await publicPage.evaluate(()=>window.__release_xss),undefined);
  const downloadEvent=publicPage.waitForEvent('download');
  await publicPage.locator(`a[href="/api/downloads/${asset.id}"]`).first().click();
  const download=await downloadEvent;
  assert.deepEqual(await fs.readFile(await download.path()),packageBytes);
  await publicPage.screenshot({path:path.join(output,'production-project-download.png'),fullPage:true});
  checkpoint('匿名访客获得完整下载文件，更新日志中的脚本按文本展示');

  for(const target of ['?page=overview','?page=projects','?page=releases','?page=files','?page=settings',`?page=publish&id=${asset.releaseId}`]) {
    await visit(target);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`页面横向溢出：${target}`);
  }
  checkpoint('后台概览、项目、版本、文件、设置与只读版本页均可打开');
  await publicPage.setViewportSize({width:390,height:844});
  await publicPage.goto(`${base}/`,{waitUntil:'networkidle'});
  await publicPage.waitForSelector('html[data-ready="true"]');
  assert.equal(await publicPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await publicPage.screenshot({path:path.join(output,'production-mobile-home.png'),fullPage:true});
  checkpoint('390px 手机屏幕无横向溢出');
  await anonymous.close();

  await visit('?page=releases');
  await page.locator('[data-withdraw]').first().click();
  await page.waitForSelector('#withdraw-dialog[open]');
  await page.locator('#withdraw-form button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-row][data-state="withdrawn"]'));
  await page.waitForSelector('html[data-ready="true"]');
  assert.equal((await app.inject({url:`/api/downloads/${asset.id}`})).statusCode,404);
  checkpoint('后台下架确认生效，原公开下载链接立即关闭');

  await page.locator('[data-logout]:visible').first().click();
  await page.waitForURL(/page=login/);
  assert.equal((await (await context.request.get(`${base}/api/session`)).json()).authenticated,false);
  assert.deepEqual(errors,[]);
  checkpoint('退出会话失效，全程无浏览器脚本错误');
  await fs.writeFile(path.join(output,'browser-report.json'),JSON.stringify({passed:checks.length,checks,errors},null,2));
} catch(error) {
  await page.screenshot({path:path.join(output,'browser-failure.png'),fullPage:true}).catch(()=>{});
  console.error('浏览器验收失败：',error.message);
  console.error((await page.locator('body').innerText()).slice(-3500));
  throw error;
} finally {
  clearTimeout(deadline);
  await browser.close();
  await app.close();
  const target=path.resolve(dataDir),parent=path.resolve(os.tmpdir());
  assert.ok(target.startsWith(parent+path.sep)&&path.basename(target).startsWith('releasedock-ui-'));
  await fs.rm(target,{recursive:true,force:true});
}
