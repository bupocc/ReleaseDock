import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { apiError,assetJson,projectJson } from './store.js';
import { assetMetadataSchema,assetPatchSchema } from './schemas.js';
import { audit,transaction } from './db.js';

export function parseRange(header,size) {
  if(!header)return null;
  const match=/^bytes=(\d*)-(\d*)$/.exec(header);
  if(!match||(!match[1]&&!match[2])||size===0)return false;
  let start,end;
  if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return false;start=Math.max(0,size-suffix);end=size-1;}
  else{start=Number(match[1]);end=match[2]?Number(match[2]):size-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return false;
  return {start,end:Math.min(end,size-1)};
}

function safeFilename(value) {
  if(typeof value!=='string'||!value.trim())throw apiError(400,'INVALID_FILENAME','请填写文件名称');
  const filename=value.normalize('NFC');
  if(Array.from(filename).length>180)throw apiError(400,'INVALID_FILENAME','文件名称不能超过 180 个字符');
  if(!filename.isWellFormed()||/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(filename))throw apiError(400,'INVALID_FILENAME','文件名称不能包含路径、控制字符或 <>:"/\\|?*');
  if(filename!==filename.trim()||filename.endsWith('.'))throw apiError(400,'INVALID_FILENAME','文件名称不能以空白开头或结尾，也不能以句点结尾');
  if(/^(?:con|prn|aux|nul|conin\$|conout\$|clock\$|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(filename.split('.')[0].trimEnd()))throw apiError(400,'INVALID_FILENAME','请使用非 Windows 保留名称，例如 setup.zip');
  return filename;
}

async function receiveFile(request,directory,limit) {
  let result;
  let temporary;
  try {
    for await(const part of request.parts({limits:{fileSize:limit,files:1,fields:8,parts:10,fieldSize:4096}})) {
      if(part.type!=='file')continue;
      if(part.fieldname!=='file')throw apiError(400,'FILE_FIELD_REQUIRED','上传字段名必须为 file');
      const filename=safeFilename(part.filename);
      const id=randomUUID();
      temporary=path.join(directory,`${id}.part`);
      let size=0,header=Buffer.alloc(0);
      const hash=createHash('sha256');
      const counter=new Transform({transform(chunk,encoding,callback){size+=chunk.length;hash.update(chunk);if(header.length<16)header=Buffer.concat([header,chunk.subarray(0,16-header.length)]);callback(null,chunk);}});
      const aborted=()=>part.file.destroy(new Error('上传已取消'));
      request.raw.once('aborted',aborted);
      try{await pipeline(part.file,counter,fs.createWriteStream(temporary,{flags:'wx',mode:0o600}));}
      finally{request.raw.off('aborted',aborted);}
      if(part.file.truncated||size>limit)throw apiError(413,'FILE_TOO_LARGE','文件超过允许的大小');
      if(size===0)throw apiError(400,'EMPTY_FILE','不能上传空文件');
      result={id,filename,temporary,size,sha256:hash.digest('hex'),contentType:part.mimetype||'application/octet-stream',header};
    }
    if(!result)throw apiError(400,'FILE_REQUIRED','请选择要上传的文件');
    return result;
  }catch(error){if(temporary)await fsp.unlink(temporary).catch(()=>{});throw error;}
}

export async function registerFiles(app,db,config) {
  const uploadDir=path.join(config.dataDir,'uploads');
  const iconDir=path.join(config.dataDir,'icons');
  fs.mkdirSync(uploadDir,{recursive:true,mode:0o700});
  fs.mkdirSync(iconDir,{recursive:true,mode:0o700});
  // 单实例启动时清理上次中断的临时流文件，不删除已完成的版本附件。
  for(const directory of [uploadDir,iconDir])for(const name of fs.readdirSync(directory)){if(/^[0-9a-f-]{36}\.part$/.test(name))fs.unlinkSync(path.join(directory,name));}

  function draft(id) {
    const row=db.prepare('SELECT * FROM releases WHERE id=?').get(id);
    if(!row)throw apiError(404,'RELEASE_NOT_FOUND','版本不存在');
    if(row.status!=='draft')throw apiError(409,'RELEASE_IMMUTABLE','只有草稿版本可以修改安装包');
    return row;
  }
  function availableFilename(releaseId,filename,exceptId='') {
    if(db.prepare('SELECT 1 FROM assets WHERE release_id=? AND filename=? AND id<>?').get(releaseId,filename,exceptId))throw apiError(409,'ASSET_FILENAME_CONFLICT','这个版本中已有同名安装包，请使用不同的文件名称');
  }
  app.post('/api/admin/releases/:id/assets',{schema:{querystring:assetMetadataSchema}},async(request,reply)=>{
    draft(request.params.id);
    if(db.prepare('SELECT COUNT(*) AS n FROM assets WHERE release_id=?').get(request.params.id).n>=64)throw apiError(400,'ASSET_LIMIT','一个版本最多包含 64 个附件');
    const file=await receiveFile(request,uploadDir,config.maxUploadBytes);
    const finalPath=path.join(uploadDir,file.id);
    try {
      transaction(db,()=>{
        draft(request.params.id);
        if(db.prepare('SELECT COUNT(*) AS n FROM assets WHERE release_id=?').get(request.params.id).n>=64)throw apiError(400,'ASSET_LIMIT','一个版本最多包含 64 个附件');
        availableFilename(request.params.id,file.filename);
        // 文件完成落盘后才登记元数据，失败时外层负责移除孤立文件。
        fs.renameSync(file.temporary,finalPath);
        db.prepare('INSERT INTO assets(id,release_id,filename,storage_name,content_type,size,platform,arch,sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(file.id,request.params.id,file.filename,file.id,file.contentType,file.size,request.query.platform,request.query.arch,file.sha256,new Date().toISOString());
        db.prepare('UPDATE releases SET updated_at=? WHERE id=?').run(new Date().toISOString(),request.params.id);
        audit(db,'asset.upload',file.id);
      });
    }catch(error){await fsp.unlink(file.temporary).catch(()=>{});await fsp.unlink(finalPath).catch(()=>{});throw error;}
    reply.code(201);return {asset:assetJson(db.prepare('SELECT * FROM assets WHERE id=?').get(file.id))};
  });
  app.patch('/api/admin/assets/:id',{schema:{body:assetPatchSchema}},async request=>{
    const updated=transaction(db,()=>{
      const asset=db.prepare('SELECT * FROM assets WHERE id=?').get(request.params.id);
      if(!asset)throw apiError(404,'NOT_FOUND','文件不存在');
      const filename=request.body.filename===undefined?asset.filename:safeFilename(request.body.filename);
      const platform=request.body.platform??asset.platform,arch=request.body.arch??asset.arch;
      const renamed=filename!==asset.filename,metadataChanged=platform!==asset.platform||arch!==asset.arch;
      // 正式发布后仅允许修正下载名称，安装包内容和平台身份保持不变。
      if(metadataChanged)draft(asset.release_id);
      if(!renamed&&!metadataChanged)return asset;
      availableFilename(asset.release_id,filename,asset.id);
      db.prepare('UPDATE assets SET filename=?,platform=?,arch=? WHERE id=?').run(filename,platform,arch,asset.id);
      db.prepare('UPDATE releases SET updated_at=? WHERE id=?').run(new Date().toISOString(),asset.release_id);
      if(renamed)audit(db,'asset.rename',asset.id);
      if(metadataChanged)audit(db,'asset.update',asset.id);
      return db.prepare('SELECT * FROM assets WHERE id=?').get(asset.id);
    });
    return {asset:assetJson(updated)};
  });
  app.delete('/api/admin/assets/:id',async request=>{
    const asset=db.prepare('SELECT * FROM assets WHERE id=?').get(request.params.id);
    if(!asset)throw apiError(404,'NOT_FOUND','文件不存在');
    draft(asset.release_id);
    const filename=path.join(uploadDir,asset.storage_name);
    // 同步文件操作与同步事务相邻，避免删除过程中插入发布操作。
    transaction(db,()=>{try{fs.unlinkSync(filename);}catch(error){if(error.code!=='ENOENT')throw error;}db.prepare('DELETE FROM assets WHERE id=?').run(asset.id);audit(db,'asset.remove',asset.id);});
    return {ok:true};
  });

  async function download(request,reply,admin) {
    const row=db.prepare('SELECT a.*,r.status,p.is_public FROM assets a JOIN releases r ON r.id=a.release_id JOIN projects p ON p.id=r.project_id WHERE a.id=?').get(request.params.id);
    if(!row||(!admin&&(row.status!=='published'||!row.is_public)))throw apiError(404,'NOT_FOUND','文件不存在或尚未公开');
    const filename=path.join(uploadDir,row.storage_name);
    let stat;
    try{stat=await fsp.stat(filename);}catch{throw apiError(404,'FILE_MISSING','文件暂时不可用，请联系站点管理员');}
    if(!stat.isFile()||stat.size!==row.size)throw apiError(409,'FILE_INVALID','文件完整性异常，请联系站点管理员');
    const etag=`"${row.sha256}"`;
    const rangeHeader=request.headers['if-range']&&request.headers['if-range']!==etag?undefined:request.headers.range;
    const range=parseRange(rangeHeader,row.size);
    reply.header('Accept-Ranges','bytes').header('ETag',etag).header('Content-Type','application/octet-stream');
    const encoded=encodeURIComponent(row.filename).replace(/['()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    reply.header('Content-Disposition',`attachment; filename="download.bin"; filename*=UTF-8''${encoded}`);
    if(range===false){reply.code(416).header('Content-Range',`bytes */${row.size}`);return reply.send();}
    if(range){reply.code(206).header('Content-Range',`bytes ${range.start}-${range.end}/${row.size}`).header('Content-Length',range.end-range.start+1);}
    else reply.header('Content-Length',row.size);
    if(request.method==='HEAD')return reply.send();
    if(!admin&&(!range||range.start===0)) {
      // 统计下载开始请求；后续断点续传片段和 HEAD 请求不重复累计。
      transaction(db,()=>{
        db.prepare('UPDATE assets SET download_count=download_count+1 WHERE id=?').run(row.id);
        db.prepare('INSERT INTO daily_downloads(day,count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1').run(new Date().toISOString().slice(0,10));
      });
    }
    return reply.send(fs.createReadStream(filename,range||undefined));
  }
  app.route({method:['GET','HEAD'],url:'/api/downloads/:id',handler:(request,reply)=>download(request,reply,false)});
  app.route({method:['GET','HEAD'],url:'/api/admin/assets/:id/download',handler:(request,reply)=>download(request,reply,true)});

  app.post('/api/admin/projects/:id/icon',async(request,reply)=>{
    const project=db.prepare('SELECT * FROM projects WHERE id=?').get(request.params.id);
    if(!project)throw apiError(404,'NOT_FOUND','项目不存在');
    const file=await receiveFile(request,iconDir,2*1024*1024);
    let extension;
    if(file.header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))extension='png';
    else if(file.header[0]===255&&file.header[1]===216&&file.header[2]===255)extension='jpg';
    else if(file.header.toString('ascii',0,4)==='RIFF'&&file.header.toString('ascii',8,12)==='WEBP')extension='webp';
    if(!extension){await fsp.unlink(file.temporary);throw apiError(400,'INVALID_IMAGE','图标仅支持真实的 PNG、JPEG 或 WebP 图片');}
    const name=`${file.id}.${extension}`;
    const icon=`/api/icons/${name}`;
    try {
      await fsp.rename(file.temporary,path.join(iconDir,name));
      db.prepare('UPDATE projects SET icon=?,updated_at=? WHERE id=?').run(icon,new Date().toISOString(),project.id);
      audit(db,'project.icon',project.id);
    }catch(error){await fsp.unlink(file.temporary).catch(()=>{});await fsp.unlink(path.join(iconDir,name)).catch(()=>{});throw error;}
    if(project.icon.startsWith('/api/icons/')){const old=project.icon.slice('/api/icons/'.length);if(/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(old))await fsp.unlink(path.join(iconDir,old)).catch(()=>{});}
    reply.code(201);return {project:projectJson(db,db.prepare('SELECT * FROM projects WHERE id=?').get(project.id),true)};
  });
  app.get('/api/icons/:name',async(request,reply)=>{
    if(!/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(request.params.name))throw apiError(404,'NOT_FOUND','图标不存在');
    const project=db.prepare('SELECT is_public FROM projects WHERE icon=?').get(`/api/icons/${request.params.name}`);
    if(!project||(!project.is_public&&!app.findAdminSession(request)))throw apiError(404,'NOT_FOUND','图标不存在');
    const filename=path.join(iconDir,request.params.name);
    if(!fs.existsSync(filename))throw apiError(404,'NOT_FOUND','图标不存在');
    const type=request.params.name.endsWith('.png')?'image/png':request.params.name.endsWith('.jpg')?'image/jpeg':'image/webp';
    return reply.type(type).send(fs.createReadStream(filename));
  });
}
