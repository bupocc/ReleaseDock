const text=(maxLength,minLength=0)=>({type:'string',minLength,maxLength});
export const projectFields={
  name:text(100,1),slug:{...text(80,1),pattern:'^[a-z0-9]+(?:-[a-z0-9]+)*$'},
  subtitle:text(160),description:text(20000),category:text(40),website:text(2048),
  platforms:{type:'array',uniqueItems:true,maxItems:12,items:text(32,1)},isPublic:{type:'boolean'},
};
export const releaseFields={version:{...text(100,1),pattern:'^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$'},title:text(200,1),notes:text(100000),channel:{type:'string',enum:['stable','prerelease']}};
export const objectSchema=(properties,required=[])=>({type:'object',additionalProperties:false,properties,required});
export const projectSchema=objectSchema(projectFields,['name','slug']);
export const projectPatchSchema=objectSchema(projectFields);
export const releaseSchema=objectSchema({...releaseFields,projectId:text(64,1)},['projectId','version','title','channel']);
export const releasePatchSchema=objectSchema(releaseFields);
export const assetMetadataSchema=objectSchema({platform:text(32,1),arch:text(32,1)},['platform','arch']);
export const siteSchema=objectSchema({name:text(80,1),description:text(1000),announcement:text(2000)});

export function validateWebsite(website) {
  if(!website)return true;
  try{const parsed=new URL(website);return ['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password;}catch{return false;}
}

export function validSemver(version) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.test(version);
}
