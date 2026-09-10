import { icon, logo, projectMark } from './icons.js';
import { api, escapeHtml as e, formatBytes, formatDate, formatNumber, versionLabel, safeWebsite, renderNotes, copyText } from './api.js';
import { header, footer, platformIcons, platformIcon, url, toast, safeNext } from './app.js';

function emptyState(title, description, action = '') {
  return `<div class="empty-state spacious"><span class="state-icon">${icon('box', 29)}</span><h3>${e(title)}</h3><p>${e(description)}</p>${action}</div>`;
}

function projectCard(project) {
  const version = typeof project.latestVersion === 'object' ? project.latestVersion?.version : project.latestVersion;
  return `<article class="project-card"><div class="project-card-head">${projectMark(project)}<div class="project-card-title"><h3><a href="${url('project', { slug: project.slug })}">${e(project.name)}</a></h3><p>${e(project.subtitle || '软件项目')}</p></div>${project.category ? `<span class="category">${e(project.category)}</span>` : ''}</div><p class="project-card-description">${e(project.description || '项目介绍即将完善。')}</p><div class="project-meta">${version ? `<span class="version">${e(versionLabel(version))}</span><span class="tag">${formatNumber(project.publishedCount ?? project.releaseCount)} 个版本</span>` : '<span class="muted">尚无公开版本</span>'}<span class="project-updated mono">${formatDate(project.updatedAt)}</span></div><div class="project-card-bottom"><div class="platform-icons">${platformIcons(project.platforms)}</div><a class="link-button" href="${url('project', { slug: project.slug })}">查看版本 ${icon('arrow', 14)}</a></div></article>`;
}

function featuredRelease(data) {
  const release = data.latestRelease;
  if (!release) return `<aside class="featured featured-empty"><div class="featured-top"><span><span class="status-dot"></span>每个版本，都值得被看见</span>${icon('layers', 18)}</div><div class="featured-main"><span class="featured-empty-icon">${icon('box', 44)}</span><div><h2>好软件，值得期待。</h2><p>为每一次更新，留一个清晰的入口。</p></div></div><p class="featured-copy">新版本发布后，你可以在这里阅读更新说明，<br>选择适合自己设备的安装包。</p><div class="featured-bottom"><span>从第一行代码，到下一次发布。</span>${icon('arrow', 18)}</div></aside>`;
  const project = data.projects.find((item) => item.id === release.projectId) || release.project || {};
  const notes = String(release.notes || project.subtitle || '查看本次更新的详细说明与安装包。').replace(/[#*`]/g, '').slice(0, 120);
  return `<aside class="featured"><div class="featured-top"><span><span class="status-dot"></span>最新发布</span><span class="tag tag-dark">${release.channel === 'prerelease' ? '预发布版' : '稳定版'}</span></div><div class="featured-main">${projectMark(project, 'large')}<div><h2>${e(project.name)} <span>${e(versionLabel(release.version))}</span></h2><p>${e(release.title || project.subtitle || '每一次更新，都向前一步。')}</p></div></div><p class="featured-copy clamp-three">${e(notes)}</p><div class="featured-bottom"><a class="btn" href="${url('project', { slug: project.slug, release: release.id })}">查看版本与下载 ${icon('arrow', 14)}</a><div class="featured-platforms">${platformIcons(project.platforms, 15)}</div></div></aside>`;
}

function homePage(data) {
  const projects = data.projects;
  const categories = [...new Set(projects.map((project) => project.category).filter(Boolean))];
  return `${header()}<main class="container" id="main-content">${data.site.announcement ? `<aside class="site-announcement">${icon('info', 16)}<p>${e(data.site.announcement)}</p></aside>` : ''}<section class="hero"><div class="hero-text"><div class="eyebrow">A HOME FOR EVERY RELEASE</div><h1>好软件，在这里。<br><span>新版本，即刻获取。</span></h1><p class="hero-description">${e(data.site.description || '发现我们的软件项目，获取最新版本。\n所有更新、安装包与说明，都整理在这里。')}</p><div class="hero-links"><a class="btn btn-primary" href="#projects">浏览全部项目 ${icon('arrow', 16)}</a><span class="muted small">无需登录，直接下载 ${icon('download', 13)}</span></div></div>${featuredRelease(data)}</section><section class="catalog" id="projects"><div class="section-heading"><div><h2>探索项目 <span class="count">${projects.length.toString().padStart(2, '0')}</span></h2><p>为日常工作，找到顺手的好工具。</p></div><label class="search-field">${icon('search', 16)}<input id="project-search" type="search" placeholder="搜索项目名称、功能…" aria-label="搜索项目"><kbd>/</kbd></label></div><div class="catalog-toolbar"><div class="filter-tabs" role="group" aria-label="项目分类"><button class="filter-tab active" data-filter="" aria-pressed="true">全部项目</button>${categories.map((category) => `<button class="filter-tab" data-filter="${e(category)}" aria-pressed="false">${e(category)}</button>`).join('')}</div><button class="sort-button" id="sort-projects">最近更新 ${icon('down', 13)}</button></div><div class="project-grid" id="project-grid">${projects.length ? [...projects].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map(projectCard).join('') : emptyState('这里还没有公开项目', '项目发布后，你可以在这里查看版本、获取安装包。', `<a class="btn btn-light" href="${url('login')}">${icon('key', 14)}管理员入口</a>`)}</div><p class="sr-only" id="search-result-count" aria-live="polite"></p></section>${footer()}</main>`;
}

function downloadRows(assets) {
  return assets.map((file) => `<div class="download-row"><span class="os-mark">${icon(platformIcon(file.platform), 22)}</span><div class="download-file"><div><strong>${e(file.platform || '通用文件')}</strong>${file.arch ? `<span class="tag">${e(file.arch)}</span>` : ''}</div><p class="mono">${e(file.filename)}</p></div><span class="file-size mono">${formatBytes(file.size)}</span>${file.sha256 ? `<button class="checksum" data-checksum="${e(file.sha256)}" data-filename="${e(file.filename)}" aria-label="复制 ${e(file.filename)} 的 SHA-256 校验值">SHA-256 ${icon('copy', 11)}</button>` : ''}<a class="btn btn-primary btn-sm" href="/api/downloads/${encodeURIComponent(file.id)}" download aria-label="下载 ${e(file.filename)}">${icon('download', 14)}下载</a></div>`).join('');
}

function projectPage(params, data) {
  const { project, releases, release, assets, site } = data;
  document.title = `${project.name}${release ? ` ${versionLabel(release.version)}` : ''} · ${site.name}`;
  const website = safeWebsite(project.website);
  const about = `<section class="project-about" id="about-project"><h4>关于 ${e(project.name)}</h4><p>${e(project.description || project.subtitle || '此项目暂未填写详细介绍。')}</p>${website ? `<a class="link-button project-website" href="${e(website)}" target="_blank" rel="noopener noreferrer">访问项目网站 ${icon('external', 12)}</a>` : ''}<dl><div><dt>累计下载</dt><dd class="mono">${formatNumber(project.downloadCount)}</dd></div><div><dt>公开版本</dt><dd class="mono">${formatNumber(releases.length)} 次</dd></div></dl></section>`;
  const detail = release ? `<div class="release-topline"><div><h2 class="mono">${e(versionLabel(release.version))}</h2><span class="tag ${release.channel === 'prerelease' ? 'tag-orange' : 'tag-green'}">${release.channel === 'prerelease' ? '预发布版' : '稳定版'}</span>${release.isLatest ? '<span class="latest-release">最新版本</span>' : ''}</div><span class="muted small">${icon('clock', 13)} <span class="mono">${formatDate(release.publishedAt)}</span> 发布</span></div>${release.channel === 'prerelease' ? `<div class="prerelease-notice">${icon('info', 15)}此版本用于提前体验新功能；如需日常使用，建议优先选择稳定版。</div>` : ''}<div class="release-notes"><h3>${e(release.title || '本次更新')}</h3><div class="notes-content">${renderNotes(release.notes)}</div></div><section class="download-section" id="downloads"><div class="download-heading"><h3>下载安装包 <span class="count mono">${assets.length.toString().padStart(2, '0')}</span></h3><span>选择适合你设备的版本</span></div>${assets.length ? `<div class="download-list">${downloadRows(assets)}</div><div class="download-footnote">${icon('shield', 13)}点击 SHA-256 可复制文件校验值，用于核对下载是否完整。</div>` : '<div class="empty-state compact">这个版本暂未提供下载文件，请查看更新说明或稍后再来。</div>'}</section>` : emptyState('第一个版本，正在路上', '此项目还没有公开版本。新版本发布后会出现在这里。');
  return `${header()}<main class="container" id="main-content"><div class="breadcrumb"><a href="${url('home')}">全部项目</a>${icon('back', 12, 'class="rotate-arrow"')}<span>${e(project.name)}</span></div><section class="project-header"><div class="project-identity">${projectMark(project, 'large')}<div><div class="project-title-line"><h1>${e(project.name)}</h1>${project.category ? `<span class="tag tag-outline">${e(project.category)}</span>` : ''}</div><p>${e(project.subtitle || project.description)}</p></div></div><div class="project-actions"><button class="btn btn-light" id="share-project">${icon('link', 15)}分享</button>${release && assets.length ? `<a class="btn btn-primary" href="#downloads">${icon('download', 16)}获取${release.isLatest ? '最新' : '此'}版本</a>` : ''}</div></section><div class="project-tabs"><a class="active" href="#releases">版本发布 <span class="mono">${releases.length.toString().padStart(2, '0')}</span></a><a href="#about-project">项目介绍</a><span class="project-platforms">${platformIcons(project.platforms)}${project.platforms?.length ? `<span>${e(project.platforms.join(' / '))}</span>` : ''}</span></div><div class="release-layout" id="releases"><aside class="version-sidebar"><div class="sidebar-label">版本历史 <span class="mono">${releases.length}</span></div><nav class="version-nav" aria-label="版本历史">${releases.map((item) => `<a href="${url('project', { slug: project.slug, release: item.id })}" class="${item.id === release?.id ? 'active' : ''}" ${item.id === release?.id ? 'aria-current="page"' : ''}><span class="version-nav-dot"></span><div><strong class="mono">${e(versionLabel(item.version))}</strong>${item.isLatest ? '<span class="latest-text">最新</span>' : ''}<small class="mono">${formatDate(item.publishedAt)}</small></div>${item.id === release?.id ? icon('back', 12, 'class="rotate-arrow"') : ''}</a>`).join('')}</nav>${about}<div class="sidebar-tip">${icon('shield', 17)}<p>公开下载，无需登录。<br>安装前可核对文件校验值。</p></div></aside><section class="release-detail">${detail}</section></div>${footer()}</main><dialog class="copy-dialog" id="copy-dialog"><h2 id="copy-dialog-title">复制内容</h2><p>浏览器未允许自动复制，请选择下方内容后复制。</p><input id="copy-value" readonly aria-labelledby="copy-dialog-title"><form method="dialog"><button class="btn btn-primary">完成</button></form></dialog>`;
}

function loginPage(params, data) {
  const name = e(data.site.name);
  document.title = `管理员登录 · ${data.site.name}`;
  return `<div class="login-page"><a class="brand login-brand" href="${url('home')}">${logo()}<span class="brand-name">${name}</span></a><a class="login-back" href="${url('home')}">${icon('back', 14)}返回发布中心</a><main class="login-shell" id="main-content"><section class="login-story"><div class="eyebrow">BUILT TO SHIP</div><h1>每一次发布，<br>都是新的开始。</h1><p>为好软件，留一个可靠的出发地。<br>管理项目、整理版本，把最新进展带给用户。</p><div class="login-release-art" aria-hidden="true"><div class="art-track"></div><div class="art-release art-release-old"><div><span class="art-dot"></span><span>创建项目</span></div>${icon('box', 15)}</div><div class="art-release art-release-mid"><div><span class="art-dot"></span><span>整理更新</span></div>${icon('edit', 15)}</div><div class="art-release art-release-new"><div><span class="art-cube">${icon('layers', 23)}</span><span><strong>发布新版本</strong><small>准备好，与世界见面。</small></span></div><span class="art-check">${icon('check', 18)}</span></div></div><div class="login-story-foot"><span class="status-dot"></span>小而专注，为每一位创造者。</div></section><section class="login-form-side"><div class="login-key">${icon('key', 26)}</div><div class="login-title"><h2>欢迎回来</h2><p>输入管理员密钥，进入你的发布工作台。</p></div><form id="login-form"><label class="form-label" for="admin-key">管理员密钥</label><div class="key-input">${icon('lock', 17)}<input type="password" id="admin-key" name="key" required placeholder="请输入管理员密钥" autocomplete="current-password" aria-describedby="login-help login-error"><button type="button" id="toggle-key" aria-label="显示密钥" aria-pressed="false">${icon('eye', 18)}</button></div><div class="field-hint" id="login-help">密钥由站点管理员提供，请妥善保管。</div><button type="submit" class="btn btn-primary btn-wide login-submit">验证并进入 ${icon('arrow', 17)}</button><p class="login-error" id="login-error" role="alert">${params.get('expired') === '1' ? '请先登录。登录后将返回刚才的管理页面。' : ''}</p></form><div class="login-divider"><span>仅供站点管理员使用</span></div><div class="login-security">${icon('shield', 17)}<p>访问项目和下载软件无需登录。<br>如果你只是来获取软件，请直接返回发布中心。</p></div></section></main><footer class="login-footer"><span>© ${new Date().getFullYear()} ${name}</span><span>让发布简单一点。</span><a href="${url('home')}">浏览公开项目 ${icon('arrow', 12)}</a></footer></div>`;
}

function activityPage(data) {
  document.title = `更新动态 · ${data.site.name}`;
  const releases = data.releases || [];
  return `${header('activity')}<main class="container activity-page" id="main-content"><div class="eyebrow">WHAT'S NEW</div><h1>每一步，都在向前。</h1><p class="muted">所有项目的最新版本，在这里一览。</p><div class="activity-list">${releases.length ? releases.map((release) => { const project = release.project || {}; return `<article class="activity-item"><time class="activity-date mono">${formatDate(release.publishedAt)}</time><span class="activity-dot"></span><div class="activity-content"><div class="activity-project">${projectMark(project, 'small')}<h2>${e(project.name)}</h2><span class="mono">${e(versionLabel(release.version))}</span><span class="tag ${release.channel === 'prerelease' ? 'tag-orange' : 'tag-green'}">${release.channel === 'prerelease' ? '预发布版' : '稳定版'}</span></div><p>${e(release.title || `${project.name || '项目'} 的新版本已发布。`)}</p><a class="link-button" href="${url('project', { slug: project.slug, release: release.id })}">查看更新与下载 ${icon('arrow', 14)}</a></div></article>`; }).join('') : emptyState('还没有新的发布动态', '公开版本发布后，会在这里留下每一步更新。', `<a class="btn btn-light" href="${url('home')}">浏览全部项目 ${icon('arrow', 14)}</a>`)}</div>${releases.length >= 100 ? '<p class="muted small">这里展示最近 100 次发布，完整历史可在对应项目中查看。</p>' : ''}${footer()}</main>`;
}

export function renderPublic(page, params, data) {
  if (page === 'home') return homePage(data);
  if (page === 'project') return projectPage(params, data);
  if (page === 'login') return loginPage(params, data);
  return activityPage(data);
}

function bindHome(data) {
  let category = '', oldestFirst = false;
  const search = document.querySelector('#project-search');
  const update = () => {
    const term = search.value.trim().toLocaleLowerCase();
    const projects = data.projects.filter((project) => (!category || project.category === category) && `${project.name} ${project.subtitle} ${project.description}`.toLocaleLowerCase().includes(term));
    projects.sort((a, b) => (new Date(b.updatedAt) - new Date(a.updatedAt)) * (oldestFirst ? -1 : 1));
    document.querySelector('#project-grid').innerHTML = projects.length ? projects.map(projectCard).join('') : emptyState(data.projects.length ? '没有找到匹配的项目' : '这里还没有公开项目', data.projects.length ? '试试其他关键词，或切换项目分类。' : '项目发布后，你可以在这里查看版本、获取安装包。');
    document.querySelector('#search-result-count').textContent = `找到 ${projects.length} 个项目`;
  };
  search.addEventListener('input', update);
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    category = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((item) => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
    update();
  }));
  document.querySelector('#sort-projects').addEventListener('click', (event) => {
    oldestFirst = !oldestFirst;
    event.currentTarget.innerHTML = `${oldestFirst ? '最早更新' : '最近更新'} ${icon('down', 13)}`;
    update();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !document.activeElement?.isContentEditable) { event.preventDefault(); search.focus(); }
  });
}

export function bindPublic(page, params, data) {
  if (page === 'home') bindHome(data);
  if (page === 'login') {
    const input = document.querySelector('#admin-key');
    document.querySelector('#toggle-key').addEventListener('click', (event) => {
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      event.currentTarget.setAttribute('aria-label', visible ? '隐藏密钥' : '显示密钥');
      event.currentTarget.setAttribute('aria-pressed', String(visible));
    });
    document.querySelector('#login-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('[type="submit"]');
      const error = document.querySelector('#login-error');
      if (button.disabled) return;
      if (!input.value.trim()) { error.textContent = '请输入管理员密钥。'; input.focus(); return; }
      button.disabled = true;
      input.disabled = true;
      form.setAttribute('aria-busy', 'true');
      button.textContent = '正在验证…';
      error.textContent = '';
      try {
        await api('/api/login', { method: 'POST', body: { key: input.value } });
        input.value = '';
        location.assign(safeNext(params.get('next')));
      } catch (reason) {
        error.textContent = reason.message;
        if (reason.status === 401) input.value = '';
      } finally {
        button.disabled = false;
        input.disabled = false;
        form.removeAttribute('aria-busy');
        button.innerHTML = `验证并进入 ${icon('arrow', 17)}`;
      }
    });
  }
  if (page === 'project') {
    const copy = async (text, title, message) => {
      try { await copyText(text); toast(message); }
      catch {
        document.querySelector('#copy-dialog-title').textContent = title;
        const input = document.querySelector('#copy-value');
        input.value = text;
        document.querySelector('#copy-dialog').showModal();
        input.select();
      }
    };
    document.querySelector('#share-project').addEventListener('click', () => copy(location.href, '复制项目链接', '项目链接已复制。'));
    document.querySelectorAll('[data-checksum]').forEach((button) => button.addEventListener('click', () => copy(button.dataset.checksum, `${button.dataset.filename} · SHA-256`, 'SHA-256 文件校验值已复制。')));
  }
}
