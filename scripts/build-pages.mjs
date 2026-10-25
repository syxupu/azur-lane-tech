import { readFile, writeFile, mkdir, rm, lstat, realpath } from 'node:fs/promises';
import { resolve, relative, dirname, isAbsolute, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const runtimeFiles = [
  'index.html', 'style.css', 'settings.css', 'app.js', 'core.js', 'targets.js',
  'ui-icons.js', 'theme.js', 'appearance.js', 'appearance-boot.js', 'list-motion.js',
  'data/ships.json', 'assets/hulls/manifest.json',
];

function inside(root, path) {
  const part = relative(root, path);
  return part !== '' && !part.startsWith('..') && !isAbsolute(part);
}

export async function buildPages(sourceRoot = projectRoot) {
  const root = await realpath(resolve(sourceRoot));
  if (root === parse(root).root) throw new Error('Refusing to build from a filesystem root.');
  const output = resolve(root, 'dist');
  if (!inside(root, output) || dirname(output) !== root) throw new Error('Unsafe build output path.');
  const outputInfo = await lstat(output).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (outputInfo && (!outputInfo.isDirectory() || outputInfo.isSymbolicLink())) {
    throw new Error('dist must be a real directory, not a file or symbolic link.');
  }

  const catalog = JSON.parse(await readFile(resolve(root, 'data/ships.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(root, 'assets/hulls/manifest.json'), 'utf8'));
  if (!Array.isArray(catalog.ships) || !catalog.ships.length || !manifest.icons) {
    throw new Error('Missing fleet catalog or hull icon manifest.');
  }
  const assets = [
    ...catalog.ships.map(ship => ship.avatar),
    ...Object.values(manifest.icons).map(icon => icon.path),
  ];
  for (const asset of assets) {
    if (typeof asset !== 'string' || !/^assets\/(?:ships\/[a-z0-9-]+\.jpg|hulls\/[a-z0-9-]+\.png)$/i.test(asset)) {
      throw new Error(`Invalid local asset path: ${String(asset)}`);
    }
  }
  const files = [...new Set([...runtimeFiles, ...assets])].sort();
  // Validate and read every allowlisted source before removing the previous build.
  const contents = await Promise.all(files.map(async path => {
    const source = await realpath(resolve(root, path));
    if (!inside(root, source)) throw new Error(`Source file escapes project: ${path}`);
    return [path, await readFile(source)];
  }));

  // output is exactly <resolved project root>/dist, checked above before recursive removal.
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const [path, bytes] of contents) {
    const destination = resolve(output, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  await writeFile(resolve(output, '.nojekyll'), '');
  return { output, files: [...files, '.nojekyll'], bytes: contents.reduce((sum, [, data]) => sum + data.length, 0) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildPages();
    console.log(`GitHub Pages 静态包已生成：${result.output}\n${result.files.length} 个文件，${(result.bytes / 1024 / 1024).toFixed(2)} MiB。仅包含页面与公开舰船素材。`);
  } catch (error) {
    console.error(`静态构建失败：${error.message}`);
    process.exitCode = 1;
  }
}
