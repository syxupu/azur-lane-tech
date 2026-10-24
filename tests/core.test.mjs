import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_FILTERS, reconcile, filterShips, summarize, counts, makeBackup, validateBackup } from '../core.js';
import { validateShips, parseWiki } from '../scripts/data-parser.mjs';

const catalog = JSON.parse(await readFile(new URL('../data/ships.json',import.meta.url),'utf8'));
const ships = catalog.ships;
const state = () => reconcile(ships).statuses;
const filter = patch => ({...DEFAULT_FILTERS,...patch});

test('完整快照：ID唯一、必要字段和全部头像有效',async()=>{
  validateShips(ships);
  assert.equal(new Set(ships.map(s=>s.id)).size,ships.length);
  await Promise.all(ships.map(async s=>{
    const image=await readFile(new URL('../'+s.avatar,import.meta.url));
    assert.ok(image.length>500,`${s.id}头像过小`);
    assert.ok((image[0]===0xff&&image[1]===0xd8)||image.toString('ascii',0,4)==='RIFF'||image[0]===0x89,`${s.id}头像不是受支持图片`);
    assert.match(s.url,/^https:\/\/wiki.biligame.com\/blhx\//);
  }));
});
test('四个快捷目标准确覆盖120级奖励（包括轻航提供的航母装填）',()=>{
  const expected=[['航母','装填',27,29],['航母','航空',42,61],['战列','装填',16,18],['战列','炮击',64,83]];
  for(const [target,stat,count,total] of expected){
    const result=filterShips(ships,state(),filter({target,stat}));
    assert.equal(result.length,count);
    assert.equal(summarize(ships,state(),target,stat).total,total);
    assert.ok(result.every(s=>s.bonuses.some(b=>b.targets.includes(target)&&b.stat===stat)));
  }
  assert.ok(filterShips(ships,state(),filter({target:'航母',stat:'装填'})).some(s=>s.name==='兰利'&&s.hull==='轻航'));
});
test('科研与META独立条目、国服别名、多舰种加成',()=>{
  const monarch=ships.find(s=>s.id==='Plan002');
  assert.equal(monarch.name,'君主');
  assert.deepEqual(monarch.bonuses,[{targets:['战巡','战列','航战'],stat:'炮击',value:2}]);
  assert.equal(ships.find(s=>s.id==='META001').bonuses[0].stat,'命中');
  assert.ok(filterShips(ships,state(),filter({search:'鲨',faction:'重樱',hull:'战列'})).some(s=>s.name==='长门'));
  assert.ok(filterShips(ships,state(),filter({search:'龙·meta',faction:'META'})).some(s=>s.name==='飞龙·META'));
});
test('加成总数不随未拥有混淆，完成一艘对每个受益舰种各计一次',()=>{
  const statuses=state();statuses.Plan002='done';
  for(const target of ['战巡','战列','航战']) assert.equal(summarize(ships,statuses,target,'炮击').done,2);
  statuses['072']='unowned';statuses['070']='done';
  const summary=summarize(ships,statuses,'航母','装填');
  assert.deepEqual(summary,{total:29,done:1,pending:27,unowned:1,ships:27});
  assert.equal(counts(ships,statuses).done,2);
});
test('全部完成、全部未拥有及无匹配状态',()=>{
  const statuses=Object.fromEntries(ships.map(s=>[s.id,'done']));
  assert.equal(filterShips(ships,statuses,filter({status:'pending'})).length,0);
  assert.equal(counts(ships,statuses).done,ships.length);
  for(const s of ships)statuses[s.id]='unowned';
  assert.equal(counts(ships,statuses).unowned,ships.length);
  assert.equal(summarize(ships,statuses,'航母','航空').unowned,61);
  assert.equal(filterShips(ships,statuses,filter({search:'不存在的舰船xyz'})).length,0);
});
test('目标加成排序、中文名称排序和筛选组合',()=>{
  const rows=filterShips(ships,state(),filter({target:'战列',stat:'炮击',faction:'皇家',sort:'bonus'}));
  assert.ok(rows.length>0);
  assert.equal(rows[0].bonuses[0].value,2);
  assert.ok(rows.every(s=>s.faction==='皇家'));
  const named=filterShips(ships,state(),filter({search:'meta',sort:'name'}));
  assert.ok(named.every((s,i)=>!i||named[i-1].name.localeCompare(s.name,'zh-CN')<=0));
});
test('备份往返不丢状态或未知ID；名单新增只补待练级',()=>{
  const statuses=state();statuses['070']='done';statuses['072']='unowned';statuses.Future001='done';
  const backup=validateBackup(JSON.parse(JSON.stringify(makeBackup(statuses))));
  assert.deepEqual(backup.statuses,statuses);
  const future=reconcile([...ships,{id:'Future002'}],backup);
  assert.equal(future.statuses['070'],'done');assert.equal(future.statuses.Future001,'done');
  assert.equal(future.statuses.Future002,'pending');assert.equal(future.added,1);
  const undo={...statuses};statuses['070']='pending';assert.equal(undo['070'],'done');
});
test('错误格式、版本、状态及恶意ID被拒绝',()=>{
  for(const invalid of [null,[],{}, {app:'azur-tech-checklist',version:2,statuses:{}}, {app:'azur-tech-checklist',version:1,statuses:[]}, {app:'azur-tech-checklist',version:1,statuses:{'072':'120'}}, {app:'azur-tech-checklist',version:1,statuses:{'<script>':'done'}}]) assert.throws(()=>validateBackup(invalid));
});
test('解析器遇到空页面或不完整名单时拒绝替换',()=>{
  assert.throws(()=>parseWiki('<html>服务器维护中</html>'),/不完整/);
  assert.throws(()=>validateShips(ships.slice(0,3)),/不完整/);
  const duplicate=structuredClone(ships);duplicate[1].id=duplicate[0].id;
  assert.throws(()=>validateShips(duplicate),/重复/);
});
