import { icon, logo, projectMark } from './icons.js';
import { projects } from './data.js';

const params = new URLSearchParams(location.search);
const page = params.get('page') || 'home';
const capture = params.has('capture');
document.body.classList.toggle('capture', capture);

export function url(name, extra = '') {
  return `?page=${name}${extra ? `&${extra}` : ''}${capture ? '&capture=1' : ''}`;
}

export function header(active = 'home') {
  return `<header class="site-header"><div class="container header-inner"><a class="brand" href="${url('home')}" aria-label="ReleaseDock 首页">${logo()}<span><span class="brand-name">ReleaseDock</span></span></a><nav class="header-nav" aria-label="主导航"><a class="${active === 'home' ? 'active' : ''}" href="${url('home')}">全部项目</a><a class="${active === 'activity' ? 'active' : ''}" href="${url('activity')}">更新动态</a></nav><div class="header-right"><span class="header-note"><span class="status-dot"></span>每一次更新，都在这里</span><a class="btn btn-light" href="${url('login')}">${icon('key',14)}管理入口</a></div></div></header>`;
}

export function footer() {
  return `<footer class="site-footer"><div class="footer-brand">${icon('layers',14)}<span>© 2026 ReleaseDock <span class="desktop-only">· 简单发布，安心获取</span></span></div><div class="footer-links"><span>界面设计稿 · 示例数据</span><a href="${url('login')}">管理员入口 ${icon('diagonal',11)}</a></div></footer>`;
}

export function platformIcons(platforms, size = 13) {
  const ids = { Windows: 'windows', macOS: 'apple', Linux: 'terminal' };
  return platforms.map(name => `<span title="${name}" aria-label="${name}">${icon(ids[name],size)}</span>`).join('');
}

function projectCard(project) {
  return `<article class="project-card" data-category="${project.category}" data-search="${project.name} ${project.subtitle} ${project.description}"><div class="project-card-head">${projectMark(project.id)}<div class="project-card-title"><h3>${project.name}</h3><p>${project.subtitle}</p></div><span class="category">${project.category}</span></div><p class="project-card-description">${project.description}</p><div class="project-meta"><span class="version">v${project.version}</span><span class="tag tag-green">稳定版</span><span style="margin-left:auto" class="mono">${project.date}</span></div><div class="project-card-bottom"><div class="platform-icons">${platformIcons(project.platforms)}</div><a class="link-button" href="${url('project',`id=${project.id}`)}">查看版本 ${icon('arrow',14)}</a></div></article>`;
}

function home() {
  return `${header()}<main class="container"><section class="hero"><div class="hero-text"><div class="eyebrow">A HOME FOR EVERY RELEASE</div><h1>好软件，在这里。<br><span>新版本，即刻获取。</span></h1><p class="hero-description">发现我们的软件项目，获取最新稳定版本。<br>所有更新、安装包与说明，都整理在这里。</p><div class="hero-links"><a class="btn btn-primary" href="#projects">浏览全部项目 ${icon('arrow',16)}</a><span class="muted small">无需登录，直接下载 ${icon('download',13)}</span></div></div><aside class="featured"><div class="featured-top"><span><span class="status-dot" style="background:#d2e3b8"></span>最新发布</span><span class="tag tag-dark">FEATURED RELEASE</span></div><div class="featured-main">${projectMark('orbit','large')}<div><h2>Orbit <span>v2.8.0</span></h2><p>你的桌面，井然有序。</p></div></div><p class="featured-copy">全新的快捷启动体验，更流畅的多工作区切换。<br>还有 12 项细节改进，让专注更进一步。</p><div class="featured-bottom"><a class="btn" href="${url('project','id=orbit')}">获取最新版本 ${icon('arrow',14)}</a><div class="featured-platforms">${platformIcons(['Windows','macOS','Linux'],15)}</div></div></aside></section><section class="catalog" id="projects"><div class="section-heading"><div><h2>探索项目 <span class="count">06</span></h2><p>为日常工作，找到顺手的好工具。</p></div><label class="search-field">${icon('search',16)}<input id="project-search" type="search" placeholder="搜索项目名称、功能…" aria-label="搜索项目"><kbd>/</kbd></label></div><div class="catalog-toolbar"><div class="filter-tabs" role="group" aria-label="项目分类">${['全部项目','效率工具','开发工具','系统工具'].map((name,i)=>`<button class="filter-tab ${i===0?'active':''}" data-filter="${name}" aria-pressed="${i===0}">${name}</button>`).join('')}</div><button class="sort-button" id="sort-projects">最近更新 ${icon('down',13)}</button></div><div class="project-grid" id="project-grid">${projects.map(projectCard).join('')}</div></section>${footer()}</main>`;
}

function prototypeNav() {
  return `<nav class="prototype-nav" aria-label="设计预览页面"><span>设计预览</span>${[['home','项目首页'],['project','版本下载'],['login','密钥登录'],['overview','后台概览'],['projects','项目管理'],['publish','发布版本']].map(([id,name])=>`<a href="${url(id)}" class="${page===id?'active':''}">${name}</a>`).join('')}</nav>`;
}

let toastTimer;
export function toast(message) {
  const node = document.querySelector('#toast');
  node.textContent = message;
  node.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>node.classList.remove('visible'),3500);
}

function bindHome() {
  let category = '全部项目';
  let reversed = false;
  const search = document.querySelector('#project-search');
  const update = () => {
    const term = search.value.trim().toLowerCase();
    const items = projects.filter(p => (category === '全部项目' || p.category === category) && `${p.name} ${p.subtitle} ${p.description}`.toLowerCase().includes(term));
    if (reversed) items.reverse();
    document.querySelector('#project-grid').innerHTML = items.length ? items.map(projectCard).join('') : '<div class="empty-state">没有找到匹配的项目，试试其他关键词。</div>';
  };
  search.addEventListener('input',update);
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click',()=>{
    category = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(item=>{ item.classList.toggle('active',item===button);item.setAttribute('aria-pressed',String(item===button)); });
    update();
  }));
  document.querySelector('#sort-projects').addEventListener('click',event=>{ reversed=!reversed;event.currentTarget.innerHTML=`${reversed?'最早更新':'最近更新'} ${icon('down',13)}`;update(); });
  document.addEventListener('keydown',event=>{if(event.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){event.preventDefault();search.focus();}});
}

async function render() {
  let markup;
  let bind;
  if (page === 'home') {
    markup = home();
    bind = bindHome;
  } else if (['project','login','activity'].includes(page)) {
    const publicPages = await import('./public-pages.js');
    markup = publicPages.renderPublic(page, params);
    bind = () => publicPages.bindPublic(page, params);
  } else {
    const adminPages = await import('./admin-pages.js');
    markup = await adminPages.renderAdmin(page, params);
    bind = () => adminPages.bindAdmin(page, params);
  }
  document.querySelector('#app').innerHTML = markup + prototypeNav();
  document.querySelectorAll('[data-toast]').forEach(node=>node.addEventListener('click',()=>toast(node.dataset.toast)));
  if (bind) await bind();
  document.documentElement.dataset.ready = 'true';
}

render().catch(error=>{
  document.querySelector('#app').innerHTML = `${header()}<main class="container" style="padding-block:70px"><h1>这个预览页面正在准备中</h1><p style="margin-block:20px">首页已经可以查看，其余设计页面会随制作完成开放。</p><a class="btn btn-primary" href="${url('home')}">返回项目首页</a></main>`;
  console.error(error);
});
