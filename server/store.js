export function projectJson(db,row,admin=false) {
  if (!row) return null;
  const releaseFilter = admin ? '' : " AND status='published'";
  const releaseCount=db.prepare(`SELECT COUNT(*) AS n FROM releases WHERE project_id=?${releaseFilter}`).get(row.id).n;
  const publishedCount=db.prepare("SELECT COUNT(*) AS n FROM releases WHERE project_id=? AND status='published'").get(row.id).n;
  const latest=db.prepare("SELECT version FROM releases WHERE project_id=? AND status='published' ORDER BY is_latest DESC, CASE channel WHEN 'stable' THEN 0 ELSE 1 END, published_at DESC LIMIT 1").get(row.id);
  const downloads=db.prepare('SELECT COALESCE(SUM(a.download_count),0) AS n FROM assets a JOIN releases r ON r.id=a.release_id WHERE r.project_id=?').get(row.id).n;
  return {id:row.id,slug:row.slug,name:row.name,subtitle:row.subtitle,description:row.description,category:row.category,website:row.website,platforms:JSON.parse(row.platforms),isPublic:!!row.is_public,icon:row.icon,latestVersion:latest?.version||null,releaseCount,publishedCount,downloadCount:downloads,createdAt:row.created_at,updatedAt:row.updated_at};
}

export function releaseJson(db,row,includeProject=false) {
  if(!row) return null;
  const item={id:row.id,projectId:row.project_id,version:row.version,title:row.title,notes:row.notes,channel:row.channel,status:row.status,isLatest:!!row.is_latest,publishedAt:row.published_at,createdAt:row.created_at,updatedAt:row.updated_at};
  const counts=db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(download_count),0) AS downloads FROM assets WHERE release_id=?').get(row.id);
  item.assetCount=counts.n;item.downloadCount=counts.downloads;
  if(includeProject) item.project=projectJson(db,db.prepare('SELECT * FROM projects WHERE id=?').get(row.project_id));
  return item;
}

export function assetJson(row) {
  return {id:row.id,releaseId:row.release_id,filename:row.filename,size:row.size,platform:row.platform,arch:row.arch,sha256:row.sha256,downloadCount:row.download_count,createdAt:row.created_at};
}

export function releaseDetail(db,id) {
  const row=db.prepare('SELECT * FROM releases WHERE id=?').get(id);
  if(!row)return null;
  return {release:releaseJson(db,row),project:projectJson(db,db.prepare('SELECT * FROM projects WHERE id=?').get(row.project_id),true),assets:db.prepare('SELECT * FROM assets WHERE release_id=? ORDER BY created_at,id').all(id).map(assetJson)};
}

export function siteJson(db) {
  return Object.fromEntries(db.prepare("SELECT key,value FROM settings WHERE key IN ('name','description','announcement')").all().map(row=>[row.key,row.value]));
}

export function apiError(statusCode,code,message) {
  return Object.assign(new Error(message),{statusCode,apiCode:code});
}
