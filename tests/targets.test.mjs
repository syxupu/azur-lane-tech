import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addTarget, normalizeTargets, removeTarget, targetKey } from '../targets.js';

const { ships } = JSON.parse(await readFile(new URL('../data/ships.json', import.meta.url), 'utf8'));
const carrierReload = { target: '航母', stat: '装填' };
const lightCarrierReload = { target: '轻航', stat: '装填' };
const battleshipFire = { target: '战列', stat: '炮击' };

test('首次使用与损坏的目标设置均为空，不预设目标', () => {
  for (const value of [undefined, null, false, 1, '航母装填', {}, []]) {
    assert.deepEqual(normalizeTargets(value, ships), []);
  }
  assert.deepEqual(normalizeTargets([carrierReload], undefined), []);
});

test('目标必须匹配同一条真实奖励，不把不同舰种属性交叉拼接', () => {
  const fixture = [{ bonuses: [
    { targets: ['航母', '轻航'], stat: '装填', value: 1 },
    { targets: ['战列'], stat: '炮击', value: 2 },
    { targets: ['战列'], stat: '航空', value: 0 },
  ] }];
  assert.deepEqual(normalizeTargets([
    carrierReload, lightCarrierReload, battleshipFire,
    { target: '航母', stat: '炮击' }, { target: '战列', stat: '装填' },
    { target: '战列', stat: '航空' }, null, [], {}, { target: '航母', stat: 1 },
  ], fixture), [carrierReload, lightCarrierReload, battleshipFire]);
});

test('读取真实名单的用户目标，去重、剔除未知组合并保持顺序', () => {
  const input = [battleshipFire, carrierReload, { ...battleshipFire },
    { target: '未知舰种', stat: '装填' }, { target: '航母', stat: '未知属性' },
    { ...lightCarrierReload, extra: '仅保留目标字段' }];
  const before = structuredClone(input);
  assert.deepEqual(normalizeTargets(input, ships), [battleshipFire, carrierReload, lightCarrierReload]);
  assert.deepEqual(input, before);
});

test('添加只接受有效组合，同一目标不会重复且不修改输入', () => {
  const initial = Object.freeze([Object.freeze({ ...carrierReload })]);
  assert.deepEqual(addTarget(undefined, carrierReload, ships), [carrierReload]);
  assert.deepEqual(addTarget(initial, carrierReload, ships), [carrierReload]);
  assert.deepEqual(addTarget(initial, { target: '航母', stat: '不存在' }, ships), [carrierReload]);
  assert.deepEqual(addTarget(initial, battleshipFire, ships), [carrierReload, battleshipFire]);
  assert.deepEqual(initial, [carrierReload]);
});

test('删除只移除指定组合，删至空后保持空，不自动补回目标', () => {
  const initial = [carrierReload, lightCarrierReload, battleshipFire];
  assert.deepEqual(removeTarget(initial, '航母', '装填'), [lightCarrierReload, battleshipFire]);
  assert.deepEqual(removeTarget(initial, '航母', '航空'), initial);
  assert.deepEqual(removeTarget([carrierReload], '航母', '装填'), []);
  assert.deepEqual(normalizeTargets(removeTarget([carrierReload], '航母', '装填'), ships), []);
  assert.deepEqual(removeTarget(null, '航母', '装填'), []);
  assert.deepEqual(initial, [carrierReload, lightCarrierReload, battleshipFire]);
});

test('稳定目标键区分可能包含分隔符的字段', () => {
  assert.equal(targetKey('航母', '装填'), targetKey('航母', '装填'));
  assert.notEqual(targetKey('a|b', 'c'), targetKey('a', 'b|c'));
  assert.notEqual(targetKey('航母', '装填'), targetKey('轻航', '装填'));
});
