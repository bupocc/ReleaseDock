import { api, escapeHtml, formatBytes } from './api.js';
import { icon } from './icons.js';

let activeDialog;

export function assetRenameButton(asset, className = '', disabled = false) {
  return `<button type="button" class="asset-rename-trigger ${escapeHtml(className)}" data-asset-rename="${escapeHtml(asset.id)}" aria-label="重命名 ${escapeHtml(asset.filename)}" title="重命名 ${escapeHtml(asset.filename)}"${disabled ? ' disabled' : ''}>${icon('edit', 13)}<span>重命名</span></button>`;
}

export function filenameError(value) {
  if (Array.from(value).some(character => { const point = character.codePointAt(0); return point >= 0xD800 && point <= 0xDFFF; })) return '文件名包含无法识别的字符，请移除后重试。';
  const name = value.normalize('NFC');
  if (!name.trim()) return '请输入完整文件名，包括扩展名。';
  if (Array.from(name).length > 180) return '文件名不能超过 180 个字符，请缩短后再保存。';
  if (name !== name.trim()) return '文件名的开头和结尾不能包含空格。';
  if (/[<>:"/\\|?*\u2028\u2029]/u.test(name) || /\p{Cc}/u.test(name)) return '文件名不能包含路径分隔符、控制字符、换行符或 < > : " | ? *。';
  if (name.endsWith('.')) return '文件名不能以句点结尾，请填写完整的文件名。';
  const stem = name.split('.')[0].trimEnd();
  if (/^(?:con|prn|aux|nul|conin\$|conout\$|clock\$|com[1-9¹²³]|lpt[1-9¹²³])$/iu.test(stem)) return '这个名称由 Windows 系统保留，请换一个文件名。';
  return '';
}

// 弹窗独立挂在 body 下，避免与发布编辑器的 form 嵌套或触发版本提交。
export function openAssetRename(asset, trigger) {
  if (activeDialog || !asset?.id) return Promise.resolve(null);
  const dialog = document.createElement('dialog');
  dialog.id = 'asset-rename-dialog';
  dialog.className = 'asset-rename-dialog';
  dialog.dataset.assetRenameDialog = asset.id;
  dialog.setAttribute('aria-labelledby', 'asset-rename-title');
  dialog.setAttribute('aria-describedby', 'asset-rename-description');
  dialog.innerHTML = `<header class="asset-rename-header"><div class="asset-rename-heading"><span class="asset-rename-mark">${icon('edit', 21)}</span><div><span class="asset-rename-eyebrow">FILE NAME</span><h2 id="asset-rename-title">重命名安装包</h2></div></div><button class="asset-rename-close" type="button" data-asset-rename-cancel aria-label="取消重命名">${icon('x', 18)}</button></header><form id="asset-rename-form" novalidate><div class="asset-rename-body"><p id="asset-rename-description">修改显示和下载时使用的文件名。</p><div class="asset-rename-current">${icon('file', 19)}<div><span>当前文件</span><strong data-asset-rename-current></strong><small>${formatBytes(asset.size)}</small></div></div><label class="asset-rename-label" for="asset-rename-filename">新文件名</label><input id="asset-rename-filename" name="filename" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" required aria-describedby="asset-rename-help asset-rename-error"><div class="asset-rename-input-meta"><p id="asset-rename-help">填写完整名称，包括扩展名。</p><span class="mono" data-asset-rename-count></span></div><p id="asset-rename-error" class="asset-rename-error" data-asset-rename-error role="alert"></p><div class="asset-rename-note">${icon('shield', 15)}<p>文件内容、下载链接和 SHA-256 校验值保持不变。</p></div></div><footer class="asset-rename-footer"><span class="asset-rename-progress" data-asset-rename-progress role="status" aria-live="polite"></span><div><button class="btn btn-light" type="button" data-asset-rename-cancel>取消</button><button class="btn btn-primary" type="submit" data-asset-rename-save>保存文件名</button></div></footer></form>`;
  const form = dialog.querySelector('#asset-rename-form');
  const input = dialog.querySelector('#asset-rename-filename');
  const error = dialog.querySelector('[data-asset-rename-error]');
  const progress = dialog.querySelector('[data-asset-rename-progress]');
  const save = dialog.querySelector('[data-asset-rename-save]');
  const cancelButtons = [...dialog.querySelectorAll('[data-asset-rename-cancel]')];
  input.value = asset.filename;
  dialog.querySelector('[data-asset-rename-current]').textContent = asset.filename;
  let busy = false;
  let renamed = null;
  const updateCount = () => {
    const count = Array.from(input.value.normalize('NFC')).length;
    const counter = dialog.querySelector('[data-asset-rename-count]');
    counter.textContent = `${count} / 180`;
    counter.classList.toggle('over-limit', count > 180);
  };
  const setBusy = (value) => {
    busy = value;
    form.setAttribute('aria-busy', String(value));
    input.disabled = value;
    save.disabled = value;
    cancelButtons.forEach((button) => { button.disabled = value; });
    save.textContent = value ? '正在保存…' : '保存文件名';
    progress.textContent = value ? '正在更新文件名…' : '';
  };
  const showError = (message, code = '', invalid = true) => {
    error.textContent = message;
    error.dataset.code = code;
    if (invalid) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    input.focus();
  };
  input.addEventListener('input', () => {
    error.textContent = '';
    delete error.dataset.code;
    input.removeAttribute('aria-invalid');
    updateCount();
  });
  cancelButtons.forEach((button) => button.addEventListener('click', () => { if (!busy) dialog.close(); }));
  dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.isComposing) event.preventDefault();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const filename = input.value;
    const validation = filenameError(filename);
    if (validation) { showError(validation, 'INVALID_FILENAME'); return; }
    if (filename === asset.filename) { dialog.close(); return; }
    error.textContent = '';
    input.removeAttribute('aria-invalid');
    setBusy(true);
    try {
      const result = await api(`/api/admin/assets/${encodeURIComponent(asset.id)}`, { method: 'PATCH', body: { filename } });
      if (result.asset?.id !== asset.id || typeof result.asset.filename !== 'string') throw new Error('服务器未返回文件名，请稍后重试或在文件列表中核对。');
      renamed = result.asset;
      dialog.close('saved');
    } catch (reason) {
      setBusy(false);
      showError(reason.message || '文件名保存失败，请稍后重试。', reason.code || '', reason.status === 400 || reason.status === 409);
    }
  });
  activeDialog = dialog;
  document.body.appendChild(dialog);
  updateCount();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      activeDialog = null;
      dialog.remove();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      resolve(renamed);
    }, { once: true });
    dialog.showModal();
    input.focus();
    input.select();
  });
}
