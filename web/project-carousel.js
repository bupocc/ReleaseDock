import { Marked } from './vendor/marked.js';
import DOMPurify from './vendor/purify.js';
import { escapeHtml as e, formatDate, formatNumber, versionLabel } from './api.js';
import { icon, projectMark } from './icons.js';
import { platformIcons, url } from './app.js';
import { platformLabel } from './platforms.js';

const AUTO_ADVANCE_MS = 6000;
const summaryMarkdown = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    image: ({ text }) => e(text),
    // 轮播只呈现阅读摘要，完整代码留在版本详情中。
    code: () => '',
  },
});

export function plainSummary(value, limit = 220) {
  if (!String(value || '').trim()) return '';
  const fragment = DOMPurify.sanitize(summaryMarkdown.parse(String(value)), {
    ALLOWED_TAGS: ['a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'],
    ALLOWED_ATTR: [],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  // 分段内容转换成纯文本时保留间隔，避免标题、列表和表格粘连。
  fragment.querySelectorAll('p, br, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr, td, th').forEach((node) => node.after(document.createTextNode(' ')));
  const text = fragment.textContent.replace(/<\/?[a-z][^>]*>/gi, ' ').replace(/\s+/g, ' ').trim();
  const characters = Array.from(text);
  return characters.length > limit ? `${characters.slice(0, limit).join('').trimEnd()}…` : text;
}

function recentProjects(projects) {
  const unique = new Map();
  for (const project of projects || []) {
    const key = project?.id || project?.slug;
    if (key && !unique.has(key)) unique.set(key, project);
  }
  const updated = (project) => Date.parse(project.latestRelease?.publishedAt || project.updatedAt) || 0;
  return [...unique.values()].sort((a, b) => updated(b) - updated(a) || String(a.name).localeCompare(String(b.name), 'zh-CN'));
}

function slide(project, index, total) {
  const release = project.latestRelease;
  const version = release ? versionLabel(release.version) : '';
  const description = plainSummary(project.description || project.subtitle, 180) || '项目介绍即将完善。';
  const title = release ? plainSummary(release.title, 100) || `${version} 已发布` : '首个版本，正在路上';
  const summary = release ? plainSummary(release.notes) || '此版本暂未填写更新说明，可前往项目页查看详情。' : '公开版本发布后，你可以在这里阅读更新说明，获取适合自己设备的安装包。';
  const platforms = Array.isArray(project.platforms) ? project.platforms : [];
  const destination = url('project', release ? { slug: project.slug, version: release.version } : { slug: project.slug });
  return `<article class="carousel-slide${index === 0 ? ' is-active' : ''}" data-carousel-slide="${e(project.id || project.slug)}" data-carousel-slide-index="${index}" role="group" aria-roledescription="幻灯片" aria-label="${index + 1} / ${total}：${e(project.name)}" ${index === 0 ? '' : 'aria-hidden="true" inert'}>
    <div class="carousel-project">
      <div class="carousel-project-meta">${project.category ? `<span class="tag tag-outline">${e(project.category)}</span>` : '<span class="carousel-project-kind">软件项目</span>'}<span>${release ? '最新发布' : '期待新版本'}</span></div>
      <div class="carousel-project-heading">${projectMark(project, 'large')}<div><h2>${e(project.name)}</h2>${version ? `<span class="carousel-version mono">${e(version)}</span>` : '<span class="carousel-version">尚未发布</span>'}</div></div>
      <p class="carousel-description">${e(description)}</p>
      ${platforms.length ? `<div class="carousel-platforms"><div class="platform-icons">${platformIcons(platforms, 15)}</div><span>${e(platforms.map(platformLabel).join(' / '))}</span></div>` : ''}
      <div class="carousel-project-actions"><a class="btn btn-primary" href="${destination}" data-carousel-open>${release ? '查看更新与下载' : '查看项目'} ${icon('arrow', 16)}</a><span>${formatNumber(project.publishedCount ?? project.releaseCount)} 个公开版本</span></div>
    </div>
    <div class="carousel-release">
      <div class="carousel-release-heading"><span>${icon('layers', 15)}${release ? '本次更新' : '项目进展'}</span>${release ? `<span class="tag ${release.channel === 'prerelease' ? 'tag-orange' : 'tag-green'}">${release.channel === 'prerelease' ? '预发布版' : '稳定版'}</span>` : ''}</div>
      <h3>${e(title)}</h3><p data-carousel-summary>${e(summary)}</p>
      <div class="carousel-release-footer">${icon('clock', 13)}<span>${release ? '发布于' : '项目更新于'}</span><time class="mono">${formatDate(release?.publishedAt || project.updatedAt)}</time></div>
    </div>
  </article>`;
}

export function renderProjectCarousel(projects) {
  const items = recentProjects(projects);
  const total = items.length;
  return `<section class="project-carousel" data-project-carousel data-carousel-count="${total}" data-carousel-index="0" data-carousel-autoplay="paused" role="region" aria-roledescription="轮播" aria-labelledby="recent-projects-title">
    <div class="carousel-heading"><h1 id="recent-projects-title"><span class="status-dot"></span>最近更新</h1><a class="link-button" href="#projects">全部项目 ${icon('arrow', 14)}</a></div>
    ${total ? `<div class="carousel-viewport" data-carousel-viewport ${total > 1 ? 'tabindex="0" aria-label="最近更新的项目，按左右方向键切换"' : ''}><div class="carousel-track" data-carousel-track>${items.map((project, index) => slide(project, index, total)).join('')}</div></div>` : `<div class="carousel-empty" data-carousel-empty><span class="state-icon">${icon('layers', 29)}</span><div><h2>下一次更新，值得期待。</h2><p>项目公开后，这里会展示它的最新进展。</p></div></div>`}
    ${total > 1 ? `<div class="carousel-footer"><div class="carousel-dots" role="group" aria-label="选择项目">${items.map((project, index) => `<button type="button" class="carousel-dot${index === 0 ? ' is-active' : ''}" data-carousel-dot="${index}" aria-label="显示${e(project.name)}，第 ${index + 1} 个项目" ${index === 0 ? 'aria-current="true"' : ''}><span></span></button>`).join('')}</div><span class="carousel-count mono"><strong data-carousel-current>01</strong><span>/ ${String(total).padStart(2, '0')}</span></span><div class="carousel-controls"><button type="button" class="carousel-toggle" data-carousel-toggle aria-label="暂停自动轮播" aria-pressed="false"><span class="carousel-toggle-symbol" aria-hidden="true"></span><span data-carousel-toggle-label>暂停</span></button><button type="button" class="carousel-arrow" data-carousel-prev aria-label="上一个项目">${icon('back', 17)}</button><button type="button" class="carousel-arrow" data-carousel-next aria-label="下一个项目">${icon('back', 17, 'class="rotate-arrow"')}</button></div></div>` : ''}
    <p class="sr-only" data-carousel-status aria-live="polite" aria-atomic="true"></p>
  </section>`;
}

export function bindProjectCarousel(root = document.querySelector('[data-project-carousel]')) {
  if (!root || root.dataset.carouselBound === 'true') return;
  root.dataset.carouselBound = 'true';
  const slides = [...root.querySelectorAll('[data-carousel-slide]')];
  if (slides.length < 2) {
    root.dataset.carouselPauseReason = slides.length ? 'single' : 'empty';
    return;
  }
  const viewport = root.querySelector('[data-carousel-viewport]');
  const track = root.querySelector('[data-carousel-track]');
  const dots = [...root.querySelectorAll('[data-carousel-dot]')];
  const toggle = root.querySelector('[data-carousel-toggle]');
  const current = root.querySelector('[data-carousel-current]');
  const status = root.querySelector('[data-carousel-status]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0;
  let timer;
  let manuallyPaused = false;
  let hovered = window.matchMedia('(hover: hover)').matches && root.matches(':hover');

  const stop = () => window.clearTimeout(timer);
  const schedule = () => {
    stop();
    const reason = !root.isConnected ? 'detached' : reducedMotion.matches ? 'reduced-motion' : document.hidden ? 'hidden' : manuallyPaused ? 'manual' : hovered ? 'hover' : root.contains(document.activeElement) ? 'focus' : '';
    root.dataset.carouselAutoplay = reason ? 'paused' : 'running';
    root.dataset.carouselPauseReason = reason;
    toggle.hidden = reducedMotion.matches;
    toggle.classList.toggle('is-paused', manuallyPaused);
    toggle.setAttribute('aria-pressed', String(manuallyPaused));
    toggle.setAttribute('aria-label', manuallyPaused ? '继续自动轮播' : '暂停自动轮播');
    toggle.querySelector('[data-carousel-toggle-label]').textContent = manuallyPaused ? '继续' : '暂停';
    if (!reason) timer = window.setTimeout(() => goTo(index + 1, false), AUTO_ADVANCE_MS);
  };

  const goTo = (next, announce = true) => {
    const previous = index;
    index = (next + slides.length) % slides.length;
    if (index !== previous && slides[previous].contains(document.activeElement)) viewport.focus({ preventScroll: true });
    track.style.transform = `translateX(-${index * 100}%)`;
    root.dataset.carouselIndex = String(index);
    slides.forEach((item, position) => {
      const active = position === index;
      item.classList.toggle('is-active', active);
      item.inert = !active;
      item.setAttribute('aria-hidden', String(!active));
    });
    dots.forEach((dot, position) => {
      const active = position === index;
      dot.classList.toggle('is-active', active);
      if (active) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
    current.textContent = String(index + 1).padStart(2, '0');
    if (announce) status.textContent = `第 ${index + 1} 个项目，共 ${slides.length} 个：${slides[index].querySelector('h2').textContent}`;
    schedule();
  };

  root.querySelector('[data-carousel-prev]').addEventListener('click', () => goTo(index - 1));
  root.querySelector('[data-carousel-next]').addEventListener('click', () => goTo(index + 1));
  dots.forEach((dot, position) => dot.addEventListener('click', () => goTo(position)));
  toggle.addEventListener('click', () => { manuallyPaused = !manuallyPaused; schedule(); });
  root.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const destination = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: slides.length - 1 }[event.key];
    if (destination === undefined) return;
    event.preventDefault();
    goTo(destination);
  });
  root.addEventListener('pointerenter', (event) => { if (event.pointerType !== 'touch') { hovered = true; schedule(); } });
  root.addEventListener('pointerleave', (event) => { if (event.pointerType !== 'touch') { hovered = false; schedule(); } });
  root.addEventListener('focusin', schedule);
  root.addEventListener('focusout', () => queueMicrotask(schedule));
  document.addEventListener('visibilitychange', schedule);
  reducedMotion.addEventListener('change', schedule);
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', schedule);
  schedule();
}
