import { Marked } from './vendor/marked.js';
import DOMPurify from './vendor/purify.js';

let csrfToken = '';
let sessionRequest;

const markdown = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    // 更新日志中的原始 HTML 按文字显示；图片说明保留为文字，避免加载外部资源。
    html: ({ text }) => escapeHtml(text),
    image: ({ text }) => escapeHtml(text),
  },
});

export class ApiError extends Error {
  constructor(message, status = 0, code = 'REQUEST_FAILED') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// 通行密钥由浏览器完成验证；后续会话由服务器的 HttpOnly Cookie 管理。
export async function api(path, options = {}) {
  if (typeof path !== 'string' || !path.startsWith('/api/')) {
    throw new ApiError('请求地址无效。');
  }
  const method = (options.method || 'GET').toUpperCase();
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (unsafe && !path.startsWith('/api/auth/') && !csrfToken) {
    if (!sessionRequest) sessionRequest = api('/api/session').finally(() => { sessionRequest = null; });
    const session = await sessionRequest;
    if (!session.authenticated) throw new ApiError('登录已失效，请重新使用通行密钥登录。', 401, 'UNAUTHORIZED');
  }
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  if (unsafe && csrfToken) headers.set('X-CSRF-Token', csrfToken);
  let body = options.body;
  if (body !== undefined && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(abort, options.timeoutMs ?? (body instanceof FormData ? 900000 : 30000));
  try {
    const response = await fetch(path, { method, body, headers, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    const result = response.status === 204 ? {} : await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) {
        csrfToken = '';
        if (path.startsWith('/api/admin/')) window.dispatchEvent(new CustomEvent('session-expired'));
      }
      throw new ApiError(result?.error?.message || (response.status === 413 ? '文件超过服务器允许的大小，请选择较小的文件。' : '请求失败，请稍后重试。'), response.status, result?.error?.code);
    }
    if (result === null) throw new ApiError('服务器返回了无法识别的内容，请稍后重试。', response.status, 'INVALID_RESPONSE');
    if (typeof result.csrfToken === 'string') csrfToken = result.csrfToken;
    if ((path === '/api/session' && !result.authenticated) || path === '/api/logout') csrfToken = '';
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'AbortError') throw new ApiError('请求超时或已取消，请检查网络后重试。', 0, 'TIMEOUT');
    throw new ApiError('无法连接服务器，请检查网络后重试。', 0, 'NETWORK_ERROR');
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function formatBytes(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), 4);
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: index ? 2 : 0 }).format(size / (1024 ** index))} ${['B', 'KB', 'MB', 'GB', 'TB'][index]}`;
}

export function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
}

export function formatDate(value, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const result = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) }).format(date);
  return result.replaceAll('/', '.');
}

export function versionLabel(value) {
  const version = String(value ?? '');
  return /^v/i.test(version) ? version : `v${version}`;
}

export function safeWebsite(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : '';
  } catch { return ''; }
}

// 后台预览和公开详情共享解析器；解析 Markdown 后再限制 HTML 标签和链接协议。
export function renderNotes(value) {
  if (!String(value || '').trim()) return '<p class="muted">此版本暂未填写更新说明。</p>';
  const fragment = DOMPurify.sanitize(markdown.parse(String(value)), {
    ALLOWED_TAGS: ['a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'],
    ALLOWED_ATTR: ['href', 'title', 'start', 'align'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  for (const link of fragment.querySelectorAll('a[href]')) {
    try {
      const destination = new URL(link.getAttribute('href'), window.location.href);
      if (!['http:', 'https:', 'mailto:'].includes(destination.protocol)) {
        link.removeAttribute('href');
      } else if (destination.origin !== window.location.origin) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
      }
    } catch { link.removeAttribute('href'); }
  }
  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}

export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(String(text)); return; } catch { /* 继续使用选择复制方式。 */ }
  }
  const input = document.createElement('textarea');
  input.value = String(text);
  input.className = 'clipboard-fallback';
  input.setAttribute('aria-hidden', 'true');
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('无法自动复制');
}
