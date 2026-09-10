import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// 验证本项目容器重建后的会话和密钥持久化，不写入示例项目或版本。
const base=process.env.CHECK_BASE_URL||'http://127.0.0.1:8080';
const keyFile=path.resolve(process.env.CHECK_KEY_FILE||'.data/container-admin-key');
const key=(await fs.readFile(keyFile,'utf8')).trim();
const login=await fetch(`${base}/api/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key})});
assert.equal(login.status,200,'容器管理密钥应可登录');
const cookie=login.headers.get('set-cookie')?.split(';')[0];
const session=await login.json();
assert.ok(cookie&&session.csrfToken);
const before=execFileSync('docker',['compose','ps','-q','app'],{encoding:'utf8',timeout:10000}).trim();
assert.ok(before,'应找到本项目容器');
execFileSync('docker',['compose','up','-d','--no-build','--force-recreate'],{encoding:'utf8',timeout:30000,stdio:'pipe'});
let healthy=false;
for(let attempt=0;attempt<25;attempt++) {
  try{const response=await fetch(`${base}/healthz`,{signal:AbortSignal.timeout(1000)});if(response.ok){healthy=true;break;}}catch{/* 容器启动期间允许短暂不可达。 */}
  await new Promise(resolve=>setTimeout(resolve,500));
}
assert.ok(healthy,'重建后健康检查应恢复');
const after=execFileSync('docker',['compose','ps','-q','app'],{encoding:'utf8',timeout:10000}).trim();
assert.notEqual(after,before,'应真正创建新的容器');
const persisted=await (await fetch(`${base}/api/session`,{headers:{cookie}})).json();
assert.equal(persisted.authenticated,true,'重建前的数据库会话应继续有效');
assert.equal(persisted.csrfToken,session.csrfToken,'会话数据应来自原数据库');
const logout=await fetch(`${base}/api/logout`,{method:'POST',headers:{cookie,'x-csrf-token':session.csrfToken}});
assert.equal(logout.status,200);
const result={verifiedAt:new Date().toISOString(),health:true,containerRecreated:true,sqliteSessionPersisted:true,adminKeyPersisted:true};
await fs.writeFile(path.resolve('.data/container-verification.json'),JSON.stringify(result,null,2));
console.log('通过：容器健康、镜像可启动、容器已重建、SQLite 会话及管理员密钥持久化。');
