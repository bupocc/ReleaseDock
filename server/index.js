import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config=loadConfig();
const app=await buildApp(config);
try {
  await app.listen({host:config.host,port:config.port});
  if(!app.db.prepare('SELECT 1 FROM passkeys LIMIT 1').get())app.log.info('管理员尚未绑定通行密钥，请在服务器运行 pnpm passkey:setup 生成一次性注册链接');
} catch(error) {
  app.log.error(error);
  await app.close();
  process.exitCode=1;
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
