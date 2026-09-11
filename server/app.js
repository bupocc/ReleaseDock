import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { loadConfig } from './config.js';
import { openDatabase,transaction,audit } from './db.js';
import { registerAuth } from './auth.js';
import { registerFiles } from './files.js';
import { projectJson,releaseJson,assetJson,releaseDetail,siteJson,apiError } from './store.js';
import { projectSchema,projectPatchSchema,releaseSchema,releasePatchSchema,siteSchema,objectSchema,validateWebsite,validVersion } from './schemas.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const now=()=>new Date().toISOString();

export async function buildApp(options={}) {
  const config=loadConfig(options);
  // Fastify 已停用仅按数字跳数信任代理的方式，必须验证直接连接来源的地址。
  const trustProxy=config.trustProxy?config.trustedProxyCidrs:false;
  const app=Fastify({logger:config.logger?{level:'info',redact:['req.headers.cookie','req.headers.authorization','req.headers.x-csrf-token','req.body.token','req.body.response','res.headers.set-cookie']}:false,trustProxy,bodyLimit:200000,requestTimeout:300000,ajv:{customOptions:{removeAdditional:false}}});
  const db=openDatabase(config.dataDir);
  app.decorate('db',db);
  app.decorate('appConfig',config);
  app.addHook('onClose',async()=>db.close());
  app.addHook('onSend',async(request,reply,payload)=>{
    reply.header('X-Content-Type-Options','nosniff');
    reply.header('X-Frame-Options','DENY');
    reply.header('Referrer-Policy','same-origin');
    reply.header('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    reply.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");
    if(request.url.startsWith('/api/'))reply.header('Cache-Control','no-store');
    return payload;
  });
  app.setErrorHandler((error,request,reply)=>{
    let status=error.statusCode||500;
    let code=error.apiCode||'INTERNAL_ERROR';
    let message=error.apiCode?error.message:'服务暂时不可用，请稍后重试';
    if(error.validation){status=400;code='VALIDATION_ERROR';message='填写内容不符合要求，请检查必填字段、长度和格式';}
    else if(/UNIQUE constraint failed/.test(error.message)){status=409;code='CONFLICT';message='项目标识、版本号或文件名已存在，请使用不同的名称';}
    else if(status===413||error.code==='FST_REQ_FILE_TOO_LARGE'){status=413;code='FILE_TOO_LARGE';message='文件或请求超过大小限制';}
    else if(status===429){code='RATE_LIMITED';message='请求过于频繁，请稍后再试';}
    else if(status===400&&!error.apiCode){code='BAD_REQUEST';message='请求格式不正确';}
    if(status>=500)request.log.error({err:error},'请求处理失败');
    reply.code(status).send({error:{code,message}});
  });
  app.setNotFoundHandler((request,reply)=>reply.code(404).send({error:{code:'NOT_FOUND',message:'内容不存在或尚未公开'}}));
  await registerAuth(app,db,config);
  await app.register(multipart,{limits:{fileSize:config.maxUploadBytes,files:1,fields:8,parts:10,fieldSize:4096},throwFileSizeLimit:true});

  const requireProject=(id)=>{
    const row=db.prepare('SELECT * FROM projects WHERE id=?').get(id);
    if(!row)throw apiError(404,'PROJECT_NOT_FOUND','项目不存在');
    return row;
  };
  const requireRelease=(id)=>{
    const row=db.prepare('SELECT * FROM releases WHERE id=?').get(id);
    if(!row)throw apiError(404,'RELEASE_NOT_FOUND','版本不存在');
    return row;
  };
  const getPublicProject=slug=>{
    const row=db.prepare('SELECT * FROM projects WHERE slug=? AND is_public=1').get(slug);
    if(!row)throw apiError(404,'NOT_FOUND','项目不存在或尚未公开');
    return row;
  };
  const getPublicVersion=(slug,version)=>{
    const project=getPublicProject(slug);
    if(!validVersion(version))throw apiError(404,'NOT_FOUND','版本不存在或尚未公开');
    // 精确匹配保存的版本号，改名或下架后不会误指向另一个带 v 或不带 v 的版本。
    const row=db.prepare('SELECT * FROM releases WHERE project_id=? AND version=?').get(project.id,version);
    if(!row||row.status!=='published')throw apiError(404,'NOT_FOUND','版本不存在或尚未公开');
    return {project,release:row};
  };

  app.get('/healthz',async()=>({ok:db.prepare('SELECT 1 AS ok').get().ok===1}));
  app.get('/api/site',async()=>({site:siteJson(db)}));
  app.get('/api/projects',async()=>{
    const rows=db.prepare(`
      SELECT p.*,r.id AS latest_release_id,r.version AS latest_release_version,
        r.title AS latest_release_title,substr(r.notes,1,1000) AS latest_release_notes,
        length(r.notes)>1000 AS latest_release_notes_truncated,
        r.channel AS latest_release_channel,r.published_at AS latest_release_published_at
      FROM projects p LEFT JOIN releases r ON r.id=(
        SELECT id FROM releases WHERE project_id=p.id AND status='published'
        ORDER BY published_at DESC,created_at DESC,id DESC LIMIT 1
      ) WHERE p.is_public=1 ORDER BY p.updated_at DESC
    `).all();
    return {projects:rows.map(row=>({
      ...projectJson(db,row),
      // 目录仅携带轮播所需的日志摘要，完整内容由版本详情接口提供。
      latestRelease:row.latest_release_id?{id:row.latest_release_id,version:row.latest_release_version,title:row.latest_release_title,notes:row.latest_release_notes,channel:row.latest_release_channel,publishedAt:row.latest_release_published_at,notesTruncated:!!row.latest_release_notes_truncated}:null,
    })),site:siteJson(db)};
  });
  app.get('/api/projects/:slug',async request=>{
    const row=getPublicProject(request.params.slug);
    return {project:projectJson(db,row),releases:db.prepare("SELECT * FROM releases WHERE project_id=? AND status='published' ORDER BY is_latest DESC,published_at DESC").all(row.id).map(item=>releaseJson(db,item))};
  });
  app.get('/api/projects/:slug/releases/:version',async request=>{
    const {project,release}=getPublicVersion(request.params.slug,request.params.version);
    return {...releaseDetail(db,release.id),project:projectJson(db,project)};
  });
  app.get('/api/releases',async request=>{
    const limit=Math.min(100,Math.max(1,Number.parseInt(request.query.limit||'20',10)||20));
    const rows=db.prepare("SELECT r.* FROM releases r JOIN projects p ON p.id=r.project_id WHERE r.status='published' AND p.is_public=1 ORDER BY r.published_at DESC LIMIT ?").all(limit);
    return {releases:rows.map(row=>releaseJson(db,row,true))};
  });
  app.get('/api/releases/:id',async request=>{
    const row=db.prepare("SELECT r.* FROM releases r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.status='published' AND p.is_public=1").get(request.params.id);
    if(!row)throw apiError(404,'NOT_FOUND','版本不存在或尚未公开');
    const result=releaseDetail(db,row.id);
    result.project=projectJson(db,db.prepare('SELECT * FROM projects WHERE id=?').get(row.project_id));
    return result;
  });

  app.get('/api/admin/projects',async()=>({projects:db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all().map(row=>projectJson(db,row,true))}));
  app.get('/api/admin/projects/:id',async request=>({project:projectJson(db,requireProject(request.params.id),true)}));
  app.post('/api/admin/projects',{schema:{body:projectSchema}},async(request,reply)=>{
    const body={subtitle:'',description:'',category:'其他',website:'',platforms:[],isPublic:true,...request.body};
    body.name=body.name.trim();
    if(!body.name)throw apiError(400,'NAME_REQUIRED','请填写项目名称');
    if(!validateWebsite(body.website))throw apiError(400,'INVALID_URL','官网地址必须是 HTTP 或 HTTPS 链接');
    const id=randomUUID(),time=now();
    db.prepare('INSERT INTO projects(id,slug,name,subtitle,description,category,website,platforms,is_public,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,body.slug,body.name,body.subtitle,body.description,body.category,body.website,JSON.stringify(body.platforms),body.isPublic?1:0,time,time);
    audit(db,'project.create',id);
    reply.code(201);return {project:projectJson(db,requireProject(id),true)};
  });
  app.patch('/api/admin/projects/:id',{schema:{body:projectPatchSchema}},async request=>{
    const old=requireProject(request.params.id);
    const body={...projectJson(db,old,true),...request.body};
    body.name=body.name.trim();
    if(!body.name)throw apiError(400,'NAME_REQUIRED','请填写项目名称');
    if(!validateWebsite(body.website))throw apiError(400,'INVALID_URL','官网地址必须是 HTTP 或 HTTPS 链接');
    db.prepare('UPDATE projects SET slug=?,name=?,subtitle=?,description=?,category=?,website=?,platforms=?,is_public=?,updated_at=? WHERE id=?').run(body.slug,body.name,body.subtitle,body.description,body.category,body.website,JSON.stringify(body.platforms),body.isPublic?1:0,now(),old.id);
    audit(db,'project.update',old.id);
    return {project:projectJson(db,requireProject(old.id),true)};
  });

  app.get('/api/admin/releases',async request=>{
    const rows=request.query.projectId?db.prepare('SELECT * FROM releases WHERE project_id=? ORDER BY updated_at DESC').all(request.query.projectId):db.prepare('SELECT * FROM releases ORDER BY updated_at DESC').all();
    return {releases:rows.map(row=>releaseJson(db,row,true))};
  });
  app.get('/api/admin/releases/:id',async request=>{requireRelease(request.params.id);return releaseDetail(db,request.params.id);});
  app.post('/api/admin/releases',{schema:{body:releaseSchema}},async(request,reply)=>{
    const body={notes:'',...request.body};
    requireProject(body.projectId);
    if(!validVersion(body.version))throw apiError(400,'INVALID_VERSION','版本号须为 1–100 个字符，以字母或数字开头，可包含字母、数字及 . _ + -，例如 1.5.0.1 或 nightly');
    if(!body.title.trim())throw apiError(400,'TITLE_REQUIRED','请填写版本标题');
    const id=randomUUID(),time=now();
    db.prepare('INSERT INTO releases(id,project_id,version,title,notes,channel,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,body.projectId,body.version,body.title.trim(),body.notes,body.channel,time,time);
    audit(db,'release.create',id);
    reply.code(201);return releaseDetail(db,id);
  });
  app.patch('/api/admin/releases/:id',{schema:{body:releasePatchSchema}},async request=>{
    return transaction(db,()=>{
      const row=requireRelease(request.params.id);
      const body={version:row.version,title:row.title,notes:row.notes,channel:row.channel,...request.body};
      if(!validVersion(body.version))throw apiError(400,'INVALID_VERSION','版本号须为 1–100 个字符，以字母或数字开头，可包含字母、数字及 . _ + -，例如 1.5.0.1 或 nightly');
      if(!body.title.trim())throw apiError(400,'TITLE_REQUIRED','请填写版本标题');
      if(row.status==='published'&&!body.notes.trim())throw apiError(400,'NOTES_REQUIRED','已发布版本的更新日志不能为空');
      if(body.setLatest===true&&row.status!=='published')throw apiError(400,'LATEST_REQUIRES_PUBLISHED','只有已发布的稳定版可以设置为最新版本');
      if(body.setLatest===true&&body.channel!=='stable')throw apiError(400,'LATEST_MUST_BE_STABLE','只有稳定版可以设置为最新版本');
      const latest=row.status==='published'&&body.channel==='stable'&&(body.setLatest??!!row.is_latest);
      const time=now();
      // 在同一事务中交接最新标记，冲突或校验失败时全部回滚。
      if(latest)db.prepare('UPDATE releases SET is_latest=0,updated_at=? WHERE project_id=? AND id<>? AND is_latest=1').run(time,row.project_id,row.id);
      db.prepare('UPDATE releases SET version=?,title=?,notes=?,channel=?,is_latest=?,updated_at=? WHERE id=?').run(body.version,body.title.trim(),body.notes,body.channel,latest?1:0,time,row.id);
      if(row.is_latest&&!latest) {
        const fallback=db.prepare("SELECT id FROM releases WHERE project_id=? AND id<>? AND status='published' AND channel='stable' ORDER BY published_at DESC,created_at DESC,id DESC LIMIT 1").get(row.project_id,row.id);
        if(fallback)db.prepare('UPDATE releases SET is_latest=1,updated_at=? WHERE id=?').run(time,fallback.id);
      }
      db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(time,row.project_id);
      audit(db,'release.update',row.id);
      return releaseDetail(db,row.id);
    });
  });
  app.post('/api/admin/releases/:id/publish',{schema:{body:objectSchema({setLatest:{type:'boolean'}})}},async request=>{
    const row=requireRelease(request.params.id);
    if(row.status==='published')throw apiError(409,'ALREADY_PUBLISHED','这个版本已经发布');
    const files=db.prepare('SELECT * FROM assets WHERE release_id=?').all(row.id);
    if(!files.length)throw apiError(400,'FILES_REQUIRED','请先上传至少一个安装包');
    if(!row.notes.trim())throw apiError(400,'NOTES_REQUIRED','请填写更新日志后再发布');
    for(const file of files){if(!fs.existsSync(path.join(config.dataDir,'uploads',file.storage_name)))throw apiError(409,'FILE_MISSING','安装包文件缺失，请检查存储卷后重试');}
    if(request.body.setLatest&&row.channel!=='stable')throw apiError(400,'LATEST_MUST_BE_STABLE','只有稳定版可以设置为最新版本');
    const hasLatest=!!db.prepare('SELECT 1 FROM releases WHERE project_id=? AND is_latest=1').get(row.project_id);
    const setLatest=row.channel==='stable'&&(request.body.setLatest||!hasLatest);
    const time=now();
    transaction(db,()=>{
      if(setLatest)db.prepare('UPDATE releases SET is_latest=0 WHERE project_id=?').run(row.project_id);
      db.prepare("UPDATE releases SET status='published',is_latest=?,published_at=?,updated_at=? WHERE id=?").run(setLatest?1:0,time,time,row.id);
      db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(time,row.project_id);
      audit(db,'release.publish',row.id);
    });
    return {release:releaseJson(db,requireRelease(row.id))};
  });
  app.post('/api/admin/releases/:id/withdraw',async request=>{
    const row=requireRelease(request.params.id);
    if(row.status!=='published')throw apiError(409,'NOT_PUBLISHED','只有已发布版本可以下架');
    transaction(db,()=>{
      db.prepare("UPDATE releases SET status='withdrawn',is_latest=0,updated_at=? WHERE id=?").run(now(),row.id);
      if(row.is_latest){const fallback=db.prepare("SELECT id FROM releases WHERE project_id=? AND status='published' AND channel='stable' ORDER BY published_at DESC LIMIT 1").get(row.project_id);if(fallback)db.prepare('UPDATE releases SET is_latest=1 WHERE id=?').run(fallback.id);}
      audit(db,'release.withdraw',row.id);
    });
    return {release:releaseJson(db,requireRelease(row.id))};
  });

  app.get('/api/admin/assets',async()=>({assets:db.prepare('SELECT a.*,p.name AS project_name,p.slug AS project_slug,r.version,r.status FROM assets a JOIN releases r ON r.id=a.release_id JOIN projects p ON p.id=r.project_id ORDER BY a.created_at DESC').all().map(row=>({...assetJson(row),projectName:row.project_name,projectSlug:row.project_slug,version:row.version,status:row.status}))}));
  app.get('/api/admin/overview',async()=>{
    const count=sql=>db.prepare(sql).get().n;
    const counts={projects:count('SELECT COUNT(*) AS n FROM projects'),releases:count("SELECT COUNT(*) AS n FROM releases WHERE status='published'"),drafts:count("SELECT COUNT(*) AS n FROM releases WHERE status='draft'"),assets:count('SELECT COUNT(*) AS n FROM assets'),storageBytes:count('SELECT COALESCE(SUM(size),0) AS n FROM assets'),downloads:count('SELECT COALESCE(SUM(download_count),0) AS n FROM assets')};
    const trend=Array.from({length:7},(_,index)=>{const date=new Date();date.setUTCDate(date.getUTCDate()-(6-index));const day=date.toISOString().slice(0,10);return {date:day,count:db.prepare('SELECT count FROM daily_downloads WHERE day=?').get(day)?.count||0};});
    return {counts,trend,recentReleases:db.prepare('SELECT * FROM releases ORDER BY updated_at DESC LIMIT 5').all().map(row=>releaseJson(db,row,true)),drafts:db.prepare("SELECT * FROM releases WHERE status='draft' ORDER BY updated_at DESC LIMIT 3").all().map(row=>releaseJson(db,row,true))};
  });
  app.get('/api/admin/settings',async()=>({site:siteJson(db)}));
  app.patch('/api/admin/settings',{schema:{body:siteSchema}},async request=>{
    if(request.body.name!==undefined&&!request.body.name.trim())throw apiError(400,'NAME_REQUIRED','请填写站点名称');
    transaction(db,()=>{for(const [key,value] of Object.entries(request.body))db.prepare('UPDATE settings SET value=? WHERE key=?').run(value.trim(),key);audit(db,'settings.update');});
    return {site:siteJson(db)};
  });
  await registerFiles(app,db,config);
  const webRoot=path.join(root,'web');
  if(fs.existsSync(webRoot)) {
    // 仅公开浏览器所需入口，保持离线可用且不暴露整个依赖目录。
    for(const [name,packageName] of [['marked.js','marked'],['purify.js','dompurify']]) {
      const source=fileURLToPath(import.meta.resolve(packageName));
      app.get(`/assets/vendor/${name}`,async(request,reply)=>reply.type('text/javascript; charset=utf-8').header('Cache-Control','public, max-age=0').send(fs.createReadStream(source)));
    }
    const webauthnBundle=fileURLToPath(new URL('../dist/bundle/index.umd.min.js',import.meta.resolve('@simplewebauthn/browser')));
    const webauthnModule=fs.readFileSync(webauthnBundle,'utf8')+'\nconst {startRegistration,startAuthentication,browserSupportsWebAuthn}=globalThis.SimpleWebAuthnBrowser;\nexport {startRegistration,startAuthentication,browserSupportsWebAuthn};\n';
    app.get('/assets/vendor/webauthn.js',async(request,reply)=>reply.type('text/javascript; charset=utf-8').header('Cache-Control','public, max-age=0').send(webauthnModule));
    await app.register(fastifyStatic,{root:webRoot,prefix:'/assets/',index:false,dotfiles:'deny',redirect:false,cacheControl:true,maxAge:0});
    const index=(reply,status=200)=>reply.code(status).type('text/html; charset=utf-8').header('Cache-Control','no-store').send(fs.createReadStream(path.join(webRoot,'index.html')));
    app.get('/',async(request,reply)=>index(reply));
    app.get('/:slug/:version',async(request,reply)=>{
      // API 与静态资源保留各自的 404，不以页面 HTML 掩盖接口或资源错误。
      if(['api','assets'].includes(request.params.slug))return reply.callNotFound();
      try{getPublicVersion(request.params.slug,request.params.version);return index(reply);}
      catch(error){if(error.statusCode===404)return index(reply,404);throw error;}
    });
  }
  return app;
}
