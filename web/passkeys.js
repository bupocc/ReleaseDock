import { api, ApiError, escapeHtml as e, formatDate } from './api.js';
import { icon } from './icons.js';
import { url, safeNext } from './router.js';

let browserModule;

function supportIssue() {
  if (!window.isSecureContext) return '通行密钥需要 HTTPS 安全连接，本机开发请使用 localhost 地址。';
  if (!window.PublicKeyCredential || !navigator.credentials) return '当前浏览器不支持通行密钥，请使用最新版 Chrome、Edge、Safari 或 Firefox。';
  return '';
}

async function webAuthn() {
  const issue = supportIssue();
  if (issue) throw new ApiError(issue);
  if (!browserModule) browserModule = import('./vendor/webauthn.js').catch(error => { browserModule = null; throw error; });
  const module = await browserModule;
  if (!module.browserSupportsWebAuthn()) throw new ApiError('当前浏览器无法使用通行密钥，请更新浏览器后重试。');
  return module;
}

function authError(error) {
  if (error instanceof ApiError) return error.message;
  const name = error?.cause?.name || error?.name;
  const code = error?.code || '';
  if (name === 'NotAllowedError' || name === 'AbortError' || code === 'ERROR_CEREMONY_ABORTED') return '验证已取消或超时。请解锁 Bitwarden 扩展，然后重试。';
  if (name === 'InvalidStateError' || code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return '此通行密钥已绑定，请使用它登录，或选择其他设备创建备用通行密钥。';
  if (name === 'SecurityError') return '当前地址无法使用此通行密钥，请通过站点配置的登录地址打开页面。';
  if (name === 'ConstraintError' || code === 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION') return '所选设备无法完成用户验证，请选择已解锁的 Bitwarden 或其他支持验证的设备。';
  if (name === 'NotSupportedError' || code === 'ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT') return '所选设备不支持此通行密钥，请更新 Bitwarden 扩展或选择其他设备。';
  return '暂时无法完成通行密钥验证，请确认浏览器和 Bitwarden 扩展已更新并解锁后重试。';
}

async function authenticate(reauthenticate = false) {
  const { startAuthentication } = await webAuthn();
  const { options } = await api('/api/auth/login/options', { method: 'POST', body: reauthenticate ? { reauthenticate: true } : {} });
  const response = await startAuthentication({ optionsJSON: options });
  return api('/api/auth/login/verify', { method: 'POST', body: { response } });
}

function enrollmentFor(auth) {
  return auth?.enrollment && Number(auth.enrollment.expiresAt) > Date.now() ? auth.enrollment : null;
}

function loginDestination(auth) {
  try {
    const destination = new URL(auth.loginUrl, location.origin);
    const expected = new URL(auth.origin);
    if (destination.origin !== expected.origin || destination.username || destination.password) return '';
    if (destination.protocol !== 'https:' && !(destination.protocol === 'http:' && destination.hostname === 'localhost')) return '';
    return destination.href;
  } catch { return ''; }
}

export function renderPasskeyLogin(params, data) {
  const auth = data.auth || {};
  const enrollment = enrollmentFor(auth);
  const setup = !!enrollment;
  const recovery = enrollment?.mode === 'recovery';
  const issue = supportIssue();
  const destination = loginDestination(auth);
  const enabled = auth.ready && !issue && (auth.initialized || setup);
  const message = data.enrollmentError || (params.get('expired') === '1' ? '登录已失效，验证后将返回刚才的管理页面。' : '');
  return `<div class="login-key">${icon('key', 26)}</div>
    <div class="login-title"><h2>${setup ? (recovery ? '恢复管理员登录' : '设置通行密钥') : '欢迎回来'}</h2><p class="passkey-login-description">${setup ? '创建管理员通行密钥，保存到你的 Bitwarden 密码库。' : '使用通行密钥，进入发布工作台。'}</p></div>
    <form id="login-form" class="passkey-login-form">
      ${setup ? `<label class="passkey-name-field" for="passkey-label"><span class="form-label">通行密钥名称</span><input id="passkey-label" name="label" maxlength="80" value="Bitwarden" required autocomplete="off" placeholder="例如：Bitwarden · 常用设备" aria-describedby="login-error"></label><p class="passkey-enrollment-note">${recovery ? '创建成功后将替换原有通行密钥，并结束其他登录。' : '这个链接仅用于本次管理员绑定。'}<br>有效期至 ${e(formatDate(enrollment.expiresAt, true))}。</p>` : ''}
      <p class="passkey-provider-hint">${icon('shield', 16)}<span>请先解锁已登录自托管密码库的 Bitwarden 浏览器扩展。</span></p>
      ${!auth.initialized && !setup ? `<div class="passkey-notice" id="passkey-setup-required">此站点尚未绑定管理员通行密钥。请在服务器生成一次性注册链接，再打开链接完成绑定。</div>` : ''}
      ${!auth.ready ? `<div class="passkey-notice" id="passkey-origin-notice"><p>请通过站点配置的登录地址使用通行密钥。</p>${destination ? `<a class="link-button" id="passkey-login-url" href="${e(destination)}">前往登录地址 ${icon('arrow', 13)}</a>` : '<p>请在服务器配置 HTTPS 站点地址后重试。</p>'}</div>` : ''}
      ${issue ? `<p class="passkey-notice" id="passkey-support-notice">${e(issue)}</p>` : ''}
      <button type="submit" class="btn btn-primary btn-wide login-submit" id="${setup ? 'passkey-register' : 'passkey-login'}" ${enabled ? '' : 'disabled'}>${icon('key', 17)}${setup ? (recovery ? '创建并恢复登录' : '创建管理员通行密钥') : '使用通行密钥登录'}</button>
      <p class="login-error" id="login-error" role="alert">${e(message)}</p>
    </form><button type="button" class="link-button passkey-refresh" id="passkey-status-refresh">重新检查登录状态 ${icon('refresh', 13)}</button>`;
}

export function bindPasskeyLogin(params, data) {
  const form = document.querySelector('#login-form');
  const submit = form.querySelector('[type="submit"]');
  const refresh = document.querySelector('#passkey-status-refresh');
  const errorNode = document.querySelector('#login-error');
  let pending = false;
  refresh.addEventListener('click', async () => {
    if (pending) return;
    pending = true;
    refresh.disabled = true;
    const label = document.querySelector('#passkey-label')?.value;
    try {
      data.auth = await api('/api/auth/status');
      data.enrollmentError = '';
      document.querySelector('.login-form-content').innerHTML = renderPasskeyLogin(params, data);
      if (label && document.querySelector('#passkey-label')) document.querySelector('#passkey-label').value = label;
      bindPasskeyLogin(params, data);
    } catch (error) {
      errorNode.textContent = authError(error);
      refresh.disabled = false;
      pending = false;
    }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || submit.disabled) return;
    const enrollment = enrollmentFor(data.auth);
    const input = document.querySelector('#passkey-label');
    if (input && !enrollment) { errorNode.textContent = '注册链接已过期，请在服务器重新生成后再绑定。'; return; }
    const label = input?.value.trim();
    if (input && !label) { errorNode.textContent = '请填写通行密钥名称。'; input.focus(); return; }
    pending = true;
    const original = submit.innerHTML;
    submit.disabled = true;
    refresh.disabled = true;
    if (input) input.disabled = true;
    form.setAttribute('aria-busy', 'true');
    submit.textContent = enrollment ? '请在浏览器中创建通行密钥…' : '请在浏览器中完成验证…';
    errorNode.textContent = '';
    try {
      if (enrollment) {
        const { startRegistration } = await webAuthn();
        const { options } = await api('/api/auth/register/options', { method: 'POST', body: { label } });
        const response = await startRegistration({ optionsJSON: options });
        await api('/api/auth/register/verify', { method: 'POST', body: { response } });
      } else await authenticate();
      location.assign(safeNext(params.get('next')));
    } catch (error) { errorNode.textContent = authError(error); }
    finally {
      pending = false;
      submit.disabled = false;
      refresh.disabled = false;
      if (input) input.disabled = false;
      form.removeAttribute('aria-busy');
      submit.innerHTML = original;
    }
  });
}

export function renderPasskeySettings() {
  return `<section class="panel passkey-settings" id="passkey-settings" aria-labelledby="passkeys-heading"><div class="panel-heading"><div><h2 id="passkeys-heading">管理员通行密钥</h2><p>管理用于登录此发布中心的设备与密码库。</p></div><button type="button" class="btn btn-light" id="passkey-add" disabled>${icon('plus', 15)}添加通行密钥</button></div><div class="passkey-settings-body"><p class="passkey-backup-tip">${icon('shield', 17)}<span>建议保存一把独立的备用通行密钥，例如另一台设备或安全密钥。</span></p><p class="passkey-verification-note" id="passkey-verification-note" hidden>更改通行密钥前，需要先验证你当前的通行密钥。</p><p class="muted passkey-loading" id="passkey-loading" role="status">正在读取通行密钥…</p><ul class="passkey-list" id="passkey-list" aria-label="已绑定的通行密钥"></ul><p class="inline-error" id="passkeys-error" role="alert"></p><p class="inline-success" id="passkeys-success" role="status"></p><button type="button" class="link-button" id="passkeys-reload" hidden>重新加载</button></div></section>
    <dialog class="confirm-dialog passkey-dialog" id="passkey-dialog" aria-labelledby="passkey-dialog-title" aria-describedby="passkey-dialog-description"><span class="state-icon">${icon('key', 25)}</span><h2 id="passkey-dialog-title">添加通行密钥</h2><p id="passkey-dialog-description"></p><form id="passkey-management-form"><label class="passkey-name-field" id="passkey-dialog-label-field" for="passkey-management-label"><span class="form-label">通行密钥名称</span><input id="passkey-management-label" name="label" maxlength="80" required autocomplete="off"></label><p class="inline-error" id="passkey-dialog-error" role="alert"></p><p class="passkey-progress" id="passkey-progress" role="status"></p><div class="dialog-actions"><button type="button" class="btn btn-light" id="passkey-dialog-cancel">取消</button><button type="submit" class="btn btn-primary" id="passkey-dialog-submit">创建通行密钥</button></div></form></dialog>`;
}

function passkeyRows(passkeys) {
  return passkeys.map(passkey => `<li class="passkey-row" data-passkey-id="${e(passkey.id)}"><span class="passkey-row-icon">${icon('key', 19)}</span><div class="passkey-row-content"><div class="passkey-row-title"><strong>${e(passkey.label)}</strong>${passkey.current ? '<span class="tag tag-green">当前登录</span>' : ''}${passkey.backedUp ? '<span class="tag tag-outline">已备份</span>' : ''}</div><p>创建于 ${e(formatDate(passkey.createdAt))}<span> · </span>${passkey.lastUsedAt ? `上次使用 ${e(formatDate(passkey.lastUsedAt, true))}` : '尚未使用'}</p></div><div class="passkey-row-actions"><button type="button" class="table-action" data-passkey-rename="${e(passkey.id)}" aria-label="重命名 ${e(passkey.label)}">${icon('edit', 14)}改名</button><button type="button" class="table-action passkey-remove" data-passkey-delete="${e(passkey.id)}" aria-label="删除 ${e(passkey.label)}" ${passkeys.length <= 1 ? 'disabled title="请先添加备用通行密钥，再删除最后一把通行密钥。"' : ''}>删除</button></div></li>`).join('');
}

export async function bindPasskeySettings({ notify = () => {} } = {}) {
  const panel = document.querySelector('#passkey-settings');
  const list = document.querySelector('#passkey-list');
  const add = document.querySelector('#passkey-add');
  const errorNode = document.querySelector('#passkeys-error');
  const success = document.querySelector('#passkeys-success');
  const reload = document.querySelector('#passkeys-reload');
  const loading = document.querySelector('#passkey-loading');
  const dialog = document.querySelector('#passkey-dialog');
  const form = document.querySelector('#passkey-management-form');
  const labelField = document.querySelector('#passkey-dialog-label-field');
  const input = document.querySelector('#passkey-management-label');
  const cancel = document.querySelector('#passkey-dialog-cancel');
  const submit = document.querySelector('#passkey-dialog-submit');
  const dialogError = document.querySelector('#passkey-dialog-error');
  const progress = document.querySelector('#passkey-progress');
  const verificationNote = document.querySelector('#passkey-verification-note');
  let passkeys = [], mode = '', selected = null, pending = false, refreshing = false;

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    panel.setAttribute('aria-busy', 'true');
    loading.hidden = false;
    reload.hidden = true;
    try {
      const result = await api('/api/admin/passkeys');
      passkeys = result.passkeys || [];
      list.innerHTML = passkeyRows(passkeys);
      panel.dataset.passkeyCount = String(passkeys.length);
      verificationNote.hidden = !result.requiresReauthentication;
      errorNode.textContent = supportIssue();
      add.disabled = !!supportIssue();
      if (!passkeys.length) list.innerHTML = '<li class="passkey-empty">暂无可用的通行密钥，请通过服务器生成注册链接完成绑定。</li>';
    } catch (error) {
      errorNode.textContent = authError(error);
      reload.hidden = false;
      add.disabled = true;
    } finally {
      refreshing = false;
      loading.hidden = true;
      panel.removeAttribute('aria-busy');
    }
  }

  function open(modeValue, passkey = null) {
    if (pending || refreshing) return;
    mode = modeValue;
    selected = passkey;
    dialog.dataset.mode = mode;
    dialogError.textContent = '';
    progress.textContent = '';
    success.textContent = '';
    const deleting = mode === 'delete';
    labelField.hidden = deleting;
    input.required = !deleting;
    input.disabled = deleting;
    input.value = passkey?.label || 'Bitwarden 备用';
    document.querySelector('#passkey-dialog-title').textContent = deleting ? '删除通行密钥？' : mode === 'rename' ? '重命名通行密钥' : '添加备用通行密钥';
    document.querySelector('#passkey-dialog-description').textContent = deleting
      ? `删除“${passkey.label}”后，将无法再用它登录。${passkey.current ? '当前会话会退出，请使用其他通行密钥重新登录。' : '其他通行密钥仍可正常使用。'}`
      : mode === 'rename' ? '为这把通行密钥设置容易辨认的名称。' : '请先解锁 Bitwarden 扩展，再选择密码库或备用设备保存新的通行密钥。';
    submit.textContent = deleting ? '确认删除' : mode === 'rename' ? '保存名称' : '创建通行密钥';
    submit.className = `btn ${deleting ? 'btn-danger' : 'btn-primary'}`;
    dialog.showModal();
    if (!deleting) { input.focus(); input.select(); } else cancel.focus();
  }

  async function verifiedRequest(path, options) {
    try { return await api(path, options); }
    catch (error) {
      if (error.code !== 'REAUTH_REQUIRED') throw error;
      progress.textContent = '请先使用当前通行密钥再次验证，然后继续此操作。';
      await authenticate(true);
      verificationNote.hidden = true;
      progress.textContent = '验证通过，正在继续…';
      return api(path, options);
    }
  }

  add.addEventListener('click', () => open('add'));
  reload.addEventListener('click', refresh);
  list.addEventListener('click', event => {
    const button = event.target.closest('button[data-passkey-rename],button[data-passkey-delete]');
    if (!button || button.disabled) return;
    const passkey = passkeys.find(item => item.id === (button.dataset.passkeyRename || button.dataset.passkeyDelete));
    if (passkey) open(button.hasAttribute('data-passkey-delete') ? 'delete' : 'rename', passkey);
  });
  cancel.addEventListener('click', () => { if (!pending) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending) return;
    const label = input.value.trim();
    if (mode !== 'delete' && !label) { dialogError.textContent = '请填写通行密钥名称。'; input.focus(); return; }
    pending = true;
    dialogError.textContent = '';
    progress.textContent = '正在处理…';
    submit.disabled = true;
    cancel.disabled = true;
    input.disabled = true;
    form.setAttribute('aria-busy', 'true');
    try {
      if (mode === 'add') {
        const { startRegistration } = await webAuthn();
        const { options } = await verifiedRequest('/api/auth/register/options', { method: 'POST', body: { label } });
        progress.textContent = '请在浏览器中选择密码库或设备，创建通行密钥…';
        const response = await startRegistration({ optionsJSON: options });
        // 注册响应只能提交一次；过期后从 options 重新开始，不能在重新验证后重放旧响应。
        try { await api('/api/auth/register/verify', { method: 'POST', body: { response } }); }
        catch (error) {
          if (error.code === 'REAUTH_REQUIRED') throw new ApiError('身份验证已过期，请再次点击创建通行密钥，重新验证后继续。', 403, error.code);
          throw error;
        }
      } else if (mode === 'rename') {
        await verifiedRequest(`/api/admin/passkeys/${encodeURIComponent(selected.id)}`, { method: 'PATCH', body: { label } });
      } else {
        const result = await verifiedRequest(`/api/admin/passkeys/${encodeURIComponent(selected.id)}`, { method: 'DELETE' });
        if (result.sessionRevoked) { location.assign(url('login', { expired: '1' })); return; }
      }
      const message = mode === 'add' ? '备用通行密钥已添加。' : mode === 'rename' ? '通行密钥名称已更新。' : '通行密钥已删除。';
      dialog.close();
      await refresh();
      success.textContent = message;
      notify(message);
      add.focus({ preventScroll: true });
    } catch (error) {
      dialogError.textContent = authError(error);
      if (error.code === 'UNAUTHORIZED' || error.code === 'SESSION_CHANGED') location.assign(url('login', { expired: '1', next: url('settings') }));
    } finally {
      pending = false;
      progress.textContent = '';
      submit.disabled = false;
      cancel.disabled = false;
      input.disabled = mode === 'delete';
      form.removeAttribute('aria-busy');
    }
  });
  await refresh();
}
