import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 仅在本机提供设计稿预览，不承担正式网站的鉴权或下载服务。
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.DESIGN_PORT || 4173);
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.md':'text/plain; charset=utf-8' };
const server = http.createServer((req,res)=>{
  try {
    const requestPath = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${port}`).pathname);
    const target = path.resolve(root, `.${requestPath === '/' ? '/index.html' : requestPath}`);
    if (target !== root && !target.startsWith(root + path.sep)) { res.writeHead(403);res.end('Forbidden');return; }
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405);res.end('Method not allowed');return; }
    const stat = fs.statSync(target);
    if (!stat.isFile()) { res.writeHead(404);res.end('Not found');return; }
    res.writeHead(200,{'Content-Type':types[path.extname(target)] || 'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(target).pipe(res);
  } catch { res.writeHead(404);res.end('Not found'); }
});
server.listen(port,'127.0.0.1',()=>console.log(`设计预览已就绪：http://127.0.0.1:${port}`));
