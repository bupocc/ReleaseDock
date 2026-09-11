import { api } from './api.js';

export function beginEnrollment() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (!fragment.has('enroll')) return null;
  let token = fragment.get('enroll') || '';
  // 一次性令牌只在内存中兑换，不能交给路由保存到历史、锚点或回跳参数中。
  history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  if (!/^[A-Za-z0-9_-]{32,512}$/.test(token)) {
    token = '';
    return Promise.resolve({ error: '注册链接无效，请在服务器重新生成一次性注册链接。' });
  }
  const request = api('/api/auth/enroll', { method: 'POST', body: { token } });
  token = '';
  return request.then(() => ({ ok: true }), error => ({ error: error.message || '无法验证注册链接，请重新打开原链接后重试。' }));
}
