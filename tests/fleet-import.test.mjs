import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateFleetExport, previewFleetImport } from '../fleet-import.js';
import { makeBackup, validateBackup } from '../core.js';

const ships = [
  { id: '001', name: '测试舰', aliases: ['和谐名'], gameGroupId: 10101 },
  { id: 'Plan001', name: '方案舰', aliases: [], gameGroupId: 19901 },
  { id: 'META001', name: '测试舰·META', aliases: ['别名·META'], gameGroupId: 970101 },
  { id: '002', name: '另一艘', aliases: [], gameGroupId: 10102 },
];
const row = patch => ({ id: 1, group_type: 10101, name: '扫描舰名', level: 100, review: false, ...patch });
const tech = patch => ({ owned: true, lv120: false, awakening_pending: false, ...patch });
const instance = patch => ({ instance: 'test', has_confirmed_snapshot: true, ships: [], ...patch });
const fleet = (...instances) => ({ format: 'azurpilot-fleet-export', version: 1, instances });
const current = () => ({ '001': 'pending', Plan001: 'pending', META001: 'pending', '002': 'pending', Future001: 'done' });

test('组编号映射科技ID，不使用扫描行ID；重复舰按最高等级合并', () => {
  const input = fleet(instance({ ships: [row({ level: 119 }), row({ id: 2, level: 125 }), row({ group_type: 19901, level: 120 })] }));
  const before = current(), inputBefore = structuredClone(input);
  const result = previewFleetImport(input, 0, ships, before);
  assert.equal(result.statuses['001'], 'done');
  assert.equal(result.statuses.Plan001, 'done');
  assert.equal(result.statuses.META001, 'pending');
  assert.equal(result.report.duplicates, 1);
  assert.equal(result.report.matched, 2);
  assert.equal(result.report.changed, 2);
  assert.deepEqual(before, current());
  assert.deepEqual(input, inputBefore);
});

test('确认科技记录恢复累计120级及待觉醒；不从额外经验推断觉醒', () => {
  const input = fleet(instance({ ships: [row({ level: 100, extra_exp: 99999999 })], technology: { progress: {
    '10101': tech({ lv120: true }), '19901': tech({ awakening_pending: true }), '970101': tech(),
  } } }));
  const result = previewFleetImport(input, 0, ships, current());
  assert.equal(result.statuses['001'], 'done');
  assert.equal(result.statuses.Plan001, 'awakening');
  assert.equal(result.statuses.META001, 'pending');
  assert.deepEqual(validateBackup(makeBackup(result.statuses)).statuses, result.statuses);
  assert.equal(previewFleetImport(fleet(instance({ ships: [row({ extra_exp: 99999999 })] })), 0, ships, current()).statuses['001'], 'pending');
});

test('未完成扫描保留已有进度与未知ID；不因缺席推断未拥有', () => {
  const before = { ...current(), '001': 'done', Plan001: 'awakening', META001: 'unowned' };
  const input = fleet(instance({ latest_reading: { complete: false }, ships: [row({}), row({ group_type: 19901 }), row({ group_type: 970101 })],
    technology: { progress: { '10101': tech({ owned: false }) } } }));
  const result = previewFleetImport(input, 0, ships, before);
  assert.equal(result.statuses['001'], 'done');
  assert.equal(result.statuses.Plan001, 'awakening');
  assert.equal(result.statuses.META001, 'pending');
  assert.equal(result.statuses['002'], 'pending');
  assert.equal(result.statuses.Future001, 'done');
});

test('跳过待核对、未知组和待确认变更；编号存在时不按同名错配', () => {
  const input = fleet(instance({ ships: [row({ review: true, level: 125 }), row({ group_type: 99999, name: '测试舰', level: 125 })],
    has_pending_changes: true, pending: { ships: [row({ level: 125 })], technology: { progress: { '19901': tech({ lv120: true }) } } },
    technology: { progress: { '99999': tech({ lv120: true }) } } }));
  const result = previewFleetImport(input, 0, ships, current());
  assert.deepEqual(result.statuses, current());
  assert.equal(result.report.reviewed, 1);
  assert.equal(result.report.unmatchedShips, 1);
  assert.equal(result.report.unmatchedTechnology, 1);
  assert.equal(result.report.matched, 0);
});

test('无组编号时只匹配唯一原名或别名，保留META身份且不模糊猜测', () => {
  const input = fleet(instance({ ships: [row({ group_type: null, name: ' 和谐名 ', level: 120 }), row({ group_type: null, name: '别名.META', level: 125 }), row({ group_type: null, name: '方案', level: 125 })] }));
  const result = previewFleetImport(input, 0, ships, current());
  assert.equal(result.statuses['001'], 'done');
  assert.equal(result.statuses.META001, 'done');
  assert.equal(result.statuses.Plan001, 'pending');
  const ambiguous = [...ships, { id: '003', name: '重复', aliases: ['和谐名'] }];
  assert.equal(previewFleetImport(input, 0, ambiguous, current()).statuses['001'], 'pending');
});

test('多个实例保持隔离，拒绝未确认快照', () => {
  const input = fleet(instance({ ships: [row({ level: 125 })] }), instance({ instance: 'other', ships: [row({ group_type: 19901, level: 125 })] }));
  assert.equal(previewFleetImport(input, 0, ships, current()).statuses.Plan001, 'pending');
  assert.equal(previewFleetImport(input, 1, ships, current()).statuses['001'], 'pending');
  assert.throws(() => previewFleetImport(input, 2, ships, current()), /实例/);
  assert.throws(() => previewFleetImport(fleet(instance({ has_confirmed_snapshot: false })), 0, ships, current()), /确认/);
});

test('不支持的格式、损坏结构和无效状态在写入前拒绝', () => {
  for (const input of [null, [], {}, { ...fleet(instance()), version: 2 }, fleet(), fleet(null), fleet(instance({ ships: {} })),
    fleet(instance({ ships: [row({ level: 126 })] })), fleet(instance({ ships: [row({ level: '120' })] })),
    fleet(instance({ ships: [row({ group_type: -1 })] })), fleet(instance({ ships: [row({ review: 'false' })] })),
    fleet(instance({ technology: { progress: [] } })), fleet(instance({ technology: { progress: { '10101': tech({ lv120: 1 }) } } })),
    fleet(instance({ technology: { progress: { '<script>': tech() } } })),
  ]) assert.throws(() => validateFleetExport(input));
});
