import { icon } from './icons.js';

const controls = new WeakMap();
let sequence = 0;
let expanded = null;

function accessibleName(select) {
  if (select.hasAttribute('aria-label')) return select.getAttribute('aria-label');
  const label = select.labels?.[0];
  if (!label) return select.name || '选择选项';
  const copy = label.cloneNode(true);
  copy.querySelectorAll('select, input, button, small, .select-control, .af-error').forEach(node => node.remove());
  return copy.textContent.replace(/\s+/g, ' ').trim() || '选择选项';
}

function createControl(select) {
  const id = `select-control-${++sequence}`;
  const wrapper = document.createElement('div');
  wrapper.className = 'select-control';
  for (const name of ['af-file-select', 'af-arch-select', 'table-select']) {
    if (select.classList.contains(name)) wrapper.classList.add(name);
  }
  wrapper.dataset.selectFor = select.id || select.name || id;
  select.before(wrapper);
  wrapper.append(select);
  select.classList.add('select-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const button = document.createElement('button');
  button.type = 'button';
  button.id = `${id}-trigger`;
  button.className = 'select-trigger';
  button.setAttribute('role', 'combobox');
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', `${id}-listbox`);
  button.innerHTML = `<span class="select-value"></span><span class="select-chevron" aria-hidden="true">${icon('down', 15)}</span>`;
  const value = button.querySelector('.select-value');
  const menu = document.createElement('div');
  menu.id = `${id}-listbox`;
  menu.className = 'select-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-labelledby', button.id);
  menu.hidden = true;
  wrapper.append(button, menu);
  let activeIndex = -1;
  let searchText = '';
  let searchTime = 0;
  let signature = '';

  const enabled = index => {
    const option = select.options[index];
    return !!option && !option.disabled && !option.hidden && !(option.parentElement.tagName === 'OPTGROUP' && option.parentElement.disabled);
  };
  const indexes = () => Array.from(select.options, (_, index) => index).filter(enabled);
  const isOpen = () => expanded === control;

  function position() {
    const bounds = button.getBoundingClientRect();
    if (!button.isConnected || bounds.bottom <= 0 || bounds.top >= innerHeight) return close();
    const gap = 7;
    const below = innerHeight - bounds.bottom - 12 - gap;
    const above = bounds.top - 12 - gap;
    const upwards = below < Math.min(menu.scrollHeight, 210) && above > below;
    const height = Math.max(40, Math.min(280, upwards ? above : below));
    const width = Math.min(Math.max(bounds.width, 156), innerWidth - 24);
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${height}px`;
    menu.style.left = `${Math.max(12, Math.min(bounds.left, innerWidth - width - 12))}px`;
    menu.dataset.direction = upwards ? 'up' : 'down';
    menu.style.top = `${upwards ? bounds.top - Math.min(menu.scrollHeight, height) - gap : bounds.bottom + gap}px`;
  }

  function highlight(index, scroll = true) {
    activeIndex = index;
    menu.querySelectorAll('[role="option"]').forEach(node => node.classList.toggle('is-active', Number(node.dataset.index) === index));
    const option = menu.querySelector(`[data-index="${index}"]`);
    if (option && isOpen()) {
      button.setAttribute('aria-activedescendant', option.id);
      if (scroll) option.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  }

  function sync() {
    button.disabled = select.matches(':disabled');
    button.setAttribute('aria-disabled', String(button.disabled));
    button.setAttribute('aria-label', accessibleName(select));
    for (const attr of ['aria-describedby', 'aria-invalid', 'aria-required']) {
      if (select.hasAttribute(attr)) button.setAttribute(attr, select.getAttribute(attr));
      else button.removeAttribute(attr);
    }
    if (select.required) button.setAttribute('aria-required', 'true');
    if (select.hasAttribute('aria-labelledby')) {
      button.setAttribute('aria-labelledby', select.getAttribute('aria-labelledby'));
      button.removeAttribute('aria-label');
    } else button.removeAttribute('aria-labelledby');
    value.textContent = select.selectedOptions[0]?.label || '请选择';
    const nextSignature = JSON.stringify(Array.from(select.options, (option, index) => [option.label, option.value, enabled(index), option.hidden, option.parentElement.label]));
    if (nextSignature !== signature) {
      signature = nextSignature;
      menu.replaceChildren();
      let previousGroup = null;
      Array.from(select.options).forEach((option, index) => {
        if (option.hidden) return;
        const group = option.parentElement.tagName === 'OPTGROUP' ? option.parentElement : null;
        if (group && group !== previousGroup) {
          const label = document.createElement('div');
          label.className = 'select-group-label';
          label.textContent = group.label;
          menu.append(label);
        }
        previousGroup = group;
        const item = document.createElement('div');
        item.id = `${id}-option-${index}`;
        item.className = 'select-option';
        item.dataset.index = index;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-disabled', String(!enabled(index)));
        const text = document.createElement('span');
        text.className = 'select-option-label';
        text.textContent = option.label;
        const check = document.createElement('span');
        check.className = 'select-option-check';
        check.setAttribute('aria-hidden', 'true');
        check.innerHTML = icon('check', 15);
        item.append(text, check);
        menu.append(item);
      });
    }
    menu.querySelectorAll('[role="option"]').forEach(node => node.setAttribute('aria-selected', String(Number(node.dataset.index) === select.selectedIndex)));
    if ((button.disabled || !indexes().length) && isOpen()) close();
    else if (isOpen()) {
      if (!enabled(activeIndex)) activeIndex = enabled(select.selectedIndex) ? select.selectedIndex : indexes()[0] ?? -1;
      highlight(activeIndex, false);
      position();
    }
  }

  function open(index = select.selectedIndex) {
    sync();
    if (button.disabled || !indexes().length) return;
    expanded?.close();
    expanded = control;
    // 菜单挂到页面根部，避免表格的滚动容器裁剪展开选项。
    document.body.append(menu);
    menu.hidden = false;
    wrapper.classList.add('is-open');
    button.setAttribute('aria-expanded', 'true');
    position();
    highlight(enabled(index) ? index : indexes()[0]);
  }

  function close() {
    menu.hidden = true;
    wrapper.append(menu);
    wrapper.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
    button.removeAttribute('aria-activedescendant');
    if (expanded === control) expanded = null;
  }

  function choose(index, restoreFocus = true) {
    if (!enabled(index) || button.disabled) return;
    const changed = select.selectedIndex !== index;
    select.selectedIndex = index;
    close();
    sync();
    if (restoreFocus) button.focus({ preventScroll: true });
    // 原表单仍接收原生字段的事件，校验、保存与筛选逻辑不必各维护一份。
    if (changed) {
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  button.addEventListener('click', () => isOpen() ? close() : open());
  button.addEventListener('keydown', event => {
    const choices = indexes();
    if (!choices.length) return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Enter' || event.key === ' ') {
        if (isOpen()) choose(activeIndex);
        else open();
        return;
      }
      if (!isOpen()) {
        open(event.key === 'End' ? choices.at(-1) : event.key === 'Home' ? choices[0] : select.selectedIndex);
        return;
      }
      const cursor = choices.indexOf(activeIndex);
      const next = event.key === 'Home' ? choices[0] : event.key === 'End' ? choices.at(-1) : choices[Math.max(0, Math.min(choices.length - 1, cursor + (event.key === 'ArrowDown' ? 1 : -1)))];
      highlight(next);
    } else if (event.key === 'Escape' && isOpen()) {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab' && isOpen()) {
      choose(activeIndex, false);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = performance.now();
      searchText = now - searchTime > 600 ? event.key : searchText + event.key;
      searchTime = now;
      const query = [...searchText].every(char => char === searchText[0]) ? searchText[0] : searchText;
      const cursor = choices.indexOf(isOpen() ? activeIndex : select.selectedIndex);
      const ordered = [...choices.slice(cursor + 1), ...choices.slice(0, cursor + 1)];
      const match = ordered.find(index => select.options[index].label.toLocaleLowerCase().startsWith(query.toLocaleLowerCase()));
      if (match !== undefined) {
        event.preventDefault();
        if (isOpen()) highlight(match);
        else choose(match);
      }
    }
  });
  menu.addEventListener('pointerdown', event => event.preventDefault());
  menu.addEventListener('pointermove', event => {
    const item = event.target.closest('[role="option"]');
    if (item && enabled(Number(item.dataset.index))) highlight(Number(item.dataset.index), false);
  });
  menu.addEventListener('click', event => {
    const item = event.target.closest('[role="option"]');
    if (item) choose(Number(item.dataset.index));
  });
  select.addEventListener('focus', () => button.focus());
  select.addEventListener('change', sync);
  select.addEventListener('input', sync);
  const observer = new MutationObserver(sync);
  observer.observe(select, { attributes: true, childList: true, subtree: true, characterData: true, attributeFilter: ['disabled', 'selected', 'label', 'hidden', 'value', 'required', 'aria-invalid', 'aria-describedby', 'aria-label', 'aria-labelledby'] });
  const control = { select, button, menu, sync, close, position };
  sync();
  return control;
}

export function enhanceSelects(root = document) {
  const selects = [...(root.matches?.('select') ? [root] : []), ...root.querySelectorAll('select')];
  for (const select of selects) {
    if (select.multiple || select.size > 1 || select.hasAttribute('data-native-select')) continue;
    if (!controls.has(select)) controls.set(select, createControl(select));
    else controls.get(select).sync();
  }
}

document.addEventListener('pointerdown', event => {
  if (expanded && !expanded.button.contains(event.target) && !expanded.menu.contains(event.target)) expanded.close();
});
document.addEventListener('focusin', event => {
  if (expanded && !expanded.button.contains(event.target) && !expanded.menu.contains(event.target)) expanded.close();
});
// 统一处理表单重置，避免动态附件行反复重建后在表单上累积监听器。
document.addEventListener('reset', event => queueMicrotask(() => enhanceSelects(event.target)));
window.addEventListener('resize', () => expanded?.position());
document.addEventListener('scroll', event => {
  if (expanded && !expanded.menu.contains(event.target)) expanded.position();
}, true);
new MutationObserver(() => {
  if (expanded && !expanded.button.isConnected) expanded.close();
}).observe(document.documentElement, { childList: true, subtree: true });
