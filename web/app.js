import { icon, logo } from './icons.js';
import { api, ApiError, escapeHtml } from './api.js';

const adminPages = new Set(['overview', 'projects', 'releases', 'publish', 'project-edit', 'files', 'settings']);
const publicPages = new Set(['home', 'catalog', 'project', 'login', 'activity']);
const params = new URLSearchParams(location.search);
const page = params.get('page') || 'home';
let site = { name: 'ReleaseDock', description: '', announcement: '' };
let toastTimer;
let expired = false;

export function url(name, extra = '') {
  const query = new URLSearchParams(typeof extra === 'string' ? extra.replace(/^&/, '') : extra);
  query.set('page', name);
  // page 放在首位，让分享的地址保持一致。
  const result = new URLSearchParams({ page: name });
  query.forEach((value, key) => { if (key !== 'page') result.set(key, value); });
  return `?${result.toString()}`;
}

export function getSite() { return site; }

export function safeNext(value) {
  if (!value) return url('overview');
  try {
    const next = new URL(value, location.origin);
    if (next.origin === location.origin && next.pathname === '/' && adminPages.has(next.searchParams.get('page'))) return `${next.pathname}${next.search}`;
  } catch { /* 无效的回跳地址使用管理概览。 */ }
  return url('overview');
}

export function header(active = 'home') {
  const name = escapeHtml(site.name);
  const catalogActive = active === 'catalog' || active === 'project';
  const activityActive = active === 'home' || active === 'activity';
  return `<header class="site-header"><div class="container header-inner"><a class="brand" href="${url('home')}" aria-label="${name} 首页">${logo()}<span class="brand-name">${name}</span></a><nav class="header-nav" aria-label="主导航"><a class="${catalogActive ? 'active' : ''}" ${catalogActive ? 'aria-current="page"' : ''} href="${url('catalog')}">全部项目</a><a class="${activityActive ? 'active' : ''}" ${activityActive ? 'aria-current="page"' : ''} href="${url('home')}">更新动态</a></nav><div class="header-right"><span class="header-note"><span class="status-dot"></span>每一次更新，都在这里</span></div></div></header><nav class="public-mobile-nav" aria-label="移动主导航"><a class="${catalogActive ? 'active' : ''}" ${catalogActive ? 'aria-current="page"' : ''} href="${url('catalog')}">全部项目</a><a class="${activityActive ? 'active' : ''}" ${activityActive ? 'aria-current="page"' : ''} href="${url('home')}">更新动态</a></nav>`;
}

export function footer() {
  return `<footer class="site-footer"><div class="footer-brand">${icon('layers', 14)}<span>© ${new Date().getFullYear()} ${escapeHtml(site.name)}<span class="desktop-only"> · 简单发布，安心获取</span></span></div><div class="footer-links"><a href="${url('home')}">更新动态</a><a href="${url('login')}">管理员入口 ${icon('diagonal', 11)}</a></div></footer>`;
}

export function platformIcon(platform) {
  const names = { windows: 'windows', macos: 'apple', mac: 'apple', darwin: 'apple', linux: 'terminal', web: 'globe', android: 'box', ios: 'apple' };
  return names[String(platform).toLowerCase()] || 'box';
}

export function platformIcons(platforms = [], size = 13) {
  return (Array.isArray(platforms) ? platforms : []).map((name) => `<span title="${escapeHtml(name)}" aria-label="${escapeHtml(name)}">${icon(platformIcon(name), size)}</span>`).join('');
}

export function toast(message) {
  const node = document.querySelector('#toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('visible'), 4500);
}

function loginRedirect() {
  if (expired) return;
  expired = true;
  const next = `${location.pathname}${location.search}`;
  location.replace(url('login', { next, expired: '1' }));
}
window.addEventListener('session-expired', loginRedirect);

async function loadData() {
  if (page === 'catalog') {
    const [catalog, latest] = await Promise.all([api('/api/projects'), api('/api/releases?limit=1')]);
    site = { ...site, ...catalog.site };
    return { projects: catalog.projects || [], latestRelease: latest.releases?.[0] || null, site };
  }
  const siteRequest = api('/api/site');
  if (adminPages.has(page) || page === 'login') {
    const [siteData, session] = await Promise.all([siteRequest, api('/api/session')]);
    site = { ...site, ...siteData.site };
    if (adminPages.has(page) && !session.authenticated) { loginRedirect(); return null; }
    if (page === 'login') {
      if (session.authenticated) { location.replace(safeNext(params.get('next'))); return null; }
      return { site };
    }
  } else {
    const siteData = await siteRequest;
    site = { ...site, ...siteData.site };
  }
  if (page === 'project') {
    const slug = params.get('slug') || params.get('id');
    if (!slug) throw new ApiError('请从项目列表中选择要查看的项目。', 404, 'PROJECT_NOT_FOUND');
    const result = await api(`/api/projects/${encodeURIComponent(slug)}`);
    const releases = result.releases || [];
    const requested = params.get('release');
    const selected = requested ? releases.find((item) => String(item.id) === requested) : releases.find((item) => item.isLatest) || releases[0];
    if (requested && !selected) throw new ApiError('这个版本不存在或已下架，请返回项目查看其他版本。', 404, 'RELEASE_NOT_FOUND');
    const detail = selected ? await api(`/api/releases/${encodeURIComponent(selected.id)}`) : { release: null, assets: [] };
    return { ...result, releases, release: detail.release, assets: detail.assets || [], site };
  }
  if (page === 'home' || page === 'activity') return { ...await api('/api/releases?limit=100'), site };
  if (page === 'overview') return { ...await api('/api/admin/overview'), site };
  if (page === 'projects') return { ...await api('/api/admin/projects'), site };
  if (page === 'releases') {
    const projectId = params.get('projectId') || '';
    const [result, projects] = await Promise.all([api(`/api/admin/releases${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`), api('/api/admin/projects')]);
    return { ...result, projects: projects.projects || [], site };
  }
  if (page === 'files') return { ...await api('/api/admin/assets'), site };
  if (page === 'settings') {
    const result = await api('/api/admin/settings');
    site = { ...site, ...result.site };
    return { site };
  }
  if (page === 'project-edit' || page === 'publish') {
    const result = await api('/api/admin/projects');
    const data = { projects: result.projects || [], project: undefined, release: undefined, assets: [], site };
    const id = params.get('id');
    if (id) {
      const detail = await api(`/api/admin/${page === 'publish' ? 'releases' : 'projects'}/${encodeURIComponent(id)}`);
      Object.assign(data, detail);
    }
    return data;
  }
  return { site };
}

function showError(error) {
  if (error.status === 401 && adminPages.has(page)) { loginRedirect(); return; }
  const missing = error.status === 404;
  document.title = `${missing ? '内容暂不可用' : '加载失败'} · ${site.name}`;
  document.querySelector('#app').innerHTML = `${header(page)}<main class="container error-page" id="main-content"><span class="state-icon">${icon(missing ? 'box' : 'info', 30)}</span><div class="eyebrow">${missing ? 'CONTENT UNAVAILABLE' : 'PLEASE TRY AGAIN'}</div><h1>${missing ? '暂时找不到这条内容' : '页面暂时无法加载'}</h1><p>${escapeHtml(error.message || '请检查网络连接后重试。')}</p><div class="state-actions">${missing ? '' : '<button class="btn btn-primary" id="retry-page">重新加载</button>'}${page === 'project' && params.get('slug') ? `<a class="btn btn-light" href="${url('project', { slug: params.get('slug') })}">返回项目</a>` : ''}<a class="btn btn-light" href="${url(adminPages.has(page) ? 'overview' : 'home')}">${adminPages.has(page) ? '返回管理概览' : '返回首页'}</a></div></main>`;
  document.querySelector('#retry-page')?.addEventListener('click', () => location.reload());
}

async function render() {
  const app = document.querySelector('#app');
  app.dataset.booting = 'false';
  try {
    if (!adminPages.has(page) && !publicPages.has(page)) throw new ApiError('这个页面不存在。', 404, 'PAGE_NOT_FOUND');
    const data = await loadData();
    if (!data) return;
    document.title = `${site.name} · 软件发布中心`;
    const module = await import(adminPages.has(page) ? './admin-pages.js' : './public-pages.js');
    if (adminPages.has(page)) {
      app.innerHTML = await module.renderAdmin(page, params, data);
      await module.bindAdmin(page, params, data);
    } else {
      app.innerHTML = module.renderPublic(page, params, data);
      await module.bindPublic(page, params, data);
    }
    const notices = { 'project-created': '项目已创建。', 'project-saved': '项目设置已保存。', 'release-saved': '版本已保存。', 'release-published': '版本已发布。', 'release-withdrawn': '版本已下架，公开页面已更新。' };
    if (params.has('notice')) {
      if (notices[params.get('notice')]) toast(notices[params.get('notice')]);
      const clean = new URL(location.href);
      clean.searchParams.delete('notice');
      history.replaceState(null, '', `${clean.pathname}${clean.search}${clean.hash}`);
    }
  } catch (error) { showError(error); }
  finally {
    document.documentElement.dataset.ready = 'true';
    document.querySelector('#main-content')?.removeAttribute('aria-busy');
  }
}

render();
