import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const moduleRoot = process.env.DESIGN_NODE_MODULES || 'C:/Users/ASUS/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(require.resolve('playwright', { paths: [moduleRoot] }));
const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, 'previews');
await fs.mkdir(output, { recursive: true });
const base = process.env.DESIGN_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true, executablePath: process.env.DESIGN_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const scenes = [
  { page:'home', file:'01-home', title:'公开项目首页', width:1440, height:1080 },
  { page:'project', file:'02-project', title:'项目版本与下载', width:1440, height:1120 },
  { page:'login', file:'03-login', title:'管理员密钥登录', width:1440, height:960 },
  { page:'overview', file:'04-admin-overview', title:'后台概览', width:1440, height:1020 },
  { page:'projects', file:'05-admin-projects', title:'项目管理', width:1440, height:1020 },
  { page:'project-edit', file:'06-project-settings', title:'项目配置', width:1440, height:1060 },
  { page:'publish', file:'07-release-editor', title:'创建与发布版本', width:1440, height:1120 },
  { page:'home', file:'08-mobile-home', title:'手机端项目首页', width:390, height:844, mobile:true },
  { page:'releases', file:'09-release-list', title:'版本管理', width:1440, height:1020 },
];
const only = process.argv.slice(2);
const selected = only.length ? scenes.filter(scene => only.includes(scene.file) || only.includes(scene.page)) : scenes;
const reports = [];
try {
  for (const scene of selected) {
    const context = await browser.newContext({ viewport:{ width:scene.width, height:scene.height }, deviceScaleFactor:1.5, isMobile:!!scene.mobile, hasTouch:!!scene.mobile, reducedMotion:'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error=>errors.push(error.message));
    await page.goto(`${base}/?page=${scene.page}&capture=1`, { waitUntil:'networkidle', timeout:20000 });
    await page.waitForSelector('html[data-ready="true"]', { timeout:10000 });
    await page.evaluate(()=>document.fonts.ready);
    const layout = await page.evaluate(()=>({ title:document.title, overflow:document.documentElement.scrollWidth > innerWidth, textLength:document.body.innerText.trim().length, height:document.documentElement.scrollHeight }));
    if (errors.length || layout.overflow || layout.textLength < 100) throw new Error(`${scene.file} 验证失败：${JSON.stringify({ errors, ...layout })}`);
    await page.screenshot({ path:path.join(output,`${scene.file}.png`), fullPage:!scene.mobile });
    if (scene.mobile) await page.screenshot({ path:path.join(output,`${scene.file}-full.png`), fullPage:true });
    reports.push({ ...scene, ...layout, errors });
    console.log(`已导出 ${scene.file}.png；无脚本错误；无横向溢出`);
    await context.close();
  }
  await fs.writeFile(path.join(output,only.length?'preview-check.json':'render-report.json'),JSON.stringify(reports,null,2));
} finally {
  await browser.close();
}
