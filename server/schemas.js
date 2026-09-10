const text=(maxLength,minLength=0)=>({type:'string',minLength,maxLength});
// 使用真实字符串结尾，避免普通 $ 锚点接受尾部换行。
const versionPattern='^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}(?![\\s\\S])';
const versionFormat=new RegExp(versionPattern);
export const projectFields={
  name:text(100,1),slug:{...text(80,1),pattern:'^[a-z0-9]+(?:-[a-z0-9]+)*$'},
  subtitle:text(160),description:text(20000),category:text(40),website:text(2048),
  platforms:{type:'array',uniqueItems:true,maxItems:12,items:text(32,1)},isPublic:{type:'boolean'},
};
export const releaseFields={version:{...text(100,1),pattern:versionPattern},title:text(200,1),notes:text(100000),channel:{type:'string',enum:['stable','prerelease']}};
export const objectSchema=(properties,required=[])=>({type:'object',additionalProperties:false,properties,required});
export const projectSchema=objectSchema(projectFields,['name','slug']);
export const projectPatchSchema=objectSchema(projectFields);
export const releaseSchema=objectSchema({...releaseFields,projectId:text(64,1)},['projectId','version','title','channel']);
export const releasePatchSchema={...objectSchema({...releaseFields,setLatest:{type:'boolean'}}),minProperties:1};
export const assetMetadataSchema=objectSchema({platform:text(32,1),arch:text(32,1)},['platform','arch']);
export const assetPatchSchema={...objectSchema({filename:text(180,1),platform:text(32,1),arch:text(32,1)}),minProperties:1};
export const siteSchema=objectSchema({name:text(80,1),description:text(1000),announcement:text(2000)});

export function validateWebsite(website) {
  if(!website)return true;
  try{const parsed=new URL(website);return ['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password;}catch{return false;}
}

export function validVersion(version) {
  return typeof version==='string'&&versionFormat.test(version);
}
