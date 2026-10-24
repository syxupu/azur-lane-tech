import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, relative, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPages } from '../scripts/build-pages.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function fixture(t) {
  const dir = await mkdtemp(resolve(tmpdir(), 'azur-pages-test-'));
  t.after(async () => {
    const delta = relative(tmpdir(), dir);
    assert.ok(!isAbsolute(delta) && !delta.startsWith('..') && basename(dir).startsWith('azur-pages-test-'));
    await rm(dir, { recursive: true, force: true });
  });
  const entries = [
    'index.html', 'style.css', 'settings.css', 'app.js', 'core.js', 'targets.js',
    'ui-icons.js', 'theme.js', 'appearance.js', 'appearance-boot.js',
  ];
  for (const path of entries) await writeFile(resolve(dir, path), await readFile(resolve(root, path)));
  for (const path of ['data', 'assets/ships', 'assets/hulls', 'screenshots', 'tests', 'dist']) await mkdir(resolve(dir, path), { recursive: true });
  await writeFile(resolve(dir, 'data/ships.json'), JSON.stringify({ ships: [{ avatar: 'assets/ships/004.jpg' }] }));
  await writeFile(resolve(dir, 'assets/hulls/manifest.json'), JSON.stringify({ icons: { 驱逐: { path: 'assets/hulls/destroyer.png' } } }));
  await writeFile(resolve(dir, 'assets/ships/004.jpg'), 'test-avatar');
  await writeFile(resolve(dir, 'assets/hulls/destroyer.png'), 'test-icon');
  for (const path of ['backup.json', '.env', 'screenshots/private.png', 'tests/example.mjs', 'assets/ships/unreferenced.jpg', 'dist/old-backup.json']) {
    await writeFile(resolve(dir, path), 'not-for-publication');
  }
  return dir;
}

async function listFiles(dir, prefix = '') {
  const names = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) names.push(...await listFiles(resolve(dir, entry.name), path + '/'));
    else names.push(path);
  }
  return names.sort();
}

test('Pages打包仅包含运行文件和被引用素材，重新构建移除旧产物', async t => {
  const dir = await fixture(t);
  const result = await buildPages(dir);
  assert.deepEqual(await listFiles(result.output), [...result.files].sort());
  assert.equal(result.files.length, 15);
  for (const excluded of ['backup.json', '.env', 'screenshots/private.png', 'tests/example.mjs', 'assets/ships/unreferenced.jpg', 'old-backup.json']) {
    await assert.rejects(access(resolve(result.output, excluded)), { code: 'ENOENT' });
  }
  assert.equal(await readFile(resolve(result.output, 'assets/ships/004.jpg'), 'utf8'), 'test-avatar');
});

test('Pages资源在仓库子路径下仍解析到发布包，不依赖站点根目录', async t => {
  const dir = await fixture(t);
  const { output } = await buildPages(dir);
  const base = new URL('https://example.github.io/azur-lane-tech/');
  const html = await readFile(resolve(output, 'index.html'), 'utf8');
  const paths = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)].map(match => match[1]).filter(path => !path.startsWith('data:'));
  for (const module of ['app.js', 'appearance.js', 'core.js', 'targets.js', 'ui-icons.js', 'theme.js']) {
    const source = await readFile(resolve(output, module), 'utf8');
    paths.push(...[...source.matchAll(/(?:from\s+|fetch\()['"]([^'"]+)['"]/g)].map(match => match[1]));
  }
  for (const path of paths) {
    const url = new URL(path, base);
    assert.equal(url.origin, base.origin);
    assert.ok(url.pathname.startsWith(base.pathname), `${path}逃离仓库子路径`);
    await access(resolve(output, decodeURIComponent(url.pathname.slice(base.pathname.length))));
  }
});

test('无效或越界素材路径会阻止发布，并保留上次构建', async t => {
  const dir = await fixture(t);
  await writeFile(resolve(dir, 'data/ships.json'), JSON.stringify({ ships: [{ avatar: '../../private.json' }] }));
  await assert.rejects(buildPages(dir), /Invalid local asset path/);
  assert.equal(await readFile(resolve(dir, 'dist/old-backup.json'), 'utf8'), 'not-for-publication');
});
