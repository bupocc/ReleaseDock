export const adminPages = new Set(['overview', 'projects', 'releases', 'publish', 'project-edit', 'files', 'settings']);
export const publicPages = new Set(['home', 'catalog', 'project', 'login', 'activity']);
const stateKey = 'releaseDockRoute';
let activeRoute;

function parameters(extra = '') {
  const result = new URLSearchParams(typeof extra === 'string' ? extra.replace(/^&/, '') : extra);
  result.delete('page');
  return result;
}

export function url(name, extra = '') {
  const params = parameters(extra);
  if (name === 'project' && params.get('slug') && params.get('version')) {
    // 精确保留版本号；1.5.1 和 v1.5.1 可以是两个不同的版本。
    return `/${encodeURIComponent(params.get('slug'))}/${encodeURIComponent(params.get('version'))}`;
  }
  // 使用真实链接支持新标签和浏览器的离开页面提示，新文档启动时统一收起参数。
  const query = new URLSearchParams({ page: name });
  params.forEach((value, key) => query.set(key, value));
  return `/?${query}`;
}

function routeFromAddress(address) {
  if (address.origin !== location.origin) return null;
  if (address.pathname === '/' && address.searchParams.has('page')) {
    return { page: address.searchParams.get('page') || 'home', params: parameters(address.searchParams) };
  }
  const segments = address.pathname.split('/').filter(Boolean);
  if (segments.length === 2 && !['api', 'assets'].includes(segments[0])) {
    try {
      return { page: 'project', params: new URLSearchParams({ slug: decodeURIComponent(segments[0]), version: decodeURIComponent(segments[1]) }) };
    } catch { return null; }
  }
  return null;
}

function storedRoute() {
  const value = history.state?.[stateKey];
  if (!value || typeof value.page !== 'string' || !value.params || typeof value.params !== 'object' || Array.isArray(value.params)) return null;
  return { page: value.page, params: parameters(value.params) };
}

export function replaceRoute(name, extra = '') {
  const params = parameters(extra);
  activeRoute = { page: name, params };
  const address = name === 'project' && params.get('slug') && params.get('version') ? url(name, params) : '/';
  const previous = history.state && typeof history.state === 'object' ? history.state : {};
  history.replaceState({ ...previous, [stateKey]: { page: name, params: Object.fromEntries(params) } }, '', address);
  return activeRoute;
}

export function currentRoute() {
  return activeRoute;
}

export function initializeRoute() {
  const address = new URL(location.href);
  const previous = storedRoute();
  const route = routeFromAddress(address) || (address.pathname === '/' ? previous : null) || { page: 'home', params: new URLSearchParams() };
  if (route.page === 'project' && previous?.page === 'project' && previous.params.get('slug') === route.params.get('slug') && previous.params.get('version') === route.params.get('version') && previous.params.has('anchor')) {
    route.params.set('anchor', previous.params.get('anchor'));
  }
  if (address.hash) route.params.set('anchor', address.hash.slice(1));
  return replaceRoute(route.page, route.params);
}

export function safeNext(value) {
  if (value) {
    try {
      const route = routeFromAddress(new URL(value, location.origin));
      if (route && adminPages.has(route.page)) return url(route.page, route.params);
    } catch { /* 无效回跳地址使用管理概览。 */ }
  }
  return url('overview');
}

export function scrollToAnchor() {
  const id = activeRoute?.params.get('anchor');
  if (!id) return;
  let target;
  try { target = document.getElementById(decodeURIComponent(id)); } catch { return; }
  if (!target) return;
  target.scrollIntoView({ block: 'start' });
  if (id === 'main-content') {
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }
}

// 页内锚点用于滚动，不再向简洁地址追加 #downloads 等片段。
document.addEventListener('click', event => {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest?.('a[href^="#"]');
  if (!link || link.target || link.hasAttribute('download')) return;
  const id = link.getAttribute('href').slice(1);
  if (!id || !activeRoute) return;
  event.preventDefault();
  const params = new URLSearchParams(activeRoute.params);
  params.set('anchor', id);
  replaceRoute(activeRoute.page, params);
  scrollToAnchor();
});
