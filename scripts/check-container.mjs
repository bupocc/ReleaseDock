import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// 不依赖管理员身份，不重建容器，也不写入业务数据。capture 另生成一致的 SQLite 备份。
const mode = process.argv[2] || 'verify';
assert.ok(['capture', 'verify'].includes(mode), '仅支持 capture 或 verify');
const base = process.env.CHECK_BASE_URL || 'http://127.0.0.1:8080';
const snapshotFile = path.resolve('.data/container-before.json');
const hash = value => createHash('sha256').update(value).digest('hex');
const inspect = [
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  "import {createHash} from 'node:crypto';",
  "import {DatabaseSync,backup} from 'node:sqlite';",
  "const root=process.env.DATA_DIR||'/app/data';",
  "const db=new DatabaseSync(path.join(root,'releasedock.sqlite'),{readOnly:true});",
  "const projects=db.prepare('SELECT * FROM projects ORDER BY id').all();",
  "const releases=db.prepare('SELECT * FROM releases ORDER BY id').all();",
  "const assets=db.prepare('SELECT * FROM assets ORDER BY id').all();",
  "const settings=db.prepare(\"SELECT * FROM settings WHERE substr(key,1,1)<>'_' ORDER BY key\").all();",
  "const files=[];",
  "async function inspectFile(relative,id){const filename=path.resolve(root,relative);if(!filename.startsWith(path.resolve(root)+path.sep))throw new Error('非法文件路径');const hash=createHash('sha256');for await(const part of fs.createReadStream(filename))hash.update(part);return {id,size:fs.statSync(filename).size,sha256:hash.digest('hex')};}",
  "for(const asset of assets){const file=await inspectFile(path.join('uploads',asset.storage_name),asset.id);if(file.size!==asset.size||file.sha256!==asset.sha256)throw new Error('安装包校验失败');files.push(file);}",
  "for(const project of projects)if(project.icon.startsWith('/api/icons/'))files.push(await inspectFile(path.join('icons',project.icon.slice('/api/icons/'.length)),'icon:'+project.id));",
  "let backupFile=null;",
  ...(mode === 'capture' ? [
    "const backupDir=path.join(root,'backups');fs.mkdirSync(backupDir,{recursive:true,mode:0o700});",
    "backupFile=path.join(backupDir,'before-passkeys-'+Date.now()+'.sqlite');await backup(db,backupFile);",
  ] : []),
  "db.close();console.log(JSON.stringify({projects,releases,assets,settings,files,backupFile}));",
].join('\n');
const raw = execFileSync('docker', ['compose', 'exec', '-T', 'app', 'node', '--input-type=module', '-e', inspect], { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
const snapshot = JSON.parse(raw);
const counts = { projects: snapshot.projects.length, releases: snapshot.releases.length, assets: snapshot.assets.length, checkedFiles: snapshot.files.length };
await fs.mkdir(path.dirname(snapshotFile), { recursive: true });
if (mode === 'capture') {
  await fs.writeFile(snapshotFile, JSON.stringify({ capturedAt: new Date().toISOString(), ...snapshot }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ captured: true, ...counts, sqliteBackup: snapshot.backupFile }));
} else {
  const before = JSON.parse(await fs.readFile(snapshotFile, 'utf8'));
  for (const field of ['projects', 'releases', 'settings', 'files']) assert.deepEqual(snapshot[field], before[field], field + ' 更新前后必须一致');
  const stableAssets = assets => assets.map(({ download_count, ...asset }) => asset);
  assert.deepEqual(stableAssets(snapshot.assets), stableAssets(before.assets), '安装包 ID、名称、存储位置、大小及 SHA-256 必须保留');
  for (const previous of before.assets) assert.ok(snapshot.assets.find(asset => asset.id === previous.id).download_count >= previous.download_count, '下载统计不能倒退');
  const health = await fetch(base + '/healthz', { signal: AbortSignal.timeout(10000) });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  const entries = await fs.readdir(path.resolve('web'), { withFileTypes: true });
  let checkedWebFiles = 0;
  for (const entry of entries.filter(entry => entry.isFile())) {
    const response = await fetch(base + '/assets/' + encodeURIComponent(entry.name), { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, entry.name);
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(await fs.readFile(path.join('web', entry.name))), '容器文件与工作区不一致：' + entry.name);
    checkedWebFiles++;
  }
  for (const route of ['/api/admin/projects', '/%61pi/%61dmin/projects', '/api/admin/passkeys']) assert.equal((await fetch(base + route)).status, 401);
  assert.equal((await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'obsolete-login-must-stay-disabled' }) })).status, 404);
  const auth = await (await fetch(base + '/api/auth/status')).json();
  assert.ok(auth.origin && auth.rpId);
  const result = { verifiedAt: new Date().toISOString(), health: true, persisted: true, ...counts, checkedWebFiles, passkeyOrigin: auth.origin, adminInitialized: auth.initialized };
  await fs.writeFile(path.resolve('.data/container-verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
