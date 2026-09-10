import { icon, logo, projectMark } from './icons.js';
import { projects, releases, assets } from './data.js';
import { url, toast } from './app.js';

const labels = {overview:'概览',projects:'项目管理',releases:'版本管理',files:'文件管理','project-edit':'项目配置',publish:'发布新版本',settings:'站点设置'};
const navItems = [['overview','grid','概览'],['projects','box','项目管理'],['releases','layers','版本管理'],['files','folder','文件管理']];

export function adminShell(page,content) {
  const active = page==='project-edit'?'projects':page==='publish'?'releases':page;
  return `<div class="admin-shell"><aside class="admin-sidebar"><a class="brand admin-brand" href="${url('overview')}">${logo()}<span class="brand-name">ReleaseDock</span></a><div class="admin-workspace"><span class="workspace-icon">${icon('layers',19)}</span><div><strong>软件发布中心</strong><small>管理控制台</small></div><span class="workspace-badge">PRO</span></div><div class="admin-nav-label">工作台</div><nav class="admin-nav" aria-label="后台导航">${navItems.map(([id,mark,name])=>`<a href="${url(id)}" class="${active===id?'active':''}">${icon(mark,17)}<span>${name}</span>${id==='projects'?'<small class="mono">6</small>':id==='releases'?'<small class="nav-dot"></small>':''}</a>`).join('')}</nav><div class="admin-nav-label secondary">管理</div><nav class="admin-nav"><a href="${url('settings')}" class="${active==='settings'?'active':''}">${icon('settings',17)}<span>站点设置</span></a><a href="${url('home')}">${icon('external',16)}<span>访问发布中心</span></a></nav><div class="sidebar-bottom"><div class="storage-widget"><div><span>${icon('folder',13)}存储空间</span><span class="mono">6.4%</span></div><div class="storage-track"><span></span></div><p><strong class="mono">1.28 GB</strong> / <span class="mono">20 GB</span><span>示例</span></p></div><div class="admin-account"><span class="avatar">A</span><div><strong>管理员</strong><small><span class="status-dot"></span>密钥登录</small></div><a href="${url('login')}" aria-label="退出管理预览">${icon('logout',16)}</a></div></div></aside><div class="admin-body"><header class="admin-topbar"><div class="admin-breadcrumb"><span>工作台</span>${icon('back',12,'style="transform:rotate(180deg)"')}<strong>${labels[page]||'概览'}</strong></div><div class="admin-topbar-right"><span class="preview-label"><span class="status-dot"></span>设计预览</span><a href="${url('home')}">预览站点 ${icon('diagonal',13)}</a><span class="topbar-divider"></span><span class="avatar small-avatar">A</span></div></header><main class="admin-content">${content}<footer class="admin-footer"><span>ReleaseDock <span class="mono">v1.0</span></span><span>界面设计稿 · 所有数据均为示例</span></footer></main></div></div>`;
}

function pageHeading(title,subtitle,actions='') {
  return `<div class="admin-page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;
}

function releaseTable(items,full=false) {
  return `<div class="table-scroll"><table class="data-table release-table"><thead><tr><th>项目 / 版本</th>${full?'<th>发布渠道</th>':''}<th>状态</th><th>更新时间</th><th class="align-right">下载次数</th><th class="align-right">操作</th></tr></thead><tbody>${items.map(release=>{ const project=projects.find(item=>item.id===release.project);return `<tr data-release-status="${release.status}" data-release-search="${project.name} ${release.version}"><td><div class="table-project">${projectMark(project.id,'small')}<div><strong>${project.name}</strong><span class="mono">v${release.version}</span></div>${release.version==='2.8.0'?'<span class="table-latest">最新</span>':''}</div></td>${full?`<td><span class="tag ${release.channel==='稳定版'?'tag-green':'tag-orange'}">${release.channel}</span></td>`:''}<td><span class="release-status ${release.status==='草稿'?'draft':''}"><span></span>${release.status}</span></td><td class="table-date mono">${release.date}</td><td class="align-right mono table-number">${release.downloads}</td><td class="align-right"><a class="table-action" href="${release.status==='草稿'?url('publish'):url('project',`id=${project.id}`)}">${release.status==='草稿'?'继续编辑':'查看版本'} ${icon('arrow',12)}</a></td></tr>`;}).join('')}</tbody></table></div>`;
}

function trendChart() {
  return `<svg class="trend-chart" viewBox="0 0 650 192" role="img" aria-label="最近七天下载次数依次为182、231、214、345、402、370和512"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#dcebd0" stop-opacity=".85"/><stop offset="100%" stop-color="#edf4e6" stop-opacity=".1"/></linearGradient></defs>${[22,65,108,151].map((y,i)=>`<line x1="31" x2="637" y1="${y}" y2="${y}" stroke="#edf0e8" stroke-dasharray="3 5"/><text x="1" y="${y+3}" fill="#a8b29c" font-size="9">${600-i*200}</text>`).join('')}<path d="M38 112 C75 112 97 91 135 100 S194 112 235 105 S294 68 335 76 S397 47 435 63 S499 75 535 71 S589 35 633 41 L633 151 L38 151Z" fill="url(#chart-fill)"/><path d="M38 112 C75 112 97 91 135 100 S194 112 235 105 S294 68 335 76 S397 47 435 63 S499 75 535 71 S589 35 633 41" stroke="#648a55" fill="none" stroke-width="2.4" stroke-linecap="round"/><circle cx="435" cy="63" r="4" stroke="white" stroke-width="2" fill="#608451"/><rect x="404" y="16" width="62" height="26" rx="5" fill="#294831"/><text x="435" y="33" text-anchor="middle" fill="#eef5e2" font-size="11">402 次</text>${['09.04','09.05','09.06','09.07','09.08','09.09','09.10'].map((date,i)=>`<text x="${38+i*99}" y="178" text-anchor="middle" fill="#9eaa90" font-size="10">${date}</text>`).join('')}</svg>`;
}

function overviewPage() {
  return `${pageHeading('让好软件，持续向前。','这里是你的发布工作台，一览项目进展与最近动态。',`<a class="btn btn-light" href="${url('project-edit','new=1')}">${icon('plus',15)}新建项目</a><a class="btn btn-primary" href="${url('publish')}">${icon('plus',15)}发布新版本</a>`)}<section class="stats-grid">${[['box','项目总数','6','全部公开','6 个项目正在被看见'],['layers','已发布版本','24','本月 +4','持续迭代，保持更新'],['download','累计下载','38,400','+18.6%','近 7 天 2,256 次下载'],['folder','文件存储','1.28','GB','64 个安装包与附件']].map(([mark,title,value,badge,note],i)=>`<article class="stat-card"><div class="stat-label"><span>${title}</span>${icon(mark,17)}</div><div class="stat-value mono">${value}${i===3?`<span class="stat-unit">${badge}</span>`:`<span class="stat-badge ${i===2?'up':''}">${i===2?'↗ ':''}${badge}</span>`}</div><p>${note}</p></article>`).join('')}</section><div class="overview-mid"><section class="panel chart-panel"><div class="panel-heading"><div><h2>下载趋势</h2><p>了解软件如何抵达更多用户</p></div><span class="period-pill">最近 7 天</span></div><div class="chart-summary"><strong class="mono">2,256</strong><span>次下载</span><span class="chart-growth">↗ 18.6%</span><small>较前 7 天</small></div>${trendChart()}</section><aside class="panel upcoming-panel"><div class="panel-heading"><h2>待办发布 <span class="mini-count mono">01</span></h2>${icon('edit',15)}</div><div class="upcoming-project">${projectMark('orbit','small')}<span>Orbit</span><span class="tag tag-orange">草稿</span></div><h3 class="mono">v2.9.0-beta.1</h3><p>下一段更流畅的工作体验。<br>新版本正在准备，与用户见面前再检查一次。</p><div class="draft-detail"><span>${icon('file',13)}3 个安装包</span><span>${icon('clock',13)}今天 10:42</span></div><a class="btn btn-soft btn-wide" href="${url('publish')}">继续编辑 ${icon('arrow',14)}</a></aside></div><section class="panel recent-panel"><div class="panel-heading"><div><h2>最近版本</h2><p>项目的每一步更新，都值得记录</p></div><a class="link-button" href="${url('releases')}">全部版本 ${icon('arrow',14)}</a></div>${releaseTable(releases.slice(0,4))}</section><div class="admin-tip">${icon('info',14)}<span>小提示：发布前可以先保存草稿。只有正式发布的版本，才会出现在公开页面。</span><a href="${url('publish')}">创建一个新版本 ${icon('arrow',12)}</a></div>`;
}

function projectsPage() {
  return `${pageHeading('项目管理','管理每个项目的信息、可见性和版本发布。',`<a class="btn btn-primary" href="${url('project-edit','new=1')}">${icon('plus',15)}新建项目</a>`)}<div class="admin-summary-line"><span><strong class="mono">6</strong> 个项目</span><span><i class="status-dot"></i>全部公开</span><span>最近更新于 <span class="mono">2026.09.08</span></span></div><section class="panel projects-panel"><div class="admin-table-toolbar"><div class="table-tabs" role="group" aria-label="项目状态"><button class="active" data-project-state="all">全部项目 <span class="mono">6</span></button><button data-project-state="public">已公开 <span class="mono">6</span></button><button data-project-state="hidden">已隐藏 <span class="mono">0</span></button></div><label class="search-field">${icon('search',15)}<input id="admin-project-search" type="search" aria-label="搜索项目" placeholder="搜索项目…"></label></div><div class="table-scroll"><table class="data-table project-management-table"><thead><tr><th>项目</th><th>最新版本</th><th>可见性</th><th>版本数</th><th class="align-right">累计下载</th><th>最近更新</th><th class="align-right">操作</th></tr></thead><tbody id="admin-project-rows">${projects.map(project=>`<tr data-project-name="${project.name} ${project.subtitle}"><td><a class="table-project" href="${url('project-edit',`id=${project.id}`)}">${projectMark(project.id)}<div><strong>${project.name}</strong><span>${project.subtitle}</span></div></a></td><td><span class="table-version mono">v${project.version}</span></td><td><span class="release-status"><span></span>公开</span></td><td class="mono table-number">${project.releases}</td><td class="mono table-number align-right">${project.downloads}</td><td class="table-date mono">${project.date}</td><td class="align-right"><div class="table-actions"><a href="${url('project-edit',`id=${project.id}`)}" aria-label="配置 ${project.name}">${icon('edit',15)}</a><a href="${url('project',`id=${project.id}`)}" aria-label="预览 ${project.name}">${icon('external',14)}</a></div></td></tr>`).join('')}</tbody></table></div><div class="table-empty" id="projects-empty" hidden>没有匹配的项目。</div><div class="table-pagination"><span id="project-count-label">共 6 个项目</span><div><span>每页 <strong class="mono">10</strong> 条</span><span class="page-number mono">1</span></div></div></section><div class="project-help-grid"><section class="project-help"><span class="help-icon">${icon('box',23)}</span><div><h3>从一个新项目开始</h3><p>为你的软件添加名称、介绍和图标，给每个版本一个清晰的归属。</p><a href="${url('project-edit','new=1')}" class="link-button">创建新项目 ${icon('arrow',13)}</a></div></section><section class="project-help"><span class="help-icon">${icon('eye',23)}</span><div><h3>公开什么，由你决定</h3><p>隐藏项目会同时隐藏其公开版本。草稿文件始终只对管理员可见。</p><a href="${url('project-edit')}" class="link-button">了解项目设置 ${icon('arrow',13)}</a></div></section></div>`;
}

function releasesPage() {
  return `${pageHeading('版本管理','整理每次更新，让发布过程清晰、有序。',`<a class="btn btn-primary" href="${url('publish')}">${icon('plus',15)}发布新版本</a>`)}<div class="release-summary"><div><span class="summary-square">${icon('layers',20)}</span><strong class="mono">24</strong><span>已发布版本</span></div><div><span class="summary-square amber">${icon('edit',20)}</span><strong class="mono">1</strong><span>待发布草稿</span></div><div><span class="summary-square">${icon('box',20)}</span><strong class="mono">6</strong><span>项目持续更新</span></div></div><section class="panel"><div class="admin-table-toolbar"><div class="table-tabs" role="group" aria-label="版本状态"><button class="active" data-release-filter="all">全部版本</button><button data-release-filter="已发布">已发布</button><button data-release-filter="草稿">草稿 <span class="draft-count mono">1</span></button></div><label class="search-field">${icon('search',15)}<input type="search" id="release-search" placeholder="搜索项目、版本号…" aria-label="搜索版本"></label></div>${releaseTable(releases,true)}<div class="table-empty" id="releases-empty" hidden>没有匹配的版本。</div><div class="table-pagination"><span id="release-count-label">展示最近 5 个版本 · 示例数据</span><span>版本按更新时间排序</span></div></section><div class="release-workflow"><span>一个版本的旅程</span><div><span>${icon('edit',16)}保存草稿</span><i></i><span>${icon('upload',16)}添加安装包</span><i></i><span>${icon('eye',16)}检查预览</span><i></i><span>${icon('check',16)}正式发布</span></div></div>`;
}

function filesPage() {
  return `${pageHeading('文件管理','查看版本附件及其归属；安装包通过发布页面统一添加。',`<a class="btn btn-primary" href="${url('publish')}">${icon('upload',15)}添加版本文件</a>`)}<section class="panel"><div class="panel-heading"><h2>最近上传的安装包</h2><span class="tag tag-outline">Orbit · v2.8.0</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>文件名称</th><th>平台</th><th>架构</th><th>文件大小</th><th>所属版本</th><th>状态</th></tr></thead><tbody>${assets.map(file=>`<tr><td><span class="file-name-cell">${icon('file',18)}<span class="mono">${file.name}</span></span></td><td>${file.system}</td><td>${file.arch}</td><td class="mono">${file.size}</td><td class="mono">v2.8.0</td><td><span class="release-status"><span></span>可下载</span></td></tr>`).join('')}</tbody></table></div></section><div class="admin-tip">${icon('info',14)}文件的公开状态跟随所属版本。发布草稿前，附件不会对访客开放。</div>`;
}

function settingsPage() {
  return `${pageHeading('站点设置','调整发布中心的名称与公开介绍。')}<form class="panel site-settings-form" id="site-settings-form"><div class="panel-heading"><h2>基本信息</h2><span class="tag tag-outline">站点级配置</span></div><div class="settings-fields"><label><span class="form-label">站点名称</span><input name="siteName" required maxlength="50" value="ReleaseDock"></label><label><span class="form-label">站点简介</span><textarea rows="3" name="description">发现我们的软件项目，获取最新稳定版本。</textarea></label><label><span class="form-label">站点公告</span><textarea rows="3" name="announcement" placeholder="可选，在公开首页显示的简短公告"></textarea></label><div class="settings-notice">${icon('shield',18)}<p>管理员密钥通过服务器配置管理。此页不显示或保存密钥。</p></div><button class="btn btn-primary" type="submit">${icon('check',15)}保存设置</button></div></form>`;
}

export async function renderAdmin(page,params) {
  document.title = `${labels[page]||'概览'} · ReleaseDock`;
  let content;
  if (['publish','project-edit'].includes(page)) {
    const forms = await import('./admin-forms.js');
    content = forms.renderAdminForm(page,params);
  } else content = ({overview:overviewPage,projects:projectsPage,releases:releasesPage,files:filesPage,settings:settingsPage}[page]||overviewPage)();
  return adminShell(page,content);
}

export async function bindAdmin(page,params) {
  if (['publish','project-edit'].includes(page)) {
    const forms = await import('./admin-forms.js');
    forms.bindAdminForm(page,params);
  }
  if (page==='projects') {
    let state='all';
    const update=()=>{
      const term=document.querySelector('#admin-project-search').value.trim().toLowerCase();
      let visible=0;
      document.querySelectorAll('[data-project-name]').forEach(row=>{row.hidden=state==='hidden'||!row.dataset.projectName.toLowerCase().includes(term);if(!row.hidden)visible++;});
      document.querySelector('#projects-empty').hidden=visible>0;
      document.querySelector('#project-count-label').textContent=`共 ${visible} 个项目`;
    };
    document.querySelector('#admin-project-search').addEventListener('input',update);
    document.querySelectorAll('[data-project-state]').forEach(button=>button.addEventListener('click',()=>{state=button.dataset.projectState;document.querySelectorAll('[data-project-state]').forEach(item=>item.classList.toggle('active',item===button));update();}));
  }
  if (page==='releases') {
    let state='all';
    const update=()=>{
      const term=document.querySelector('#release-search').value.trim().toLowerCase();
      let visible=0;
      document.querySelectorAll('[data-release-status]').forEach(row=>{row.hidden=(state!=='all'&&row.dataset.releaseStatus!==state)||!row.dataset.releaseSearch.toLowerCase().includes(term);if(!row.hidden)visible++;});
      document.querySelector('#releases-empty').hidden=visible>0;
      document.querySelector('#release-count-label').textContent=`显示 ${visible} 个版本 · 示例数据`;
    };
    document.querySelector('#release-search').addEventListener('input',update);
    document.querySelectorAll('[data-release-filter]').forEach(button=>button.addEventListener('click',()=>{state=button.dataset.releaseFilter;document.querySelectorAll('[data-release-filter]').forEach(item=>item.classList.toggle('active',item===button));update();}));
  }
  if (page==='settings') document.querySelector('#site-settings-form').addEventListener('submit',event=>{event.preventDefault();toast('设置已在当前设计预览中确认；正式持久化将在后端实现。');});
}
