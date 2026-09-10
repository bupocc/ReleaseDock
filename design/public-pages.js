import { icon, logo, projectMark } from './icons.js';
import { projects, assets } from './data.js';
import { header, footer, platformIcons, url, toast } from './app.js';

function filesFor(project, version) {
  if (project.id === 'orbit') return assets.map(file=>({...file,name:file.name.replace('2.8.0',version)}));
  return project.platforms.map(system=>({ system, arch:system==='macOS'?'Apple Silicon':'x64', name:`${project.name}-${version}-${system.toLowerCase()}${system==='Windows'?'.exe':system==='macOS'?'.dmg':'.AppImage'}`, size:project.size, type:system==='Windows'?'安装程序':system==='macOS'?'磁盘映像':'AppImage', icon:system==='Windows'?'windows':system==='macOS'?'apple':'terminal' }));
}

function downloadRows(project, version) {
  return filesFor(project,version).map((file,index)=>`<div class="download-row"><span class="os-mark">${icon(file.icon,22)}</span><div class="download-file"><div><strong>${file.system}</strong><span class="tag">${file.arch}</span>${index===0?'<span class="recommended">常用版本</span>':''}</div><p class="mono">${file.name}</p></div><span class="file-size mono">${file.size}</span><button class="checksum" data-checksum="${file.name}" aria-label="查看 ${file.name} 的 SHA-256 校验信息">SHA-256 ${icon('copy',11)}</button><button class="btn ${index===0?'btn-primary':'btn-light'} btn-sm" data-toast="这是界面设计预览，真实安装包将在接入后端后提供。">${icon('download',14)}下载</button></div>`).join('');
}

function projectPage(params) {
  const project = projects.find(item=>item.id===params.get('id')) || projects[0];
  const requestedVersion = params.get('v');
  const version = requestedVersion && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(requestedVersion) ? requestedVersion : project.version;
  const history = project.id==='orbit' ? ['2.8.0','2.7.2','2.7.1','2.7.0','2.6.0'] : [project.version];
  const dates = ['2026.09.08','2026.08.22','2026.08.15','2026.08.01','2026.07.18'];
  const selectedIndex = Math.max(0,history.indexOf(version));
  const date = project.id==='orbit'?dates[selectedIndex]:project.date;
  const isLatest = version===project.version;
  document.title = `${project.name} v${version} · ReleaseDock`;
  return `${header()}<main class="container"><div class="breadcrumb"><a href="${url('home')}">全部项目</a>${icon('back',12,'style="transform:rotate(180deg)"')}<span>${project.name}</span></div><section class="project-header"><div class="project-identity">${projectMark(project.id,'large')}<div><div class="project-title-line"><h1>${project.name}</h1><span class="tag tag-outline">${project.category}</span></div><p>${project.subtitle} · ${project.description}</p></div></div><div class="project-actions"><button class="btn btn-light" id="share-project">${icon('link',15)}分享</button><a class="btn btn-primary" href="#downloads">${icon('download',16)}获取${isLatest?'最新':'此'}版本</a></div></section><div class="project-tabs"><a class="active" href="#releases">版本发布 <span class="mono">${project.releases.toString().padStart(2,'0')}</span></a><a href="#about-project">项目介绍</a><span class="project-platforms">${platformIcons(project.platforms)}<span>跨平台支持</span></span></div><div class="release-layout" id="releases"><aside class="version-sidebar"><div class="sidebar-label">版本历史 <span class="mono">${project.releases}</span></div><div class="version-nav">${history.map((item,i)=>`<a href="${url('project',`id=${project.id}&v=${item}`)}" class="${item===version?'active':''}"><span class="version-nav-dot"></span><div><strong class="mono">v${item}</strong>${i===0?'<span class="latest-text">最新</span>':''}<small class="mono">${project.id==='orbit'?dates[i]:project.date}</small></div>${item===version?icon('back',12,'style="transform:rotate(180deg)"'):''}</a>`).join('')}</div><div class="project-about" id="about-project"><h4>关于 ${project.name}</h4><p>${project.description}</p><dl><div><dt>累计下载</dt><dd class="mono">${project.downloads}</dd></div><div><dt>版本发布</dt><dd class="mono">${project.releases} 次</dd></div></dl></div><div class="sidebar-tip">${icon('shield',17)}<p>公开下载，无需登录。<br>安装前可核对文件校验值。</p></div></aside><section class="release-detail"><div class="release-topline"><div><h2 class="mono">v${version}</h2><span class="tag tag-green">稳定版</span>${isLatest?'<span class="latest-release">最新版本</span>':''}</div><span class="muted small">${icon('clock',13)} <span class="mono">${date}</span> 发布</span></div><div class="release-notes"><h3>${project.id==='orbit'&&isLatest?'更从容的工作，从更有序的桌面开始。':`${project.name} ${version} 更新已就绪。`}</h3><p>这次更新，我们把注意力放在了那些每天都会用到的细节上。</p><div class="note-group"><span class="note-icon added">+</span><div><h4>新增功能</h4><ul><li>${project.id==='orbit'?'全新快捷启动面板，应用与文件一搜即达。':'新增快捷操作入口，常用功能更容易找到。'}</li><li>${project.id==='orbit'?'支持多个工作区，自由切换不同工作状态。':'支持自定义工作配置，适应不同使用场景。'}</li></ul></div></div><div class="note-group"><span class="note-icon improved">↗</span><div><h4>体验优化</h4><ul><li>优化启动速度，减少后台资源占用。</li><li>改进高分辨率屏幕下的文字与图标显示。</li></ul></div></div><div class="note-group"><span class="note-icon fixed">✓</span><div><h4>问题修复</h4><ul><li>修复部分设备休眠后无法正常恢复的问题。</li></ul></div></div></div><section class="download-section" id="downloads"><div class="download-heading"><h3>下载安装包 <span class="count mono">${filesFor(project,version).length.toString().padStart(2,'0')}</span></h3><span>选择适合你设备的版本</span></div><div class="download-list">${downloadRows(project,version)}</div><div class="download-footnote">${icon('info',13)}macOS 用户请根据芯片类型选择 Apple Silicon 或 Intel 版本。</div></section></section></div>${footer()}</main>`;
}

function loginPage() {
  document.title = '管理员登录 · ReleaseDock';
  return `<div class="login-page"><a class="brand login-brand" href="${url('home')}">${logo()}<span class="brand-name">ReleaseDock</span></a><a class="login-back" href="${url('home')}">${icon('back',14)}返回发布中心</a><main class="login-shell"><section class="login-story"><div class="eyebrow">BUILT TO SHIP</div><h1>每一次发布，<br>都是新的开始。</h1><p>为好软件，留一个可靠的出发地。<br>管理项目、整理版本，把最新进展带给用户。</p><div class="login-release-art" aria-hidden="true"><div class="art-track"></div><div class="art-release art-release-old"><div><span class="art-dot"></span><span class="mono">v2.7.0</span></div><span>已发布 ${icon('check',12)}</span></div><div class="art-release art-release-mid"><div><span class="art-dot"></span><span class="mono">v2.7.2</span></div><span>已发布 ${icon('check',12)}</span></div><div class="art-release art-release-new"><div><span class="art-cube">${icon('box',23)}</span><span><strong class="mono">v2.8.0</strong><small>准备好，与世界见面。</small></span></div><span class="art-check">${icon('check',18)}</span></div></div><div class="login-story-foot"><span class="status-dot"></span>小而专注，为每一位创造者。</div></section><section class="login-form-side"><div class="login-key">${icon('key',26)}</div><div class="login-title"><h2>欢迎回来</h2><p>输入管理员密钥，进入你的发布工作台。</p></div><form id="login-form"><label class="form-label" for="admin-key">管理员密钥</label><div class="key-input">${icon('lock',17)}<input type="password" id="admin-key" placeholder="请输入管理员密钥" autocomplete="off" aria-describedby="login-help"><button type="button" id="toggle-key" aria-label="显示密钥">${icon('eye',18)}</button></div><div class="field-hint" id="login-help">密钥由站点管理员提供，请妥善保管。</div><button type="submit" class="btn btn-primary btn-wide login-submit">验证并进入 ${icon('arrow',17)}</button><p class="login-error" id="login-error" role="alert"></p></form><div class="login-divider"><span>仅供站点管理员使用</span></div><div class="login-security">${icon('shield',17)}<p>访问项目和下载软件无需登录。<br>如果你只是来获取软件，请直接返回发布中心。</p></div><a class="login-demo" href="${url('overview')}">预览后台设计 ${icon('arrow',13)}</a><p class="login-demo-hint">当前为设计稿，请勿输入真实密钥。</p></section></main><footer class="login-footer"><span>© 2026 ReleaseDock</span><span>让发布简单一点。</span><span>界面设计稿 · 示例数据</span></footer></div>`;
}

function activityPage() {
  document.title = '更新动态 · ReleaseDock';
  return `${header('activity')}<main class="container activity-page"><div class="eyebrow">WHAT'S NEW</div><h1>每一步，都在向前。</h1><p class="muted">所有项目的最新版本，在这里一览。</p><div class="activity-list">${projects.map((project,i)=>`<article class="activity-item"><span class="activity-date mono">${project.date}</span><span class="activity-dot"></span><div class="activity-content"><div class="activity-project">${projectMark(project.id,'small')}<h2>${project.name}</h2><span class="mono">v${project.version}</span><span class="tag tag-green">稳定版</span></div><p>${i===0?'全新快捷启动面板、多工作区支持，以及多项体验优化。':`${project.subtitle}迎来新版本，带来功能改进与稳定性提升。`}</p><a class="link-button" href="${url('project',`id=${project.id}`)}">查看更新与下载 ${icon('arrow',14)}</a></div></article>`).join('')}</div>${footer()}</main>`;
}

export function renderPublic(page,params) {
  if (page==='project') return projectPage(params);
  if (page==='login') return loginPage();
  return activityPage();
}

export function bindPublic(page) {
  if (page==='login') {
    const input = document.querySelector('#admin-key');
    document.querySelector('#toggle-key').addEventListener('click',event=>{ const visible=input.type==='password';input.type=visible?'text':'password';event.currentTarget.setAttribute('aria-label',visible?'隐藏密钥':'显示密钥'); });
    document.querySelector('#login-form').addEventListener('submit',event=>{
      event.preventDefault();
      document.querySelector('#login-error').textContent = input.value ? '这是设计预览，不会发送或验证密钥。请使用下方「预览后台设计」。' : '请输入管理员密钥；查看设计稿请使用下方预览入口。';
      input.value='';
    });
  }
  if (page==='project') {
    document.querySelector('#share-project').addEventListener('click',async()=>{
      try {await navigator.clipboard.writeText(location.href);toast('项目链接已复制。');}catch{toast('当前浏览器未开放剪贴板，可直接复制地址栏中的链接。');}
    });
    document.querySelectorAll('[data-checksum]').forEach(button=>button.addEventListener('click',()=>toast('设计预览：正式发布时将显示由服务器计算的 SHA-256 文件校验值。')));
  }
}
