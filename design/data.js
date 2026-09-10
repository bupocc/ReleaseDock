// 仅用于视觉设计与交互预览；这些项目、版本和统计均为示例数据。
export const projects = [
  { id: 'orbit', name: 'Orbit', subtitle: '桌面工作台', description: '把应用、文件和灵感，放进一个井井有条的工作空间。', category: '效率工具', version: '2.8.0', date: '2026.09.08', platforms: ['Windows', 'macOS', 'Linux'], downloads: '12,486', size: '86.4 MB', releases: 8 },
  { id: 'flowsync', name: 'FlowSync', subtitle: '文件同步', description: '在设备之间轻松同步，让每一份重要文件始终保持最新。', category: '系统工具', version: '1.6.2', date: '2026.09.06', platforms: ['Windows', 'macOS'], downloads: '8,392', size: '42.8 MB', releases: 5 },
  { id: 'pixelkit', name: 'PixelKit', subtitle: '图像工具箱', description: '压缩、转换、批量处理。让日常图像工作更简单。', category: '效率工具', version: '3.1.0', date: '2026.09.04', platforms: ['Windows', 'macOS'], downloads: '6,218', size: '65.2 MB', releases: 4 },
  { id: 'termix', name: 'Termix', subtitle: '终端助手', description: '为开发者打造的轻量终端，让常用命令触手可及。', category: '开发工具', version: '1.2.0', date: '2026.09.02', platforms: ['Windows', 'macOS', 'Linux'], downloads: '4,806', size: '28.1 MB', releases: 3 },
  { id: 'notespace', name: 'NoteSpace', subtitle: '轻量笔记', description: '专注记录，随时整理。给每个稍纵即逝的想法一个家。', category: '效率工具', version: '2.0.1', date: '2026.08.29', platforms: ['Windows', 'macOS'], downloads: '3,657', size: '38.6 MB', releases: 2 },
  { id: 'cloudbridge', name: 'CloudBridge', subtitle: '云端连接器', description: '连接本地与云端，以熟悉的方式管理你的远程文件。', category: '开发工具', version: '1.4.0', date: '2026.08.25', platforms: ['Windows', 'macOS', 'Linux'], downloads: '2,841', size: '19.7 MB', releases: 2 },
];

export const releases = [
  { project: 'orbit', version: '2.9.0-beta.1', channel: '预发布', status: '草稿', date: '2026.09.10 10:42', files: 3, downloads: '—' },
  { project: 'orbit', version: '2.8.0', channel: '稳定版', status: '已发布', date: '2026.09.08 14:30', files: 4, downloads: '2,146' },
  { project: 'flowsync', version: '1.6.2', channel: '稳定版', status: '已发布', date: '2026.09.06 09:15', files: 2, downloads: '1,382' },
  { project: 'pixelkit', version: '3.1.0', channel: '稳定版', status: '已发布', date: '2026.09.04 16:20', files: 2, downloads: '968' },
  { project: 'termix', version: '1.2.0', channel: '稳定版', status: '已发布', date: '2026.09.02 11:08', files: 3, downloads: '746' },
];

export const assets = [
  { system: 'Windows', arch: 'x64', name: 'Orbit-2.8.0-win-x64.exe', size: '86.4 MB', type: '安装程序', icon: 'windows' },
  { system: 'macOS', arch: 'Apple Silicon', name: 'Orbit-2.8.0-mac-arm64.dmg', size: '92.1 MB', type: '磁盘映像', icon: 'apple' },
  { system: 'macOS', arch: 'Intel', name: 'Orbit-2.8.0-mac-x64.dmg', size: '96.7 MB', type: '磁盘映像', icon: 'apple' },
  { system: 'Linux', arch: 'x64', name: 'Orbit-2.8.0-linux-x64.AppImage', size: '88.3 MB', type: 'AppImage', icon: 'terminal' },
];
