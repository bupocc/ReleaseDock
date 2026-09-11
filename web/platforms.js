// 项目配置、安装包识别和公开展示共用平台定义，扩展平台时只维护一处。
const platforms = [
  { value: 'Windows', label: 'Windows', icon: 'windows', aliases: ['windows', 'win'] },
  { value: 'macOS', label: 'macOS', icon: 'apple', aliases: ['macos', 'mac', 'darwin'] },
  { value: 'Linux', label: 'Linux', icon: 'terminal', aliases: ['linux'] },
  { value: 'Android', label: 'Android', icon: 'android', aliases: ['android', '安卓'] },
  { value: 'iOS', label: 'iOS', icon: 'phone', aliases: ['ios', 'iphone', 'ipad'] },
  { value: 'HarmonyOS', label: '鸿蒙', icon: 'harmony', aliases: ['harmonyos', 'harmony', 'ohos', '鸿蒙'] },
  { value: 'Web', label: 'Web', icon: 'globe', aliases: ['web'] },
];

export const PLATFORM_VALUES = Object.freeze(platforms.map(item => item.value));
const byName = new Map(platforms.flatMap(item => item.aliases.map(alias => [alias, item])));
const definition = value => byName.get(String(value || '').trim().toLowerCase());

export const platformLabel = value => definition(value)?.label || String(value || '通用文件');
export const platformIcon = value => definition(value)?.icon || 'box';

export function inferPackage(filename) {
  const name = String(filename || '').toLowerCase();
  let platform = 'Windows';
  if (/\.(apk|aab|apks|xapk)$/.test(name)) platform = 'Android';
  else if (/\.ipa$/.test(name)) platform = 'iOS';
  else if (/\.(hap|hsp)$/.test(name)) platform = 'HarmonyOS';
  else if (/\.(dmg|pkg)$/.test(name)) platform = 'macOS';
  else if (/\.(appimage|deb|rpm|snap|flatpak)$/.test(name)) platform = 'Linux';
  else if (/(?:^|[^a-z0-9])(android)(?:[^a-z0-9]|$)/.test(name)) platform = 'Android';
  else if (/(?:^|[^a-z0-9])(ios|iphone|ipad)(?:[^a-z0-9]|$)/.test(name)) platform = 'iOS';
  else if (/(?:^|[^a-z0-9])(harmonyos|harmony|ohos)(?:[^a-z0-9]|$)/.test(name)) platform = 'HarmonyOS';
  else if (/(?:^|[^a-z0-9])(macos|mac|darwin|osx)(?:[^a-z0-9]|$)/.test(name)) platform = 'macOS';
  else if (/(?:^|[^a-z0-9])(linux)(?:[^a-z0-9]|$)/.test(name)) platform = 'Linux';
  else if (/\.(html|wasm)$/.test(name) || /(?:^|[^a-z0-9])web(?:[^a-z0-9]|$)/.test(name)) platform = 'Web';

  // 明确匹配架构标记，避免把 harmony 等普通单词误判为 ARM64。
  let arch = ['Android', 'iOS', 'HarmonyOS', 'Web'].includes(platform) ? 'universal' : 'x64';
  if (/(?:^|[^a-z0-9])(universal2?|noarch|all)(?:[^a-z0-9]|$)/.test(name)) arch = 'universal';
  else if (/(?:^|[^a-z0-9])(arm64(?:-v8a)?|aarch64)(?:[^a-z0-9]|$)/.test(name)) arch = 'arm64';
  else if (/(?:^|[^a-z0-9])(x86[_-]64|x64|amd64|win64)(?:[^a-z0-9]|$)/.test(name)) arch = 'x64';
  else if (/(?:^|[^a-z0-9])(x86|i[3-6]86|win32)(?:[^a-z0-9]|$)/.test(name)) arch = 'x86';
  return { platform, arch };
}
