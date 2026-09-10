import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config=loadConfig();
const app=await buildApp(config);
try {
  await app.listen({host:config.host,port:config.port});
  if(config.adminKeyFile)app.log.info({keyFile:config.adminKeyFile},'管理员密钥已保存到本地文件；请勿公开该文件');
} catch(error) {
  app.log.error(error);
  await app.close();
  process.exitCode=1;
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
