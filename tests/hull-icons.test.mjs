import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { relative, isAbsolute } from 'node:path';

test('舰种图标覆盖全部自身/受益舰种，本地PNG尺寸及SHA256完整', async () => {
  const catalog = JSON.parse(await readFile(new URL('../data/ships.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('../assets/hulls/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(manifest.icons && typeof manifest.icons === 'object' && !Array.isArray(manifest.icons));

  const hulls = new Set(catalog.ships.flatMap(ship => [
    ship.hull, ...ship.bonuses.flatMap(bonus => bonus.targets),
  ]));
  for (const hull of hulls) assert.ok(Object.hasOwn(manifest.icons, hull), `${hull}缺少图标映射`);

  const assetRoot = await realpath(new URL('../assets/hulls/', import.meta.url));
  const files = new Map();
  for (const [hull, icon] of Object.entries(manifest.icons)) {
    assert.match(icon.path, /^assets\/hulls\/[a-z0-9]+(?:-[a-z0-9]+)*\.png$/, `${hull}图标路径必须位于assets/hulls`);
    assert.ok(Number.isInteger(icon.width) && icon.width > 0, `${hull}图标宽度无效`);
    assert.ok(Number.isInteger(icon.height) && icon.height > 0, `${hull}图标高度无效`);
    assert.match(icon.sha256, /^[a-f0-9]{64}$/, `${hull}图标校验值无效`);

    // Several hull names may intentionally share an original sprite (风帆S/V/M).
    // Verify every mapping against the file, without demanding unique paths.
    if (!files.has(icon.path)) {
      const imagePath = await realpath(new URL(`../${icon.path}`, import.meta.url));
      const withinRoot = relative(assetRoot, imagePath);
      assert.ok(withinRoot && !withinRoot.startsWith('..') && !isAbsolute(withinRoot), `${hull}图标真实路径越界`);
      const bytes = await readFile(imagePath);
      assert.ok(bytes.length >= 33, `${hull}图标PNG头不完整`);
      assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), `${hull}图标不是PNG`);
      assert.equal(bytes.readUInt32BE(8), 13, `${hull}图标IHDR长度无效`);
      assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', `${hull}图标缺少IHDR`);
      files.set(icon.path, {
        width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    const actual = files.get(icon.path);
    assert.equal(actual.width, icon.width, `${hull}图标宽度与manifest不符`);
    assert.equal(actual.height, icon.height, `${hull}图标高度与manifest不符`);
    assert.equal(actual.sha256, icon.sha256, `${hull}图标内容与manifest校验值不符`);
  }
});
