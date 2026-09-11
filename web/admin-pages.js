import { icon, logo, projectMark } from './icons.js';
import { api, escapeHtml as e, formatBytes, formatDate, formatNumber, copyText } from './api.js';
import { url, toast } from './app.js';
import { assetRenameButton, openAssetRename } from './asset-rename.js';
import { enhanceSelects } from './select-control.js';
import { platformLabel } from './platforms.js';
import { renderPasskeySettings, bindPasskeySettings } from './passkeys.js';

const displayVersion = value => String(value ?? '');

const labels = { overview: '概览', projects: '项目管理', releases: '版本管理', files: '文件管理', 'project-edit': '项目配置', publish: '版本发布', settings: '站点设置' };
const navItems = [['overview', 'grid', '概览'], ['projects', 'box', '项目管理'], ['releases', 'layers', '版本管理'], ['files', 'folder', '文件管理']];

export function adminShell(page, content, data) {
  const active = page === 'project-edit' ? 'projects' : page === 'publish' ? 'releases' : page;
  const name = e(data.site.name);
  return `<div class="admin-shell"><button class="admin-menu-backdrop" id="admin-menu-backdrop" aria-label="关闭导航" tabindex="-1" hidden></button><aside class="admin-sidebar" id="admin-sidebar"><a class="brand admin-brand" href="${url('overview')}">${logo()}<span class="brand-name">${name}</span></a><div class="admin-workspace"><span class="workspace-icon">${icon('layers', 19)}</span><div><strong>软件发布中心</strong><small>管理控制台</small></div></div><div class="admin-nav-label">工作台</div><nav class="admin-nav" aria-label="后台导航">${navItems.map(([id, mark, title]) => `<a href="${url(id)}" class="${active === id ? 'active' : ''}" ${active === id ? 'aria-current="page"' : ''}>${icon(mark, 17)}<span>${title}</span></a>`).join('')}</nav><div class="admin-nav-label secondary">管理</div><nav class="admin-nav" aria-label="站点管理"><a href="${url('settings')}" class="${active === 'settings' ? 'active' : ''}">${icon('settings', 17)}<span>站点设置</span></a><a href="${url('home')}">${icon('external', 16)}<span>访问发布中心</span></a></nav><div class="sidebar-bottom"><div class="sidebar-release-note">${icon('shield', 17)}<p>每一次更新，<br>都从这里抵达用户。</p></div><div class="admin-account"><span class="avatar">A</span><div><strong>管理员</strong><small><span class="status-dot"></span>已登录</small></div><button class="logout-icon" data-logout aria-label="退出登录">${icon('logout', 16)}</button></div></div></aside><div class="admin-body"><header class="admin-topbar"><div class="admin-breadcrumb"><button id="admin-menu-toggle" class="admin-menu-toggle" aria-label="打开管理导航" aria-expanded="false" aria-controls="admin-sidebar">${icon('menu', 20)}</button><span>工作台</span>${icon('back', 12, 'class="rotate-arrow"')}<strong>${labels[page] || '概览'}</strong></div><div class="admin-topbar-right"><a href="${url('home')}">访问站点 ${icon('diagonal', 13)}</a><span class="topbar-divider"></span><button class="topbar-logout" data-logout>${icon('logout', 15)}<span>退出登录</span></button></div></header><main class="admin-content" id="main-content">${content}<footer class="admin-footer"><span>${name}</span><span>每一次更新，都在这里。</span></footer></main></div></div>`;
}

function pageHeading(title, subtitle, actions = '') {
  return `<div class="admin-page-heading"><div><h1>${e(title)}</h1><p>${e(subtitle)}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
}

function emptyState(title, copy, action = '', mark = 'box') {
  return `<div class="admin-empty"><span class="state-icon">${icon(mark, 28)}</span><h3>${e(title)}</h3><p>${e(copy)}</p>${action}</div>`;
}

function statusBadge(status) {
  const states = { draft: ['draft', '草稿'], published: ['', '已发布'], withdrawn: ['withdrawn', '已下架'] };
  const [style, label] = states[status] || ['withdrawn', '未发布'];
  return `<span class="release-status ${style}"><span></span>${label}</span>`;
}

function projectFor(release, projects = []) {
  return release.project || projects.find((project) => project.id === release.projectId) || { id: release.projectId, name: release.projectName || '项目', slug: release.projectSlug || '' };
}

function releaseTable(items, full = false, projects = []) {
  return `<div class="table-scroll"><table class="data-table release-table"><thead><tr><th scope="col">项目 / 版本</th>${full ? '<th scope="col">发布渠道</th>' : ''}<th scope="col">状态</th><th scope="col">更新时间</th><th scope="col" class="align-right">下载次数</th><th scope="col" class="align-right">操作</th></tr></thead><tbody>${items.map((release) => {
    const project = projectFor(release, projects);
    const publicLink = release.status === 'published' && project.slug && project.isPublic !== false;
    return `<tr data-row data-state="${e(release.status)}" data-search="${e(`${project.name} ${release.version} ${release.title}`)}"><td><div class="table-project">${projectMark(project, 'small')}<div><strong>${e(project.name)}</strong><span class="mono">${e(displayVersion(release.version))}</span></div>${release.isLatest && release.status === 'published' ? '<span class="table-latest">最新</span>' : ''}</div></td>${full ? `<td><span class="tag ${release.channel === 'prerelease' ? 'tag-orange' : 'tag-green'}">${release.channel === 'prerelease' ? '预发布版' : '稳定版'}</span></td>` : ''}<td>${statusBadge(release.status)}</td><td class="table-date mono">${formatDate(release.updatedAt || release.publishedAt)}</td><td class="align-right mono table-number">${release.downloadCount == null ? '—' : formatNumber(release.downloadCount)}</td><td class="align-right"><div class="release-row-actions"><a class="table-action" href="${url('publish', { id: release.id })}">编辑 ${icon('edit', 13)}</a>${publicLink ? `<a class="table-action" href="${url('project', { slug: project.slug, version: release.version })}" aria-label="查看 ${e(project.name)} ${e(displayVersion(release.version))} 的公开页面">${icon('external', 14)}${full ? '公开页' : ''}</a>` : ''}${full && release.status === 'published' ? `<button class="table-action withdraw-action" data-withdraw="${e(release.id)}" data-release-name="${e(`${project.name} ${displayVersion(release.version)}`)}">下架</button>` : ''}</div></td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function trendChart(trend) {
  if (!trend.length) return emptyState('还没有下载记录', '发布第一个版本后，在这里查看每天的下载情况。', '', 'chart');
  const values = trend.map((point) => Math.max(0, Number(point.count) || 0));
  const max = Math.max(...values, 3);
  const ceiling = Math.ceil(max / 3) * 3;
  const points = values.map((value, index) => ({ x: trend.length > 1 ? 42 + index * (590 / (trend.length - 1)) : 337, y: 154 - value / ceiling * 126 }));
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const area = `${line} L${points.at(-1).x.toFixed(1)} 154 L${points[0].x.toFixed(1)} 154 Z`;
  return `<svg class="trend-chart" viewBox="0 0 650 202" role="img" aria-label="最近 ${trend.length} 天下载趋势，合计 ${values.reduce((sum, value) => sum + value, 0)} 次"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#dcebd0" stop-opacity=".85"/><stop offset="100%" stop-color="#edf4e6" stop-opacity=".12"/></linearGradient></defs>${[0, 1, 2, 3].map((row) => `<line x1="40" x2="635" y1="${28 + row * 42}" y2="${28 + row * 42}" stroke="#e5ebe0" stroke-dasharray="3 5"/><text x="3" y="${32 + row * 42}" fill="#73816b" font-size="10">${formatNumber(ceiling - row * ceiling / 3)}</text>`).join('')}<path d="${area}" fill="url(#chart-fill)"/><path d="${line}" stroke="#648a55" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>${points.map((point, index) => `<circle cx="${point.x}" cy="${point.y}" r="3.5" fill="#527c46" stroke="white" stroke-width="1.5"><title>${e(trend[index].date)}：${values[index]} 次下载</title></circle><text x="${point.x}" y="184" text-anchor="middle" fill="#6f7b66" font-size="10">${e(formatDate(trend[index].date).slice(5))}</text>`).join('')}</svg><details class="chart-data"><summary>查看每日数据</summary><div class="chart-data-list">${trend.map((point, index) => `<div><span class="mono">${e(formatDate(point.date))}</span><strong class="mono">${formatNumber(values[index])} 次</strong></div>`).join('')}</div></details>`;
}

function overviewPage(data) {
  const counts = data.counts || {};
  const trend = data.trend || [];
  const drafts = data.drafts || [];
  const recent = data.recentReleases || [];
  const total = trend.reduce((sum, point) => sum + (Number(point.count) || 0), 0);
  const draft = drafts[0];
  const stats = [
    ['box', '项目总数', formatNumber(counts.projects), '每个项目，都有自己的发布空间'],
    ['layers', '已发布版本', formatNumber(counts.releases), `${formatNumber(counts.drafts)} 个版本等待发布`],
    ['download', '累计下载', formatNumber(counts.downloads), `最近 ${trend.length || 7} 天 ${formatNumber(total)} 次下载`],
    ['folder', '文件存储', formatBytes(counts.storageBytes), `${formatNumber(counts.assets)} 个安装包与附件`],
  ];
  return `${pageHeading('让好软件，持续向前。', '这里是你的发布工作台，一览项目进展与最近动态。', `<a class="btn btn-light" href="${url('project-edit', 'new=1')}">${icon('plus', 15)}新建项目</a><a class="btn btn-primary" href="${url('publish')}">${icon('plus', 15)}发布新版本</a>`)}<section class="stats-grid" aria-label="发布统计">${stats.map(([mark, title, value, note]) => `<article class="stat-card"><div class="stat-label"><span>${title}</span>${icon(mark, 17)}</div><div class="stat-value mono">${value}</div><p>${note}</p></article>`).join('')}</section>${!counts.projects ? `<section class="onboarding-panel"><span class="onboarding-mark">${icon('box', 30)}</span><div><h2>从你的第一个项目开始。</h2><p>添加项目信息，上传安装包，再把新版本分享给用户。</p></div><a class="btn btn-primary" href="${url('project-edit', 'new=1')}">${icon('plus', 15)}创建项目</a></section>` : ''}<div class="overview-mid"><section class="panel chart-panel"><div class="panel-heading"><div><h2>下载趋势</h2><p>了解软件如何抵达更多用户</p></div><span class="period-pill">最近 ${trend.length || 7} 天</span></div><div class="chart-summary"><strong class="mono">${formatNumber(total)}</strong><span>次下载</span></div>${trendChart(trend)}</section><aside class="panel upcoming-panel"><div class="panel-heading"><h2>待办发布 <span class="mini-count mono">${formatNumber(counts.drafts)}</span></h2>${icon('edit', 15)}</div>${draft ? `<div class="upcoming-project">${projectMark(projectFor(draft), 'small')}<span>${e(projectFor(draft).name)}</span><span class="tag tag-orange">草稿</span></div><h3 class="mono">${e(displayVersion(draft.version))}</h3><p>${e(draft.title || '完善更新说明和安装包，准备下一次发布。')}</p><div class="draft-detail">${draft.assetCount != null ? `<span>${icon('file', 13)}${formatNumber(draft.assetCount)} 个文件</span>` : ''}<span>${icon('clock', 13)}${formatDate(draft.updatedAt)}</span></div><a class="btn btn-soft btn-wide" href="${url('publish', { id: draft.id })}">继续编辑 ${icon('arrow', 14)}</a>` : `<div class="draft-clear"><span class="clear-check">${icon('check', 25)}</span><h3>所有发布，井然有序。</h3><p>目前没有待发布的草稿。<br>新想法准备好了，就开始下一次更新。</p><a class="link-button" href="${url('publish')}">创建新版本 ${icon('arrow', 14)}</a></div>`}</aside></div><section class="panel recent-panel"><div class="panel-heading"><div><h2>最近版本</h2><p>项目的每一步更新，都值得记录</p></div><a class="link-button" href="${url('releases')}">全部版本 ${icon('arrow', 14)}</a></div>${recent.length ? releaseTable(recent.slice(0, 5)) : emptyState('还没有版本记录', '先创建项目，再为它添加第一个版本。', `<a class="btn btn-light" href="${url(counts.projects ? 'publish' : 'project-edit', counts.projects ? '' : 'new=1')}">${counts.projects ? '创建新版本' : '创建项目'} ${icon('arrow', 14)}</a>`, 'layers')}</section><div class="admin-tip">${icon('info', 14)}<span>发布前可以先保存草稿。只有已公开项目的已发布版本，才会出现在公开页面。</span></div>`;
}

function pagination(noun, count) {
  return `<div class="table-pagination"><span id="table-count-label" aria-live="polite">共 ${count} 个${noun}</span><div class="pagination-controls"><button class="pagination-button" id="table-prev" aria-label="上一页">${icon('back', 14)}</button><span class="mono" id="table-page-label">1 / ${Math.max(1, Math.ceil(count / 10))}</span><button class="pagination-button" id="table-next" aria-label="下一页">${icon('back', 14, 'class="rotate-arrow"')}</button></div></div>`;
}

function projectsPage(data) {
  const projects = data.projects || [];
  const publicCount = projects.filter((project) => project.isPublic).length;
  return `${pageHeading('项目管理', '管理每个项目的信息、可见性和版本发布。', `<a class="btn btn-primary" href="${url('project-edit', 'new=1')}">${icon('plus', 15)}新建项目</a>`)}<div class="admin-summary-line"><span><strong class="mono">${projects.length}</strong> 个项目</span><span><i class="status-dot"></i>${publicCount} 个公开项目</span><span>隐藏项目及其版本不会出现在公开页面</span></div><section class="panel projects-panel"><div class="admin-table-toolbar"><div class="table-tabs" role="group" aria-label="项目状态"><button class="active" data-table-filter="all" aria-pressed="true">全部项目 <span class="mono">${projects.length}</span></button><button data-table-filter="public" aria-pressed="false">已公开 <span class="mono">${publicCount}</span></button><button data-table-filter="hidden" aria-pressed="false">已隐藏 <span class="mono">${projects.length - publicCount}</span></button></div><label class="search-field">${icon('search', 15)}<input id="table-search" type="search" aria-label="搜索项目" placeholder="搜索项目名称、标识…"></label></div>${projects.length ? `<div class="table-scroll"><table class="data-table project-management-table"><thead><tr><th scope="col">项目</th><th scope="col">最新版本</th><th scope="col">可见性</th><th scope="col">版本数</th><th scope="col" class="align-right">累计下载</th><th scope="col">最近更新</th><th scope="col" class="align-right">操作</th></tr></thead><tbody>${projects.map((project) => `<tr data-row data-state="${project.isPublic ? 'public' : 'hidden'}" data-search="${e(`${project.name} ${project.subtitle} ${project.slug}`)}"><td><a class="table-project" href="${url('project-edit', { id: project.id })}">${projectMark(project)}<div><strong>${e(project.name)}</strong><span>${e(project.subtitle || project.slug)}</span></div></a></td><td><span class="table-version mono">${project.latestVersion ? e(displayVersion(typeof project.latestVersion === 'object' ? project.latestVersion.version : project.latestVersion)) : '—'}</span></td><td><span class="release-status ${project.isPublic ? '' : 'withdrawn'}"><span></span>${project.isPublic ? '公开' : '隐藏'}</span></td><td><a class="mono table-number" href="${url('releases', { projectId: project.id })}" aria-label="查看 ${e(project.name)} 的版本">${formatNumber(project.releaseCount)}</a></td><td class="mono table-number align-right">${formatNumber(project.downloadCount)}</td><td class="table-date mono">${formatDate(project.updatedAt)}</td><td class="align-right"><div class="table-actions"><a href="${url('publish', { project: project.id })}" title="为此项目发布新版本" aria-label="为 ${e(project.name)} 发布新版本">${icon('plus', 15)}</a><a href="${url('project-edit', { id: project.id })}" title="配置项目" aria-label="配置 ${e(project.name)}">${icon('edit', 15)}</a>${project.isPublic ? `<a href="${url('project', { slug: project.slug })}" title="查看公开页面" aria-label="查看 ${e(project.name)} 的公开页面">${icon('external', 14)}</a>` : ''}</div></td></tr>`).join('')}</tbody></table></div>` : emptyState('创建第一个项目', '填写软件名称与介绍，让每一个版本都有清晰的归属。', `<a class="btn btn-primary" href="${url('project-edit', 'new=1')}">${icon('plus', 15)}新建项目</a>`)}<div class="table-empty" id="table-empty" hidden>没有匹配的项目，试试其他关键词或可见性。</div>${pagination('项目', projects.length)}</section><div class="project-help-grid"><section class="project-help"><span class="help-icon">${icon('box', 23)}</span><div><h3>从一个新项目开始</h3><p>添加名称、介绍和图标，给软件一个清晰的发布空间。</p><a href="${url('project-edit', 'new=1')}" class="link-button">创建新项目 ${icon('arrow', 13)}</a></div></section><section class="project-help"><span class="help-icon">${icon('eye', 23)}</span><div><h3>公开什么，由你决定</h3><p>隐藏项目会同时隐藏其公开版本。草稿文件始终不会对访客开放。</p><span class="help-caption">在项目配置中调整可见性</span></div></section></div>`;
}

function releasesPage(params, data) {
  const releases = data.releases || [];
  const published = releases.filter((release) => release.status === 'published').length;
  const drafts = releases.filter((release) => release.status === 'draft').length;
  const withdrawn = releases.filter((release) => release.status === 'withdrawn').length;
  return `${pageHeading('版本管理', '整理每次更新，让发布过程清晰、有序。', `<a class="btn btn-primary" href="${url('publish', params.get('projectId') ? { project: params.get('projectId') } : '')}">${icon('plus', 15)}发布新版本</a>`)}<div class="release-summary"><div><span class="summary-square">${icon('layers', 20)}</span><strong class="mono">${published}</strong><span>已发布版本</span></div><div><span class="summary-square amber">${icon('edit', 20)}</span><strong class="mono">${drafts}</strong><span>待发布草稿</span></div><div><span class="summary-square">${icon('box', 20)}</span><strong class="mono">${withdrawn}</strong><span>已下架版本</span></div></div><section class="panel"><div class="admin-table-toolbar"><div class="table-tabs" role="group" aria-label="版本状态"><button class="active" data-table-filter="all" aria-pressed="true">全部版本</button><button data-table-filter="published" aria-pressed="false">已发布</button><button data-table-filter="draft" aria-pressed="false">草稿 <span class="draft-count mono">${drafts}</span></button><button data-table-filter="withdrawn" aria-pressed="false">已下架</button></div><div class="table-toolbar-controls"><select id="release-project-filter" class="table-select" aria-label="按项目筛选版本"><option value="">全部项目</option>${(data.projects || []).map((project) => `<option value="${e(project.id)}" ${params.get('projectId') === project.id ? 'selected' : ''}>${e(project.name)}</option>`).join('')}</select><label class="search-field">${icon('search', 15)}<input type="search" id="table-search" placeholder="搜索项目、版本号…" aria-label="搜索版本"></label></div></div>${releases.length ? releaseTable(releases, true, data.projects) : emptyState('还没有版本记录', '创建一个版本，添加更新说明和安装包，再正式发布。', `<a class="btn btn-primary" href="${url('publish', params.get('projectId') ? { project: params.get('projectId') } : '')}">${icon('plus', 15)}创建版本</a>`, 'layers')}<div class="table-empty" id="table-empty" hidden>没有匹配的版本，试试其他关键词或状态。</div>${pagination('版本', releases.length)}</section><div class="release-workflow"><span>一个版本的旅程</span><div><span>${icon('edit', 16)}保存草稿</span><i></i><span>${icon('upload', 16)}添加安装包</span><i></i><span>${icon('eye', 16)}检查内容</span><i></i><span>${icon('check', 16)}正式发布</span></div></div><dialog class="confirm-dialog" id="withdraw-dialog" aria-labelledby="withdraw-title"><span class="state-icon">${icon('layers', 25)}</span><h2 id="withdraw-title">下架这个版本？</h2><p><strong id="withdraw-name"></strong></p><p>下架后，访客将无法查看此版本或下载它的附件。版本记录和文件会保留在后台。</p><form id="withdraw-form"><p class="inline-error" id="withdraw-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn btn-light" id="withdraw-cancel">取消</button><button type="submit" class="btn btn-danger">确认下架</button></div></form></dialog>`;
}

function fileRow(file) {
  return `<tr data-row data-asset-row="${e(file.id)}" data-state="${e(file.status)}" data-search="${e(`${file.filename} ${file.projectName} ${file.version}`)}"><td><div class="file-name-cell">${icon('file', 18)}<div class="file-name-details"><span class="mono" data-asset-filename title="${e(file.filename)}">${e(file.filename)}</span>${assetRenameButton(file, 'file-rename-action')}</div></div></td><td>${e(platformLabel(file.platform))}<span class="table-subline mono">${e(file.arch || '—')}</span></td><td class="mono">${formatBytes(file.size)}</td><td>${e(file.projectName)}<span class="table-subline mono">${e(displayVersion(file.version))}</span></td><td>${statusBadge(file.status)}</td><td class="align-right"><div class="release-row-actions">${file.sha256 ? `<button class="table-action" type="button" data-file-checksum="${e(file.sha256)}" aria-label="复制 ${e(file.filename)} 的校验值">SHA-256 ${icon('copy', 12)}</button>` : ''}<a class="table-action" href="${url('publish', { id: file.releaseId })}">所属版本 ${icon('arrow', 12)}</a></div></td></tr>`;
}

function filesPage(data) {
  const assets = data.assets || [];
  return `${pageHeading('文件管理', '查看版本附件及其归属，可直接调整显示和下载时使用的文件名。', `<a class="btn btn-primary" href="${url('publish')}">${icon('upload', 15)}添加版本文件</a>`)}<div class="admin-summary-line"><span><strong class="mono">${assets.length}</strong> 个文件</span><span>合计 <strong class="mono">${formatBytes(assets.reduce((sum, file) => sum + (Number(file.size) || 0), 0))}</strong></span></div><section class="panel"><div class="admin-table-toolbar"><div class="table-tabs" role="group" aria-label="文件状态"><button class="active" data-table-filter="all" aria-pressed="true">全部文件</button><button data-table-filter="published" aria-pressed="false">已发布版本</button><button data-table-filter="draft" aria-pressed="false">草稿附件</button><button data-table-filter="withdrawn" aria-pressed="false">已下架版本</button></div><label class="search-field">${icon('search', 15)}<input type="search" id="table-search" placeholder="搜索文件、项目…" aria-label="搜索文件"></label></div>${assets.length ? `<div class="table-scroll"><table class="data-table files-table"><thead><tr><th scope="col">文件名称</th><th scope="col">平台 / 架构</th><th scope="col">大小</th><th scope="col">所属项目 / 版本</th><th scope="col">版本状态</th><th scope="col" class="align-right">操作</th></tr></thead><tbody>${assets.map(fileRow).join('')}</tbody></table></div>` : emptyState('还没有上传文件', '先创建版本草稿，再为它添加适合不同平台的安装包。', `<a class="btn btn-light" href="${url('publish')}">创建版本 ${icon('arrow', 14)}</a>`, 'folder')}<div class="table-empty" id="table-empty" hidden>没有匹配的文件。</div>${pagination('文件', assets.length)}</section><div class="admin-tip">${icon('info', 14)}<span>文件的公开状态跟随项目与版本。项目隐藏、版本草稿或下架后，附件都不会对访客开放。</span></div>`;
}

function settingsPage(data) {
  return `${pageHeading('站点设置', '配置站点信息与管理员通行密钥。')}<form class="panel site-settings-form" id="site-settings-form"><div class="panel-heading"><h2>基本信息</h2><span class="tag tag-outline">站点配置</span></div><div class="settings-fields"><label><span class="form-label">站点名称 <span class="required">*</span></span><input name="name" required maxlength="80" value="${e(data.site.name)}"></label><label><span class="form-label">站点简介</span><textarea rows="3" name="description" maxlength="1000" placeholder="简要介绍你的软件发布中心">${e(data.site.description)}</textarea><span class="field-hint">显示在公开首页的介绍区域。</span></label><label><span class="form-label">站点公告</span><textarea rows="3" name="announcement" maxlength="2000" placeholder="可选，在公开首页显示的公告">${e(data.site.announcement)}</textarea><span class="field-hint">留空即可隐藏公告。</span></label><p class="inline-error" id="settings-error" role="alert"></p><p class="inline-success" id="settings-success" role="status"></p><button class="btn btn-primary" type="submit">${icon('check', 15)}保存设置</button></div></form>${renderPasskeySettings()}`;
}

export async function renderAdmin(page, params, data) {
  document.title = `${labels[page] || '概览'} · ${data.site.name}`;
  let content;
  if (['publish', 'project-edit'].includes(page)) {
    const forms = await import('./admin-forms.js');
    content = forms.renderAdminForm(page, params, data);
  } else if (page === 'releases') content = releasesPage(params, data);
  else content = ({ overview: overviewPage, projects: projectsPage, files: filesPage, settings: settingsPage }[page] || overviewPage)(data);
  return adminShell(page, content, data);
}

function bindTable(noun) {
  const rows = [...document.querySelectorAll('[data-row]')];
  const search = document.querySelector('#table-search');
  let filter = 'all', current = 1;
  const update = () => {
    const term = search.value.trim().toLocaleLowerCase();
    const matching = rows.filter((row) => (filter === 'all' || row.dataset.state === filter) && row.dataset.search.toLocaleLowerCase().includes(term));
    const pages = Math.max(1, Math.ceil(matching.length / 10));
    current = Math.min(current, pages);
    rows.forEach((row) => { row.hidden = true; });
    matching.slice((current - 1) * 10, current * 10).forEach((row) => { row.hidden = false; });
    document.querySelector('#table-empty').hidden = matching.length > 0 || rows.length === 0;
    document.querySelector('#table-count-label').textContent = `共 ${matching.length} 个${noun}${matching.length > 10 ? ` · 每页 10 条` : ''}`;
    document.querySelector('#table-page-label').textContent = `${current} / ${pages}`;
    document.querySelector('#table-prev').disabled = current <= 1;
    document.querySelector('#table-next').disabled = current >= pages;
  };
  search.addEventListener('input', () => { current = 1; update(); });
  document.querySelectorAll('[data-table-filter]').forEach((button) => button.addEventListener('click', () => {
    filter = button.dataset.tableFilter;
    current = 1;
    document.querySelectorAll('[data-table-filter]').forEach((item) => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
    update();
  }));
  document.querySelector('#table-prev').addEventListener('click', () => { current--; update(); });
  document.querySelector('#table-next').addEventListener('click', () => { current++; update(); });
  update();
  return update;
}

function bindShell() {
  const toggle = document.querySelector('#admin-menu-toggle');
  const sidebar = document.querySelector('#admin-sidebar');
  const backdrop = document.querySelector('#admin-menu-backdrop');
  const close = () => { sidebar.classList.remove('open'); backdrop.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-label', '打开管理导航'); document.body.classList.remove('admin-menu-open'); };
  toggle.addEventListener('click', () => {
    if (sidebar.classList.contains('open')) close();
    else { sidebar.classList.add('open'); backdrop.hidden = false; toggle.setAttribute('aria-expanded', 'true'); toggle.setAttribute('aria-label', '关闭管理导航'); document.body.classList.add('admin-menu-open'); sidebar.querySelector('.admin-nav a')?.focus(); }
  });
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && sidebar.classList.contains('open')) { close(); toggle.focus(); } });
  document.querySelectorAll('[data-logout]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try { await api('/api/logout', { method: 'POST' }); location.assign(url('login')); }
    catch (error) { if (error.status === 401) location.assign(url('login')); else toast(error.message); }
    finally { button.disabled = false; }
  }));
}

export async function bindAdmin(page, params, data) {
  bindShell();
  enhanceSelects(document);
  if (['publish', 'project-edit'].includes(page)) {
    const forms = await import('./admin-forms.js');
    await forms.bindAdminForm(page, params, data);
  }
  const refreshTable = ['projects', 'releases', 'files'].includes(page) ? bindTable({ projects: '项目', releases: '版本', files: '文件' }[page]) : null;
  if (page === 'releases') {
    document.querySelector('#release-project-filter').addEventListener('change', (event) => location.assign(url('releases', event.target.value ? { projectId: event.target.value } : '')));
    const dialog = document.querySelector('#withdraw-dialog');
    const form = document.querySelector('#withdraw-form');
    let releaseId = '', pending = false;
    document.querySelectorAll('[data-withdraw]').forEach((button) => button.addEventListener('click', () => {
      releaseId = button.dataset.withdraw;
      document.querySelector('#withdraw-name').textContent = button.dataset.releaseName;
      document.querySelector('#withdraw-error').textContent = '';
      dialog.showModal();
    }));
    document.querySelector('#withdraw-cancel').addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', (event) => { if (pending) event.preventDefault(); });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (pending || !releaseId) return;
      pending = true;
      form.querySelectorAll('button').forEach((button) => { button.disabled = true; });
      const submit = form.querySelector('[type="submit"]');
      submit.textContent = '正在下架…';
      try {
        await api(`/api/admin/releases/${encodeURIComponent(releaseId)}/withdraw`, { method: 'POST' });
        location.assign(url('releases', { ...(params.get('projectId') ? { projectId: params.get('projectId') } : {}), notice: 'release-withdrawn' }));
      } catch (error) { document.querySelector('#withdraw-error').textContent = error.message; }
      finally { pending = false; form.querySelectorAll('button').forEach((button) => { button.disabled = false; }); submit.textContent = '确认下架'; }
    });
  }
  if (page === 'files') document.querySelectorAll('[data-asset-rename]').forEach((button) => button.addEventListener('click', async () => {
    const asset = (data.assets || []).find(item => item.id === button.dataset.assetRename);
    const row = button.closest('[data-asset-row]');
    if (!asset || !row) return;
    try {
      const renamed = await openAssetRename(asset, button);
      if (!renamed) return;
      const updated = { ...asset, ...renamed };
      data.assets = data.assets.map(item => item.id === updated.id ? updated : item);
      const filename = row.querySelector('[data-asset-filename]');
      filename.textContent = updated.filename;
      filename.title = updated.filename;
      button.setAttribute('aria-label', `重命名 ${updated.filename}`);
      button.title = `重命名 ${updated.filename}`;
      row.querySelector('[data-file-checksum]')?.setAttribute('aria-label', `复制 ${updated.filename} 的校验值`);
      row.dataset.search = `${updated.filename} ${updated.projectName || ''} ${updated.version || ''}`;
      refreshTable();
      toast('安装包已重命名。');
      // 若旧文件名筛选使该行不再显示，回到搜索框继续操作。
      (row.hidden ? document.querySelector('#table-search') : button)?.focus({ preventScroll: true });
    } catch (error) { toast(error.message || '无法打开重命名窗口，请稍后重试。'); }
  }));
  if (page === 'files') document.querySelectorAll('[data-file-checksum]').forEach((button) => button.addEventListener('click', async () => {
    try { await copyText(button.dataset.fileChecksum); toast('SHA-256 文件校验值已复制。'); }
    catch {
      const dialog = document.createElement('dialog');
      dialog.className = 'copy-dialog';
      dialog.innerHTML = '<h2>SHA-256 文件校验值</h2><p>浏览器未允许自动复制，请选择下方内容后复制。</p><input readonly aria-label="SHA-256 文件校验值"><form method="dialog"><button class="btn btn-primary">完成</button></form>';
      dialog.querySelector('input').value = button.dataset.fileChecksum;
      document.body.appendChild(dialog);
      dialog.addEventListener('close', () => dialog.remove(), { once: true });
      dialog.showModal();
      dialog.querySelector('input').select();
    }
  }));
  if (page === 'settings') {
    const form = document.querySelector('#site-settings-form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      if (button.disabled) return;
      const values = new FormData(form);
      const error = document.querySelector('#settings-error');
      const success = document.querySelector('#settings-success');
      const payload = { name: String(values.get('name') || '').trim(), description: String(values.get('description') || '').trim(), announcement: String(values.get('announcement') || '').trim() };
      if (!payload.name) { error.textContent = '请填写站点名称。'; return; }
      error.textContent = '';
      success.textContent = '';
      button.disabled = true;
      button.textContent = '正在保存…';
      form.setAttribute('aria-busy', 'true');
      try {
        const result = await api('/api/admin/settings', { method: 'PATCH', body: payload });
        Object.assign(data.site, result.site);
        document.querySelector('.admin-brand .brand-name').textContent = result.site.name;
        document.querySelector('.admin-footer > span').textContent = result.site.name;
        document.title = `站点设置 · ${result.site.name}`;
        success.textContent = '设置已保存，公开页面已更新。';
        toast('站点设置已保存。');
      } catch (reason) { error.textContent = reason.message; }
      finally { button.disabled = false; button.innerHTML = `${icon('check', 15)}保存设置`; form.removeAttribute('aria-busy'); }
    });
    await bindPasskeySettings({ notify: toast });
  }
}
