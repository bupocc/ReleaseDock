// 界面图标与项目标识均为本地矢量图形，不依赖外部资源。
const paths = {
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  diagonal: '<path d="M6 18 18 6M6 6h12v12"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  key: '<circle cx="8" cy="9" r="5"/><path d="m12 12 9 9m-5-5 3-3m-6 0 3-3"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/>',
  box: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v9l9 5 9-5V8M12 13v9M7 5.7l9 5"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l3 4h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  chart: '<path d="M4 3v17h17M8 15v-4m5 4V7m5 8V4"/>',
  settings: '<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3H9Z"/><circle cx="12" cy="12" r="3"/>',
  logout: '<path d="M10 4H4v16h6m4-12 4 4-4 4M8 12h12"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  edit: '<path d="m14 5 5 5M4 20l5-1L21 7l-5-5L4 14v6Z"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  file: '<path d="M13 2H5v20h14V8l-6-6Zm0 0v6h6M8 13h8m-8 4h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  link: '<path d="m10 13 4-4m-6 6-1 1a4.2 4.2 0 0 1-6-6l5-5a4.2 4.2 0 0 1 6 0m0 4 1-1a4.2 4.2 0 0 1 6 6l-5 5a4.2 4.2 0 0 1-6 0"/>',
  windows: '<path d="m3 5 8-1v7H3V5Zm10-1 8-1v8h-8V4ZM3 13h8v7l-8-1v-6Zm10 0h8v8l-8-1v-7Z"/>',
  apple: '<path d="M14 6c0-3 2-4 4-4 0 2-1 4-4 4Zm6 10c-1 3-3 6-5 5-2-1-3-1-5 0-3 1-7-6-7-10 0-4 4-6 7-4 2 1 3-1 5-1 2 0 4 1 5 3-4 2-4 5 0 7Z"/>',
  terminal: '<path d="m5 7 5 5-5 5m8 0h6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  bold: '<path d="M6 4h7a4 4 0 0 1 0 8H6m0-8v16h8a4 4 0 0 0 0-8H6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  code: '<path d="m7 6-5 6 5 6m10-12 5 6-5 6m-1-16-8 20"/>',
};

export function icon(name, size = 18, extra = '') {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${paths[name] || paths.box}</svg>`;
}

export function logo() {
  return `<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="m6 10 10-5 10 5-10 5-10-5Z" fill="#e0edcd"/><path d="M6 15.5 16 21l10-5.5M6 21l10 5.5L26 21" stroke="#e0edcd" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
}

export function projectMark(name, size = '') {
  const shapes = {
    orbit: '<ellipse cx="24" cy="24" rx="17" ry="8" transform="rotate(-38 24 24)"/><ellipse cx="24" cy="24" rx="17" ry="8" transform="rotate(38 24 24)"/><circle cx="24" cy="24" r="3" fill="currentColor" stroke="none"/>',
    flowsync: '<path d="M10 17h25l-6-6m9 20H13l6 6M35 17v7M13 31v-7"/>',
    pixelkit: '<rect x="10" y="10" width="12" height="12" rx="2" fill="currentColor" stroke="none"/><rect x="26" y="10" width="12" height="12" rx="2"/><rect x="10" y="26" width="12" height="12" rx="2"/><rect x="26" y="26" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
    termix: '<path d="m11 15 9 9-9 9m14 0h12"/>',
    notespace: '<path d="M13 8h17l7 7v25H13V8Zm17 0v9h7M20 25h10m-10 7h7"/>',
    cloudbridge: '<path d="M13 33a8 8 0 0 1-1-16 12 12 0 0 1 23-1 8.5 8.5 0 0 1 0 17H13Z"/><path d="M24 21v16m-5-5 5 5 5-5"/>',
  };
  return `<span class="project-mark ${name} ${size}"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.orbit}</svg></span>`;
}
