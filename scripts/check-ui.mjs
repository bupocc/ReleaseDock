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
  const inline=page.locator(`[data-af-asset-filename="${id}"]`);
  if(await inline.count()) {
    await inline.fill(filename);
    const saved=page.waitForResponse(response=>response.url().endsWith(`/api/admin/assets/${id}`)&&response.request().method()==='PATCH');
    await inline.press('Enter');
    const response=await saved;
    assert.equal(response.status(),200,await response.text());
    const updated=(await response.json()).asset;
    await page.waitForFunction(({id,filename})=>{const input=document.querySelector(`[data-af-asset-filename="${id}"]`);return input&&!input.disabled&&input.value===filename;},{id,filename:updated.filename});
    return updated;
  }
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
async function adminRequest(method,route,body) {
  const {csrfToken}=await (await context.request.get(`${base}/api/session`)).json();
  const response=await context.request.fetch(`${base}${route}`,{method,headers:{'X-CSRF-Token':csrfToken},data:body});
  assert.ok(response.ok(),await response.text());
  return response.json();
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
  assert.equal(await page.locator('[data-carousel-empty]').count(),1);
  assert.equal(await page.locator('[data-carousel-slide], [data-carousel-next]').count(),0);
  assert.ok(!(await page.locator('body').innerText()).includes('A HOME FOR EVERY RELEASE'));
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
  await page.waitForSelector('#admin-key');
  const loginText=await page.locator('#login-form').innerText();
  assert.ok(!loginText.includes('仅供站点管理员使用'));
  assert.ok(await page.locator('label[for="admin-key"]').evaluate(node=>{const bounds=node.getBoundingClientRect();return bounds.width<=1&&bounds.height<=1;}));
  assert.ok(await page.locator('#admin-key').getAttribute('aria-label')||await page.locator('label[for="admin-key"]').count());
  await page.screenshot({path:path.join(output,'production-login.png'),fullPage:true});
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
  for(const platform of ['Windows','macOS']) {
    const input=page.locator(`input[name="platforms"][value="${platform}"]`);
    await input.focus();
    if(!await input.isChecked()) await input.press('Space');
    assert.equal(await input.isChecked(),true);
    assert.ok(await input.evaluate(node=>{const style=getComputedStyle(node);return style.opacity==='0'||style.clipPath!=='none';}));
  }
  const savedProject=page.waitForResponse(response=>response.url().endsWith('/api/admin/projects')&&response.request().method()==='POST');
  await page.locator('#af-project-form button[type="submit"]').click();
  const projectResponse=await savedProject;
  assert.equal(projectResponse.status(),201,await projectResponse.text());
  const project=(await projectResponse.json()).project;
  await page.waitForURL(/page=project-edit.*id=/);
  assert.deepEqual(project.platforms.sort(),['Windows','macOS'].sort());
  checkpoint('平台标签隐藏复选框并支持键盘选择，项目表单保存真实数据');

  const hiddenProject=(await adminRequest('POST','/api/admin/projects',{name:'备用隐藏项目',slug:'hidden-browser-project',subtitle:'仅用于检查项目选择',platforms:['Linux'],isPublic:false})).project;

  await visit(`?page=publish&project=${project.id}`);
  const projectSelect=page.locator('[data-select-for="af-release-project"] [role="combobox"]');
  await projectSelect.press('ArrowDown');
  assert.equal(await projectSelect.getAttribute('aria-expanded'),'true');
  await page.screenshot({path:path.join(output,'production-project-select.png'),fullPage:true,animations:'disabled'});
  const options=await page.locator('#af-release-project option').evaluateAll(nodes=>nodes.map(node=>node.value));
  await projectSelect.press('End');
  await projectSelect.press('Enter');
  assert.equal(await page.locator('#af-release-project').inputValue(),options.at(-1));
  await projectSelect.press('Home');
  await projectSelect.press('Tab');
  assert.equal(await page.locator('#af-release-project').inputValue(),options[0]);
  await projectSelect.click();
  await page.getByRole('option',{name:'备用隐藏项目',exact:true}).click();
  assert.equal(await page.locator('#af-release-project').inputValue(),hiddenProject.id);
  await projectSelect.click();
  await page.getByRole('option',{name:'验收项目',exact:true}).click();
  await projectSelect.press('ArrowDown');
  await projectSelect.press('End');
  await projectSelect.press('Escape');
  assert.equal(await page.locator('#af-release-project').inputValue(),project.id);
  await projectSelect.click();
  await page.locator('#af-release-title').click();
  assert.equal(await projectSelect.getAttribute('aria-expanded'),'false');
  checkpoint('项目下拉使用自定义列表，方向键、Home/End、回车、Tab、Escape 和点击外部均正常');
  await page.locator('#af-release-version').fill('1.5.0.1');
  await page.locator('#af-release-title').fill('第一个可下载的正式版本');
  const releaseNotes='## 新增功能\n- 支持软件版本发布与下载。\n\n> 升级前请阅读 **注意事项**。\n> 查看 [使用文档](https://example.com/releases_(stable)?lang=zh&from=notes)。\n\n<script>window.__release_xss = true</script>';
  await page.locator('#af-release-notes').fill(releaseNotes);
  const packageBytes=Buffer.from('ReleaseDock browser acceptance package.\n');
  await page.locator('#af-package-input').setInputFiles([{name:'acceptance-original.txt',mimeType:'text/plain',buffer:packageBytes},{name:'second-package.txt',mimeType:'text/plain',buffer:Buffer.from('Second package for independent filename edits.')}]);
  const pendingFilename=page.locator('[data-af-pending-filename]').first();
  await pendingFilename.waitFor();
  assert.equal(await page.locator('[data-af-asset]').count(),0);
  const uploadFilename='上传前改名 1.5.0.1.txt';
  await pendingFilename.fill(uploadFilename);
  for(const attribute of ['data-af-pending-platform','data-af-pending-arch']) {
    const select=page.locator(`[${attribute}]`).first();
    const trigger=select.locator('..').getByRole('combobox');
    const key=await select.getAttribute(attribute);
    await trigger.press('End');
    await trigger.press('Enter');
    await page.waitForFunction(({attribute,key})=>document.activeElement?.parentElement.querySelector('select')?.getAttribute(attribute)===key,{attribute,key});
    await trigger.press('Home');
    await trigger.press('Enter');
    assert.equal(await pendingFilename.inputValue(),uploadFilename);
  }
  const uploaded=page.waitForResponse(response=>/\/api\/admin\/releases\/[^/]+\/assets\?/.test(response.url())&&response.request().method()==='POST');
  await page.locator('#af-upload-pending').click();
  const uploadResponse=await uploaded;
  assert.equal(uploadResponse.status(),201,await uploadResponse.text());
  const asset=(await uploadResponse.json()).asset;
  assert.equal(asset.filename,uploadFilename);
  await page.waitForFunction(()=>document.querySelectorAll('[data-af-asset]').length===2&&document.querySelector('#af-publish-form').getAttribute('aria-busy')==='false');
  assert.equal(await projectSelect.isDisabled(),true);
  const createdDetail=(await (await context.request.get(`${base}/api/admin/releases/${asset.releaseId}`)).json());
  const createdRelease=createdDetail.release;
  const secondAsset=createdDetail.assets.find(item=>item.id!==asset.id);
  assert.equal(createdRelease.version,'1.5.0.1');
  checkpoint('四段版本号保存成功，文件先在列表原位改名再上传，建草稿后项目选择保持锁定');
  const unsavedTitle='第一个可下载的正式版本（已核验）';
  await page.locator('#af-release-title').fill(unsavedTitle);
  for(const attribute of ['data-af-asset-platform','data-af-asset-arch']) {
    const trigger=page.locator(`[${attribute}="${asset.id}"]`).locator('..').getByRole('combobox');
    for(const key of ['End','Home']) {
      const saved=page.waitForResponse(response=>response.url().endsWith(`/api/admin/assets/${asset.id}`)&&response.request().method()==='PATCH');
      await trigger.press(key);
      await trigger.press('Enter');
      assert.equal((await saved).status(),200);
      await page.waitForFunction(({attribute,id})=>document.querySelector('#af-publish-form').getAttribute('aria-busy')==='false'&&document.activeElement?.parentElement.querySelector('select')?.getAttribute(attribute)===id,{attribute,id:asset.id});
    }
  }
  assert.ok(await page.locator(`[data-af-asset-platform="${asset.id}"]`).locator('..').locator('.select-value').evaluate(node=>node.scrollWidth<=node.clientWidth));
  checkpoint('待上传及已上传文件的下拉选项保存后保持键盘焦点，Windows 平台名完整显示');
  await page.locator(`[data-af-asset-filename="${asset.id}"]`).fill('取消后的名称.txt');
  await page.locator(`[data-af-cancel-filename="${asset.id}"]`).click();
  assert.equal(await page.locator(`[data-af-asset-filename="${asset.id}"]`).inputValue(),asset.filename);
  assert.equal((await (await context.request.get(`${base}/api/admin/releases/${asset.releaseId}`)).json()).assets[0].filename,asset.filename);
  const draftFilename='验收安装包 1.5.0.1.txt';
  await page.locator(`[data-af-asset-filename="${secondAsset.id}"]`).fill('第二个文件尚未保存.txt');
  const renamedDraft=await renameAsset(asset.id,draftFilename);
  assert.equal(renamedDraft.filename,draftFilename);
  assert.equal(renamedDraft.sha256,asset.sha256);
  assert.equal(await page.locator('#af-release-title').inputValue(),unsavedTitle);
  assert.equal(await page.locator('#af-release-notes').inputValue(),releaseNotes);
  assert.equal(await page.locator(`[data-af-asset-filename="${asset.id}"]`).inputValue(),draftFilename);
  assert.equal(await page.locator(`[data-af-asset-filename="${secondAsset.id}"]`).inputValue(),'第二个文件尚未保存.txt');
  await page.locator(`[data-af-cancel-filename="${secondAsset.id}"]`).click();
  await page.locator('[data-af-editor-tab="preview"]').click();
  assert.equal(await page.locator('#af-notes-preview-panel blockquote strong').innerText(),'注意事项');
  assert.equal(await page.locator('#af-notes-preview-panel blockquote a').getAttribute('href'),'https://example.com/releases_(stable)?lang=zh&from=notes');
  checkpoint('已上传附件可原位取消或回车保存新名称，未保存日志及校验值保留，Markdown 预览正确');
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
    if(target==='?page=overview'||target==='?page=releases') {
      assert.equal(await page.locator(`a[href="?page=publish&id=${asset.releaseId}"]`).innerText(),'编辑');
    }
  }
  checkpoint('后台概览、项目、版本、文件、设置与版本编辑页均可打开');
  const publishedBefore=(await (await context.request.get(`${base}/api/admin/releases/${asset.releaseId}`)).json()).release;
  const editedTitle='正式发布后修订的说明';
  const editedNotes=releaseNotes+'\n\n修订：补充四段版本的升级步骤。';
  await page.locator('#af-release-version').fill('1.5.0.2');
  await page.locator('#af-release-title').fill(editedTitle);
  await page.locator('[data-af-editor-tab="edit"]').click();
  await page.locator('#af-release-notes').fill(editedNotes);
  await page.locator('input[name="channel"][value="prerelease"]').check();
  assert.equal(await page.locator('#af-latest').isDisabled(),true);
  assert.equal(await page.locator('#af-latest').isChecked(),false);
  const metadataSaved=page.waitForResponse(response=>response.url().endsWith(`/api/admin/releases/${asset.releaseId}`)&&response.request().method()==='PATCH');
  await page.locator('#af-save-draft').click();
  const metadataResponse=await metadataSaved;
  assert.equal(metadataResponse.status(),200,await metadataResponse.text());
  const publishedAfter=(await metadataResponse.json()).release;
  assert.equal(publishedAfter.version,'1.5.0.2');
  assert.equal(publishedAfter.status,'published');
  assert.equal(publishedAfter.publishedAt,publishedBefore.publishedAt);
  assert.equal(publishedAfter.channel,'prerelease');
  assert.equal(publishedAfter.isLatest,false);
  await publicPage.reload({waitUntil:'networkidle'});
  await publicPage.waitForSelector('html[data-ready="true"]');
  assert.ok((await publicPage.locator('body').innerText()).includes(editedTitle));
  assert.ok((await publicPage.locator('.notes-content').innerText()).includes('补充四段版本的升级步骤'));
  await page.screenshot({path:path.join(output,'production-published-editor.png'),fullPage:true});
  checkpoint('概览和列表可进入编辑，已发布版本号、标题、日志及渠道可保存，最新稳定标记同步，发布时间与状态不变');
  const lockedFilename='已发布安装包 1.5.0.2.txt';
  await renameAsset(asset.id,lockedFilename);
  assert.equal(await page.locator(`[data-af-asset-platform="${asset.id}"]`).isDisabled(),true);
  assert.equal(await page.locator(`[data-af-asset-platform="${asset.id}"]`).locator('..').getByRole('combobox').isDisabled(),true);
  assert.equal(await page.locator(`[data-af-asset-filename="${asset.id}"]`).inputValue(),lockedFilename);
  await page.setViewportSize({width:390,height:844});
  await page.locator(`[data-af-asset-filename="${asset.id}"]`).fill('../非法文件.txt');
  await page.locator(`[data-af-save-filename="${asset.id}"]`).click();
  await page.locator('.af-filename-error').filter({hasText:/名称|路径|包含/}).first().waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(output,'production-mobile-rename.png'),fullPage:true});
  await page.locator(`[data-af-asset-filename="${asset.id}"]`).press('Escape');
  assert.equal(await page.locator(`[data-af-asset-filename="${asset.id}"]`).inputValue(),lockedFilename);
  await page.setViewportSize({width:1440,height:1000});
  checkpoint('已发布附件平台和架构锁定且自定义控件同步禁用，手机原位改名校验非法名称并支持 Escape 取消');
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
  assert.equal(await publicPage.locator('[data-carousel-slide]').count(),1);
  assert.equal(await publicPage.locator('[data-carousel-next]').count(),0);
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
  await page.locator('#af-release-title').fill('下架后补充的归档说明');
  const withdrawnSaved=page.waitForResponse(response=>response.url().endsWith(`/api/admin/releases/${asset.releaseId}`)&&response.request().method()==='PATCH');
  await page.locator('#af-save-draft').click();
  const withdrawnResponse=await withdrawnSaved;
  assert.equal(withdrawnResponse.status(),200);
  assert.equal((await withdrawnResponse.json()).release.status,'withdrawn');
  assert.equal((await app.inject({url:`/api/downloads/${asset.id}`})).statusCode,404);
  checkpoint('下架后可修改归档信息及附件名，保存不会重新公开下载');

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
