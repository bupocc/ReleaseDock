import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash,randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { buildApp } from '../server/app.js';
import { parseRange } from '../server/files.js';
import { validVersion } from '../server/schemas.js';

import { bootstrapAdmin, createClient } from './helpers/passkeys.mjs';

function multipart(filename,content) {
  const boundary='----releasedock-integration-boundary';
  return {headers:{'content-type':`multipart/form-data; boundary=${boundary}`},payload:Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),Buffer.from(content),Buffer.from(`\r\n--${boundary}--\r\n`)])};
}

test('版本发布、管理鉴权与公开下载形成真实闭环',{timeout:55000},async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'releasedock-test-'));
  let app=await buildApp({dataDir,logger:false,loginRateLimit:100,maxUploadBytes:1024});
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
  await t.test('通行密钥绑定设置 HttpOnly 会话，旧文本密钥入口关闭',async()=>{
    assert.equal((await call('POST','/api/login',{key:'obsolete-key'})).statusCode,404);
    const {response,headers}=await bootstrapAdmin(app);
    assert.equal(response.statusCode,200,response.body);
    const cookieHeaders=[response.headers['set-cookie']].flat().join(';');
    assert.match(cookieHeaders,/HttpOnly/);
    assert.match(cookieHeaders,/SameSite=Strict/i);
    cookie=headers.cookie;csrf=headers['x-csrf-token'];
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
    assert.equal((await call('POST','/api/admin/releases',{...body,version:'1/0/0'})).statusCode,400);
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
  await t.test('已发布安装包可新增和删除，项目隐藏立即阻止下载',async()=>{
    assert.equal((await call('PATCH',`/api/admin/releases/${releaseId}`,{title:'已修正的正式版本标题'})).statusCode,200);
    assert.equal((await app.inject({url:`/api/releases/${releaseId}`})).json().release.title,'已修正的正式版本标题');
    const file=multipart('another.exe',bytes);
    const extra=await call('POST',`/api/admin/releases/${releaseId}/assets?platform=Windows&arch=x64`,file.payload,file.headers);
    assert.equal(extra.statusCode,201,extra.body);
    assert.equal((await call('DELETE',`/api/admin/assets/${extra.json().asset.id}`)).statusCode,200);
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
    app=await buildApp({dataDir,logger:false,loginRateLimit:100,maxUploadBytes:1024});
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

test('安装包改名保留文件身份、权限边界和持久化记录',{timeout:20000},async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'releasedock-test-rename-'));
  let app;
  t.after(async()=>{
    await app?.close();
    const target=path.resolve(dataDir),parent=path.resolve(os.tmpdir());
    assert.ok(target.startsWith(parent+path.sep)&&path.basename(target).startsWith('releasedock-test-rename-'));
    await fs.rm(target,{recursive:true,force:true});
  });
  const options={dataDir,logger:false,loginRateLimit:100,maxUploadBytes:1024};
  app=await buildApp(options);
  const {headers}=await bootstrapAdmin(app);
  const call=(method,url,payload,extraHeaders={})=>app.inject({method,url,payload,headers:{...headers,...extraHeaders}});
  const project=(await call('POST','/api/admin/projects',{name:'文件改名测试',slug:'asset-rename'})).json().project;
  const release=(await call('POST','/api/admin/releases',{projectId:project.id,version:'1.0.0',title:'安装包改名',notes:'验证下载名称与文件内容独立保存。',channel:'stable'})).json().release;
  const bytes=Buffer.concat([Buffer.from('ReleaseDock rename package\0'),Buffer.from([255,128,13,10])]);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const upload=async filename=>{
    const file=multipart(filename,bytes);
    const response=await call('POST',`/api/admin/releases/${release.id}/assets?platform=Windows&arch=x64`,file.payload,file.headers);
    assert.equal(response.statusCode,201,response.body);
    return response.json().asset;
  };
  const asset=await upload('original.zip'),other=await upload('existing.zip');
  const url=`/api/admin/assets/${asset.id}`,downloadUrl=`/api/downloads/${asset.id}`;
  const stored=()=>app.db.prepare('SELECT * FROM assets WHERE id=?').get(asset.id);
  const storedRelease=()=>app.db.prepare('SELECT * FROM releases WHERE id=?').get(release.id);
  const auditCount=()=>app.db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE target_id=?').get(asset.id).n;
  const fileIdentity=row=>({id:row.id,releaseId:row.release_id,storageName:row.storage_name,contentType:row.content_type,size:row.size,sha256:row.sha256,createdAt:row.created_at});
  const originalIdentity=fileIdentity(stored());
  const originalFiles=(await fs.readdir(path.join(dataDir,'uploads'))).sort();
  const assertName=(response,filename)=>{
    assert.match(response.headers['content-disposition'],/attachment;.*filename\*=UTF-8''/);
    assert.equal(decodeURIComponent(response.headers['content-disposition'].split("filename*=UTF-8''")[1]),filename);
  };
  let filename='中文安装包-1.0.0.zip';

  await t.test('改名接口检查登录与 CSRF，上传仍要求平台和架构',async()=>{
    for(const route of [url,`/%61pi/%61dmin/assets/${asset.id}`]) {
      assert.equal((await app.inject({method:'PATCH',url:route,payload:{filename}})).statusCode,401);
      assert.equal((await call('PATCH',route,{filename},{'x-csrf-token':''})).statusCode,403);
    }
    assert.equal((await call('PATCH',url,{filename},{origin:'https://attacker.example'})).statusCode,403);
    assert.equal((await call('PATCH','/api/admin/assets/missing',{filename})).statusCode,404);
    const file=multipart('missing-metadata.zip',bytes);
    for(const query of ['','?platform=Windows','?arch=x64'])assert.equal((await call('POST',`/api/admin/releases/${release.id}/assets${query}`,file.payload,file.headers)).statusCode,400);
    assert.equal(stored().filename,'original.zip');
    assert.deepEqual((await fs.readdir(path.join(dataDir,'uploads'))).sort(),originalFiles);
  });
  await t.test('草稿仅改名保留内容和文件 ID，并更新版本时间与审计',async()=>{
    // 固定旧时间，避免依赖机器时钟的毫秒精度断言。
    const previousTime='2000-01-01T00:00:00.000Z';
    app.db.prepare('UPDATE releases SET updated_at=? WHERE id=?').run(previousTime,release.id);
    const beforeAudit=auditCount();
    const response=await call('PATCH',url,{filename});
    assert.equal(response.statusCode,200,response.body);
    assert.deepEqual(response.json().asset,{...asset,filename});
    assert.deepEqual(fileIdentity(stored()),originalIdentity);
    assert.notEqual(storedRelease().updated_at,previousTime);
    assert.equal(auditCount(),beforeAudit+1);
    assert.equal(app.db.prepare('SELECT action FROM audit_log WHERE target_id=? ORDER BY id DESC LIMIT 1').get(asset.id).action,'asset.rename');
    const preview=await call('GET',`${url}/download`);
    assert.equal(preview.statusCode,200);assertName(preview,filename);assert.deepEqual(preview.rawPayload,bytes);
    assert.equal((await app.inject({url:downloadUrl})).statusCode,404);
    const beforeNoop=storedRelease().updated_at;
    assert.equal((await call('PATCH',url,{filename})).statusCode,200);
    assert.equal(auditCount(),beforeAudit+1);assert.equal(storedRelease().updated_at,beforeNoop);
  });
  await t.test('非法名称与同版本重名被拒绝，失败不部分修改数据',async()=>{
    const before=stored(),beforeRelease=storedRelease(),beforeAudit=auditCount();
    const invalid=['',' ','.','..','../evil.zip','..\\evil.zip','/tmp/evil.zip','C:\\temp\\evil.zip','bad:name.zip','bad?.zip','bad*.zip','bad|name.zip','bad<name>.zip','bad"name.zip','bad\0name.zip','bad\r\nname.zip','bad\u007fname.zip','bad\u0085name.zip','bad\u2028name.zip',' leading.zip','trailing.zip ','trailing.','CON','con.txt','NUL.zip','AUX','PRN.exe','COM1.zip','LPT9.zip','COM¹.zip','con .zip','CONIN$.zip','bad\ud800.zip','x'.repeat(181)];
    for(const invalidFilename of invalid) {
      const response=await call('PATCH',url,{filename:invalidFilename});
      assert.equal(response.statusCode,400,`非法名称应被拒绝：${JSON.stringify(invalidFilename)}，${response.body}`);
    }
    assert.equal((await call('PATCH',url,{})).statusCode,400);
    assert.equal((await call('PATCH',url,{filename,unexpected:true})).statusCode,400);
    const conflict=await call('PATCH',url,{filename:other.filename,platform:'Linux',arch:'arm64'});
    assert.equal(conflict.statusCode,409,conflict.body);
    assert.equal(conflict.json().error.code,'ASSET_FILENAME_CONFLICT');
    assert.match(conflict.json().error.message,/同名安装包/);
    assert.deepEqual(stored(),before);assert.deepEqual(storedRelease(),beforeRelease);assert.equal(auditCount(),beforeAudit);
  });
  await t.test('同版本并发改名只保留一个同名结果',async()=>{
    const responses=await Promise.all([asset.id,other.id].map(id=>call('PATCH',`/api/admin/assets/${id}`,{filename:'shared.zip'})));
    assert.deepEqual(responses.map(response=>response.statusCode).sort((a,b)=>a-b),[200,409]);
    assert.equal(responses.find(response=>response.statusCode===409).json().error.code,'ASSET_FILENAME_CONFLICT');
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM assets WHERE release_id=? AND filename=?').get(release.id,'shared.zip').n,1);
    assert.equal((await call('PATCH',url,{filename})).statusCode,200);
    assert.equal((await call('PATCH',`/api/admin/assets/${other.id}`,{filename:other.filename})).statusCode,200);
    assert.deepEqual(fileIdentity(stored()),originalIdentity);
  });
  await t.test('草稿平台和架构可以单独修改，未提交的字段保持不变',async()=>{
    const platform=await call('PATCH',url,{platform:'Linux'});
    assert.equal(platform.statusCode,200,platform.body);
    assert.equal(platform.json().asset.platform,'Linux');assert.equal(platform.json().asset.arch,'x64');assert.equal(platform.json().asset.filename,filename);
    const architecture=await call('PATCH',url,{arch:'arm64'});
    assert.equal(architecture.statusCode,200,architecture.body);
    assert.equal(architecture.json().asset.platform,'Linux');assert.equal(architecture.json().asset.arch,'arm64');assert.equal(architecture.json().asset.filename,filename);
    assert.deepEqual(fileIdentity(stored()),originalIdentity);
  });
  await t.test('正式版改名后旧链接、完整下载、HEAD 和 Range 使用新名称',async()=>{
    const published=await call('POST',`/api/admin/releases/${release.id}/publish`,{setLatest:true});
    assert.equal(published.statusCode,200,published.body);
    const beforeRelease=storedRelease();
    filename='ReleaseDock 安装包 (正式版).zip';
    const renamed=await call('PATCH',url,{filename});
    assert.equal(renamed.statusCode,200,renamed.body);
    const afterRelease=storedRelease();
    for(const field of ['status','is_latest','published_at','created_at'])assert.equal(afterRelease[field],beforeRelease[field]);
    const detail=await app.inject({url:`/api/releases/${release.id}`});
    assert.equal(detail.json().assets.find(item=>item.id===asset.id).filename,filename);
    const download=await app.inject({url:downloadUrl});
    assert.equal(download.statusCode,200);assertName(download,filename);assert.deepEqual(download.rawPayload,bytes);
    assert.equal(createHash('sha256').update(download.rawPayload).digest('hex'),sha256);
    assert.equal(download.headers.etag,`"${sha256}"`);
    const partial=await app.inject({url:downloadUrl,headers:{range:'bytes=2-8','if-range':`"${sha256}"`}});
    assert.equal(partial.statusCode,206);assertName(partial,filename);assert.deepEqual(partial.rawPayload,bytes.subarray(2,9));
    assert.equal(partial.headers['content-range'],`bytes 2-8/${bytes.length}`);
    const head=await app.inject({method:'HEAD',url:downloadUrl});
    assert.equal(head.statusCode,200);assertName(head,filename);assert.equal(head.body,'');assert.equal(Number(head.headers['content-length']),bytes.length);
    assert.deepEqual(fileIdentity(stored()),originalIdentity);
  });
  await t.test('正式版可修改平台和架构，重名失败不会部分修改字段',async()=>{
    const before=stored(),beforeRelease=storedRelease(),beforeAudit=auditCount();
    for(const metadata of [{platform:'Windows'},{arch:'x64'}]) {
      const response=await call('PATCH',url,{filename:other.filename,...metadata});
      assert.equal(response.statusCode,409,response.body);assert.equal(response.json().error.code,'ASSET_FILENAME_CONFLICT');
    }
    assert.deepEqual(stored(),before);assert.deepEqual(storedRelease(),beforeRelease);assert.equal(auditCount(),beforeAudit);
    filename='ReleaseDock 修订名称.zip';
    const sameMetadata=await call('PATCH',url,{filename,platform:'Windows',arch:'x64'});
    assert.equal(sameMetadata.statusCode,200,sameMetadata.body);assert.equal(sameMetadata.json().asset.filename,filename);
    assert.equal(sameMetadata.json().asset.platform,'Windows');assert.equal(sameMetadata.json().asset.arch,'x64');assert.deepEqual(fileIdentity(stored()),originalIdentity);
    const duplicate=await call('PATCH',url,{filename:other.filename});
    assert.equal(duplicate.statusCode,409,duplicate.body);assert.equal(stored().filename,filename);
  });
  await t.test('下架期间允许改名但不开放下载，重新发布沿用原链接',async()=>{
    assert.equal((await call('POST',`/api/admin/releases/${release.id}/withdraw`)).statusCode,200);
    filename='ReleaseDock 离线安装包.zip';
    const renamed=await call('PATCH',url,{filename});
    assert.equal(renamed.statusCode,200,renamed.body);assert.equal(storedRelease().status,'withdrawn');
    assert.equal((await app.inject({url:downloadUrl})).statusCode,404);
    assert.equal((await call('PATCH',url,{platform:'Linux'})).statusCode,200);
    const preview=await call('GET',`${url}/download`);
    assert.equal(preview.statusCode,200);assertName(preview,filename);assert.deepEqual(preview.rawPayload,bytes);
    assert.equal((await call('POST',`/api/admin/releases/${release.id}/publish`,{setLatest:true})).statusCode,200);
    const download=await app.inject({url:downloadUrl});
    assert.equal(download.statusCode,200);assertName(download,filename);assert.deepEqual(download.rawPayload,bytes);
  });
  await t.test('重启后文件名称、审计和原始存储内容仍然保留',async()=>{
    const before=stored(),beforeAudit=auditCount();
    await app.close();
    app=await buildApp(options);
    assert.equal((await call('GET','/api/session')).json().authenticated,true);
    assert.deepEqual(stored(),before);assert.equal(auditCount(),beforeAudit);
    assert.equal((await call('GET','/api/admin/assets')).json().assets.find(item=>item.id===asset.id).filename,filename);
    const download=await app.inject({url:downloadUrl});
    assert.equal(download.statusCode,200);assertName(download,filename);assert.deepEqual(download.rawPayload,bytes);
    assert.deepEqual(fileIdentity(stored()),originalIdentity);
    assert.deepEqual((await fs.readdir(path.join(dataDir,'uploads'))).sort(),originalFiles);
    assert.deepEqual(await fs.readFile(path.join(dataDir,'uploads',originalIdentity.storageName)),bytes);
  });
});

test('灵活版本号与正式版本编辑保持发布状态、文件身份和最新标记一致',{timeout:25000},async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'releasedock-test-edit-'));
  let app;
  t.after(async()=>{
    await app?.close();
    const target=path.resolve(dataDir),parent=path.resolve(os.tmpdir());
    assert.ok(target.startsWith(parent+path.sep)&&path.basename(target).startsWith('releasedock-test-edit-'));
    await fs.rm(target,{recursive:true,force:true});
  });
  const options={dataDir,logger:false,loginRateLimit:100,maxUploadBytes:1024};
  app=await buildApp(options);
  const {headers}=await bootstrapAdmin(app);
  const call=(method,url,payload,extraHeaders={})=>app.inject({method,url,payload,headers:{...headers,...extraHeaders}});
  const project=(await call('POST','/api/admin/projects',{name:'版本编辑测试',slug:'release-edit'})).json().project;
  const otherProject=(await call('POST','/api/admin/projects',{name:'独立项目',slug:'release-edit-other'})).json().project;
  const releases=new Map();
  const bytes=Buffer.concat([Buffer.from('ReleaseDock unchanged package'),Buffer.from([0,255,128])]);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  let main,older,newer,preview,draft,otherLatest,mainAsset,originalAsset,publishedAt;
  const releaseRow=id=>app.db.prepare('SELECT * FROM releases WHERE id=?').get(id);
  const latestIds=()=>app.db.prepare('SELECT id FROM releases WHERE project_id=? AND is_latest=1 ORDER BY id').all(project.id).map(row=>row.id);
  const snapshot=()=>({releases:app.db.prepare('SELECT * FROM releases ORDER BY id').all(),projects:app.db.prepare('SELECT * FROM projects ORDER BY id').all(),audits:app.db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n});
  const publish=async(id,setLatest)=>{
    const file=multipart('setup.zip',bytes);
    const upload=await call('POST',`/api/admin/releases/${id}/assets?platform=Windows&arch=x64`,file.payload,file.headers);
    assert.equal(upload.statusCode,201,upload.body);
    const response=await call('POST',`/api/admin/releases/${id}/publish`,{setLatest});
    assert.equal(response.statusCode,200,response.body);
    return upload.json().asset;
  };

  await t.test('四段、日期、短版本和标签均可创建，渠道按管理员选择保存',async()=>{
    for(const version of ['1.5.0.1','1.5','2026.09.11','v1.5.0.1','nightly','rc','release-2026_09+sha']) {
      const channel=version==='nightly'?'prerelease':'stable';
      const response=await call('POST','/api/admin/releases',{projectId:project.id,version,title:`版本 ${version}`,notes:'原始更新说明',channel});
      assert.equal(response.statusCode,201,`${version}: ${response.body}`);
      assert.equal(response.json().release.version,version);assert.equal(response.json().release.channel,channel);
      releases.set(version,response.json().release.id);
    }
    main=releases.get('1.5.0.1');older=releases.get('1.5');newer=releases.get('2026.09.11');preview=releases.get('nightly');draft=releases.get('v1.5.0.1');
    for(const version of ['','1.5\n','1/5','../1.5','<script>','版本1','x'.repeat(101)])assert.equal((await call('POST','/api/admin/releases',{projectId:project.id,version,title:'非法版本',notes:'说明',channel:'stable'})).statusCode,400);
    const duplicate=await call('POST','/api/admin/releases',{projectId:project.id,version:'1.5.0.1',title:'重复版本',channel:'stable'});
    assert.equal(duplicate.statusCode,409);
    const independent=await call('POST','/api/admin/releases',{projectId:otherProject.id,version:'1.5.0.1',title:'不同项目可复用版本号',notes:'独立说明',channel:'stable'});
    assert.equal(independent.statusCode,201,independent.body);otherLatest=independent.json().release.id;
  });
  await t.test('草稿可编辑且仍受登录、CSRF、编码路由与项目归属保护',async()=>{
    for(const route of [`/api/admin/releases/${draft}`,`/%61pi/%61dmin/releases/${draft}`]) {
      assert.equal((await app.inject({method:'PATCH',url:route,payload:{title:'未授权修改'}})).statusCode,401);
      assert.equal((await call('PATCH',route,{title:'无 CSRF'},{'x-csrf-token':''})).statusCode,403);
    }
    assert.equal((await call('PATCH',`/api/admin/releases/${draft}`,{projectId:otherProject.id})).statusCode,400);
    const response=await call('PATCH',`/api/admin/releases/${draft}`,{version:'build_2026.09+rev-1',title:'草稿已修改',notes:'',channel:'prerelease'});
    assert.equal(response.statusCode,200,response.body);
    assert.equal(response.json().release.status,'draft');assert.equal(response.json().release.publishedAt,null);assert.equal(response.json().release.isLatest,false);
    assert.equal(response.json().release.projectId,project.id);assert.equal(response.json().release.notes,'');
    const before=snapshot();
    assert.equal((await call('PATCH',`/api/admin/releases/${draft}`,{title:'不能部分保存',setLatest:true})).statusCode,400);
    assert.deepEqual(snapshot(),before);
    assert.equal((await app.inject({url:`/api/releases/${draft}`})).statusCode,404);
  });
  await t.test('正式版标题、日志和四段版本修改立即公开，不改变发布时间或附件',async()=>{
    await publish(older,true);await publish(newer,true);await publish(preview,false);mainAsset=await publish(main,true);await publish(otherLatest,true);
    // 明确候选版本的发布时间，验证回退不依赖版本字符串的排序。
    for(const [id,time] of [[older,'2001-01-01T00:00:00.000Z'],[newer,'2002-01-01T00:00:00.000Z'],[preview,'2003-01-01T00:00:00.000Z'],[main,'2004-01-01T00:00:00.000Z']])app.db.prepare('UPDATE releases SET published_at=? WHERE id=?').run(time,id);
    publishedAt=releaseRow(main).published_at;
    originalAsset=app.db.prepare('SELECT * FROM assets WHERE id=?').get(mainAsset.id);
    const beforeAudit=app.db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE target_id=?').get(main).n;
    const payload={version:'1.5.0.2',title:'  正式版修订标题  ',notes:'## 修订说明\n> 更正了文字\n\n[使用文档](https://example.com/docs)',channel:'stable'};
    const saved=await call('PATCH',`/api/admin/releases/${main}`,payload);
    assert.equal(saved.statusCode,200,saved.body);
    assert.equal(saved.json().release.title,'正式版修订标题');assert.equal(saved.json().release.version,'1.5.0.2');assert.equal(saved.json().release.notes,payload.notes);
    assert.equal(saved.json().release.status,'published');assert.equal(saved.json().release.publishedAt,publishedAt);assert.equal(saved.json().release.isLatest,true);
    assert.deepEqual(saved.json().assets,[mainAsset]);
    assert.equal(saved.json().project.updatedAt,saved.json().release.updatedAt);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE target_id=?').get(main).n,beforeAudit+1);
    assert.equal(app.db.prepare('SELECT action FROM audit_log WHERE target_id=? ORDER BY id DESC LIMIT 1').get(main).action,'release.update');
    const publicDetail=await app.inject({url:`/api/releases/${main}`});
    assert.equal(publicDetail.statusCode,200);assert.equal(publicDetail.json().release.notes,payload.notes);assert.equal(publicDetail.json().release.version,'1.5.0.2');
    const catalog=(await app.inject({url:'/api/projects'})).json().projects.find(item=>item.id===project.id);
    assert.equal(catalog.latestRelease.id,main);assert.equal(catalog.latestRelease.title,'正式版修订标题');
  });
  await t.test('非法内容、项目迁移与重名失败回滚全部元数据和最新标记',async()=>{
    const before=snapshot();
    const invalid=[{version:'1.5\n'},{version:'1/5'},{version:'x'.repeat(101)},{title:'   '},{notes:''},{notes:'\n  '},{channel:'prerelease',setLatest:true},{status:'draft'},{projectId:otherProject.id},{}];
    for(const payload of invalid)assert.equal((await call('PATCH',`/api/admin/releases/${main}`,payload)).statusCode,400,JSON.stringify(payload));
    assert.equal((await call('PATCH',`/api/admin/releases/${main}`,{version:releaseRow(older).version,title:'不能部分保存'})).statusCode,409);
    // 抢占最新标记后才遇到版本唯一约束，必须恢复原最新版本。
    const conflict=await call('PATCH',`/api/admin/releases/${older}`,{version:releaseRow(main).version,title:'不能抢走最新标记',setLatest:true});
    assert.equal(conflict.statusCode,409,conflict.body);
    assert.deepEqual(snapshot(),before);assert.deepEqual(latestIds(),[main]);
  });
  await t.test('修改渠道和最新设置时只回退同项目已发布稳定版',async()=>{
    let response=await call('PATCH',`/api/admin/releases/${main}`,{version:'1.5.0.2-rc',channel:'prerelease'});
    assert.equal(response.statusCode,200,response.body);assert.equal(response.json().release.isLatest,false);assert.deepEqual(latestIds(),[newer]);
    assert.equal(response.json().release.publishedAt,publishedAt);
    assert.equal((await app.inject({url:`/api/releases/${main}`})).json().release.channel,'prerelease');
    assert.equal((await call('PATCH',`/api/admin/releases/${older}`,{setLatest:true})).statusCode,200);assert.deepEqual(latestIds(),[older]);
    assert.equal((await call('PATCH',`/api/admin/releases/${main}`,{channel:'stable'})).statusCode,200);assert.deepEqual(latestIds(),[older]);
    assert.equal((await call('PATCH',`/api/admin/releases/${main}`,{setLatest:true})).statusCode,200);assert.deepEqual(latestIds(),[main]);
    assert.equal((await call('PATCH',`/api/admin/releases/${main}`,{setLatest:false})).statusCode,200);assert.deepEqual(latestIds(),[newer]);
    assert.equal((await call('PATCH',`/api/admin/releases/${main}`,{channel:'prerelease'})).statusCode,200);assert.deepEqual(latestIds(),[newer]);
    assert.equal((await call('PATCH',`/api/admin/releases/${newer}`,{channel:'prerelease'})).statusCode,200);assert.deepEqual(latestIds(),[older]);
    assert.equal((await call('PATCH',`/api/admin/releases/${older}`,{setLatest:false})).statusCode,200);assert.deepEqual(latestIds(),[]);
    assert.equal((await call('PATCH',`/api/admin/releases/${preview}`,{setLatest:true})).statusCode,400);
    response=await call('PATCH',`/api/admin/releases/${main}`,{channel:'stable',setLatest:true});
    assert.equal(response.statusCode,200,response.body);assert.deepEqual(latestIds(),[main]);
    const competing=await Promise.all([main,older].map(id=>call('PATCH',`/api/admin/releases/${id}`,{setLatest:true})));
    assert.deepEqual(competing.map(item=>item.statusCode),[200,200]);assert.equal(latestIds().length,1);
    assert.equal((await call('PATCH',`/api/admin/releases/${main}`,{setLatest:true})).statusCode,200);
    assert.equal(releaseRow(otherLatest).is_latest,1);assert.equal(releaseRow(main).published_at,publishedAt);
  });
  await t.test('仅编辑版本信息不改变原下载 ID、字节和 SHA-256',async()=>{
    const file=multipart('replacement.zip',bytes);
    const extra=await call('POST',`/api/admin/releases/${main}/assets?platform=Windows&arch=x64`,file.payload,file.headers);
    assert.equal(extra.statusCode,201,extra.body);
    assert.equal((await call('DELETE',`/api/admin/assets/${extra.json().asset.id}`)).statusCode,200);
    assert.deepEqual(app.db.prepare('SELECT * FROM assets WHERE id=?').get(mainAsset.id),originalAsset);
    const download=await app.inject({url:`/api/downloads/${mainAsset.id}`});
    assert.equal(download.statusCode,200);assert.deepEqual(download.rawPayload,bytes);assert.equal(download.headers.etag,`"${sha256}"`);
    assert.equal(createHash('sha256').update(download.rawPayload).digest('hex'),sha256);
    const partial=await app.inject({url:`/api/downloads/${mainAsset.id}`,headers:{range:'bytes=3-9'}});
    assert.equal(partial.statusCode,206);assert.deepEqual(partial.rawPayload,bytes.subarray(3,10));
    assert.deepEqual(await fs.readFile(path.join(dataDir,'uploads',originalAsset.storage_name)),bytes);
  });
  await t.test('已下架版本可修改，保存不会重新发布或打开下载',async()=>{
    assert.equal((await call('POST',`/api/admin/releases/${main}/withdraw`)).statusCode,200);
    const saved=await call('PATCH',`/api/admin/releases/${main}`,{version:'2026.09.12',title:'下架期间修订',notes:'暂不公开的修订说明',channel:'prerelease',setLatest:false});
    assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().release.status,'withdrawn');assert.equal(saved.json().release.publishedAt,publishedAt);assert.equal(saved.json().release.isLatest,false);
    assert.equal((await app.inject({url:`/api/releases/${main}`})).statusCode,404);assert.equal((await app.inject({url:`/api/downloads/${mainAsset.id}`})).statusCode,404);
    const catalog=(await app.inject({url:'/api/projects'})).json().projects.find(item=>item.id===project.id);
    assert.notEqual(catalog.latestRelease.id,main);
    const before=snapshot();
    assert.equal((await call('PATCH',`/api/admin/releases/${main}`,{title:'不能部分保存',channel:'stable',setLatest:true})).statusCode,400);
    assert.deepEqual(snapshot(),before);
    assert.equal((await call('GET',`/api/admin/assets/${mainAsset.id}/download`)).statusCode,200);
  });
  await t.test('重启后修订内容、下架状态与附件仍保留',async()=>{
    const before=releaseRow(main);
    await app.close();app=await buildApp(options);
    assert.deepEqual(releaseRow(main),before);
    const response=await call('GET',`/api/admin/releases/${main}`);
    assert.equal(response.statusCode,200);assert.equal(response.json().release.version,'2026.09.12');assert.equal(response.json().release.notes,'暂不公开的修订说明');
    assert.equal(response.json().assets[0].id,mainAsset.id);assert.equal(response.json().assets[0].sha256,sha256);
    assert.equal((await app.inject({url:`/api/releases/${main}`})).statusCode,404);
    assert.deepEqual((await call('GET',`/api/admin/assets/${mainAsset.id}/download`)).rawPayload,bytes);
  });
});

test('管理员可在发布和下架后管理附件，内容替换失败或并发时保留有效文件',{timeout:30000},async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'releasedock-test-content-'));
  const pending=new Set();
  let app;
  t.after(async()=>{
    for(const request of pending)request.finish();
    await Promise.allSettled([...pending].map(request=>request.response));
    await app?.close();
    const target=path.resolve(dataDir),parent=path.resolve(os.tmpdir());
    assert.ok(target.startsWith(parent+path.sep)&&path.basename(target).startsWith('releasedock-test-content-'));
    await fs.rm(target,{recursive:true,force:true});
  });
  const options={dataDir,logger:false,loginRateLimit:100,maxUploadBytes:512};
  app=await buildApp(options);
  const {headers}=await bootstrapAdmin(app);
  const call=(method,url,payload,extraHeaders={})=>app.inject({method,url,payload,headers:{...headers,...extraHeaders}});
  const project=(await call('POST','/api/admin/projects',{name:'安装包内容管理',slug:'asset-content'})).json().project;
  const release=(await call('POST','/api/admin/releases',{projectId:project.id,version:'1.5.0.1',title:'可维护的版本附件',notes:'验证附件替换、并发和公开权限。',channel:'stable'})).json().release;
  const upload=async(filename,bytes)=>{
    const file=multipart(filename,bytes);
    const response=await call('POST',`/api/admin/releases/${release.id}/assets?platform=Windows&arch=x64`,file.payload,file.headers);
    assert.equal(response.statusCode,201,response.body);
    return response.json().asset;
  };
  const replace=(id,filename,bytes,query='?platform=Linux&arch=arm64')=>{
    const file=multipart(filename,bytes);
    return call('PUT',`/api/admin/assets/${id}/content${query}`,file.payload,file.headers);
  };
  const originalBytes=Buffer.from('original software package\0\xff');
  let expectedBytes=originalBytes;
  const original=await upload('original.zip',originalBytes),sibling=await upload('occupied.zip',originalBytes);
  assert.equal((await call('POST',`/api/admin/releases/${release.id}/publish`,{setLatest:true})).statusCode,200);
  const stored=(id=original.id)=>app.db.prepare('SELECT * FROM assets WHERE id=?').get(id);
  const publication=()=>{
    const row=app.db.prepare('SELECT status,published_at,is_latest FROM releases WHERE id=?').get(release.id);
    return {...row};
  };
  const snapshot=async()=>({assets:app.db.prepare('SELECT * FROM assets ORDER BY id').all(),release:app.db.prepare('SELECT * FROM releases WHERE id=?').get(release.id),project:app.db.prepare('SELECT * FROM projects WHERE id=?').get(project.id),audits:app.db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n,files:(await fs.readdir(path.join(dataDir,'uploads'))).sort()});
  const assertClean=async()=>assert.deepEqual((await fs.readdir(path.join(dataDir,'uploads'))).sort(),app.db.prepare('SELECT storage_name FROM assets ORDER BY storage_name').all().map(row=>row.storage_name));
  const startUpload=(id,filename,bytes)=>{
    const file=multipart(filename,bytes),stream=new PassThrough();
    const ending=Buffer.from('\r\n------releasedock-integration-boundary--\r\n');
    const request={finish:()=>{if(!stream.writableEnded)stream.end(ending);}};
    request.response=call('PUT',`/api/admin/assets/${id}/content?platform=Linux&arch=x64`,stream,file.headers).then(response=>{pending.delete(request);return response;});
    pending.add(request);
    stream.write(file.payload.subarray(0,file.payload.length-ending.length));
    return request;
  };
  const waitForUploads=async count=>{
    const deadline=Date.now()+3000;
    while(Date.now()<deadline) {
      if((await fs.readdir(path.join(dataDir,'uploads'))).filter(name=>name.endsWith('.part')).length>=count)return;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.fail('等待可控上传进入临时文件阶段超时');
  };

  await t.test('替换接口继续检查匿名、编码路径、CSRF 和平台必填字段',async()=>{
    const file=multipart('new.zip',Buffer.from('replacement'));
    const before=await snapshot();
    for(const route of [`/api/admin/assets/${original.id}/content`,`/%61pi/%61dmin/assets/${original.id}/content`]) {
      assert.equal((await app.inject({method:'PUT',url:`${route}?platform=Linux&arch=x64`,payload:file.payload,headers:file.headers})).statusCode,401);
      assert.equal((await call('PUT',`${route}?platform=Linux&arch=x64`,file.payload,{...file.headers,'x-csrf-token':''})).statusCode,403);
    }
    assert.equal((await call('PUT',`/api/admin/assets/${original.id}/content?platform=Linux&arch=x64`,file.payload,{...file.headers,origin:'https://attacker.example'})).statusCode,403);
    for(const query of ['','?platform=Linux','?arch=x64'])assert.equal((await replace(original.id,'new.zip',expectedBytes,query)).statusCode,400);
    assert.equal((await replace('missing','new.zip',expectedBytes)).statusCode,404);
    assert.deepEqual(await snapshot(),before);
  });
  await t.test('已发布版本可新增、改名、修改平台架构和删除附件',async()=>{
    const before=publication(),added=await upload('additional.zip',Buffer.from('additional binary'));
    assert.equal((await app.inject({url:`/api/downloads/${added.id}`})).statusCode,200);
    const edited=await call('PATCH',`/api/admin/assets/${added.id}`,{filename:'附加安装包.zip',platform:'macOS',arch:'universal'});
    assert.equal(edited.statusCode,200,edited.body);assert.equal(edited.json().asset.platform,'macOS');assert.equal(edited.json().asset.arch,'universal');
    const detail=(await app.inject({url:`/api/releases/${release.id}`})).json();
    assert.equal(detail.assets.find(asset=>asset.id===added.id).filename,'附加安装包.zip');
    assert.equal((await call('DELETE',`/api/admin/assets/${added.id}`)).statusCode,200);
    assert.equal((await app.inject({url:`/api/downloads/${added.id}`})).statusCode,404);assert.equal(stored(added.id),undefined);
    assert.deepEqual(publication(),before);await assertClean();
  });
  await t.test('已发布附件流式替换后原链接返回新名称、字节和校验值',async()=>{
    const before=stored(),beforePublication=publication();
    expectedBytes=Buffer.from('updated software package with new bytes\0\xfe');
    const response=await replace(original.id,'updated.tar.gz',expectedBytes,'?platform=macOS&arch=universal');
    assert.equal(response.statusCode,200,response.body);
    const asset=response.json().asset,hash=createHash('sha256').update(expectedBytes).digest('hex');
    assert.equal(asset.id,original.id);assert.equal(asset.releaseId,release.id);assert.equal(asset.createdAt,original.createdAt);assert.equal(asset.downloadCount,before.download_count);
    assert.equal(asset.filename,'updated.tar.gz');assert.equal(asset.platform,'macOS');assert.equal(asset.arch,'universal');assert.equal(asset.size,expectedBytes.length);assert.equal(asset.sha256,hash);
    assert.notEqual(stored().storage_name,before.storage_name);
    await assert.rejects(fs.access(path.join(dataDir,'uploads',before.storage_name)),{code:'ENOENT'});
    assert.deepEqual(await fs.readFile(path.join(dataDir,'uploads',stored().storage_name)),expectedBytes);
    const download=await app.inject({url:`/api/downloads/${original.id}`});
    assert.equal(download.statusCode,200);assert.deepEqual(download.rawPayload,expectedBytes);assert.equal(download.headers.etag,`"${hash}"`);assert.match(download.headers['content-disposition'],/updated.tar.gz/);
    const changedRange=await app.inject({url:`/api/downloads/${original.id}`,headers:{range:'bytes=2-6','if-range':`"${before.sha256}"`}});
    assert.equal(changedRange.statusCode,200);assert.deepEqual(changedRange.rawPayload,expectedBytes);
    const partial=await app.inject({url:`/api/downloads/${original.id}`,headers:{range:'bytes=2-6','if-range':`"${hash}"`}});
    assert.equal(partial.statusCode,206);assert.deepEqual(partial.rawPayload,expectedBytes.subarray(2,7));
    assert.equal(app.db.prepare('SELECT action FROM audit_log WHERE target_id=? ORDER BY id DESC LIMIT 1').get(original.id).action,'asset.replace');
    assert.deepEqual(publication(),beforePublication);await assertClean();
  });
  await t.test('超限、空文件、非法名称和重名均保留原文件及全部元数据',async()=>{
    const before=await snapshot();
    for(const [filename,bytes,status] of [['too-large.zip',Buffer.alloc(1024),413],['empty.zip',Buffer.alloc(0),400],['CON.zip',expectedBytes,400],['occupied.zip',expectedBytes,409]]) {
      const response=await replace(original.id,filename,bytes);
      assert.equal(response.statusCode,status,response.body);
      assert.deepEqual(await snapshot(),before);
    }
    assert.deepEqual((await app.inject({url:`/api/downloads/${original.id}`})).rawPayload,expectedBytes);await assertClean();
  });
  await t.test('新文件落盘后的数据库失败回滚到原下载',async fault=>{
    const before=await snapshot(),prepare=app.db.prepare.bind(app.db);
    const stub=fault.mock.method(app.db,'prepare',sql=>{
      if(/^UPDATE assets SET/.test(sql)&&sql.includes('storage_name='))return {run(){throw new Error('隔离测试：数据库写入失败');}};
      return prepare(sql);
    });
    try {
      const response=await replace(original.id,'database-failure.zip',Buffer.from('must not become active'));
      assert.equal(response.statusCode,500,response.body);
    }finally{stub.mock.restore();}
    assert.deepEqual(await snapshot(),before);
    assert.deepEqual((await app.inject({url:`/api/downloads/${original.id}`})).rawPayload,expectedBytes);await assertClean();
  });
  await t.test('上传期间元数据被修改时拒绝覆盖，保留已保存的修改',async()=>{
    const before=stored(),uploading=startUpload(original.id,'stale-upload.zip',Buffer.from('stale upload'));
    try {
      await waitForUploads(1);
      const edit=await call('PATCH',`/api/admin/assets/${original.id}`,{filename:'concurrent-edit.zip',platform:'Windows',arch:'x86'});
      assert.equal(edit.statusCode,200,edit.body);
    }finally{uploading.finish();}
    const response=await uploading.response;
    assert.equal(response.statusCode,409,response.body);assert.equal(response.json().error.code,'ASSET_CHANGED');
    assert.equal(stored().filename,'concurrent-edit.zip');assert.equal(stored().platform,'Windows');assert.equal(stored().arch,'x86');assert.equal(stored().storage_name,before.storage_name);assert.equal(stored().sha256,before.sha256);
    assert.deepEqual((await app.inject({url:`/api/downloads/${original.id}`})).rawPayload,expectedBytes);await assertClean();
  });
  await t.test('两个并发替换只能有一个提交成功，失败请求不遗留文件',async()=>{
    const choices=[{filename:'winner-a.zip',bytes:Buffer.from('candidate a')},{filename:'winner-b.zip',bytes:Buffer.from('candidate b with different content')}];
    const uploads=choices.map(choice=>startUpload(original.id,choice.filename,choice.bytes));
    try{await waitForUploads(2);}finally{uploads.forEach(uploading=>uploading.finish());}
    const responses=await Promise.all(uploads.map(uploading=>uploading.response));
    assert.deepEqual(responses.map(response=>response.statusCode).sort((a,b)=>a-b),[200,409]);
    const winner=responses.findIndex(response=>response.statusCode===200);
    assert.equal(responses[1-winner].json().error.code,'ASSET_CHANGED');
    expectedBytes=choices[winner].bytes;
    assert.equal(stored().filename,choices[winner].filename);assert.equal(stored().sha256,createHash('sha256').update(expectedBytes).digest('hex'));
    assert.deepEqual((await app.inject({url:`/api/downloads/${original.id}`})).rawPayload,expectedBytes);await assertClean();
  });
  await t.test('上传期间删除目标不会被上传请求恢复',async()=>{
    const extra=await upload('delete-during-upload.zip',Buffer.from('temporary package'));
    const uploading=startUpload(extra.id,'deleted-replacement.zip',Buffer.from('must not be restored'));
    try {
      await waitForUploads(1);
      assert.equal((await call('DELETE',`/api/admin/assets/${extra.id}`)).statusCode,200);
    }finally{uploading.finish();}
    const response=await uploading.response;
    assert.equal(response.statusCode,404,response.body);assert.equal(stored(extra.id),undefined);
    assert.equal((await app.inject({url:`/api/downloads/${extra.id}`})).statusCode,404);await assertClean();
  });
  await t.test('上传期间下架版本后，替换成功也不会重新开放下载',async()=>{
    const previous=publication();
    expectedBytes=Buffer.from('updated while release was withdrawn');
    const uploading=startUpload(original.id,'withdrawn-main.zip',expectedBytes);
    try {
      await waitForUploads(1);
      assert.equal((await call('POST',`/api/admin/releases/${release.id}/withdraw`)).statusCode,200);
    }finally{uploading.finish();}
    const response=await uploading.response;
    assert.equal(response.statusCode,200,response.body);assert.equal(publication().status,'withdrawn');assert.equal(publication().published_at,previous.published_at);
    assert.equal((await app.inject({url:`/api/downloads/${original.id}`})).statusCode,404);
    assert.deepEqual((await call('GET',`/api/admin/assets/${original.id}/download`)).rawPayload,expectedBytes);await assertClean();
  });
  await t.test('下架版本仍可增删改和替换附件，匿名始终不可访问',async()=>{
    const before=publication(),extra=await upload('withdrawn-extra.zip',Buffer.from('private first bytes'));
    assert.equal((await call('PATCH',`/api/admin/assets/${extra.id}`,{filename:'withdrawn-metadata.zip',platform:'Linux',arch:'arm64'})).statusCode,200);
    const bytes=Buffer.from('private replacement content'),response=await replace(extra.id,'withdrawn-replaced.zip',bytes);
    assert.equal(response.statusCode,200,response.body);assert.equal(response.json().asset.id,extra.id);
    assert.equal((await app.inject({url:`/api/downloads/${extra.id}`})).statusCode,404);
    assert.deepEqual((await call('GET',`/api/admin/assets/${extra.id}/download`)).rawPayload,bytes);
    assert.equal((await call('DELETE',`/api/admin/assets/${extra.id}`)).statusCode,200);
    assert.equal((await call('GET',`/api/admin/assets/${extra.id}/download`)).statusCode,404);
    assert.deepEqual(publication(),before);await assertClean();
  });
  await t.test('隐藏项目替换附件不会公开，恢复可见性与重启后使用新内容',async()=>{
    assert.equal((await call('POST',`/api/admin/releases/${release.id}/publish`,{setLatest:true})).statusCode,200);
    assert.equal((await call('PATCH',`/api/admin/projects/${project.id}`,{isPublic:false})).statusCode,200);
    const before=publication();
    expectedBytes=Buffer.from('persistent replacement in hidden project');
    assert.equal((await replace(original.id,'persistent.zip',expectedBytes)).statusCode,200);
    assert.equal((await app.inject({url:`/api/downloads/${original.id}`})).statusCode,404);assert.deepEqual(publication(),before);
    assert.equal((await call('PATCH',`/api/admin/projects/${project.id}`,{isPublic:true})).statusCode,200);
    const asset=stored();
    await app.close();app=await buildApp(options);
    assert.deepEqual(stored(),asset);assert.deepEqual(publication(),before);
    const download=await app.inject({url:`/api/downloads/${original.id}`});
    assert.equal(download.statusCode,200);assert.deepEqual(download.rawPayload,expectedBytes);assert.equal(download.headers.etag,`"${asset.sha256}"`);await assertClean();
  });
  await t.test('删除最后一个附件只移除下载，不改变版本发布状态',async()=>{
    const before=publication();
    assert.equal((await call('DELETE',`/api/admin/assets/${sibling.id}`)).statusCode,200);
    assert.equal((await call('DELETE',`/api/admin/assets/${original.id}`)).statusCode,200);
    assert.deepEqual(publication(),before);
    const detail=await app.inject({url:`/api/releases/${release.id}`});
    assert.equal(detail.statusCode,200);assert.deepEqual(detail.json().assets,[]);
    assert.equal((await app.inject({url:`/api/downloads/${original.id}`})).statusCode,404);await assertClean();
  });
});

test('公开项目目录独立查找最新已发布版本并仅携带有限日志摘要',{timeout:10000},async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'releasedock-test-catalog-'));
  const app=await buildApp({dataDir,logger:false});
  t.after(async()=>{
    await app.close();
    const target=path.resolve(dataDir),parent=path.resolve(os.tmpdir());
    assert.ok(target.startsWith(parent+path.sep)&&path.basename(target).startsWith('releasedock-test-catalog-'));
    await fs.rm(target,{recursive:true,force:true});
  });
  const projectInsert=app.db.prepare('INSERT INTO projects(id,slug,name,is_public,created_at,updated_at) VALUES(?,?,?,?,?,?)');
  const releaseInsert=app.db.prepare('INSERT INTO releases(id,project_id,version,title,notes,channel,status,is_latest,published_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  const time='2026-01-01T00:00:00.000Z';
  for(const [id,visible] of [['old-project',1],['busy-project',1],['empty-project',1],['private-project',0]])projectInsert.run(id,id,id,visible,time,time);
  const insert=(id,projectId,version,{status='published',channel='stable',notes='简短说明',publishedAt=time,createdAt=time,latest=0}={})=>releaseInsert.run(id,projectId,version,`标题 ${version}`,notes,channel,status,latest,status==='draft'?null:publishedAt,createdAt,time);
  const fullNotes=`## 较早发布项目的更新日志\n> ${'中文说明'.repeat(400)}`;
  const oldTime='2025-01-01T00:00:00.000Z';
  insert('catalog-z-old','old-project','old',{publishedAt:oldTime,createdAt:'2024-01-01T00:00:00.000Z'});
  insert('catalog-tie-a','old-project','1.5',{publishedAt:oldTime,createdAt:oldTime});
  insert('catalog-tie-b','old-project','1.5.0.1',{publishedAt:oldTime,createdAt:oldTime,notes:fullNotes});
  insert('old-draft','old-project','future-draft',{status:'draft'});
  insert('old-withdrawn','old-project','future-withdrawn',{status:'withdrawn',publishedAt:'2099-01-01T00:00:00.000Z'});
  // 另一个项目有超过 100 次更新，不能让较早发布的项目丢失轮播版本。
  for(let index=0;index<106;index++)insert(`busy-${index}`,'busy-project',`nightly-${index}`,{publishedAt:new Date(Date.UTC(2026,8,1,0,0,index)).toISOString(),channel:index===105?'prerelease':'stable',latest:index===0?1:0});
  insert('empty-draft','empty-project','draft-only',{status:'draft'});
  insert('private-published','private-project','hidden',{publishedAt:'2099-01-01T00:00:00.000Z'});
  const response=await app.inject({url:'/api/projects'});
  assert.equal(response.statusCode,200,response.body);
  const projects=response.json().projects;
  assert.equal(projects.length,3);assert.ok(projects.every(project=>project.id!=='private-project'));
  const old=projects.find(project=>project.id==='old-project');
  assert.deepEqual(old.latestRelease,{id:'catalog-tie-b',version:'1.5.0.1',title:'标题 1.5.0.1',notes:Array.from(fullNotes).slice(0,1000).join(''),channel:'stable',publishedAt:oldTime,notesTruncated:true});
  const busy=projects.find(project=>project.id==='busy-project');
  assert.equal(busy.latestRelease.id,'busy-105');assert.equal(busy.latestRelease.channel,'prerelease');assert.equal(busy.latestRelease.notesTruncated,false);assert.equal(busy.latestVersion,'nightly-0');
  assert.equal(projects.find(project=>project.id==='empty-project').latestRelease,null);
  const recent=(await app.inject({url:'/api/releases?limit=100'})).json().releases;
  assert.equal(recent.length,100);assert.ok(recent.every(release=>release.projectId==='busy-project'));
  for(const id of ['old-draft','old-withdrawn','empty-draft','private-published'])assert.equal((await app.inject({url:`/api/releases/${id}`})).statusCode,404);
  assert.equal((await app.inject({url:'/api/releases/catalog-tie-b'})).json().release.notes,fullNotes);
});

test('Range 与灵活版本号边界验证',()=>{
  assert.deepEqual(parseRange('bytes=2-',10),{start:2,end:9});
  assert.deepEqual(parseRange('bytes=-100',10),{start:0,end:9});
  for(const value of ['bytes=-0','bytes=1-0','bytes=10-','bytes=0-1,3-4','items=0-2','bytes=999999999999999999999-'])assert.equal(parseRange(value,10),false);
  assert.equal(parseRange('bytes=0-',0),false);
  for(const value of ['1.0.0','0.1.2','2.3.0-beta.1','1.2.3+build.9','1.5.0.1','1.5','2026.09.11','v1.5.0.1','nightly','rc','release-2026_09+sha','01.0.0','1.2.3-01','1.2.3-beta..1','1.2.3-','a'.repeat(100)])assert.ok(validVersion(value),value);
  for(const value of ['',null,undefined,123,' 1.5','1.5 ','1.5\n','1.5\r\n','1.5\r','nightly/rc','1\\2','版本1','<script>','.1.5','-rc','_nightly','+build','1.5\0','1 5','1:5','x'.repeat(101)])assert.equal(validVersion(value),false,JSON.stringify(value));
});

test('通行密钥验证入口限制连续请求',{timeout:10000},async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'releasedock-test-rate-'));
  const app=await buildApp({dataDir,logger:false,loginRateLimit:2});
  t.after(async()=>{await app.close();const target=path.resolve(dataDir);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(target).startsWith('releasedock-test-'));await fs.rm(target,{recursive:true,force:true});});
  const client=createClient(app);
  for(let i=0;i<2;i++)assert.equal((await client.request('POST','/api/auth/login/options',{})).statusCode,409);
  const response=await client.request('POST','/api/auth/login/options',{});
  assert.equal(response.statusCode,429);
  assert.equal(response.json().error.code,'RATE_LIMITED');
});

test('并发上传不能超过每版本 64 个附件',{timeout:10000},async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'releasedock-test-race-'));
  const app=await buildApp({dataDir,logger:false});
  t.after(async()=>{await app.close();const target=path.resolve(dataDir);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(target).startsWith('releasedock-test-'));await fs.rm(target,{recursive:true,force:true});});
  const {headers}=await bootstrapAdmin(app);
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
