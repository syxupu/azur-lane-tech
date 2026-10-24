import { mkdir, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// BWIKI mirrors the game's original ShipType sprites. Keep original pixels and
// transparency; the application must not need a live wiki request at runtime.
const root = fileURLToPath(new URL('../', import.meta.url));
const definitions = [
  ['驱逐', 'destroyer'], ['轻巡', 'light-cruiser'], ['重巡', 'heavy-cruiser'],
  ['超巡', 'large-cruiser'], ['战巡', 'battlecruiser'], ['战列', 'battleship'],
  ['航战', 'aviation-battleship'], ['航母', 'aircraft-carrier'], ['轻航', 'light-carrier'],
  ['重炮', 'monitor'], ['维修', 'repair'], ['潜艇', 'submarine'],
  ['潜母', 'submarine-carrier'], ['运输', 'transport'], ['风帆', 'sailing-frigate'],
  ['风帆S', 'sailing-frigate'], ['风帆V', 'sailing-frigate'], ['风帆M', 'sailing-frigate'],
];
const endpoint = new URL('https://wiki.biligame.com/blhx/api.php');
endpoint.search = new URLSearchParams({
  action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url|size|timestamp|sha1',
  titles: definitions.map(([name]) => `文件:ShipType-${name}.png`).join('|'),
});
async function get(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(25000),
    headers: { 'User-Agent': 'AzurLaneTechChecklist/1.0 (personal offline study tool)' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response;
}

const data = await get(endpoint).then(response => response.json());
const pages = Object.values(data.query?.pages || {});
const icons = {};
const staged = new Map();
for (const [name, slug] of definitions) {
  const title = `文件:ShipType-${name}.png`;
  const page = pages.find(p => p.title === title);
  const info = page?.imageinfo?.[0];
  if (!info?.url || !info.width || !info.height) throw new Error(`缺少舰种原图：${title}`);
  const source = new URL(info.url);
  if (source.protocol !== 'https:' || source.hostname !== 'patchwiki.biligame.com') throw new Error(`非预期素材来源：${source}`);
  const path = `assets/hulls/${slug}.png`;
  if (!staged.has(path)) {
    const response = await get(source);
    if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error(`舰种响应不是图片：${name}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error(`舰种素材不是PNG：${name}`);
    staged.set(path, bytes);
  }
  icons[name] = {
    path, width: info.width, height: info.height, source: source.href,
    filePage: info.descriptionurl, requestedTitle: title, pageId: page.pageid,
    sourceTimestamp: info.timestamp, sourceSha1: info.sha1,
    sha256: createHash('sha256').update(staged.get(path)).digest('hex'),
    ...(name.startsWith('风帆') ? { note: 'BWIKI的风帆S、V、M文件均指向同一通用风帆原图；不伪造各子类不同图标。' } : {}),
  };
}
await mkdir(`${root}assets/hulls`, { recursive: true });
for (const [path, bytes] of staged) {
  await writeFile(`${root}${path}.tmp`, bytes);
  await rename(`${root}${path}.tmp`, `${root}${path}`);
}
const manifest = {
  schemaVersion: 1,
  source: 'https://wiki.biligame.com/blhx/杜威',
  sourceDescription: '碧蓝航线BWIKI舰船详情使用的ShipType舰种图标原图；素材版权归游戏原权利人。',
  updatedAt: new Date().toISOString(),
  treatment: 'PNG原图原样保存，无重绘、裁切或换色。',
  icons,
};
await writeFile(`${root}assets/hulls/manifest.json.tmp`, JSON.stringify(manifest, null, 2) + '\n');
await rename(`${root}assets/hulls/manifest.json.tmp`, `${root}assets/hulls/manifest.json`);
console.log(`已保存 ${staged.size} 张原图，覆盖 ${definitions.length} 个舰种名称。`);
