import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root=path.dirname(fileURLToPath(import.meta.url));
const moduleFiles=['icons.js','data.js','app.js','public-pages.js','admin-pages.js','admin-forms.js'];
const sources={};
for(const file of moduleFiles) {
  let source=await fs.readFile(path.join(root,file),'utf8');
  source=source.replace(/from\s+(['"])\.\/([^'"]+)\1/g,(_,quote,name)=>`from 'releasedock/${name}'`).replace(/import\((['"])\.\/([^'"]+)\1\)/g,(_,quote,name)=>`import('releasedock/${name}')`);
  sources[`releasedock/${file}`]=source;
}
const css=(await Promise.all(['styles.css','admin.css','admin-forms.css'].map(file=>fs.readFile(path.join(root,file),'utf8')))).join('\n');
const serialized=JSON.stringify(sources).replace(/</g,'\\u003c');
const preview=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ReleaseDock · 单文件设计预览</title><style>${css}</style></head><body><div id="app"><p style="padding:40px">正在加载界面设计…</p></div><div id="toast" role="status" aria-live="polite"></div><script>const sources=${serialized};const imports={};for(const [name,source] of Object.entries(sources)){imports[name]=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));}const map=document.createElement('script');map.type='importmap';map.textContent=JSON.stringify({imports});document.head.append(map);const entry=document.createElement('script');entry.type='module';entry.textContent="import 'releasedock/app.js';";document.body.append(entry);</script></body></html>`;
await fs.writeFile(path.join(root,'preview.html'),preview);

const scenes=[['01-home','公开项目首页','home'],['02-project','项目版本与下载','project'],['03-login','管理员密钥登录','login'],['04-admin-overview','后台概览','overview'],['05-admin-projects','项目管理','projects'],['06-project-settings','项目配置','project-edit'],['07-release-editor','创建与发布版本','publish'],['08-mobile-home','手机端项目首页','home'],['09-release-list','版本管理','releases']];
const gallery=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ReleaseDock · 页面设计图</title><style>body{margin:0;background:#f1f4ed;color:#26392b;font-family:'Microsoft YaHei',sans-serif}main{max-width:1500px;margin:auto;padding:48px 36px}header{display:flex;align-items:center;justify-content:space-between;gap:30px;margin-bottom:35px}h1{font-size:30px;font-weight:600;letter-spacing:-1px;margin:0}header p{font-size:12px;color:#829474;line-height:1.8;margin-top:10px}a{color:inherit;text-decoration:none}.button{display:inline-block;padding:13px 19px;background:#277450;color:#fff;border-radius:7px;font-size:12px;white-space:nowrap}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}article{background:#fff;border:1px solid #e0e7d8;border-radius:10px;overflow:hidden}.image{height:315px;padding:13px;background:#e8ede2;box-sizing:border-box;display:block}.image img{width:100%;height:100%;object-fit:contain;transition:transform .2s}.image:hover img{transform:scale(1.015)}.caption{padding:18px;display:flex;justify-content:space-between;align-items:center;gap:12px}h2{font-size:13px;font-weight:500;margin:0}h2 span{font-size:10px;color:#99ab8b;margin-right:8px}.caption>a{font-size:10px;color:#729257}footer{margin-top:30px;color:#91a17f;font-size:11px;line-height:1.8}@media(max-width:1000px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){main{padding:30px 20px}header{display:block}.button{margin-top:10px}.grid{grid-template-columns:1fr}.image{height:300px}h1{font-size:25px}}</style></head><body><main><header><div><h1>ReleaseDock · 页面设计图</h1><p>清爽浅色 / 米白背景 / 墨绿色强调<br>公开浏览与下载、密钥登录、项目配置和版本发布，共 9 个页面设计。</p></div><a class="button" href="preview.html">打开交互预览 →</a></header><div class="grid">${scenes.map(([file,title,page],i)=>`<article><a class="image" href="previews/${file}.png" target="_blank" rel="noopener"><img src="previews/${file}.png" alt="${title}设计图"></a><div class="caption"><h2><span>${String(i+1).padStart(2,'0')}</span>${title}</h2><a href="preview.html?page=${page}">预览页面 →</a></div></article>`).join('')}</div><footer>图片由真实页面排版渲染。设计中的项目、版本和统计为示例；正式网站使用独立数据库。<br>点击图片可打开原始高清 PNG。手机完整长图：<a href="previews/08-mobile-home-full.png">查看长图</a>。</footer></main></body></html>`;
await fs.writeFile(path.join(root,'gallery.html'),gallery);

const require=createRequire(import.meta.url);
const modules=process.env.DESIGN_NODE_MODULES||'C:/Users/ASUS/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const sharp=require(require.resolve('sharp',{paths:[modules]}));
const canvas={width:1800,height:1510,channels:3,background:'#edf1e7'};
const layers=[];
const heading=Buffer.from('<svg width="1800" height="160"><text x="55" y="78" font-family="Microsoft YaHei" font-size="38" font-weight="600" fill="#28412c">ReleaseDock · 页面设计</text><text x="57" y="120" font-family="Microsoft YaHei" font-size="18" fill="#829871">软件发布中心 · 清爽浅色 · 公开下载与后台管理</text></svg>');
layers.push({input:heading,left:0,top:0});
for(let i=0;i<scenes.length;i++) {
  const [file,title]=scenes[i];
  const left=55+(i%3)*580,top=172+Math.floor(i/3)*438;
  const thumb=await sharp(path.join(root,'previews',`${file}.png`)).resize(530,365,{fit:'contain',background:'#ffffff'}).png().toBuffer();
  layers.push({input:thumb,left,top});
  const label=Buffer.from(`<svg width="530" height="50"><text x="1" y="30" font-family="Microsoft YaHei" font-size="17" fill="#4d6f43">${String(i+1).padStart(2,'0')} / ${title}</text></svg>`);
  layers.push({input:label,left,top:top+367});
}
await sharp({create:canvas}).composite(layers).png().toFile(path.join(root,'previews','00-design-overview.png'));
console.log('已生成单文件预览、设计图画廊与总览图。');
