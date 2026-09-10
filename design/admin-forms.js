import { icon, projectMark } from './icons.js';
import { projects } from './data.js';
import { url, toast } from './app.js';

// 设计稿只保存文字与文件元数据，安装包和图标内容不会上传或持久化。
const DRAFT_PREFIX = 'releasedock.design.';
const MAX_FILE_SIZE = 2 * 1024 ** 3;
const SYSTEMS = ['Windows', 'macOS', 'Linux'];
const ARCHITECTURES = ['x64', 'Apple Silicon', 'ARM64', 'Intel', '通用'];
const DEFAULT_NOTES = '## 新增\n- 全新快捷面板，一键连接常用应用与文件\n- 支持工作区自定义排序，整理更自由\n\n## 优化\n- 提升启动速度，减少后台内存占用\n- 优化多显示器下的窗口布局\n\n## 修复\n- 修复休眠唤醒后的快捷键失效问题';
let releaseState;
let projectState;

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const textValue = (value, fallback, limit = 10000) => typeof value === 'string' ? value.slice(0, limit) : fallback;
const systemIcon = system => ({ Windows: 'windows', macOS: 'apple', Linux: 'terminal' })[system] || 'file';
const option = (value, selected) => `<option value="${escapeHTML(value)}"${value === selected ? ' selected' : ''}>${escapeHTML(value)}</option>`;
const errorSlot = name => `<span class="af-error" id="af-error-${name}" aria-live="polite"></span>`;

function readDraft(key, params) {
  if (params?.has?.('capture')) return {};
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_PREFIX + key) || 'null');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function persistDraft(key, value) {
  try {
    localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    toast('当前浏览器无法保存草稿，内容仍保留在本页。');
    return false;
  }
}

function createRelease(params) {
  const requestedProject = params?.get?.('project') || params?.get?.('id');
  const saved = readDraft('publish', params);
  const project = projects.find(item => item.id === requestedProject) || projects.find(item => item.id === saved.project) || projects[0];
  const defaults = [
    { name: `${project.name}-2.9.0-win-x64.exe`, size: 86.4 * 1024 ** 2, system: 'Windows', arch: 'x64', sample: true },
    { name: `${project.name}-2.9.0-mac-arm64.dmg`, size: 92.1 * 1024 ** 2, system: 'macOS', arch: 'Apple Silicon', sample: true },
    { name: `${project.name}-2.9.0-linux-x64.AppImage`, size: 88.3 * 1024 ** 2, system: 'Linux', arch: 'x64', sample: true },
  ];
  return {
    project: project.id,
    version: textValue(saved.version, '2.9.0', 100),
    title: textValue(saved.title, '更轻盈的体验，更顺手的日常。', 120),
    channel: saved.channel === 'preview' ? 'preview' : 'stable',
    notes: textValue(saved.notes, DEFAULT_NOTES, 30000),
    latest: saved.latest !== false && saved.channel !== 'preview',
    files: Array.isArray(saved.files) ? saved.files.filter(file => file && typeof file.name === 'string' && Number.isFinite(file.size) && file.size >= 0 && file.size <= MAX_FILE_SIZE).slice(0, 50).map(file => ({
      name: file.name.slice(0, 255), size: file.size,
      system: SYSTEMS.includes(file.system) ? file.system : 'Windows',
      arch: ARCHITECTURES.includes(file.arch) ? file.arch : 'x64', sample: file.sample === true,
    })) : defaults,
  };
}

function createProject(params) {
  const isNew = params?.get?.('new') === '1';
  const source = projects.find(item => item.id === params?.get?.('id')) || projects[0];
  const draftKey = `project.${isNew ? 'new' : source.id}`;
  const saved = readDraft(draftKey, params);
  return {
    draftKey, sourceId: source.id, isNew,
    name: textValue(saved.name, isNew ? '' : source.name, 60),
    slug: textValue(saved.slug, isNew ? '' : source.id, 80),
    summary: textValue(saved.summary, isNew ? '' : source.description, 120),
    description: textValue(saved.description, isNew ? '' : `${source.name} 是一款为日常工作打造的${source.subtitle}。\n${source.description}\n\n简洁的界面、顺手的操作，让你把更多精力留给重要的事。`, 5000),
    category: ['效率工具', '开发工具', '系统工具'].includes(saved.category) ? saved.category : source.category,
    website: textValue(saved.website, isNew ? '' : `https://${source.id}.example.com`, 500),
    platforms: Array.isArray(saved.platforms) ? SYSTEMS.filter(system => saved.platforms.includes(system)) : isNew ? ['Windows'] : [...source.platforms],
    visibility: saved.visibility === 'hidden' ? 'hidden' : 'public',
    iconUrl: '',
  };
}

function pageHeading(title, description, actions, eyebrow) {
  return `<header class="af-page-heading"><div><div class="af-eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div><div class="af-page-actions">${actions}</div></header>`;
}

function cardHeading(title, description, trailing = '') {
  return `<div class="af-card-heading"><div><h2>${title}</h2>${description ? `<p>${description}</p>` : ''}</div>${trailing}</div>`;
}

function fileSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return bytes ? `${Math.max(1, Math.round(bytes / 1024))} KB` : '0 KB';
}

function fileRows(files) {
  if (!files.length) return '<div class="af-files-empty">还没有安装包，选择文件开始添加。</div>';
  return files.map((file, index) => `<div class="af-file-row"><span class="af-file-icon">${icon(systemIcon(file.system), 21)}</span><div class="af-file-info"><strong title="${escapeHTML(file.name)}">${escapeHTML(file.name)}</strong><span><span class="mono">${fileSize(file.size)}</span><span class="af-file-dot">·</span>${file.sample ? '示例文件' : '本地文件，尚未上传'}</span></div><select class="af-file-select" data-af-file-system="${index}" aria-label="${escapeHTML(file.name)} 的操作系统">${SYSTEMS.map(system => option(system, file.system)).join('')}</select><select class="af-file-select af-arch-select" data-af-file-arch="${index}" aria-label="${escapeHTML(file.name)} 的处理器架构">${ARCHITECTURES.map(arch => option(arch, file.arch)).join('')}</select><button class="af-remove-file" type="button" data-af-remove-file="${index}" aria-label="移除 ${escapeHTML(file.name)}">${icon('x', 14)}</button></div>`).join('');
}

function renderPublish(state) {
  return `<section class="af-page">
    ${pageHeading('发布新版本', '把新的改进，带给每一位使用者。', `<a class="btn btn-light" href="${url('releases')}">${icon('back', 14)}返回版本列表</a><button class="btn btn-light" id="af-save-draft" type="button">${icon('file', 14)}保存草稿</button>`, 'CREATE A RELEASE')}
    <form id="af-publish-form" class="af-layout" novalidate>
      <div class="af-main-column">
        <section class="af-card">
          ${cardHeading('版本信息', '为这次更新，写一个清晰的开始。', '<span class="af-section-number mono">01</span>')}
          <div class="af-fields af-two-fields">
            <label class="af-field" for="af-release-project"><span>所属项目 <i>*</i></span><select id="af-release-project" name="project">${projects.map(project => `<option value="${project.id}"${state.project === project.id ? ' selected' : ''}>${project.name} · ${project.subtitle}</option>`).join('')}</select></label>
            <label class="af-field" for="af-release-version"><span>版本号 <i>*</i></span><div class="af-input-prefix"><span class="mono">v</span><input class="mono" id="af-release-version" name="version" value="${escapeHTML(state.version)}" placeholder="2.9.0" maxlength="100" aria-describedby="af-error-version" required></div>${errorSlot('version')}</label>
            <label class="af-field af-span-all" for="af-release-title"><span>发布标题 <i>*</i></span><input id="af-release-title" name="title" value="${escapeHTML(state.title)}" placeholder="用一句话介绍这次更新" maxlength="120" aria-describedby="af-error-title" required>${errorSlot('title')}</label>
            <fieldset class="af-field af-span-all af-fieldset"><legend>发布渠道</legend><div class="af-channel-group"><label class="af-radio-option"><input type="radio" name="channel" value="stable"${state.channel === 'stable' ? ' checked' : ''}><span><strong>稳定版</strong><small>推荐所有用户使用</small></span><span class="af-channel-dot"></span></label><label class="af-radio-option"><input type="radio" name="channel" value="preview"${state.channel === 'preview' ? ' checked' : ''}><span><strong>预发布</strong><small>邀请用户提前体验</small></span><span class="af-channel-dot"></span></label></div></fieldset>
          </div>
        </section>
        <section class="af-card af-editor-card">
          ${cardHeading('更新日志', '记录新功能、体验优化和问题修复。', '<span class="af-section-number mono">02</span>')}
          <div class="af-editor"><div class="af-editor-toolbar"><div class="af-editor-tabs" role="tablist" aria-label="更新日志视图"><button type="button" role="tab" aria-selected="true" aria-controls="af-notes-edit-panel" id="af-edit-tab" class="active" data-af-editor-tab="edit">编辑</button><button type="button" role="tab" aria-selected="false" aria-controls="af-notes-preview-panel" id="af-preview-tab" data-af-editor-tab="preview">预览</button></div><div class="af-format-actions" id="af-format-actions"><button type="button" data-af-format="heading" aria-label="插入标题">H</button><button type="button" data-af-format="bold" aria-label="插入粗体">${icon('bold', 14)}</button><button type="button" data-af-format="list" aria-label="插入列表">${icon('list', 15)}</button><button type="button" data-af-format="code" aria-label="插入代码">${icon('code', 15)}</button><button type="button" data-af-format="link" aria-label="插入链接">${icon('link', 14)}</button></div></div><div id="af-notes-edit-panel" role="tabpanel" aria-labelledby="af-edit-tab"><textarea id="af-release-notes" name="notes" maxlength="30000" spellcheck="false" aria-label="Markdown 更新日志" aria-describedby="af-error-notes">${escapeHTML(state.notes)}</textarea></div><div class="af-markdown af-inline-preview" id="af-notes-preview-panel" role="tabpanel" aria-labelledby="af-preview-tab" hidden></div><div class="af-editor-footer"><span><span class="af-markdown-badge">M↓</span> 支持 Markdown 语法</span><span id="af-notes-count" class="mono">${state.notes.length} 字</span></div></div>${errorSlot('notes')}
        </section>
        <section class="af-card af-assets-card">
          ${cardHeading('安装包', '为不同平台，提供对应的下载文件。', `<span class="af-file-count mono" id="af-file-count">${state.files.length} 个文件</span>`)}
          <div class="af-dropzone" id="af-dropzone"><span class="af-upload-symbol">${icon('upload', 24)}</span><p><button type="button" id="af-select-files">点击选择文件</button><span>，或将文件拖放到这里</span></p><small>EXE、DMG、AppImage、ZIP 等 · 单文件上限 2 GB，可配置</small><input id="af-package-input" type="file" multiple hidden></div>
          <div class="af-files" id="af-file-list">${fileRows(state.files)}</div>${errorSlot('files')}
          <p class="af-local-note">${icon('info', 12)}文件选择仅在本地预览，示例安装包不会上传。</p>
        </section>
      </div>
      <aside class="af-side-column">
        <section class="af-card af-publish-settings">
          ${cardHeading('发布设置', '', icon('settings', 17))}
          <div class="af-status-line"><span>当前状态</span><span class="tag tag-orange">${icon('edit', 10)}草稿</span></div><p class="af-settings-description">准备就绪后发布，让访客查看更新并下载安装包。</p>
          <div class="af-setting-divider"></div>
          <label class="af-toggle-row"><span><strong>设为最新稳定版</strong><small id="af-latest-hint">在项目前台优先展示此版本</small></span><span class="af-switch"><input id="af-latest" type="checkbox" name="latest"${state.latest ? ' checked' : ''}${state.channel === 'preview' ? ' disabled' : ''}><span></span></span></label>
          <div class="af-setting-divider"></div>
          <div class="af-checklist"><span>${icon('check', 13)}发布后，所有访客均可下载</span><span>${icon('check', 13)}历史版本和文件会继续保留</span></div>
        </section>
        <section class="af-card af-release-summary">
          <div class="af-summary-label">发布预览 <span class="mono">PREVIEW</span></div>
          <div class="af-summary-identity"><span id="af-summary-mark">${projectMark(state.project)}</span><div><h3 id="af-summary-name">${escapeHTML(projects.find(project => project.id === state.project).name)}</h3><span class="mono" id="af-summary-version">v${escapeHTML(state.version)}</span></div><span class="tag tag-green" id="af-summary-channel">${state.channel === 'stable' ? '稳定版' : '预发布'}</span></div>
          <p id="af-summary-title">${escapeHTML(state.title)}</p><div class="af-summary-meta"><span>${icon('file', 13)}<span id="af-summary-files">${state.files.length} 个安装包</span></span><span>${icon('globe', 13)}公开发布</span></div>
          <button class="btn btn-light btn-wide" id="af-preview-release" type="button">${icon('eye', 15)}预览发布效果</button><button class="btn btn-primary btn-wide af-publish-button" type="submit">${icon('upload', 15)}发布版本</button><p class="af-save-status" id="af-save-status">设计预览 · 不会实际发布</p>
        </section>
        <p class="af-side-note">${icon('info', 13)}好的更新日志，也是一份写给使用者的说明。</p>
      </aside>
    </form>
    <dialog class="af-dialog" id="af-preview-dialog" aria-labelledby="af-dialog-heading"></dialog>
  </section>`;
}

function projectPreview(state) {
  return `<div class="af-project-preview"><div class="af-preview-card-head"><span data-af-project-mark>${state.iconUrl ? `<img src="${escapeHTML(state.iconUrl)}" class="af-custom-icon" alt="项目图标">` : projectMark(state.sourceId)}</span><div><h3 id="af-card-name">${escapeHTML(state.name || '项目名称')}</h3><span class="mono" id="af-card-slug">/${escapeHTML(state.slug || 'project-slug')}</span></div><span id="af-card-category">${escapeHTML(state.category)}</span></div><p id="af-card-summary">${escapeHTML(state.summary || '一句话介绍你的项目，让使用者快速了解它。')}</p><div class="af-preview-version"><span class="mono">${state.isNew ? '待发布' : `v${projects.find(project => project.id === state.sourceId).version}`}</span><span class="tag tag-green">${state.isNew ? '新项目' : '稳定版'}</span></div><div class="af-preview-card-footer"><span id="af-card-platforms">${state.platforms.map(platform => `<span aria-label="${platform}" title="${platform}">${icon(systemIcon(platform), 14)}</span>`).join('')}</span><span>查看版本 ${icon('arrow', 13)}</span></div></div>`;
}

function renderProjectEdit(state) {
  return `<section class="af-page">
    ${pageHeading(state.isNew ? '新建项目' : '项目配置', '让好的软件，从清晰的介绍开始。', `<a class="btn btn-light" href="${url('projects')}">${icon('back', 14)}返回项目列表</a>${state.isNew ? '' : `<a class="btn btn-light" href="${url('project', `id=${state.sourceId}`)}">${icon('external', 13)}查看前台</a>`}`, 'PROJECT SETTINGS')}
    <form class="af-layout" id="af-project-form" novalidate>
      <div class="af-main-column">
        <section class="af-card">
          ${cardHeading('项目资料', '这些信息会显示在公开的项目页面。', '<span class="af-section-number mono">01</span>')}
          <div class="af-fields af-two-fields">
            <label class="af-field" for="af-project-name"><span>项目名称 <i>*</i></span><input id="af-project-name" name="name" value="${escapeHTML(state.name)}" maxlength="60" placeholder="例如 Orbit" aria-describedby="af-error-name" required>${errorSlot('name')}</label>
            <label class="af-field" for="af-project-slug"><span>项目标识 <i>*</i></span><div class="af-input-prefix af-slug-input"><span class="mono">/</span><input class="mono" id="af-project-slug" name="slug" value="${escapeHTML(state.slug)}" maxlength="80" placeholder="orbit" aria-describedby="af-error-slug" required></div><small>用于项目地址，小写字母、数字或短横线</small>${errorSlot('slug')}</label>
            <label class="af-field af-span-all" for="af-project-summary"><span>一句话简介 <i>*</i><em id="af-summary-count">${state.summary.length}/120</em></span><input id="af-project-summary" name="summary" value="${escapeHTML(state.summary)}" maxlength="120" placeholder="简单介绍项目能为使用者做什么" aria-describedby="af-error-summary" required>${errorSlot('summary')}</label>
            <label class="af-field af-span-all" for="af-project-description"><span>详细介绍 <span class="af-optional">选填</span></span><textarea class="af-description" id="af-project-description" name="description" maxlength="5000" placeholder="介绍项目的主要功能、特点和适用场景">${escapeHTML(state.description)}</textarea><small>帮助新使用者更全面地了解项目。</small></label>
            <label class="af-field" for="af-project-category"><span>项目分类</span><select id="af-project-category" name="category">${['效率工具', '开发工具', '系统工具'].map(category => option(category, state.category)).join('')}</select></label>
            <label class="af-field" for="af-project-website"><span>官方网站 <span class="af-optional">选填</span></span><div class="af-input-prefix af-website-input"><span>${icon('link', 14)}</span><input id="af-project-website" name="website" type="url" value="${escapeHTML(state.website)}" maxlength="500" placeholder="https://" aria-describedby="af-error-website"></div>${errorSlot('website')}</label>
            <fieldset class="af-field af-span-all af-fieldset"><legend>支持平台 <i>*</i></legend><div class="af-platform-choices">${SYSTEMS.map(system => `<label><input type="checkbox" name="platforms" value="${system}"${state.platforms.includes(system) ? ' checked' : ''}>${icon(systemIcon(system), 16)}<span>${system}</span></label>`).join('')}</div>${errorSlot('platforms')}</fieldset>
          </div>
        </section>
        <section class="af-card af-icon-card">
          ${cardHeading('项目图标', '一个容易辨认的图标，让项目更有记忆点。', '<span class="af-section-number mono">02</span>')}
          <div class="af-icon-uploader"><div class="af-icon-well" data-af-project-mark>${projectMark(state.sourceId, 'large')}</div><div><button type="button" class="btn btn-light btn-sm" id="af-select-icon">${icon('upload', 13)}选择图片</button><p>PNG、JPG 或 WebP，建议 256 × 256 px<br>不超过 2 MB · 仅在本页预览</p><input id="af-project-icon" type="file" accept="image/png,image/jpeg,image/webp" hidden></div></div>
        </section>
      </div>
      <aside class="af-side-column">
        <section class="af-card af-visibility-card">
          ${cardHeading('项目可见性', '决定谁可以发现这个项目。')}
          <div class="af-visibility-options"><label class="af-visibility-option"><input type="radio" name="visibility" value="public"${state.visibility === 'public' ? ' checked' : ''}><span class="af-visibility-icon">${icon('globe', 18)}</span><span><strong>公开项目</strong><small>所有访客都可以浏览和下载</small></span></label><label class="af-visibility-option"><input type="radio" name="visibility" value="hidden"${state.visibility === 'hidden' ? ' checked' : ''}><span class="af-visibility-icon">${icon('lock', 18)}</span><span><strong>隐藏项目</strong><small>暂不在前台展示</small></span></label></div>
        </section>
        <section class="af-card af-project-preview-panel">
          <div class="af-summary-label">前台卡片预览 <span class="af-live-label"><span></span>实时</span></div>
          ${projectPreview(state)}<p class="af-preview-note" id="af-visibility-note">${state.visibility === 'hidden' ? '当前为隐藏状态，保存后前台不展示。' : '项目将在首页的项目列表中展示。'}</p>
          <button type="submit" class="btn btn-primary btn-wide">${icon('check', 15)}保存项目配置</button><p class="af-save-status" id="af-project-save-status">设计预览 · 仅保存本地草稿</p>
        </section>
        <p class="af-side-note">${icon('info', 13)}项目资料可以随时调整，已发布版本将独立保留。</p>
      </aside>
    </form>
  </section>`;
}

// Markdown 先转义后排版，只允许安全的公开网页链接。
function inlineMarkdown(value) {
  return escapeHTML(value).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function markdown(value) {
  let inList = false;
  let output = '';
  for (const line of value.replace(/\r/g, '').split('\n')) {
    const bullet = /^\s*[-*]\s+(.+)/.exec(line);
    if (bullet) {
      if (!inList) output += '<ul>';
      output += `<li>${inlineMarkdown(bullet[1])}</li>`;
      inList = true;
      continue;
    }
    if (inList) { output += '</ul>'; inList = false; }
    const heading = /^(#{1,3})\s+(.+)/.exec(line);
    if (heading) output += `<h${heading[1].length + 2}>${inlineMarkdown(heading[2])}</h${heading[1].length + 2}>`;
    else if (line.trim()) output += `<p>${inlineMarkdown(line)}</p>`;
  }
  return (output + (inList ? '</ul>' : '')) || '<p class="muted">写下更新内容，即可在这里看到预览。</p>';
}

function clearErrors(form) {
  form.querySelectorAll('.af-error').forEach(node => { node.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach(node => node.removeAttribute('aria-invalid'));
}

function fieldError(form, name, message) {
  const slot = form.querySelector(`#af-error-${name}`);
  if (slot) slot.textContent = message;
  const field = form.elements.namedItem(name);
  if (field instanceof Element) field.setAttribute('aria-invalid', 'true');
}

function validVersion(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
  return !!match && (!match[4] || match[4].split('.').every(part => !/^\d+$/.test(part) || part === '0' || part[0] !== '0'));
}

function collectRelease(form, state) {
  const fields = new FormData(form);
  Object.assign(state, { project: fields.get('project'), version: fields.get('version').trim(), title: fields.get('title').trim(), channel: fields.get('channel'), notes: fields.get('notes'), latest: fields.get('channel') === 'stable' && fields.has('latest') });
}

function validateRelease(form, state, needsFiles = false) {
  clearErrors(form);
  const errors = [];
  if (!validVersion(state.version)) errors.push(['version', '请输入有效版本号，例如 2.9.0 或 2.9.0-beta.1。']);
  else if (state.channel === 'stable' && state.version.split('+')[0].includes('-')) errors.push(['version', '带 beta 等预发布标识的版本，请选择「预发布」渠道。']);
  if (!state.title) errors.push(['title', '请填写这次版本的发布标题。']);
  if (!state.notes.trim()) errors.push(['notes', '请填写更新日志，帮助使用者了解本次变化。']);
  if (needsFiles && !state.files.length) errors.push(['files', '请至少添加一个安装包。']);
  errors.forEach(([name, message]) => fieldError(form, name, message));
  if (errors.length) {
    const first = form.querySelector('[aria-invalid="true"]') || form.querySelector('#af-select-files');
    if (first?.id === 'af-release-notes') form.querySelector('#af-edit-tab')?.click();
    first?.focus();
    toast('还有内容需要完善，请检查表单中的提示。');
  }
  return !errors.length;
}

function bindPublish() {
  const form = document.querySelector('#af-publish-form');
  const state = releaseState;
  const list = form.querySelector('#af-file-list');
  const notes = form.querySelector('#af-release-notes');
  const dialog = document.querySelector('#af-preview-dialog');
  const updateSummary = () => {
    collectRelease(form, state);
    const project = projects.find(item => item.id === state.project);
    form.querySelector('#af-summary-name').textContent = project.name;
    form.querySelector('#af-summary-mark').innerHTML = projectMark(project.id);
    form.querySelector('#af-summary-version').textContent = state.version ? `v${state.version}` : '待填写版本号';
    form.querySelector('#af-summary-title').textContent = state.title || '为这次更新写一个标题';
    const channel = form.querySelector('#af-summary-channel');
    channel.textContent = state.channel === 'stable' ? '稳定版' : '预发布';
    channel.className = `tag ${state.channel === 'stable' ? 'tag-green' : 'tag-orange'}`;
    const latest = form.querySelector('#af-latest');
    latest.disabled = state.channel === 'preview';
    if (latest.disabled) latest.checked = false;
    form.querySelector('#af-latest-hint').textContent = latest.disabled ? '预发布版本不会替换最新稳定版' : '在项目前台优先展示此版本';
    form.querySelector('#af-notes-count').textContent = `${notes.value.length} 字`;
    form.querySelector('#af-notes-preview-panel').innerHTML = markdown(notes.value);
  };
  const updateFiles = () => {
    list.innerHTML = fileRows(state.files);
    form.querySelector('#af-file-count').textContent = `${state.files.length} 个文件`;
    form.querySelector('#af-summary-files').textContent = `${state.files.length} 个安装包`;
    form.querySelector('#af-error-files').textContent = '';
  };
  form.addEventListener('input', updateSummary);
  form.addEventListener('change', updateSummary);
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-af-remove-file]');
    if (!button) return;
    state.files.splice(Number(button.dataset.afRemoveFile), 1);
    updateFiles();
  });
  list.addEventListener('change', event => {
    const select = event.target;
    if (select.dataset.afFileSystem !== undefined) state.files[Number(select.dataset.afFileSystem)].system = select.value;
    if (select.dataset.afFileArch !== undefined) state.files[Number(select.dataset.afFileArch)].arch = select.value;
    updateFiles();
  });
  const addFiles = files => {
    let added = 0;
    const rejected = [];
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) { rejected.push(`${file.name} 超过 2 GB`); continue; }
      if (state.files.length >= 50) { rejected.push('最多可预览 50 个文件'); break; }
      if (state.files.some(item => item.name === file.name && item.size === file.size)) continue;
      const system = /mac|darwin|\.(dmg|pkg)$/i.test(file.name) ? 'macOS' : /linux|\.(appimage|deb|rpm)$/i.test(file.name) ? 'Linux' : 'Windows';
      const arm = /arm|aarch64/i.test(file.name);
      state.files.push({ name: file.name, size: file.size, system, arch: arm ? system === 'macOS' ? 'Apple Silicon' : 'ARM64' : 'x64', sample: false });
      added++;
    }
    updateFiles();
    if (rejected.length) { form.querySelector('#af-error-files').textContent = rejected.join('；'); toast('部分文件未添加，请查看安装包区域的提示。'); }
    else toast(added ? `已添加 ${added} 个本地文件，尚未上传。` : '所选文件已经在列表中。');
  };
  const packageInput = form.querySelector('#af-package-input');
  form.querySelector('#af-select-files').addEventListener('click', () => packageInput.click());
  packageInput.addEventListener('change', () => { addFiles(packageInput.files); packageInput.value = ''; });
  const dropzone = form.querySelector('#af-dropzone');
  let dragDepth = 0;
  dropzone.addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; dropzone.classList.add('af-drag-active'); });
  dropzone.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
  dropzone.addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) dropzone.classList.remove('af-drag-active'); });
  dropzone.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; dropzone.classList.remove('af-drag-active'); addFiles(event.dataTransfer.files); });
  const tabs = [...form.querySelectorAll('[data-af-editor-tab]')];
  const showEditor = tab => {
    const preview = tab.dataset.afEditorTab === 'preview';
    tabs.forEach(button => { button.classList.toggle('active', button === tab); button.setAttribute('aria-selected', String(button === tab)); button.tabIndex = button === tab ? 0 : -1; });
    form.querySelector('#af-notes-edit-panel').hidden = preview;
    form.querySelector('#af-notes-preview-panel').hidden = !preview;
    form.querySelector('#af-format-actions').hidden = preview;
    form.querySelector('#af-notes-preview-panel').innerHTML = markdown(notes.value);
  };
  tabs.forEach((tab, index) => {
    tab.tabIndex = index === 0 ? 0 : -1;
    tab.addEventListener('click', () => showEditor(tab));
    tab.addEventListener('keydown', event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const next = tabs[(index + 1) % tabs.length]; showEditor(next); next.focus(); } });
  });
  form.querySelectorAll('[data-af-format]').forEach(button => button.addEventListener('click', () => {
    const formats = { heading: ['## ', '', '标题'], bold: ['**', '**', '重要内容'], list: ['- ', '', '列表内容'], code: ['`', '`', '代码'], link: ['[', '](https://example.com)', '链接文字'] };
    const [before, after, placeholder] = formats[button.dataset.afFormat];
    const start = notes.selectionStart;
    const selected = notes.value.slice(start, notes.selectionEnd) || placeholder;
    notes.setRangeText(before + selected + after, start, notes.selectionEnd, 'end');
    notes.focus();
    notes.setSelectionRange(start + before.length, start + before.length + selected.length);
    notes.dispatchEvent(new Event('input', { bubbles: true }));
  }));
  document.querySelector('#af-save-draft').addEventListener('click', () => {
    collectRelease(form, state);
    if (persistDraft('publish', state)) {
      document.querySelector('#af-save-status').textContent = `草稿已保存至本浏览器 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
      toast('演示草稿已保存到本地，安装包内容不会保存或上传。');
    }
  });
  form.querySelector('#af-preview-release').addEventListener('click', () => {
    collectRelease(form, state);
    if (!validateRelease(form, state)) return;
    const project = projects.find(item => item.id === state.project);
    dialog.innerHTML = `<div class="af-dialog-shell"><header class="af-dialog-header"><div><span class="af-eyebrow">RELEASE PREVIEW</span><h2 id="af-dialog-heading">发布效果预览</h2></div><button class="btn btn-light btn-icon" type="button" data-af-close aria-label="关闭预览">${icon('x', 16)}</button></header><div class="af-dialog-body"><div class="af-dialog-identity">${projectMark(project.id)}<div><h3>${escapeHTML(project.name)} <span class="mono">v${escapeHTML(state.version)}</span></h3><span class="tag ${state.channel === 'stable' ? 'tag-green' : 'tag-orange'}">${state.channel === 'stable' ? '稳定版' : '预发布'}</span>${state.latest ? '<span class="af-dialog-latest">最新版本</span>' : ''}</div></div><h3 class="af-dialog-title">${escapeHTML(state.title)}</h3><div class="af-markdown">${markdown(state.notes)}</div><div class="af-dialog-downloads"><h4>下载安装包 <span class="mono">${state.files.length}</span></h4>${state.files.length ? state.files.map(file => `<div>${icon(systemIcon(file.system), 18)}<span><strong>${escapeHTML(file.system)} <small>${escapeHTML(file.arch)}</small></strong><span>${escapeHTML(file.name)}</span></span><span class="mono">${fileSize(file.size)}</span>${icon('download', 16)}</div>`).join('') : '<p class="muted">安装包尚未添加。</p>'}</div></div><footer class="af-dialog-footer"><span>${icon('info', 12)}设计预览，安装包不可下载。</span><button type="button" class="btn btn-primary" data-af-close>返回继续编辑</button></footer></div>`;
    dialog.querySelectorAll('[data-af-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
    dialog.showModal();
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    collectRelease(form, state);
    if (!validateRelease(form, state, true)) return;
    toast('发布信息校验通过。这是设计预览，版本不会真正发布。');
    document.querySelector('#af-save-status').textContent = '信息校验通过 · 设计预览未实际发布';
  });
  updateSummary();
}

function bindProjectEdit() {
  const form = document.querySelector('#af-project-form');
  const state = projectState;
  const collect = () => {
    const values = new FormData(form);
    for (const name of ['name', 'slug', 'summary', 'description', 'website']) state[name] = values.get(name).trim();
    state.category = values.get('category');
    state.platforms = values.getAll('platforms');
    state.visibility = values.get('visibility');
  };
  const updatePreview = () => {
    collect();
    form.querySelector('#af-card-name').textContent = state.name || '项目名称';
    form.querySelector('#af-card-slug').textContent = `/${state.slug || 'project-slug'}`;
    form.querySelector('#af-card-summary').textContent = state.summary || '一句话介绍你的项目，让使用者快速了解它。';
    form.querySelector('#af-card-category').textContent = state.category;
    form.querySelector('#af-card-platforms').innerHTML = state.platforms.map(platform => `<span aria-label="${platform}" title="${platform}">${icon(systemIcon(platform), 14)}</span>`).join('');
    form.querySelector('#af-summary-count').textContent = `${form.elements.summary.value.length}/120`;
    form.querySelector('#af-visibility-note').textContent = state.visibility === 'hidden' ? '当前为隐藏状态，保存后前台不展示。' : '项目将在首页的项目列表中展示。';
    form.querySelector('.af-project-preview').classList.toggle('af-preview-hidden', state.visibility === 'hidden');
  };
  form.addEventListener('input', updatePreview);
  form.addEventListener('change', updatePreview);
  const imageInput = form.querySelector('#af-project-icon');
  form.querySelector('#af-select-icon').addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    imageInput.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 ** 2) { toast('请选择不超过 2 MB 的 PNG、JPG 或 WebP 图片。'); return; }
    const nextUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (state.iconUrl) URL.revokeObjectURL(state.iconUrl);
      state.iconUrl = nextUrl;
      form.querySelectorAll('[data-af-project-mark]').forEach(node => { node.innerHTML = `<img src="${nextUrl}" class="af-custom-icon" alt="${escapeHTML(state.name || '项目')}图标">`; });
      toast('项目图标已在本页预览，图片不会上传。');
    };
    image.onerror = () => { URL.revokeObjectURL(nextUrl); toast('这张图片无法读取，请选择另一张图片。'); };
    image.src = nextUrl;
  });
  window.addEventListener('pagehide', () => { if (state.iconUrl) URL.revokeObjectURL(state.iconUrl); }, { once: true });
  form.addEventListener('submit', event => {
    event.preventDefault();
    collect();
    clearErrors(form);
    const errors = [];
    if (!state.name) errors.push(['name', '请填写项目名称。']);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(state.slug)) errors.push(['slug', '使用小写字母、数字或连接它们的短横线。']);
    else if (projects.some(project => project.id === state.slug && (state.isNew || project.id !== state.sourceId))) errors.push(['slug', '这个项目标识已被使用，请换一个。']);
    if (!state.summary) errors.push(['summary', '请用一句话介绍这个项目。']);
    if (!state.platforms.length) errors.push(['platforms', '请至少选择一个支持平台。']);
    if (state.website) {
      try { if (!['http:', 'https:'].includes(new URL(state.website).protocol)) throw new Error('protocol'); }
      catch { errors.push(['website', '请输入以 https:// 或 http:// 开头的网址。']); }
    }
    errors.forEach(([name, message]) => fieldError(form, name, message));
    if (errors.length) { (form.querySelector('[aria-invalid="true"]') || form.querySelector('[name="platforms"]'))?.focus(); toast('请完善标出的项目资料后再保存。'); return; }
    const { iconUrl, draftKey, ...draft } = state;
    if (persistDraft(draftKey, draft)) {
      form.querySelector('#af-project-save-status').textContent = '配置已保存为本地演示草稿';
      toast('项目配置已保存到本地设计草稿，前台示例数据未变更。');
    }
  });
  updatePreview();
}

export function renderAdminForm(page, params) {
  if (page === 'publish') { releaseState = createRelease(params); return renderPublish(releaseState); }
  if (page === 'project-edit') { projectState = createProject(params); return renderProjectEdit(projectState); }
  return '';
}

export function bindAdminForm(page, params) {
  if (page === 'publish') bindPublish();
  else if (page === 'project-edit') bindProjectEdit();
}
