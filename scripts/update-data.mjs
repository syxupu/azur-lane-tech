import { readFile, writeFile, mkdir, access, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseWiki, SOURCE } from './data-parser.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = process.argv.indexOf('--source');
const html = local >= 0 ? await readFile(process.argv[local + 1], 'utf8') : await download(SOURCE).then(r => r.text());
const ships = parseWiki(html);
await mkdir(`${root}assets/ships`, { recursive: true });
await mkdir(`${root}data`, { recursive: true });
let next = 0, downloaded = 0;
const failed = [];
async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'AzurLaneTechChecklist/1.0 (personal offline study tool)' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
}
async function worker() {
  while (next < ships.length) {
    const ship = ships[next++];
    try { await access(`${root}${ship.avatar}`); continue; } catch {}
    try {
      const res = await download(ship.avatarSource);
      if (!res.headers.get('content-type')?.startsWith('image/')) throw new Error('头像响应不是图片');
      await writeFile(`${root}${ship.avatar}`, Buffer.from(await res.arrayBuffer()));
      downloaded++;
    } catch (e) { failed.push(ship.id); }
    if ((downloaded + failed.length) % 100 === 0) console.log(`头像处理 ${downloaded + failed.length}/${ships.length}`);
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
const revision = html.match(/"wgRevisionId":(\d+)/)?.[1] || null;
const data = { schemaVersion: 1, source: SOURCE, sourceRevision: revision, updatedAt: new Date().toISOString(), ships };
await writeFile(`${root}data/ships.json.tmp`, JSON.stringify(data, null, 2) + '\n', 'utf8');
await rename(`${root}data/ships.json.tmp`, `${root}data/ships.json`);
console.log(`已保存 ${ships.length} 艘舰船；新下载头像 ${downloaded}；缺失 ${failed.length}${failed.length ? '：' + failed.join(',') : ''}`);
