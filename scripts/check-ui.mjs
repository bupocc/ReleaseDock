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
async function renameAsset(id,filename) {
  await page.locator(`[data-asset-rename="${id}"]`).click();
  await page.locator('#asset-rename-filename').fill(filename);
  const saved=page.waitForResponse(response=>response.url().endsWith(`/api/admin/assets/${id}`)&&response.request().method()==='PATCH');
  await page.locator('#asset-rename-filename').press('Enter');
  const response=await saved;
  assert.equal(response.status(),200,await response.text());
  await page.locator('#asset-rename-dialog').waitFor({state:'hidden'});
  const updated=(await response.json()).asset;
  await page.waitForFunction(({id,filename})=>[...document.querySelectorAll('[data-asset-rename]')].some(button=>button.dataset.assetRename===id&&button.getAttribute('aria-label')===`重命名 ${filename}`),{id,filename:updated.filename});
  return updated;
}
try {
  await visit('');
  assert.ok((await page.locator('body').innerText()).length>100);
  assert.equal(await page.locator('.activity-page').count(),1);
  await page.screenshot({path:path.join(output,'production-home-empty.png'),fullPage:true});
  await page.locator('.header-nav a[href="?page=catalog"]').click();
  await page.waitForURL(/page=catalog/);
  await page.waitForSelector('html[data-ready="true"]');
  assert.equal(await page.locator('.error-page').count(),0);
  assert.equal(await page.locator('#project-search').isVisible(),true);
  await page.screenshot({path:path.join(output,'production-catalog-empty.png'),fullPage:true});
  checkpoint('首页保留更新动态，导航可打开全部项目，空站点无加载错误');

  const markdownChecks=await page.evaluate(async()=>{
    const {renderNotes}=await import('/assets/api.js');
    const render=source=>{const node=document.createElement('div');node.innerHTML=renderNotes(source);return node;};
    const quote=render('> 引用 **重点**\n>\n> - [说明](https://example.com/help)\n>\n>> 嵌套引用');
    const links=render('[说明](https://example.com/releases_(stable)?lang=zh&from=notes "版本文档")\n\n[参考][guide]\n\n[guide]: https://example.com/reference');
    const escaped=render('\\> 普通文字\n\n\\[不是链接\\](#downloads)');
    const code=render('`> [代码](https://example.com)`\n\n```txt\n> [代码块](https://example.com)\n```');
    const unsafe=render('[脚本](javascript:alert(1))\n\n[实体编码](jav&#x61;script:alert(1))\n\n[数据](data:text/html,boom)\n\n[文件](file:///tmp/secret)\n\n<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>');
    const relative=render('[下载](/api/downloads/example) [锚点](#downloads) [邮件](mailto:hello@example.com)');
    const link=links.querySelector('a');
    return {
      quote:!!quote.querySelector('blockquote strong')&&!!quote.querySelector('blockquote ul li a')&&!!quote.querySelector('blockquote blockquote'),
      links:link?.getAttribute('href')==='https://example.com/releases_(stable)?lang=zh&from=notes'&&link.title==='版本文档'&&link.target==='_blank'&&link.rel==='noopener noreferrer'&&links.querySelectorAll('a').length===2,
      escapes:!escaped.querySelector('blockquote,a')&&escaped.textContent.includes('> 普通文字'),
      code:code.querySelectorAll('code').length===2&&!code.querySelector('a,blockquote')&&code.querySelector('pre code')?.textContent.includes('> [代码块]'),
      safe:!unsafe.querySelector('a[href],img,script,svg,iframe')&&unsafe.textContent.includes('<script>')&&!Array.from(unsafe.querySelectorAll('*')).some(node=>Array.from(node.attributes).some(attr=>/^on/i.test(attr.name))),
      relative:relative.querySelectorAll('a[href]').length===3&&relative.querySelector('a').getAttribute('href')==='/api/downloads/example',
    };
  });
  assert.deepEqual(markdownChecks,{quote:true,links:true,escapes:true,code:true,safe:true,relative:true});
  checkpoint('Markdown 引用、嵌套、链接、括号、转义与代码正确渲染，危险协议和原始 HTML 被隔离');

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
  const releaseNotes='## 新增功能\n- 支持软件版本发布与下载。\n\n> 升级前请阅读 **注意事项**。\n> 查看 [使用文档](https://example.com/releases_(stable)?lang=zh&from=notes)。\n\n<script>window.__release_xss = true</script>';
  await page.locator('#af-release-notes').fill(releaseNotes);
  const packageBytes=Buffer.from('ReleaseDock browser acceptance package.\n');
  const uploaded=page.waitForResponse(response=>/\/api\/admin\/releases\/[^/]+\/assets\?/.test(response.url())&&response.request().method()==='POST');
  await page.locator('#af-package-input').setInputFiles({name:'acceptance-1.0.0.txt',mimeType:'text/plain',buffer:packageBytes});
  const uploadResponse=await uploaded;
  assert.equal(uploadResponse.status(),201,await uploadResponse.text());
  const asset=(await uploadResponse.json()).asset;
  await page.waitForSelector('[data-af-asset]');
  const unsavedTitle='第一个可下载的正式版本（已核验）';
  await page.locator('#af-release-title').fill(unsavedTitle);
  await page.locator(`[data-asset-rename="${asset.id}"]`).click();
  assert.equal(await page.locator('#asset-rename-filename').inputValue(),asset.filename);
  await page.locator('#asset-rename-filename').fill('取消后的名称.txt');
  await page.locator('#asset-rename-form [data-asset-rename-cancel]').click();
  assert.equal((await (await context.request.get(`${base}/api/admin/releases/${asset.releaseId}`)).json()).assets[0].filename,asset.filename);
  const draftFilename='验收安装包 1.0.0.txt';
  const renamedDraft=await renameAsset(asset.id,draftFilename);
  assert.equal(renamedDraft.filename,draftFilename);
  assert.equal(renamedDraft.sha256,asset.sha256);
  assert.equal(await page.locator('#af-release-title').inputValue(),unsavedTitle);
  assert.equal(await page.locator('#af-release-notes').inputValue(),releaseNotes);
  assert.ok((await page.locator(`[data-af-asset="${asset.id}"]`).innerText()).includes(draftFilename));
  await page.locator('[data-af-editor-tab="preview"]').click();
  assert.equal(await page.locator('#af-notes-preview-panel blockquote strong').innerText(),'注意事项');
  assert.equal(await page.locator('#af-notes-preview-panel blockquote a').getAttribute('href'),'https://example.com/releases_(stable)?lang=zh&from=notes');
  checkpoint('草稿附件可取消或回车保存新名称，更新日志及校验值保留，编辑器引用和链接预览正确');
  await page.screenshot({path:path.join(output,'production-release-editor.png'),fullPage:true});
  const anonymous=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
  const draftDownload=await anonymous.request.get(`${base}/api/downloads/${asset.id}`);
  assert.equal(draftDownload.status(),404);
  checkpoint('文件真实上传并生成草稿，未登录无法下载草稿附件');

  await page.locator('#af-preview-release').click();
  await page.waitForSelector('#af-preview-dialog[open]');
  assert.equal(await page.locator('#af-preview-dialog blockquote a').count(),1);
  assert.ok((await page.locator('.af-dialog-downloads').innerText()).includes(draftFilename));
  await page.keyboard.press('Escape');
  await page.locator('#af-publish-release').click();
  await page.waitForURL(/page=releases/);
  await page.waitForSelector('html[data-ready="true"]');
  await page.screenshot({path:path.join(output,'production-release-list.png'),fullPage:true});
  checkpoint('发布前预览可用，确认后版本进入真实已发布列表');

  await visit('?page=files');
  const publicFilename='正式安装包 1.0.0 (Windows).txt';
  const renamedPublic=await renameAsset(asset.id,publicFilename);
  assert.equal(renamedPublic.filename,publicFilename);
  assert.equal(renamedPublic.sha256,asset.sha256);
  await page.locator('#table-search').fill(publicFilename);
  assert.equal(await page.locator('[data-row]:visible').count(),1);
  assert.ok((await page.locator('[data-row]:visible').innerText()).includes(publicFilename));
  checkpoint('文件管理支持已发布附件改名，列表和搜索立即使用新名称');

  const publicPage=await anonymous.newPage();
  publicPage.on('pageerror',error=>errors.push(error.message));
  await publicPage.goto(`${base}/`,{waitUntil:'networkidle'});
  await publicPage.waitForSelector('html[data-ready="true"]');
  assert.equal(await publicPage.locator('.activity-item').count(),1);
  assert.ok((await publicPage.locator('.activity-item').innerText()).includes(unsavedTitle));
  await publicPage.locator('.activity-item .link-button').click();
  await publicPage.waitForURL(/page=project/);
  await publicPage.waitForSelector('html[data-ready="true"]');
  assert.equal(await publicPage.locator('.error-page').count(),0,await publicPage.locator('body').innerText());
  assert.ok((await publicPage.locator('body').innerText()).includes('第一个可下载的正式版本'));
  assert.equal(await publicPage.evaluate(()=>window.__release_xss),undefined);
  assert.equal(await publicPage.locator('.notes-content blockquote strong').innerText(),'注意事项');
  assert.equal(await publicPage.locator('.notes-content blockquote a').getAttribute('href'),'https://example.com/releases_(stable)?lang=zh&from=notes');
  assert.ok((await publicPage.locator('.download-list').innerText()).includes(publicFilename));
  const downloadEvent=publicPage.waitForEvent('download');
  await publicPage.locator(`a[href="/api/downloads/${asset.id}"]`).first().click();
  const download=await downloadEvent;
  assert.equal(download.suggestedFilename(),publicFilename);
  assert.deepEqual(await fs.readFile(await download.path()),packageBytes);
  await publicPage.screenshot({path:path.join(output,'production-project-download.png'),fullPage:true});
  checkpoint('首页展示真实发布动态，匿名访客下载新文件名且字节完整，公开引用链接正确，脚本按文本展示');

  for(const target of ['?page=overview','?page=projects','?page=releases','?page=files','?page=settings',`?page=publish&id=${asset.releaseId}`]) {
    await visit(target);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`页面横向溢出：${target}`);
  }
  checkpoint('后台概览、项目、版本、文件、设置与只读版本页均可打开');
  const lockedFilename='已发布安装包 1.0.0.txt';
  await renameAsset(asset.id,lockedFilename);
  assert.equal(await page.locator(`[data-af-asset-platform="${asset.id}"]`).isDisabled(),true);
  assert.ok((await page.locator(`[data-af-asset="${asset.id}"]`).innerText()).includes(lockedFilename));
  await page.setViewportSize({width:390,height:844});
  await page.locator(`[data-asset-rename="${asset.id}"]`).click();
  await page.locator('#asset-rename-filename').fill('../非法文件.txt');
  await page.locator('[data-asset-rename-save]').click();
  await page.locator('[data-asset-rename-error]').filter({hasText:/名称|路径|包含/}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(output,'production-mobile-rename.png'),fullPage:true});
  await page.keyboard.press('Escape');
  await page.locator('#asset-rename-dialog').waitFor({state:'hidden'});
  await page.setViewportSize({width:1440,height:1000});
  checkpoint('已发布版本页可单独改名，其他附件字段锁定；手机弹窗可校验非法名并通过 Escape 取消');
  await publicPage.setViewportSize({width:390,height:844});
  await publicPage.goto(`${base}/`,{waitUntil:'networkidle'});
  await publicPage.waitForSelector('html[data-ready="true"]');
  assert.equal(await publicPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await publicPage.screenshot({path:path.join(output,'production-mobile-home.png'),fullPage:true});
  await publicPage.locator('.public-mobile-nav a[href="?page=catalog"]').click();
  await publicPage.waitForURL(/page=catalog/);
  await publicPage.waitForSelector('html[data-ready="true"]');
  await publicPage.locator('#project-search').fill('验收项目');
  assert.equal(await publicPage.locator('.project-card').count(),1);
  assert.equal(await publicPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  checkpoint('390px 手机首页、项目目录和搜索正常，无横向溢出');
  await anonymous.close();

  await visit('?page=releases');
  await page.locator('[data-withdraw]').first().click();
  await page.waitForSelector('#withdraw-dialog[open]');
  await page.locator('#withdraw-form button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-row][data-state="withdrawn"]'));
  await page.waitForSelector('html[data-ready="true"]');
  assert.equal((await app.inject({url:`/api/downloads/${asset.id}`})).statusCode,404);
  await visit(`?page=publish&id=${asset.releaseId}`);
  assert.equal((await renameAsset(asset.id,'下架归档安装包.txt')).filename,'下架归档安装包.txt');
  assert.equal((await app.inject({url:`/api/downloads/${asset.id}`})).statusCode,404);
  checkpoint('下架关闭公开下载，附件仍可改名且不会重新公开');

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
