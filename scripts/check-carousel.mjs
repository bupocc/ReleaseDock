import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildApp } from '../server/app.js';
import { bootstrapAdmin } from '../tests/helpers/passkeys.mjs';

const require=createRequire(import.meta.url);
const modules=process.env.DESIGN_NODE_MODULES||'C:/Users/ASUS/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(require.resolve('playwright',{paths:[modules]}));
const output=path.resolve('test-results');
await fs.mkdir(output,{recursive:true});
const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'releasedock-carousel-'));
const app=await buildApp({dataDir,logger:false});
const base=await app.listen({host:'127.0.0.1',port:0});
const browser=await chromium.launch({headless:true,executablePath:process.env.DESIGN_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const deadline=setTimeout(()=>browser.close(),55000);
const context=await browser.newContext({viewport:{width:1440,height:1000}});
context.setDefaultTimeout(10000);
const page=await context.newPage();
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const checks=[];
const checkpoint=message=>{checks.push(message);console.log(`通过：${message}`);};
let headers;
async function call(method,url,payload,extraHeaders={}) {
  const response=await app.inject({method,url,payload,headers:{...headers,...extraHeaders}});
  assert.ok(response.statusCode>=200&&response.statusCode<300,response.body);
  return response.json();
}
async function visit(target) {
  await page.goto(`${base}/${target}`,{waitUntil:'networkidle'});
  await page.waitForSelector('html[data-ready="true"]');
  assert.equal(await page.locator('.error-page').count(),0,await page.locator('body').innerText());
}
async function release(project,version,channel,notes) {
  const {release}=await call('POST','/api/admin/releases',{projectId:project.id,version,title:`${project.name} ${version} 更新`,channel,notes});
  const boundary='releasedock-carousel-boundary';
  const body=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test-package.txt"\r\nContent-Type: text/plain\r\n\r\nCarousel acceptance package.\r\n--${boundary}--\r\n`);
  await call('POST',`/api/admin/releases/${release.id}/assets?platform=Windows&arch=x64`,body,{'content-type':`multipart/form-data; boundary=${boundary}`});
  return (await call('POST',`/api/admin/releases/${release.id}/publish`,{setLatest:channel==='stable'})).release;
}
try {
  ({headers}=await bootstrapAdmin(app));
  await call('PATCH','/api/admin/settings',{announcement:'发布中心已更新：欢迎查看项目近期改进。'});
  await visit('');
  const spacing=await page.evaluate(()=>{
    const header=document.querySelector('.site-header').getBoundingClientRect();
    const title=document.querySelector('.activity-heading').getBoundingClientRect();
    const announcement=document.querySelector('.site-announcement').getBoundingClientRect();
    return {headerToTitle:title.top-header.bottom,titleToAnnouncement:announcement.top-title.bottom};
  });
  assert.ok(spacing.headerToTitle>=15&&spacing.headerToTitle<80,JSON.stringify(spacing));
  assert.ok(spacing.titleToAnnouncement>=12&&spacing.titleToAnnouncement<40,JSON.stringify(spacing));
  await page.screenshot({path:path.join(output,'production-activity-announcement.png'),fullPage:true,animations:'disabled'});
  checkpoint('动态页标题紧接导航，公告位于标题下方，间距紧凑');

  const first=(await call('POST','/api/admin/projects',{name:'晨星工具箱',slug:'morning-tools',subtitle:'把常用桌面工具放在一起',description:'一个轻量的桌面工作空间。整理文件、查找内容，让每天的常用操作更加顺手。',platforms:['Windows','macOS'],category:'效率工具',isPublic:true})).project;
  await release(first,'1.5.0.1','stable','## 新增\n- 新增文件整理和快速搜索。\n\n> 更新前请保存当前工作。');
  const second=(await call('POST','/api/admin/projects',{name:'流光同步',slug:'stream-sync',subtitle:'设备之间的文件同步工具',description:'在不同设备间同步项目资料，让每一次切换都能接着工作。',platforms:['Windows','Linux'],category:'实用工具',isPublic:true})).project;
  await release(second,'2.0.0','stable','## 改进\n- 优化大文件同步。');
  const newest=await release(second,'2.1.0-rc.1','prerelease','## 提前体验\n- 全新的同步进度视图。\n- 支持网络恢复后继续传输。\n\n> 请先阅读 [使用文档](https://example.com/guide)。\n\n```js\nwindow.__carousel_xss = true\n```\n\n<img src=x onerror=alert(1)>');
  const hidden=(await call('POST','/api/admin/projects',{name:'内部项目',slug:'private-carousel-project',isPublic:false})).project;
  await release(hidden,'nightly','stable','该项目不能出现在公开轮播。');

  await page.clock.install();
  await visit('?page=catalog');
  const carousel=page.locator('[data-project-carousel]');
  assert.equal(await carousel.getAttribute('data-carousel-count'),'2');
  assert.equal(await page.locator('[data-carousel-slide]').count(),2);
  assert.equal(await page.locator(`[data-carousel-slide="${hidden.id}"]`).count(),0);
  assert.equal(await page.locator(`[data-carousel-slide="${second.id}"]`).count(),1);
  assert.ok((await page.locator(`[data-carousel-slide="${second.id}"]`).innerText()).includes('2.1.0-rc.1'));
  const text=await page.locator(`[data-carousel-slide="${second.id}"] [data-carousel-summary]`).innerText();
  assert.ok(text.includes('全新的同步进度视图')&&text.includes('请先阅读 使用文档'));
  assert.ok(!text.includes('##')&&!text.includes('[使用文档]')&&!text.includes('__carousel_xss'));
  assert.equal(await page.evaluate(()=>window.__carousel_xss),undefined);
  assert.equal(await page.locator('[data-carousel-slide] img[src="x"]').count(),0);
  assert.equal(await page.locator('[data-carousel-slide].is-active').getAttribute('data-carousel-slide'),second.id);
  assert.ok(await page.locator('[data-carousel-track]').evaluate(node=>parseFloat(getComputedStyle(node).transitionDuration)>0));
  await page.screenshot({path:path.join(output,'production-catalog-carousel.png'),fullPage:true,animations:'disabled'});
  checkpoint('轮播按项目去重并显示真正最近发布版本，隐藏项目不公开，Markdown 摘要清晰且无脚本执行');

  await page.mouse.move(2,2);
  await page.locator('#project-search').focus();
  assert.equal(await carousel.getAttribute('data-carousel-autoplay'),'running');
  const initial=await carousel.getAttribute('data-carousel-index');
  await page.clock.fastForward(6100);
  assert.notEqual(await carousel.getAttribute('data-carousel-index'),initial);
  await page.clock.fastForward(600);
  assert.equal(await page.locator('[data-carousel-slide][aria-hidden="false"]').count(),1);
  assert.equal(await page.locator('[data-carousel-slide][inert]').count(),1);
  checkpoint('自动轮播约每 6 秒切换，带位移动画且只允许当前项目链接获取焦点');

  await carousel.hover();
  assert.equal(await carousel.getAttribute('data-carousel-pause-reason'),'hover');
  const hovered=await carousel.getAttribute('data-carousel-index');
  await page.clock.fastForward(8000);
  assert.equal(await carousel.getAttribute('data-carousel-index'),hovered);
  await page.mouse.move(2,2);
  await page.locator('[data-carousel-viewport]').focus();
  assert.equal(await carousel.getAttribute('data-carousel-pause-reason'),'focus');
  await page.clock.fastForward(8000);
  assert.equal(await carousel.getAttribute('data-carousel-index'),hovered);
  await page.locator('[data-carousel-viewport]').press('Home');
  assert.equal(await carousel.getAttribute('data-carousel-index'),'0');
  await page.locator('[data-carousel-viewport]').press('ArrowRight');
  assert.equal(await carousel.getAttribute('data-carousel-index'),'1');
  await page.locator('[data-carousel-prev]').click();
  assert.equal(await carousel.getAttribute('data-carousel-index'),'0');
  await page.locator('[data-carousel-next]').click();
  assert.equal(await carousel.getAttribute('data-carousel-index'),'1');
  await page.locator('[data-carousel-dot="0"]').click();
  assert.equal(await carousel.getAttribute('data-carousel-index'),'0');
  checkpoint('鼠标悬停与键盘焦点暂停计时，方向键、前后按钮与指示点均可切换');

  await page.locator('[data-carousel-toggle]').click();
  await page.mouse.move(2,2);
  await page.locator('#project-search').focus();
  assert.equal(await carousel.getAttribute('data-carousel-pause-reason'),'manual');
  const paused=await carousel.getAttribute('data-carousel-index');
  await page.clock.fastForward(8000);
  assert.equal(await carousel.getAttribute('data-carousel-index'),paused);
  await page.locator('[data-carousel-toggle]').click();
  await page.mouse.move(2,2);
  await page.locator('#project-search').focus();
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(await carousel.getAttribute('data-carousel-pause-reason'),'hidden');
  await page.clock.fastForward(8000);
  assert.equal(await carousel.getAttribute('data-carousel-index'),paused);
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(await carousel.getAttribute('data-carousel-autoplay'),'running');
  checkpoint('手动暂停可恢复，模拟页面隐藏事件会停止轮播计时');

  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>document.querySelector('[data-project-carousel]').dataset.carouselPauseReason==='reduced-motion');
  assert.equal(await page.locator('[data-carousel-toggle]').isVisible(),false);
  assert.equal(await page.locator('[data-carousel-track]').evaluate(node=>getComputedStyle(node).transitionDuration),'0s');
  const reduced=await carousel.getAttribute('data-carousel-index');
  await page.clock.fastForward(8000);
  assert.equal(await carousel.getAttribute('data-carousel-index'),reduced);
  await page.locator('[data-carousel-next]').click();
  assert.notEqual(await carousel.getAttribute('data-carousel-index'),reduced);
  checkpoint('减少动态偏好禁用自动播放和动画，同时保留手动切换');

  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(output,'production-mobile-carousel.png'),fullPage:true,animations:'disabled'});
  await page.locator('#project-search').fill('晨星');
  assert.equal(await page.locator('.project-card').count(),1);
  assert.equal(await page.locator('[data-carousel-slide]').count(),2);
  await page.locator('[data-carousel-dot="0"]').click();
  await page.locator('[data-carousel-slide].is-active [data-carousel-open]').click();
  await page.waitForSelector('html[data-ready="true"]');
  assert.equal(new URL(page.url()).pathname, `/${second.slug}/${newest.version}`);
  assert.ok((await page.locator('.release-topline').innerText()).includes('2.1.0-rc.1'));
  checkpoint('手机轮播、目录搜索无横向溢出，查看更新链接定位到对应版本');

  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'carousel-report.json'),JSON.stringify({passed:checks.length,checks,errors},null,2));
} catch(error) {
  await page.screenshot({path:path.join(output,'carousel-failure.png'),fullPage:true}).catch(()=>{});
  console.error('轮播验收失败：',error.message);
  throw error;
} finally {
  clearTimeout(deadline);
  await browser.close();
  await app.close();
  const target=path.resolve(dataDir),parent=path.resolve(os.tmpdir());
  assert.ok(target.startsWith(parent+path.sep)&&path.basename(target).startsWith('releasedock-carousel-'));
  await fs.rm(target,{recursive:true,force:true});
}
