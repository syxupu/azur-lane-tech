import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_FILTERS, compareRarity, filterShips, reconcile } from '../core.js';
import { DEFAULT_RESEARCH, normalizeResearch, researchStage, matchesResearch, describeStage, NATIONS } from '../research.js';

const rules = JSON.parse(await readFile(new URL('../data/game-rules.json', import.meta.url), 'utf8'));
const catalog = JSON.parse(await readFile(new URL('../data/ships.json', import.meta.url), 'utf8'));
const ships = catalog.ships.map(ship => ({...ship, gameGroupId: rules.ships[ship.id]?.groupId}));
const find = name => { const ship = ships.find(ship => ship.name === name); assert.ok(ship, name); return ship; };
const research = name => rules.research.find(item => item.id === find(name).id);
const eligible = (name, stage, candidate, mode = 'vanguard') => matchesResearch(find(candidate), research(name).stages[stage], rules.ships, mode, find(name).id);

test('游戏规则快照覆盖全部科技条目和一期至九期47艘科研船的94段任务', () => {
  assert.equal(rules.schemaVersion, 1);
  assert.match(rules.sourceRevision, /^[a-f\d]{40}$/);
  assert.deepEqual(Object.keys(rules.ships).sort(), ships.map(ship => ship.id).sort());
  assert.equal(rules.research.length, 47);
  assert.deepEqual([...new Set(rules.research.map(item => item.season))], [1,2,3,4,5,6,7,8,9]);
  assert.deepEqual(rules.research.map(item => item.id), ships.filter(ship => ship.id.startsWith('Plan')).map(ship => ship.id));
  assert.equal(new Set(Object.values(rules.ships).map(info => info.groupId)).size, ships.length);
  for (const ship of ships) assert.ok(Number.isInteger(ship.gameGroupId) && ship.gameGroupId > 0);
  for (const item of rules.research) {
    assert.equal(item.stages.length, 2);
    for (const stage of item.stages) {
      assert.ok(['vanguard','main'].includes(stage.position));
      assert.ok([1000000,1200000,2000000,2400000].includes(stage.exp));
      assert.ok(stage.requirements.length);
      for (const condition of stage.requirements) { assert.ok(NATIONS[condition.nation]); assert.ok(condition.types.length && condition.types.every(Number.isInteger)); }
    }
  }
});
test('同稀有度按游戏组编号混排，方案舰和常规舰共享金/彩档；状态分组优先', () => {
  const names = ['罗恩','君主','企业','胡德','新泽西','吾妻','兰利','拉菲'];
  const sample = names.map(find);
  const sorted = [...sample].sort(compareRarity);
  assert.deepEqual(sorted.map(ship => ship.name), ['新泽西','吾妻','企业','胡德','君主','罗恩','拉菲','兰利']);
  assert.ok(find('企业').id.localeCompare(find('胡德').id,'en',{numeric:true}) < 0);
  assert.equal(compareRarity(find('罗恩'),find('君主')) > 0, true);
  const statuses = reconcile(sample).statuses; statuses[find('新泽西').id] = 'done'; statuses[find('罗恩').id] = 'unowned';
  const result = filterShips(sample, statuses, {...DEFAULT_FILTERS,sort:'rarity'});
  assert.deepEqual(result.map(ship => ship.name), ['吾妻','企业','胡德','君主','拉菲','兰利','罗恩','新泽西']);
  assert.deepEqual(sample.map(ship => ship.name), names);
});
test('同稀有度使用客户端编号而不是科技编号：新舰不会被挤到同档最后', () => {
  const sample = [{id:'900',rarity:'超稀有',gameGroupId:10101},{id:'004',rarity:'超稀有',gameGroupId:20101},{id:'Plan001',rarity:'最高方案',gameGroupId:19901}];
  assert.deepEqual(sample.toSorted(compareRarity).map(ship => ship.id), ['900','Plan001','004']);
});
test('马可波罗、契卡洛夫和瓦尔帕莱索逐段切换阵营，不能取两段并集', () => {
  for (const [name, first, second] of [['马可·波罗',[4,6],[2,6]],['契卡洛夫',[6,7],[1,7]],['瓦尔帕莱索',[2],[1]]]) {
    assert.deepEqual(research(name).stages.map(stage => stage.requirements.map(c => c.nation)), [first,second]);
  }
  assert.ok(eligible('马可·波罗',0,'俾斯麦'));
  assert.equal(eligible('马可·波罗',1,'俾斯麦'),false);
  assert.equal(eligible('马可·波罗',0,'胡德'),false);
  assert.ok(eligible('马可·波罗',1,'胡德'));
  assert.ok(eligible('契卡洛夫',1,'企业'));
  assert.equal(eligible('契卡洛夫',0,'企业'),false);
  assert.ok(eligible('瓦尔帕莱索',0,'胡德'));
  assert.equal(eligible('瓦尔帕莱索',1,'胡德'),false);
  assert.ok(eligible('瓦尔帕莱索',1,'企业'));
});
test('超巡的两段切换前后排，使用舰船自身舰种；潜艇和META不计入', () => {
  for (const name of ['吾妻','埃吉尔','布雷斯特']) assert.deepEqual(research(name).stages.map(stage => stage.position), ['main','vanguard']);
  assert.ok(eligible('吾妻',0,'长门'));
  assert.equal(eligible('吾妻',1,'长门'),false);
  assert.ok(eligible('吾妻',1,'绫波'));
  assert.equal(eligible('吾妻',0,'绫波'),false);
  assert.equal(eligible('安克雷奇',0,'企业'),false);
  assert.equal(eligible('安克雷奇',0,'大青花鱼'),false);
  assert.equal(eligible('白龙',0,'飞龙·META'),false);
  assert.equal(eligible('安克雷奇',0,'安克雷奇'),false);
  assert.ok(eligible('加斯科涅',0,'俾斯麦'));
  assert.ok(eligible('加斯科涅',0,'黎塞留'));
});
test('导驱按当前前后排模式匹配；普通驱逐不能被算成后排', () => {
  const ddg = ships.filter(ship => rules.ships[ship.id].alternateTypes);
  assert.deepEqual(ddg.map(ship => ship.name), ['鞍山','抚顺','长春','太原']);
  assert.ok(eligible('哈尔滨',0,'鞍山','vanguard'));
  assert.equal(eligible('哈尔滨',0,'鞍山','main'),false);
  const main = { requirements: [{nation:5,types:[4,5,6,7,21]}] };
  assert.ok(matchesResearch(find('鞍山'),main,rules.ships,'main'));
  assert.equal(matchesResearch(find('鞍山'),main,rules.ships,'vanguard'),false);
  assert.equal(matchesResearch(find('长风'),main,rules.ships,'main'),false);
});
test('科研筛选可与科技组合取交集，已达120级/未拥有状态不改变经验资格', () => {
  const selection = {shipId:find('白龙').id,stage:0};
  const stage = researchStage(selection,rules.research);
  const statuses = reconcile(ships).statuses;
  statuses[find('长门').id]='done'; statuses[find('赤城').id]='unowned';
  const result = filterShips(ships,statuses,{...DEFAULT_FILTERS,target:'航母',stat:'装填'}).filter(ship => matchesResearch(ship,stage,rules.ships));
  assert.ok(result.length);
  assert.ok(result.every(ship => ship.faction === '重樱' && ['轻航','航母','战列','战巡','航战','维修','重炮'].includes(ship.hull)));
  assert.ok(matchesResearch(find('长门'),stage,rules.ships));
  assert.ok(matchesResearch(find('赤城'),stage,rules.ships));
  assert.equal(matchesResearch({...find('长门'),id:'Future001'},stage,rules.ships),false);
});
test('科研偏好兼容旧设置，非法选择回退，不影响练级存档', () => {
  for (const value of [null,[],{}, {shipId:'Unknown'}]) assert.deepEqual(normalizeResearch(value,rules.research),DEFAULT_RESEARCH);
  const value = {shipId:'Plan047',stage:1,onlyMatches:true,missileMode:'main'};
  assert.deepEqual(normalizeResearch(value,rules.research),value);
  assert.deepEqual(normalizeResearch({...value,stage:99,onlyMatches:'yes',missileMode:'bad'},rules.research),{...value,stage:0,onlyMatches:false,missileMode:'vanguard'});
  assert.match(describeStage(research('瓦尔帕莱索').stages[1]),/白鹰.*主力.*240万/);
  assert.equal(researchStage(DEFAULT_RESEARCH,rules.research),null);
});
