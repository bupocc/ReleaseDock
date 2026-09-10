import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const target=path.resolve('.env');
const content=`ADMIN_KEY=${randomBytes(36).toString('base64url')}\nHOST=127.0.0.1\nPORT=8080\nDATA_DIR=./.data\nMAX_UPLOAD_MB=2048\nSESSION_HOURS=12\nCOOKIE_SECURE=false\n`;
try {
  fs.writeFileSync(target,content,{flag:'wx',mode:0o600});
  console.log(`已生成管理员密钥并保存到 ${target}。为避免泄露，密钥未在终端显示。`);
} catch(error) {
  if(error.code==='EEXIST'){console.error('.env 已存在，未覆盖。请直接在本地配置文件中管理密钥。');process.exitCode=1;}
  else throw error;
}
