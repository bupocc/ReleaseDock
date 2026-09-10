import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash,randomUUID } from 'node:crypto';
import { buildApp } from '../server/app.js';
import { parseRange } from '../server/files.js';
import { validSemver } from '../server/schemas.js';

const key='integration-only-admin-key-not-for-production-42';

function multipart(filename,content) {
  const boundary='----releasedock-integration-boundary';
  return {headers:{'content-type':`multipart/form-data; boundary=${boundary}`},payload:Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),Buffer.from(content),Buffer.from(`\r\n--${boundary}--\r\n`)])};
}

test('版本发布、管理鉴权与公开下载形成真实闭环',{timeout:55000},async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'releasedock-test-'));
  let app=await buildApp({dataDir,adminKey:key,logger:false,loginRateLimit:100,maxUploadBytes:1024});
  let cookie='',csrf='',projectId='',releaseId='',assetId='';
  const bytes=Buffer.from('releasedock-test-software-package');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  t.after(async()=>{
    await app.close();
    const target=path.resolve(dataDir),parent=path.resolve(os.tmpdir());
    assert.ok(target.startsWith(parent+path.sep)&&path.basename(target).startsWith('releasedock-test-'));
    await fs.rm(target,{recursive:true,force:true});
  });
  const call=(method,url,body,headers={})=>app.inject({method,url,payload:body,headers:{...(cookie?{cookie,'x-csrf-token':csrf}:{}),...headers}});
  const json=response=>response.json();

  await t.test('匿名只能读取公开数据，站点响应不泄露内部设置',async()=>{
    assert.equal((await call('GET','/api/admin/projects')).statusCode,401);
    for(const url of ['/%61pi/admin/projects','/api/%61dmin/projects','/%61pi/%61dmin/projects']) {
      assert.equal((await app.inject({url})).statusCode,401,`编码路由应鉴权：${url}`);
      assert.equal((await app.inject({method:'POST',url,payload:{name:'未授权',slug:'forbidden'}})).statusCode,401);
    }
    assert.deepEqual(json(await call('GET','/api/projects')).projects,[]);
    assert.deepEqual(json(await call('GET','/api/session')),{authenticated:false});
    const site=json(await call('GET','/api/site')).site;
    assert.deepEqual(Object.keys(site).sort(),['announcement','description','name']);
    assert.equal((await call('GET','/assets/../.data/admin-key')).statusCode,404);
  });
  await t.test('密钥登录设置 HttpOnly 会话，不回传管理密钥',async()=>{
    assert.equal((await call('POST','/api/login',{key:'incorrect-key'})).statusCode,401);
    const response=await call('POST','/api/login',{key});
    assert.equal(response.statusCode,200,response.body);
    assert.match(response.headers['set-cookie'],/HttpOnly/);
    assert.match(response.headers['set-cookie'],/SameSite=Strict/i);
    assert.ok(!response.body.includes(key));
    cookie=response.headers['set-cookie'].split(';')[0];csrf=json(response).csrfToken;
    assert.equal(json(await call('GET','/api/session')).authenticated,true);
  });
  await t.test('写操作检查 CSRF 与来源，项目元数据执行校验',async()=>{
    const body={name:'测试工作台',slug:'test-orbit',subtitle:'真实接口测试',description:'测试项目',category:'效率工具',website:'https://example.com',platforms:['Windows','macOS'],isPublic:true};
    assert.equal((await call('POST','/api/admin/projects',body,{'x-csrf-token':''})).statusCode,403);
    assert.equal((await call('POST','/%61pi/%61dmin/projects',body,{'x-csrf-token':''})).statusCode,403);
    assert.equal((await call('POST','/api/admin/projects',body,{origin:'https://attacker.example'})).statusCode,403);
    assert.equal((await call('POST','/api/admin/projects',{...body,website:'javascript:alert(1)'})).statusCode,400);
    const response=await call('POST','/api/admin/projects',body);
    assert.equal(response.statusCode,201,response.body);projectId=json(response).project.id;
    assert.equal((await call('POST','/api/admin/projects',body)).statusCode,409);
    assert.equal((await call('GET','/api/projects')).json().projects.length,1);
  });
  await t.test('新版本先保存草稿，空附件不能发布',async()=>{
    const body={projectId,version:'1.0.0',title:'首个正式版本',channel:'stable',notes:'## 新增功能\n- 可以开始工作了。'};
    assert.equal((await call('POST','/api/admin/releases',{...body,version:'01.0.0'})).statusCode,400);
    const response=await call('POST','/api/admin/releases',body);
    assert.equal(response.statusCode,201,response.body);releaseId=json(response).release.id;
    assert.equal(json(response).release.status,'draft');
    assert.equal((await call('POST',`/api/admin/releases/${releaseId}/publish`,{setLatest:true})).statusCode,400);
    assert.equal((await call('GET',`/api/releases/${releaseId}`)).statusCode,404);
    assert.equal(json(await call('GET','/api/projects/test-orbit')).releases.length,0);
  });
  await t.test('流式上传计算校验值，草稿地址不可公开下载',async()=>{
    const file=multipart('test-setup.exe',bytes);
    const response=await call('POST',`/api/admin/releases/${releaseId}/assets?platform=Windows&arch=x64`,file.payload,file.headers);
    assert.equal(response.statusCode,201,response.body);
    const asset=json(response).asset;assetId=asset.id;
    assert.equal(asset.size,bytes.length);assert.equal(asset.sha256,sha256);
    assert.equal((await call('GET',`/api/downloads/${assetId}`)).statusCode,404);
    assert.equal((await app.inject({url:`/%61pi/%61dmin/assets/${assetId}/download`})).statusCode,401);
    const preview=await call('GET',`/api/admin/assets/${assetId}/download`);
    assert.equal(preview.statusCode,200);assert.deepEqual(preview.rawPayload,bytes);
    assert.equal(json(await call('GET','/api/admin/assets')).assets.length,1);
    const duplicate=await call('POST',`/api/admin/releases/${releaseId}/assets?platform=Windows&arch=x64`,file.payload,file.headers);
    assert.equal(duplicate.statusCode,409);
    assert.equal((await fs.readdir(path.join(dataDir,'uploads'))).length,1);
  });
  await t.test('发布后公开详情与下载读取同一版本数据',async()=>{
    const response=await call('POST',`/api/admin/releases/${releaseId}/publish`,{setLatest:true});
    assert.equal(response.statusCode,200,response.body);
    assert.equal(json(response).release.isLatest,true);
    const detail=json(await call('GET',`/api/releases/${releaseId}`));
    assert.equal(detail.release.status,'published');assert.equal(detail.assets[0].sha256,sha256);
    const download=await app.inject({url:`/api/downloads/${assetId}`});
    assert.equal(download.statusCode,200);assert.deepEqual(download.rawPayload,bytes);
    assert.match(download.headers['content-disposition'],/attachment;/);
    assert.equal(download.headers['x-content-type-options'],'nosniff');
    assert.equal(json(await call('GET','/api/projects')).projects[0].latestVersion,'1.0.0');
  });
  await t.test('支持断点续传、HEAD 与非法范围，统计不累计后续片段',async()=>{
    const before=json(await call('GET','/api/admin/assets')).assets[0].downloadCount;
    const partial=await app.inject({url:`/api/downloads/${assetId}`,headers:{range:'bytes=2-8'}});
    assert.equal(partial.statusCode,206);assert.deepEqual(partial.rawPayload,bytes.subarray(2,9));
    assert.equal(partial.headers['content-range'],`bytes 2-8/${bytes.length}`);
    const suffix=await app.inject({url:`/api/downloads/${assetId}`,headers:{range:'bytes=-4'}});
    assert.equal(suffix.statusCode,206);assert.deepEqual(suffix.rawPayload,bytes.subarray(-4));
    const head=await app.inject({method:'HEAD',url:`/api/downloads/${assetId}`});
    assert.equal(head.statusCode,200);assert.equal(head.body,'');assert.equal(Number(head.headers['content-length']),bytes.length);
    const invalid=await app.inject({url:`/api/downloads/${assetId}`,headers:{range:'bytes=99999-'}});
    assert.equal(invalid.statusCode,416);
    const after=json(await call('GET','/api/admin/assets')).assets[0].downloadCount;
    assert.equal(after,before);
  });
  await t.test('已发布安装包不可覆盖或删除，项目隐藏立即阻止下载',async()=>{
    assert.equal((await call('PATCH',`/api/admin/releases/${releaseId}`,{title:'不能改写已发布版本'})).statusCode,409);
    assert.equal((await call('DELETE',`/api/admin/assets/${assetId}`)).statusCode,409);
    const file=multipart('another.exe',bytes);
    assert.equal((await call('POST',`/api/admin/releases/${releaseId}/assets?platform=Windows&arch=x64`,file.payload,file.headers)).statusCode,409);
    assert.equal((await call('PATCH',`/api/admin/projects/${projectId}`,{isPublic:false})).statusCode,200);
    assert.equal((await app.inject({url:`/api/downloads/${assetId}`})).statusCode,404);
    assert.equal((await app.inject({url:'/api/projects/test-orbit'})).statusCode,404);
    assert.equal((await app.inject({url:`/api/releases/${releaseId}`})).statusCode,404);
    assert.equal(json(await app.inject({url:'/api/releases'})).releases.length,0);
    assert.equal((await call('PATCH',`/api/admin/projects/${projectId}`,{isPublic:true})).statusCode,200);
  });
  await t.test('超限上传清理临时文件，草稿附件可改平台或移除',async()=>{
    const response=await call('POST','/api/admin/releases',{projectId,version:'1.1.0',title:'第二版',notes:'新功能',channel:'stable'});
    const second=json(response).release.id;
    const big=multipart('too-big.bin',Buffer.alloc(2048));
    assert.equal((await call('POST',`/api/admin/releases/${second}/assets?platform=Linux&arch=arm64`,big.payload,big.headers)).statusCode,413);
    assert.ok((await fs.readdir(path.join(dataDir,'uploads'))).every(name=>!name.endsWith('.part')));
    const good=multipart('portable.zip',bytes);
    const upload=await call('POST',`/api/admin/releases/${second}/assets?platform=Linux&arch=x64`,good.payload,good.headers);
    assert.equal(upload.statusCode,201,upload.body);const id=json(upload).asset.id;
    assert.equal((await call('PATCH',`/api/admin/assets/${id}`,{platform:'Linux',arch:'arm64'})).statusCode,200);
    assert.equal((await call('DELETE',`/api/admin/assets/${id}`)).statusCode,200);
    assert.equal((await call('GET',`/api/admin/assets/${id}/download`)).statusCode,404);
    assert.equal(json(await call('GET',`/api/admin/releases/${second}`)).assets.length,0);
  });
  await t.test('下架即时关闭文件链接，重新发布保留同一附件',async()=>{
    assert.equal((await call('POST',`/api/admin/releases/${releaseId}/withdraw`)).statusCode,200);
    assert.equal((await app.inject({url:`/api/downloads/${assetId}`})).statusCode,404);
    assert.equal((await app.inject({url:`/api/releases/${releaseId}`})).statusCode,404);
    assert.equal((await call('POST',`/api/admin/releases/${releaseId}/publish`,{setLatest:true})).statusCode,200);
    assert.equal((await app.inject({url:`/api/downloads/${assetId}`})).statusCode,200);
  });
  await t.test('站点设置与统计来自数据库，重启后仍保留',async()=>{
    const response=await call('PATCH','/api/admin/settings',{name:'测试发布中心',description:'真实持久化',announcement:'欢迎下载'});
    assert.equal(response.statusCode,200,response.body);
    const counts=json(await call('GET','/api/admin/overview')).counts;
    assert.equal(counts.projects,1);assert.equal(counts.releases,1);assert.equal(counts.drafts,1);assert.equal(counts.assets,1);
    await app.close();
    app=await buildApp({dataDir,adminKey:key,logger:false,loginRateLimit:100,maxUploadBytes:1024});
    assert.equal(json(await call('GET','/api/site')).site.name,'测试发布中心');
    assert.equal(json(await call('GET','/api/projects')).projects.length,1);
    assert.equal((await app.inject({url:`/api/downloads/${assetId}`})).statusCode,200);
  });
  await t.test('退出登录立即撤销会话，旧 Cookie 不能继续写入',async()=>{
    assert.equal((await call('POST','/api/logout')).statusCode,200);
    assert.equal(json(await call('GET','/api/session')).authenticated,false);
    assert.equal((await call('GET','/api/admin/projects')).statusCode,401);
  });
});

test('Range 与语义版本号边界验证',()=>{
  assert.deepEqual(parseRange('bytes=2-',10),{start:2,end:9});
  assert.deepEqual(parseRange('bytes=-100',10),{start:0,end:9});
  for(const value of ['bytes=-0','bytes=1-0','bytes=10-','bytes=0-1,3-4','items=0-2','bytes=999999999999999999999-'])assert.equal(parseRange(value,10),false);
  assert.equal(parseRange('bytes=0-',0),false);
  for(const value of ['1.0.0','0.1.2','2.3.0-beta.1','1.2.3+build.9'])assert.ok(validSemver(value));
  for(const value of ['01.0.0','1.0','1.2.3-01','1.2.3-beta..1','1.2.3-','<script>'])assert.equal(validSemver(value),false);
});

test('登录限流阻止连续猜测密钥',{timeout:10000},async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'releasedock-test-rate-'));
  const app=await buildApp({dataDir,adminKey:key,logger:false,loginRateLimit:2});
  t.after(async()=>{await app.close();const target=path.resolve(dataDir);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(target).startsWith('releasedock-test-'));await fs.rm(target,{recursive:true,force:true});});
  for(let i=0;i<2;i++)assert.equal((await app.inject({method:'POST',url:'/api/login',payload:{key:'incorrect'}})).statusCode,401);
  const response=await app.inject({method:'POST',url:'/api/login',payload:{key:'incorrect'}});
  assert.equal(response.statusCode,429);
  assert.equal(response.json().error.code,'RATE_LIMITED');
});

test('并发上传不能超过每版本 64 个附件',{timeout:10000},async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'releasedock-test-race-'));
  const app=await buildApp({dataDir,adminKey:key,logger:false});
  t.after(async()=>{await app.close();const target=path.resolve(dataDir);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(target).startsWith('releasedock-test-'));await fs.rm(target,{recursive:true,force:true});});
  const login=await app.inject({method:'POST',url:'/api/login',payload:{key}});
  const headers={cookie:login.headers['set-cookie'].split(';')[0],'x-csrf-token':login.json().csrfToken};
  const project=(await app.inject({method:'POST',url:'/api/admin/projects',headers,payload:{name:'并发边界测试',slug:'upload-race'}})).json().project;
  const release=(await app.inject({method:'POST',url:'/api/admin/releases',headers,payload:{projectId:project.id,version:'1.0.0',title:'并发测试',notes:'验证数量上限',channel:'stable'}})).json().release;
  // 预置边界数据，让两次真实上传竞争最后一个可用名额。
  const time=new Date().toISOString(),hash=createHash('sha256').update('x').digest('hex');
  const insert=app.db.prepare('INSERT INTO assets(id,release_id,filename,storage_name,content_type,size,platform,arch,sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
  for(let index=0;index<63;index++) {
    const id=randomUUID();
    await fs.writeFile(path.join(dataDir,'uploads',id),'x');
    insert.run(id,release.id,`fixture-${index}.zip`,id,'application/octet-stream',1,'Windows','x64',hash,time);
  }
  const results=await Promise.all(['first.zip','second.zip'].map(filename=>{
    const file=multipart(filename,Buffer.alloc(128));
    return app.inject({method:'POST',url:`/api/admin/releases/${release.id}/assets?platform=Windows&arch=x64`,headers:{...headers,...file.headers},payload:file.payload});
  }));
  assert.deepEqual(results.map(response=>response.statusCode).sort((a,b)=>a-b),[201,400]);
  assert.equal(results.find(response=>response.statusCode===400).json().error.code,'ASSET_LIMIT');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM assets WHERE release_id=?').get(release.id).n,64);
  assert.equal((await fs.readdir(path.join(dataDir,'uploads'))).length,64);
});
