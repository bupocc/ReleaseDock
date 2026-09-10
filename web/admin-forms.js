import { icon, projectMark } from './icons.js';
import { api, escapeHtml, formatBytes, renderNotes } from './api.js';
import { url, toast } from './app.js';

const SYSTEMS = ['Windows', 'macOS', 'Linux'];
const ARCHES = ['x64', 'arm64', 'x86', 'universal'];
const ARCH_LABELS = { x64: 'x64', arm64: 'ARM64', x86: 'x86', universal: '通用' };
const MAX_PACKAGE_SIZE = 2 * 1024 ** 3;
const MAX_ICON_SIZE = 2 * 1024 ** 2;
let releaseState;
let projectState;
let fileSequence = 0;

const esc = escapeHtml;
const str = value => typeof value === 'string' ? value : '';
const systemIcon = value => ({ Windows: 'windows', macOS: 'apple', Linux: 'terminal' })[value] || 'file';
const option = (value, selected, label = value) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
const errorSlot = name => `<span class="af-error" id="af-error-${name}" aria-live="polite"></span>`;
const statusLabel = status => ({ draft: '草稿', published: '已发布', withdrawn: '已撤回' })[status] || '草稿';
const errorMessage = error => error?.message || '请求失败，请检查网络后重试。';

function heading(title, description, actions, eyebrow = 'CREATE A RELEASE') {
  return `<header class="af-page-heading"><div><div class="af-eyebrow">${eyebrow}</div><h1 id="af-page-title">${title}</h1><p>${description}</p></div><div class="af-page-actions">${actions}</div></header>`;
}

function cardHeading(title, description = '', trailing = '') {
  return `<div class="af-card-heading"><div><h2>${title}</h2>${description ? `<p>${description}</p>` : ''}</div>${trailing}</div>`;
}

function feedbackMarkup() {
  return '<div class="af-feedback" id="af-feedback" role="alert" hidden></div>';
}

function feedback(message, kind = 'error') {
  const node = document.querySelector('#af-feedback');
  if (!node) return;
  node.textContent = message;
  node.className = `af-feedback af-feedback-${kind}`;
  node.hidden = !message;
}

function emptyPage(title, message, target = 'project-edit', extra = 'new=1', action = '创建第一个项目') {
  return `<section class="af-page">${heading(title, '让好的软件，从清晰的介绍开始。', '')}<div class="af-card af-empty-page">${icon('folder', 36)}<h2>${message}</h2><p>项目用于归档版本、更新日志与安装包。</p><a class="btn btn-primary" href="${url(target, extra)}">${icon('plus', 15)}${action}</a></div></section>`;
}

function makeRelease(params, data) {
  const release = data.release;
  const projects = [...(data.projects || [])];
  if (data.project && !projects.some(item => item.id === data.project.id)) projects.push(data.project);
  const projectId = release?.projectId || params.get('project') || data.project?.id || projects[0]?.id;
  const project = projects.find(item => item.id === projectId);
  const state = {
    projects, project, id: release?.id || '', projectId,
    version: str(release?.version), title: str(release?.title), notes: str(release?.notes),
    channel: release?.channel === 'prerelease' ? 'prerelease' : 'stable',
    status: release?.status || 'draft', latest: release && release.status !== 'draft' ? !!release.isLatest : release?.channel !== 'prerelease',
    assets: Array.isArray(data.assets) ? [...data.assets] : [], pending: [], busy: false, allowLeave: false,
    saved: !!release, updatedAt: release?.updatedAt || '',
  };
  state.readonly = !!release && release.status !== 'draft';
  state.fingerprint = JSON.stringify(releasePayload(state));
  return state;
}

function releasePayload(state) {
  return { projectId: state.projectId, version: state.version.trim(), title: state.title.trim(), notes: state.notes, channel: state.channel };
}

function assetOptions(values, selected, labels = {}) {
  const choices = values.includes(selected) || !selected ? values : [selected, ...values];
  return choices.map(value => option(value, selected, labels[value] || value)).join('');
}

function assetRows(state) {
  const locked = state.readonly || state.busy;
  const serverRows = state.assets.map(asset => `<div class="af-file-row" data-af-asset="${esc(asset.id)}"><span class="af-file-icon">${icon(systemIcon(asset.platform), 21)}</span><div class="af-file-info"><strong title="${esc(asset.filename)}">${esc(asset.filename)}</strong><span><span class="mono">${formatBytes(asset.size)}</span><span class="af-file-dot">·</span>已上传${asset.sha256 ? ' · SHA-256 已生成' : ''}</span></div><select class="af-file-select" data-af-asset-platform="${esc(asset.id)}" aria-label="${esc(asset.filename)} 的操作系统"${locked ? ' disabled' : ''}>${assetOptions(SYSTEMS, asset.platform)}</select><select class="af-file-select af-arch-select" data-af-asset-arch="${esc(asset.id)}" aria-label="${esc(asset.filename)} 的处理器架构"${locked ? ' disabled' : ''}>${assetOptions(ARCHES, asset.arch, ARCH_LABELS)}</select>${state.readonly ? `<span class="af-file-locked" title="此版本的文件不可修改">${icon('lock', 13)}</span>` : `<button class="af-remove-file" type="button" data-af-delete-asset="${esc(asset.id)}" aria-label="移除 ${esc(asset.filename)}"${locked ? ' disabled' : ''}>${icon('x', 14)}</button>`}</div>`).join('');
  const pendingRows = state.pending.map(item => `<div class="af-file-row af-pending-row${item.status === 'failed' ? ' af-upload-failed' : ''}" data-af-pending="${item.key}"><span class="af-file-icon">${item.status === 'uploading' ? '<span class="af-spinner" aria-label="正在上传"></span>' : icon(systemIcon(item.platform), 21)}</span><div class="af-file-info"><strong title="${esc(item.file.name)}">${esc(item.file.name)}</strong><span><span class="mono">${formatBytes(item.file.size)}</span><span class="af-file-dot">·</span>${item.status === 'uploading' ? '正在上传，请勿关闭页面' : item.status === 'failed' ? '上传失败，可重试' : '等待上传'}</span></div><select class="af-file-select" data-af-pending-platform="${item.key}" aria-label="${esc(item.file.name)} 的操作系统"${locked ? ' disabled' : ''}>${assetOptions(SYSTEMS, item.platform)}</select><select class="af-file-select af-arch-select" data-af-pending-arch="${item.key}" aria-label="${esc(item.file.name)} 的处理器架构"${locked ? ' disabled' : ''}>${assetOptions(ARCHES, item.arch, ARCH_LABELS)}</select><button class="af-remove-file" type="button" data-af-remove-pending="${item.key}" aria-label="取消上传 ${esc(item.file.name)}"${locked ? ' disabled' : ''}>${icon('x', 14)}</button>${item.error ? `<p class="af-upload-error">${esc(item.error)}<button type="button" data-af-retry-file="${item.key}"${locked ? ' disabled' : ''}>重试</button></p>` : ''}</div>`).join('');
  return serverRows + pendingRows || `<div class="af-files-empty">${state.readonly ? '此版本没有安装包。' : '还没有安装包，选择文件开始上传。'}</div>`;
}

function renderPublish(state) {
  const locked = state.readonly;
  const disabled = locked ? ' disabled' : '';
  const title = locked ? '版本详情' : state.id ? '编辑版本草稿' : '发布新版本';
  const actions = `<a class="btn btn-light" href="${url('releases')}">${icon('back', 14)}返回版本列表</a>${locked ? `<a class="btn btn-primary" href="${url('publish', `project=${encodeURIComponent(state.projectId)}`)}">${icon('plus', 14)}发布新版本</a>` : '<button class="btn btn-light" id="af-save-draft" type="button">保存草稿</button>'}`;
  return `<section class="af-page" id="af-release-page">
    ${heading(title, locked ? '版本内容与安装包保持不变，新的改进请发布新版本。' : '把新的改进，带给每一位使用者。', actions)}
    ${feedbackMarkup()}
    ${locked ? `<div class="af-readonly-notice">${icon('lock', 16)}${state.status === 'withdrawn' ? '此版本已撤回，访客无法下载；版本记录以只读方式保留。' : '此版本已经发布。为保持下载内容和校验值一致，版本信息及文件不可修改。'}</div>` : ''}
    <form id="af-publish-form" class="af-layout" novalidate>
      <div class="af-main-column">
        <section class="af-card">
          ${cardHeading('版本信息', '为这次更新，写一个清晰的开始。', '<span class="af-section-number mono">01</span>')}
          <div class="af-fields af-two-fields">
            <label class="af-field" for="af-release-project"><span>所属项目 <i>*</i></span><select id="af-release-project" name="projectId"${state.id ? ' disabled' : ''}>${state.projects.map(project => option(project.id, state.projectId, project.name)).join('')}</select>${state.id ? '<small>草稿创建后，所属项目不可变更。</small>' : ''}${errorSlot('projectId')}</label>
            <label class="af-field" for="af-release-version"><span>版本号 <i>*</i></span><div class="af-input-prefix"><span class="mono">v</span><input class="mono" id="af-release-version" name="version" value="${esc(state.version)}" placeholder="1.0.0" maxlength="100" aria-describedby="af-error-version" required${locked ? ' readonly' : ''}></div>${errorSlot('version')}</label>
            <label class="af-field af-span-all" for="af-release-title"><span>发布标题 <i>*</i></span><input id="af-release-title" name="title" value="${esc(state.title)}" placeholder="用一句话介绍这次更新" maxlength="200" aria-describedby="af-error-title" required${locked ? ' readonly' : ''}>${errorSlot('title')}</label>
            <fieldset class="af-field af-span-all af-fieldset"><legend>发布渠道</legend><div class="af-channel-group"><label class="af-radio-option"><input type="radio" name="channel" value="stable"${state.channel === 'stable' ? ' checked' : ''}${disabled}><span><strong>稳定版</strong><small>推荐所有用户使用</small></span><span class="af-channel-dot"></span></label><label class="af-radio-option"><input type="radio" name="channel" value="prerelease"${state.channel === 'prerelease' ? ' checked' : ''}${disabled}><span><strong>预发布</strong><small>邀请用户提前体验</small></span><span class="af-channel-dot"></span></label></div></fieldset>
          </div>
        </section>
        <section class="af-card af-editor-card">
          ${cardHeading('更新日志', '记录新功能、体验优化和问题修复。', '<span class="af-section-number mono">02</span>')}
          <div class="af-editor"><div class="af-editor-toolbar"><div class="af-editor-tabs" role="tablist" aria-label="更新日志视图"><button type="button" role="tab" aria-selected="true" aria-controls="af-notes-edit-panel" id="af-edit-tab" class="active" data-af-editor-tab="edit">${locked ? '原文' : '编辑'}</button><button type="button" role="tab" aria-selected="false" aria-controls="af-notes-preview-panel" id="af-preview-tab" data-af-editor-tab="preview">预览</button></div>${locked ? '' : `<div class="af-format-actions" id="af-format-actions"><button type="button" data-af-format="heading" aria-label="插入标题">H</button><button type="button" data-af-format="bold" aria-label="插入粗体">${icon('bold', 14)}</button><button type="button" data-af-format="list" aria-label="插入列表">${icon('list', 15)}</button><button type="button" data-af-format="code" aria-label="插入代码">${icon('code', 15)}</button></div>`}</div><div id="af-notes-edit-panel" role="tabpanel" aria-labelledby="af-edit-tab"><textarea id="af-release-notes" name="notes" maxlength="100000" spellcheck="false" placeholder="## 新增&#10;- 介绍本次新增的功能&#10;&#10;## 优化&#10;- 记录体验改进与问题修复" aria-label="Markdown 更新日志" aria-describedby="af-error-notes"${locked ? ' readonly' : ''}>${esc(state.notes)}</textarea></div><div class="af-markdown af-inline-preview" id="af-notes-preview-panel" role="tabpanel" aria-labelledby="af-preview-tab" hidden></div><div class="af-editor-footer"><span><span class="af-markdown-badge">M↓</span> 支持 Markdown 语法</span><span id="af-notes-count" class="mono">${state.notes.length} 字</span></div></div>${errorSlot('notes')}
        </section>
        <section class="af-card af-assets-card">
          ${cardHeading('安装包', locked ? '此版本保留的真实下载文件。' : '选择文件后，先保存草稿，再逐个上传。', `<span class="af-file-count mono" id="af-file-count">${state.assets.length} 个文件</span>`)}
          ${locked ? '' : `<div class="af-dropzone" id="af-dropzone"><span class="af-upload-symbol">${icon('upload', 24)}</span><p><button type="button" id="af-select-files">点击选择文件</button><span>，或将文件拖放到这里</span></p><small>EXE、DMG、AppImage、ZIP 等 · 每个文件最大 2 GB</small><input id="af-package-input" type="file" multiple hidden></div>`}
          <div class="af-files" id="af-file-list">${assetRows(state)}</div>${errorSlot('assets')}
          ${locked ? '' : `<div class="af-upload-footer"><span id="af-upload-status" aria-live="polite">文件上传完成后，才可正式发布。</span><button class="btn btn-light btn-sm" id="af-upload-pending" type="button" hidden>上传待处理文件</button></div>`}
        </section>
      </div>
      <aside class="af-side-column">
        <section class="af-card af-publish-settings">
          ${cardHeading('发布设置', '', icon('settings', 17))}
          <div class="af-status-line"><span>当前状态</span><span class="tag ${state.status === 'published' ? 'tag-green' : 'tag-orange'}" id="af-release-status">${state.id ? statusLabel(state.status) : '尚未保存'}</span></div><p class="af-settings-description" id="af-settings-description">${locked ? '如需修改内容或安装包，请创建一个新的版本。' : state.project.isPublic ? '准备就绪后发布，让访客查看更新并下载安装包。' : '项目当前隐藏；发布后的版本仍不会向访客展示。'}</p>
          <div class="af-setting-divider"></div><label class="af-toggle-row"><span><strong>设为最新稳定版</strong><small id="af-latest-hint">在项目前台优先展示此版本</small></span><span class="af-switch"><input id="af-latest" type="checkbox" name="latest"${state.latest ? ' checked' : ''}${locked || state.channel !== 'stable' ? ' disabled' : ''}><span></span></span></label>
          <div class="af-setting-divider"></div><div class="af-checklist"><span>${icon('check', 13)}草稿内容仅管理员可见</span><span>${icon('check', 13)}发布后保留固定文件与校验值</span></div>
        </section>
        <section class="af-card af-release-summary">
          <div class="af-summary-label">发布预览 <span class="mono">PREVIEW</span></div><div class="af-summary-identity"><span id="af-summary-mark">${projectMark(state.project)}</span><div><h3 id="af-summary-name">${esc(state.project.name)}</h3><span class="mono" id="af-summary-version">${state.version ? `v${esc(state.version)}` : '待填写版本号'}</span></div><span class="tag tag-green" id="af-summary-channel">${state.channel === 'stable' ? '稳定版' : '预发布'}</span></div>
          <p id="af-summary-title">${esc(state.title || '为这次更新写一个标题')}</p><div class="af-summary-meta"><span>${icon('file', 13)}<span id="af-summary-files">${state.assets.length} 个安装包</span></span><span id="af-summary-visibility">${icon(state.project.isPublic ? 'globe' : 'lock', 13)}${state.project.isPublic ? '公开项目' : '隐藏项目'}</span></div>
          <button class="btn btn-light btn-wide" id="af-preview-release" type="button">${icon('eye', 15)}预览发布效果</button>${locked ? '' : `<button class="btn btn-primary btn-wide af-publish-button" id="af-publish-release" type="submit">${icon('upload', 15)}发布版本</button>`}<p class="af-save-status" id="af-save-status" aria-live="polite">${locked ? '版本以只读方式保留' : state.id ? '草稿已保存' : '填写版本信息，开始一次新发布'}</p>
        </section><p class="af-side-note">${icon('info', 13)}好的更新日志，也是一份写给使用者的说明。</p>
      </aside>
    </form><dialog class="af-dialog" id="af-preview-dialog" aria-labelledby="af-dialog-heading"></dialog>
  </section>`;
}

function makeProject(params, data) {
  const project = params.get('new') === '1' ? null : data.project;
  const state = { project, id: project?.id || '', projects: data.projects || [], name: str(project?.name), slug: str(project?.slug), subtitle: str(project?.subtitle), description: str(project?.description), category: project?.category || '效率工具', website: str(project?.website), platforms: [...(project?.platforms || [])], isPublic: project ? !!project.isPublic : true, iconFile: null, iconUrl: '', busy: false, allowLeave: false };
  state.fingerprint = JSON.stringify(projectPayload(state));
  return state;
}

function projectPayload(state) {
  return { name: state.name.trim(), slug: state.slug.trim(), subtitle: state.subtitle.trim(), description: state.description, category: state.category, website: state.website.trim(), platforms: state.platforms, isPublic: state.isPublic };
}

function projectPreview(state) {
  const version = typeof state.project?.latestVersion === 'string' ? state.project.latestVersion : state.project?.latestVersion?.version;
  return `<div class="af-project-preview"><div class="af-preview-card-head"><span data-af-project-mark>${projectMark(state.project || { slug: state.slug })}</span><div><h3 id="af-card-name">${esc(state.name || '项目名称')}</h3><span class="mono" id="af-card-slug">/${esc(state.slug || 'project-slug')}</span></div><span id="af-card-category">${esc(state.category)}</span></div><p id="af-card-summary">${esc(state.subtitle || '一句话介绍你的项目，让使用者快速了解它。')}</p><div class="af-preview-version"><span class="mono">${version ? `v${esc(version)}` : '尚未发布版本'}</span>${version ? '<span class="tag tag-green">稳定版</span>' : ''}</div><div class="af-preview-card-footer"><span id="af-card-platforms">${state.platforms.map(platform => `<span aria-label="${esc(platform)}" title="${esc(platform)}">${icon(systemIcon(platform), 14)}</span>`).join('')}</span><span>查看版本 ${icon('arrow', 13)}</span></div></div>`;
}

function renderProject(state) {
  const categories = [...new Set(['效率工具', '开发工具', '系统工具', '其他', state.category])];
  return `<section class="af-page" id="af-project-page">
    ${heading(state.id ? '项目配置' : '新建项目', '让好的软件，从清晰的介绍开始。', `<a class="btn btn-light" href="${url('projects')}">${icon('back', 14)}返回项目列表</a><a class="btn btn-light" id="af-view-project" href="${state.id ? url('project', `id=${encodeURIComponent(state.project.slug)}`) : '#'}"${state.id && state.isPublic ? '' : ' hidden'}>${icon('external', 13)}查看前台</a>`, 'PROJECT SETTINGS')}
    ${feedbackMarkup()}
    <form class="af-layout" id="af-project-form" novalidate>
      <div class="af-main-column">
        <section class="af-card">${cardHeading('项目资料', '这些信息会显示在公开的项目页面。', '<span class="af-section-number mono">01</span>')}
          <div class="af-fields af-two-fields">
            <label class="af-field" for="af-project-name"><span>项目名称 <i>*</i></span><input id="af-project-name" name="name" value="${esc(state.name)}" maxlength="100" placeholder="例如 Orbit" aria-describedby="af-error-name" required>${errorSlot('name')}</label>
            <label class="af-field" for="af-project-slug"><span>项目标识 <i>*</i></span><div class="af-input-prefix af-slug-input"><span class="mono">/</span><input class="mono" id="af-project-slug" name="slug" value="${esc(state.slug)}" maxlength="80" placeholder="orbit" aria-describedby="af-error-slug" required></div><small>用于项目地址，小写字母、数字或短横线</small>${errorSlot('slug')}</label>
            <label class="af-field af-span-all" for="af-project-summary"><span>一句话简介 <i>*</i><em id="af-summary-count">${state.subtitle.length}/160</em></span><input id="af-project-summary" name="subtitle" value="${esc(state.subtitle)}" maxlength="160" placeholder="简单介绍项目能为使用者做什么" aria-describedby="af-error-subtitle" required>${errorSlot('subtitle')}</label>
            <label class="af-field af-span-all" for="af-project-description"><span>详细介绍 <span class="af-optional">选填</span></span><textarea class="af-description" id="af-project-description" name="description" maxlength="10000" placeholder="介绍项目的主要功能、特点和适用场景">${esc(state.description)}</textarea><small>帮助新使用者更全面地了解项目。</small></label>
            <label class="af-field" for="af-project-category"><span>项目分类</span><select id="af-project-category" name="category">${categories.map(category => option(category, state.category)).join('')}</select></label>
            <label class="af-field" for="af-project-website"><span>官方网站 <span class="af-optional">选填</span></span><div class="af-input-prefix af-website-input"><span>${icon('link', 14)}</span><input id="af-project-website" name="website" type="url" value="${esc(state.website)}" maxlength="2000" placeholder="https://" aria-describedby="af-error-website"></div>${errorSlot('website')}</label>
            <fieldset class="af-field af-span-all af-fieldset"><legend>支持平台 <i>*</i></legend><div class="af-platform-choices">${SYSTEMS.map(system => `<label><input type="checkbox" name="platforms" value="${system}"${state.platforms.includes(system) ? ' checked' : ''}>${icon(systemIcon(system), 16)}<span>${system}</span></label>`).join('')}</div>${errorSlot('platforms')}</fieldset>
          </div>
        </section>
        <section class="af-card af-icon-card">${cardHeading('项目图标', '一个容易辨认的图标，让项目更有记忆点。', '<span class="af-section-number mono">02</span>')}<div class="af-icon-uploader"><div class="af-icon-well" data-af-project-mark>${projectMark(state.project || { slug: state.slug }, 'large')}</div><div><button type="button" class="btn btn-light btn-sm" id="af-select-icon">${icon('upload', 13)}选择图片</button><p>PNG、JPG 或 WebP，建议 256 × 256 px<br>不超过 2 MB，保存项目时上传</p><input id="af-project-icon" type="file" accept="image/png,image/jpeg,image/webp" hidden></div></div><div class="af-icon-status" id="af-icon-status" aria-live="polite"></div><button type="button" class="btn btn-light btn-sm" id="af-retry-icon" hidden>重试图标上传</button></section>
      </div>
      <aside class="af-side-column">
        <section class="af-card af-visibility-card">${cardHeading('项目可见性', '决定谁可以发现这个项目。')}<div class="af-visibility-options"><label class="af-visibility-option"><input type="radio" name="visibility" value="public"${state.isPublic ? ' checked' : ''}><span class="af-visibility-icon">${icon('globe', 18)}</span><span><strong>公开项目</strong><small>访客可浏览并下载已发布版本</small></span></label><label class="af-visibility-option"><input type="radio" name="visibility" value="hidden"${!state.isPublic ? ' checked' : ''}><span class="af-visibility-icon">${icon('lock', 18)}</span><span><strong>隐藏项目</strong><small>前台不展示，访客不能下载</small></span></label></div></section>
        <section class="af-card af-project-preview-panel"><div class="af-summary-label">前台卡片预览 <span class="af-live-label"><span></span>实时</span></div>${projectPreview(state)}<p class="af-preview-note" id="af-visibility-note">${state.isPublic ? '保存后，项目会在公开列表中展示。' : '保存后，项目及版本不会向访客展示。'}</p><button type="submit" class="btn btn-primary btn-wide" id="af-save-project">${icon('check', 15)}${state.id ? '保存项目配置' : '创建项目'}</button><p class="af-save-status" id="af-project-save-status" aria-live="polite">${state.id ? '修改后记得保存' : '填写项目资料，开始管理软件版本'}</p></section>
        <p class="af-side-note">${icon('info', 13)}项目资料可以随时调整，已发布版本将独立保留。</p>
      </aside>
    </form>
  </section>`;
}

function clearErrors(form) {
  form.querySelectorAll('.af-error').forEach(node => { node.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach(node => node.removeAttribute('aria-invalid'));
}

function showErrors(form, errors) {
  for (const [name, message] of errors) {
    const slot = form.querySelector(`#af-error-${name}`);
    if (slot) slot.textContent = message;
    const field = form.querySelector(`[name="${name}"]`);
    field?.setAttribute('aria-invalid', 'true');
  }
  if (errors.length) {
    const first = form.querySelector('[aria-invalid="true"]');
    if (first?.name === 'notes') form.querySelector('#af-edit-tab')?.click();
    first?.focus();
  }
  return errors.length === 0;
}

function validVersion(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
  return !!match && (!match[4] || match[4].split('.').every(part => !/^\d+$/.test(part) || part === '0' || part[0] !== '0'));
}

function bindRelease(state) {
  const form = document.querySelector('#af-publish-form');
  if (!form) return;
  const root = document.querySelector('#af-release-page');
  const list = form.querySelector('#af-file-list');
  const notes = form.querySelector('#af-release-notes');
  const saveButton = root.querySelector('#af-save-draft');
  const dialog = root.querySelector('#af-preview-dialog');
  const setStatus = message => { form.querySelector('#af-save-status').textContent = message; };
  const collect = () => {
    if (state.readonly) return;
    state.projectId = form.elements.projectId.value;
    state.project = state.projects.find(item => item.id === state.projectId);
    state.version = form.elements.version.value.trim();
    state.title = form.elements.title.value.trim();
    state.notes = notes.value;
    state.channel = form.querySelector('[name="channel"]:checked').value;
    state.latest = state.channel === 'stable' && form.elements.latest.checked;
  };
  const controls = () => {
    root.classList.toggle('af-busy', state.busy);
    form.setAttribute('aria-busy', String(state.busy));
    form.querySelectorAll('input,select,textarea').forEach(node => {
      const readonlyText = state.readonly && ['version', 'title', 'notes'].includes(node.name);
      node.disabled = state.busy || (state.readonly && !readonlyText) || (node.name === 'projectId' && !!state.id) || (node.name === 'latest' && state.channel !== 'stable');
      if (readonlyText) node.readOnly = true;
    });
    root.querySelectorAll('button').forEach(node => { if (!dialog.contains(node)) node.disabled = state.busy; });
  };
  const syncFiles = () => {
    list.innerHTML = assetRows(state);
    form.querySelector('#af-file-count').textContent = `${state.assets.length} 个已上传${state.pending.length ? ` · ${state.pending.length} 个待处理` : ''}`;
    form.querySelector('#af-summary-files').textContent = `${state.assets.length} 个安装包`;
    const uploadButton = form.querySelector('#af-upload-pending');
    if (uploadButton) { uploadButton.hidden = !state.pending.length; uploadButton.disabled = state.busy; }
  };
  const updateSummary = () => {
    collect();
    form.querySelector('#af-summary-name').textContent = state.project.name;
    form.querySelector('#af-summary-mark').innerHTML = projectMark(state.project);
    form.querySelector('#af-summary-version').textContent = state.version ? `v${state.version}` : '待填写版本号';
    form.querySelector('#af-summary-title').textContent = state.title || '为这次更新写一个标题';
    const channel = form.querySelector('#af-summary-channel');
    channel.textContent = state.channel === 'stable' ? '稳定版' : '预发布';
    channel.className = `tag ${state.channel === 'stable' ? 'tag-green' : 'tag-orange'}`;
    if (state.channel !== 'stable') form.elements.latest.checked = false;
    form.elements.latest.disabled = state.busy || state.readonly || state.channel !== 'stable';
    form.querySelector('#af-latest-hint').textContent = state.channel === 'stable' ? '在项目前台优先展示此版本' : '预发布版本不会替换最新稳定版';
    form.querySelector('#af-summary-visibility').innerHTML = `${icon(state.project.isPublic ? 'globe' : 'lock', 13)}${state.project.isPublic ? '公开项目' : '隐藏项目'}`;
    if (!state.readonly) form.querySelector('#af-settings-description').textContent = state.project.isPublic ? '准备就绪后发布，让访客查看更新并下载安装包。' : '项目当前隐藏；发布后的版本仍不会向访客展示。';
    form.querySelector('#af-notes-count').textContent = `${state.notes.length} 字`;
    form.querySelector('#af-notes-preview-panel').innerHTML = renderNotes(state.notes);
    if (!state.busy && !state.readonly && JSON.stringify(releasePayload(state)) !== state.fingerprint) setStatus('有未保存的更改');
  };
  const validate = (publishing = false) => {
    collect();
    clearErrors(form);
    const errors = [];
    if (!state.project) errors.push(['projectId', '请选择所属项目。']);
    if (!validVersion(state.version)) errors.push(['version', '请输入有效版本号，例如 1.0.0 或 1.0.0-beta.1。']);
    else if (state.channel === 'stable' && state.version.split('+')[0].includes('-')) errors.push(['version', '带 beta 等标识的版本，请选择「预发布」渠道。']);
    if (!state.title) errors.push(['title', '请填写这次版本的发布标题。']);
    if (publishing && !state.notes.trim()) errors.push(['notes', '正式发布前，请填写更新日志。']);
    if (publishing && state.pending.length) errors.push(['assets', '还有文件尚未上传成功，请上传或移除后再发布。']);
    else if (publishing && !state.assets.length) errors.push(['assets', '至少上传一个真实安装包后，才能发布。']);
    const valid = showErrors(form, errors);
    if (!valid) feedback('请先完善表单中标出的内容。');
    return valid;
  };
  const run = async (message, task) => {
    if (state.busy || state.readonly) return;
    state.busy = true;
    feedback('');
    controls();
    syncFiles();
    setStatus(message);
    try { await task(); }
    catch (error) { feedback(errorMessage(error)); setStatus('操作未完成，请检查上方提示后重试'); toast(errorMessage(error)); }
    finally { state.busy = false; controls(); syncFiles(); }
  };
  // 上传前保存服务器草稿；仅在服务器确认后更新本地保存状态。
  const ensureDraft = async () => {
    collect();
    const payload = releasePayload(state);
    if (state.id && JSON.stringify(payload) === state.fingerprint) return;
    const { projectId, ...changes } = payload;
    const result = await api(state.id ? `/api/admin/releases/${encodeURIComponent(state.id)}` : '/api/admin/releases', { method: state.id ? 'PATCH' : 'POST', body: state.id ? changes : payload });
    if (!result.release?.id) throw new Error('服务器未返回版本记录，请刷新后核对草稿。');
    state.id = result.release.id;
    state.status = result.release.status;
    state.saved = true;
    state.updatedAt = result.release.updatedAt;
    state.fingerprint = JSON.stringify(payload);
    if (Array.isArray(result.assets)) state.assets = result.assets;
    if (result.project) { state.project = result.project; state.projects = state.projects.map(item => item.id === result.project.id ? result.project : item); }
    root.querySelector('#af-page-title').textContent = '编辑版本草稿';
    form.querySelector('#af-release-status').textContent = statusLabel(state.status);
    history.replaceState(null, '', url('publish', `id=${encodeURIComponent(state.id)}`));
    controls();
    syncFiles();
    setStatus('草稿已保存');
  };
  const upload = async onlyKey => {
    if (!state.pending.length || !validate()) return;
    await run('正在保存草稿，准备上传…', async () => {
      await ensureDraft();
      const queue = state.pending.filter(item => !onlyKey || item.key === onlyKey);
      let completed = 0;
      for (let index = 0; index < queue.length; index++) {
        const item = queue[index];
        item.status = 'uploading'; item.error = '';
        setStatus(`正在上传 ${index + 1}/${queue.length}：${item.file.name}`);
        form.querySelector('#af-upload-status').textContent = `正在上传 ${index + 1}/${queue.length}，请勿关闭页面。`;
        syncFiles();
        try {
          const body = new FormData(); body.append('file', item.file);
          const result = await api(`/api/admin/releases/${encodeURIComponent(state.id)}/assets?${new URLSearchParams({ platform: item.platform, arch: item.arch })}`, { method: 'POST', body });
          if (!result.asset?.id) throw new Error('服务器未返回文件记录，请刷新后核对上传结果。');
          state.assets.push(result.asset);
          state.pending = state.pending.filter(candidate => candidate !== item);
          completed++;
        } catch (error) {
          item.status = 'failed'; item.error = errorMessage(error);
          if (error.status === 401 || error.status === 403) { feedback(item.error); break; }
        }
        syncFiles();
      }
      const remaining = state.pending.length;
      form.querySelector('#af-upload-status').textContent = remaining ? `本次已上传 ${completed} 个文件，${remaining} 个文件尚未完成。` : `全部上传完成，共 ${state.assets.length} 个安装包。`;
      setStatus(remaining ? '草稿已保存，部分文件需要重试' : '草稿和安装包已保存');
      if (remaining) feedback('部分文件未上传成功，可在对应文件下重试。');
      else toast(`已上传 ${completed} 个安装包。`);
    });
  };
  const addFiles = async files => {
    if (state.busy || state.readonly) { toast('当前操作尚未完成，请稍后添加文件。'); return; }
    const rejected = [];
    let added = 0;
    for (const file of files) {
      if (file.size > MAX_PACKAGE_SIZE) { rejected.push(`${file.name} 超过 2 GB`); continue; }
      if (file.size === 0) { rejected.push(`${file.name} 是空文件`); continue; }
      if (state.assets.some(asset => asset.filename === file.name && asset.size === file.size) || state.pending.some(item => item.file.name === file.name && item.file.size === file.size)) continue;
      const platform = /mac|darwin|\.(dmg|pkg)$/i.test(file.name) ? 'macOS' : /linux|\.(appimage|deb|rpm)$/i.test(file.name) ? 'Linux' : 'Windows';
      state.pending.push({ key: String(++fileSequence), file, platform, arch: /arm|aarch64/i.test(file.name) ? 'arm64' : /(?:x86|ia32)(?:[.-]|$)/i.test(file.name) ? 'x86' : 'x64', status: 'queued', error: '' });
      added++;
    }
    syncFiles();
    if (added) await upload();
    else if (!rejected.length) toast('所选文件已经在列表中。');
    if (rejected.length) { form.querySelector('#af-error-assets').textContent = rejected.join('；'); toast('部分文件无法添加，请查看安装包区域的提示。'); }
  };
  form.addEventListener('input', updateSummary);
  form.addEventListener('change', updateSummary);
  saveButton?.addEventListener('click', async () => {
    if (!validate()) return;
    await run('正在保存草稿…', async () => { await ensureDraft(); setStatus(state.pending.length ? '草稿已保存，仍有文件等待上传' : '草稿已保存'); toast('版本草稿已保存。'); });
  });
  form.querySelector('#af-upload-pending')?.addEventListener('click', () => upload());
  list.addEventListener('click', async event => {
    const retry = event.target.closest('[data-af-retry-file]');
    if (retry) { await upload(retry.dataset.afRetryFile); return; }
    const remove = event.target.closest('[data-af-remove-pending]');
    if (remove && !state.busy) { state.pending = state.pending.filter(item => item.key !== remove.dataset.afRemovePending); syncFiles(); return; }
    const button = event.target.closest('[data-af-delete-asset]');
    if (!button || state.busy || state.readonly) return;
    const asset = state.assets.find(item => item.id === button.dataset.afDeleteAsset);
    if (!asset || !window.confirm(`从草稿中移除「${asset.filename}」？服务器上的文件将被删除。`)) return;
    await run('正在移除安装包…', async () => {
      await api(`/api/admin/assets/${encodeURIComponent(asset.id)}`, { method: 'DELETE' });
      state.assets = state.assets.filter(item => item.id !== asset.id);
      setStatus('安装包已移除'); toast('已从草稿中移除安装包。');
    });
  });
  list.addEventListener('change', async event => {
    const select = event.target;
    if (state.busy || state.readonly) return;
    const pendingKey = select.dataset.afPendingPlatform || select.dataset.afPendingArch;
    if (pendingKey) { const item = state.pending.find(candidate => candidate.key === pendingKey); if (item) item[select.dataset.afPendingPlatform ? 'platform' : 'arch'] = select.value; syncFiles(); return; }
    const id = select.dataset.afAssetPlatform || select.dataset.afAssetArch;
    if (!id) return;
    const asset = state.assets.find(item => item.id === id);
    const body = { platform: asset.platform, arch: asset.arch, [select.dataset.afAssetPlatform ? 'platform' : 'arch']: select.value };
    await run('正在保存安装包信息…', async () => {
      const result = await api(`/api/admin/assets/${encodeURIComponent(id)}`, { method: 'PATCH', body });
      if (!result.asset?.id) throw new Error('服务器未返回更新后的文件信息。');
      state.assets = state.assets.map(item => item.id === id ? result.asset : item);
      setStatus('安装包信息已保存');
    });
  });
  const input = form.querySelector('#af-package-input');
  form.querySelector('#af-select-files')?.addEventListener('click', () => input.click());
  input?.addEventListener('change', () => { const files = [...input.files]; input.value = ''; addFiles(files); });
  const dropzone = form.querySelector('#af-dropzone');
  if (dropzone) {
    let dragDepth = 0;
    dropzone.addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; if (!state.busy) dropzone.classList.add('af-drag-active'); });
    dropzone.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = state.busy ? 'none' : 'copy'; });
    dropzone.addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) dropzone.classList.remove('af-drag-active'); });
    dropzone.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; dropzone.classList.remove('af-drag-active'); addFiles([...event.dataTransfer.files]); });
  }
  const tabs = [...form.querySelectorAll('[data-af-editor-tab]')];
  const showTab = tab => {
    const preview = tab.dataset.afEditorTab === 'preview';
    tabs.forEach(button => { button.classList.toggle('active', button === tab); button.setAttribute('aria-selected', String(button === tab)); button.tabIndex = button === tab ? 0 : -1; });
    form.querySelector('#af-notes-edit-panel').hidden = preview;
    form.querySelector('#af-notes-preview-panel').hidden = !preview;
    const toolbar = form.querySelector('#af-format-actions'); if (toolbar) toolbar.hidden = preview;
    form.querySelector('#af-notes-preview-panel').innerHTML = renderNotes(notes.value);
  };
  tabs.forEach((tab, index) => {
    tab.tabIndex = index ? -1 : 0;
    tab.addEventListener('click', () => showTab(tab));
    tab.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const next = tabs[(index + 1) % tabs.length]; showTab(next); next.focus(); } });
  });
  form.querySelectorAll('[data-af-format]').forEach(button => button.addEventListener('click', () => {
    const [prefix, suffix, placeholder] = { heading: ['## ', '', '标题'], bold: ['**', '**', '重要内容'], list: ['- ', '', '列表内容'], code: ['`', '`', '代码'] }[button.dataset.afFormat];
    const start = notes.selectionStart;
    const selected = notes.value.slice(start, notes.selectionEnd) || placeholder;
    notes.setRangeText(prefix + selected + suffix, start, notes.selectionEnd, 'end'); notes.focus(); notes.setSelectionRange(start + prefix.length, start + prefix.length + selected.length); notes.dispatchEvent(new Event('input', { bubbles: true }));
  }));
  form.querySelector('#af-preview-release').addEventListener('click', () => {
    collect();
    dialog.innerHTML = `<div class="af-dialog-shell"><header class="af-dialog-header"><div><span class="af-eyebrow">RELEASE PREVIEW</span><h2 id="af-dialog-heading">发布效果预览</h2></div><button class="btn btn-light btn-icon" type="button" data-af-close aria-label="关闭预览">${icon('x', 16)}</button></header><div class="af-dialog-body"><div class="af-dialog-identity">${projectMark(state.project)}<div><h3>${esc(state.project.name)} <span class="mono">${state.version ? `v${esc(state.version)}` : '版本号待填写'}</span></h3><span class="tag ${state.channel === 'stable' ? 'tag-green' : 'tag-orange'}">${state.channel === 'stable' ? '稳定版' : '预发布'}</span>${state.latest ? '<span class="af-dialog-latest">最新稳定版</span>' : ''}</div></div><h3 class="af-dialog-title">${esc(state.title || '发布标题待填写')}</h3><div class="af-markdown">${renderNotes(state.notes)}</div><div class="af-dialog-downloads"><h4>下载安装包 <span class="mono">${state.assets.length}</span></h4>${state.assets.length ? state.assets.map(asset => `<div>${icon(systemIcon(asset.platform), 18)}<span><strong>${esc(asset.platform)} <small>${esc(ARCH_LABELS[asset.arch] || asset.arch)}</small></strong><span>${esc(asset.filename)}</span></span><span class="mono">${formatBytes(asset.size)}</span>${icon('download', 16)}</div>`).join('') : '<p class="muted">安装包尚未上传。</p>'}</div></div><footer class="af-dialog-footer"><span>${icon('info', 12)}${state.project.isPublic ? state.status === 'published' ? '此版本已经公开发布。' : '仅预览当前内容，正式发布后访客才能下载。' : '当前项目隐藏，访客无法查看或下载。'}</span><button type="button" class="btn btn-primary" data-af-close>${state.readonly ? '关闭预览' : '返回继续编辑'}</button></footer></div>`;
    dialog.querySelectorAll('[data-af-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
    dialog.showModal();
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (state.readonly || !validate(true)) return;
    await run('正在发布版本…', async () => {
      await ensureDraft();
      setStatus('正在发布版本…');
      const result = await api(`/api/admin/releases/${encodeURIComponent(state.id)}/publish`, { method: 'POST', body: { setLatest: state.latest } });
      if (result.release?.status !== 'published') throw new Error('未能确认发布结果，请刷新版本列表核对。');
      state.allowLeave = true;
      toast('版本已发布。');
      location.assign(url('releases', 'notice=release-published'));
    });
  });
  window.addEventListener('beforeunload', event => {
    if (!state.allowLeave && !state.readonly && (state.busy || state.pending.length || JSON.stringify(releasePayload(state)) !== state.fingerprint)) { event.preventDefault(); event.returnValue = ''; }
  });
  controls(); updateSummary();
  if (state.readonly) showTab(tabs[1]);
}

function bindProject(state) {
  const form = document.querySelector('#af-project-form');
  if (!form) return;
  const root = document.querySelector('#af-project-page');
  const status = form.querySelector('#af-project-save-status');
  const iconStatus = form.querySelector('#af-icon-status');
  const retryIcon = form.querySelector('#af-retry-icon');
  const collect = () => {
    for (const name of ['name', 'slug', 'subtitle', 'description', 'category', 'website']) state[name] = form.elements[name].value;
    state.platforms = [...form.querySelectorAll('[name="platforms"]:checked')].map(node => node.value);
    state.isPublic = form.querySelector('[name="visibility"]:checked').value === 'public';
  };
  const setBusy = value => {
    state.busy = value;
    form.setAttribute('aria-busy', String(value));
    root.classList.toggle('af-busy', value);
    form.querySelectorAll('input,select,textarea,button').forEach(node => { node.disabled = value; });
  };
  const updateMarks = () => {
    form.querySelectorAll('[data-af-project-mark]').forEach(node => { node.innerHTML = state.iconUrl ? `<img src="${esc(state.iconUrl)}" class="af-custom-icon" alt="项目图标预览">` : projectMark(state.project || { slug: state.slug }, node.classList.contains('af-icon-well') ? 'large' : ''); });
  };
  const preview = () => {
    collect();
    form.querySelector('#af-card-name').textContent = state.name.trim() || '项目名称';
    form.querySelector('#af-card-slug').textContent = `/${state.slug.trim() || 'project-slug'}`;
    form.querySelector('#af-card-summary').textContent = state.subtitle.trim() || '一句话介绍你的项目，让使用者快速了解它。';
    form.querySelector('#af-card-category').textContent = state.category;
    form.querySelector('#af-card-platforms').innerHTML = state.platforms.map(platform => `<span title="${platform}" aria-label="${platform}">${icon(systemIcon(platform), 14)}</span>`).join('');
    form.querySelector('#af-summary-count').textContent = `${state.subtitle.length}/160`;
    form.querySelector('#af-visibility-note').textContent = state.isPublic ? '保存后，项目会在公开列表中展示。' : '保存后，项目及版本不会向访客展示。';
    form.querySelector('.af-project-preview').classList.toggle('af-preview-hidden', !state.isPublic);
    if (!state.busy && JSON.stringify(projectPayload(state)) !== state.fingerprint) status.textContent = '有未保存的更改';
  };
  const acceptProject = project => {
    state.project = project; state.id = project.id;
    for (const name of ['name', 'slug', 'subtitle', 'description', 'category', 'website']) { state[name] = str(project[name]); form.elements[name].value = state[name]; }
    state.platforms = project.platforms || []; state.isPublic = !!project.isPublic;
    form.querySelectorAll('[name="platforms"]').forEach(node => { node.checked = state.platforms.includes(node.value); });
    form.querySelectorAll('[name="visibility"]').forEach(node => { node.checked = (node.value === 'public') === state.isPublic; });
    state.fingerprint = JSON.stringify(projectPayload(state));
    root.querySelector('#af-page-title').textContent = '项目配置';
    form.querySelector('#af-save-project').innerHTML = `${icon('check', 15)}保存项目配置`;
    const viewLink = root.querySelector('#af-view-project');
    viewLink.href = url('project', `id=${encodeURIComponent(project.slug)}`); viewLink.hidden = !project.isPublic;
    history.replaceState(null, '', url('project-edit', `id=${encodeURIComponent(project.id)}`));
    preview(); updateMarks();
  };
  const uploadIcon = async () => {
    if (!state.iconFile || !state.id) return;
    iconStatus.textContent = '正在上传项目图标…'; retryIcon.hidden = true;
    const body = new FormData(); body.append('file', state.iconFile);
    const result = await api(`/api/admin/projects/${encodeURIComponent(state.id)}/icon`, { method: 'POST', body });
    if (!result.project?.id) throw new Error('服务器未返回上传后的图标信息。');
    state.iconFile = null;
    if (state.iconUrl) URL.revokeObjectURL(state.iconUrl);
    state.iconUrl = '';
    state.project = result.project;
    updateMarks(); iconStatus.textContent = '项目图标已上传';
  };
  const validate = () => {
    collect(); clearErrors(form);
    const errors = [];
    if (!state.name.trim()) errors.push(['name', '请填写项目名称。']);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(state.slug.trim())) errors.push(['slug', '使用小写字母、数字或连接它们的短横线。']);
    else if (state.projects.some(project => project.slug === state.slug.trim() && project.id !== state.id)) errors.push(['slug', '这个项目标识已被使用，请换一个。']);
    if (!state.subtitle.trim()) errors.push(['subtitle', '请用一句话介绍这个项目。']);
    if (!state.platforms.length) errors.push(['platforms', '请至少选择一个支持平台。']);
    if (state.website.trim()) { try { if (!['http:', 'https:'].includes(new URL(state.website.trim()).protocol)) throw new Error(); } catch { errors.push(['website', '请输入以 https:// 或 http:// 开头的网址。']); } }
    const valid = showErrors(form, errors); if (!valid) feedback('请完善标出的项目资料后再保存。'); return valid;
  };
  form.addEventListener('input', preview);
  form.addEventListener('change', preview);
  const imageInput = form.querySelector('#af-project-icon');
  form.querySelector('#af-select-icon').addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', async () => {
    const file = imageInput.files[0]; imageInput.value = '';
    if (!file || state.busy) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > MAX_ICON_SIZE || !file.size) { toast('请选择不超过 2 MB 的 PNG、JPG 或 WebP 图片。'); return; }
    const nextUrl = URL.createObjectURL(file); setBusy(true);
    try {
      const image = new Image(); image.src = nextUrl; await image.decode();
      if (state.iconUrl) URL.revokeObjectURL(state.iconUrl);
      state.iconUrl = nextUrl; state.iconFile = file;
      updateMarks(); iconStatus.textContent = '图片已选择，保存项目时上传。'; retryIcon.hidden = true; status.textContent = '有待上传的项目图标';
    } catch { URL.revokeObjectURL(nextUrl); toast('这张图片无法读取，请选择另一张图片。'); }
    finally { setBusy(false); }
  });
  retryIcon.addEventListener('click', async () => {
    if (state.busy || !state.iconFile || !state.id) return;
    setBusy(true); feedback('');
    try { await uploadIcon(); status.textContent = '项目图标已保存'; toast('项目图标已上传。'); }
    catch (error) { iconStatus.textContent = errorMessage(error); retryIcon.hidden = false; feedback(`图标上传失败：${errorMessage(error)}`); }
    finally { setBusy(false); }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (state.busy || !validate()) return;
    const creating = !state.id;
    const payload = projectPayload(state);
    setBusy(true); feedback(''); status.textContent = creating ? '正在创建项目…' : '正在保存项目配置…';
    let saved = false;
    try {
      const result = await api(state.id ? `/api/admin/projects/${encodeURIComponent(state.id)}` : '/api/admin/projects', { method: state.id ? 'PATCH' : 'POST', body: payload });
      if (!result.project?.id) throw new Error('服务器未返回项目记录，请刷新列表核对保存结果。');
      acceptProject(result.project); saved = true;
      await uploadIcon();
      status.textContent = '项目配置已保存'; toast(creating ? '项目已创建，可以开始发布版本。' : '项目配置已保存。');
    } catch (error) {
      if (saved && state.iconFile) { status.textContent = '项目资料已保存，图标上传失败'; iconStatus.textContent = errorMessage(error); retryIcon.hidden = false; feedback(`项目资料已保存，但图标上传失败：${errorMessage(error)}。可点击「重试图标上传」。`); }
      else { status.textContent = '保存未完成，请检查上方提示'; feedback(errorMessage(error)); }
      toast(saved ? '项目资料已保存，图标需要重试。' : errorMessage(error));
    } finally { setBusy(false); }
  });
  window.addEventListener('beforeunload', event => {
    if (!state.allowLeave && (state.busy || state.iconFile || JSON.stringify(projectPayload(state)) !== state.fingerprint)) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('pagehide', () => { if (state.iconUrl) URL.revokeObjectURL(state.iconUrl); }, { once: true });
  preview();
}

export function renderAdminForm(page, params, data = {}) {
  if (page === 'publish') {
    releaseState = makeRelease(params, data);
    if (!releaseState.project) return data.release || params.get('id') ? emptyPage('版本详情', '无法加载版本所属项目。', 'releases', '', '返回版本列表') : emptyPage('发布新版本', '先创建一个项目，再发布软件版本。');
    if (params.get('id') && !data.release) return emptyPage('版本详情', '该版本不存在或已被删除。', 'releases', '', '返回版本列表');
    return renderPublish(releaseState);
  }
  if (page === 'project-edit') {
    if (params.get('id') && !data.project && params.get('new') !== '1') return emptyPage('项目配置', '该项目不存在或无法加载。', 'projects', '', '返回项目列表');
    projectState = makeProject(params, data);
    return renderProject(projectState);
  }
  return '';
}

export async function bindAdminForm(page, params, data = {}) {
  if (page === 'publish' && releaseState?.project) bindRelease(releaseState);
  else if (page === 'project-edit' && projectState) bindProject(projectState);
}
