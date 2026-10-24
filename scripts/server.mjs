import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'http://127.0.0.1:5173';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, origin).pathname);
    const target = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!target.startsWith(root.endsWith(sep) ? root : root + sep) || !Object.hasOwn(types, extname(target))) { res.writeHead(403); res.end('Forbidden'); return; }
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[extname(target)], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口5173已被占用。若工具已启动，请打开 ${origin}；否则请先关闭占用该端口的程序。` : error); process.exitCode = 1; });
server.listen(5173, '127.0.0.1', () => {
  console.log(`舰队科技清单已启动：${origin}\n按 Ctrl+C 停止服务。`);
  if (process.argv.includes('--open') && process.platform === 'win32') spawn('rundll32.exe', ['url.dll,FileProtocolHandler', origin], { stdio: 'ignore' }).unref();
});
