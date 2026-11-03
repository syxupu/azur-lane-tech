// Read selected literal fields from the extracted CN client tables; never execute Lua.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const repository = 'https://github.com/AzurLaneTools/AzurLaneLuaScripts';
const paths = ['CN/sharecfg/ship_data_group.lua', 'CN/sharecfg/ship_data_blueprint.lua', 'CN/sharecfgdata/task_data_template.lua', 'CN/sharecfgdata/ship_data_statistics.lua'];
async function download(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(45000)});
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return response.text();
}
function entries(lua, table) {
  const expression = new RegExp(`(?:_G\\.)?pg\\.base\\.${table}\\[(\\d+)\\] = \\{`, 'g');
  const matches = [...lua.matchAll(expression)];
  return new Map(matches.map((match, index) => [Number(match[1]), lua.slice(match.index + match[0].length, matches[index + 1]?.index ?? lua.length)]));
}
function number(body, field) {
  const match = body?.match(new RegExp(`^\\s*${field} = (\\d+)`, 'm'));
  if (!match) throw new Error(`Missing numeric field ${field}`);
  return Number(match[1]);
}
function array(body, field) {
  const match = body?.match(new RegExp(`^\\s*${field} = \\{`, 'm'));
  if (!match) throw new Error(`Missing array ${field}`);
  const start = match.index + match[0].length - 1;
  let depth = 0, end = start;
  for (; end < body.length; end++) {
    if (body[end] === '{') depth++;
    if (body[end] === '}' && --depth === 0) break;
  }
  const literal = body.slice(start, end + 1);
  if (!/^[\d\s{},]+$/.test(literal)) throw new Error(`Non-numeric Lua array: ${field}`);
  return JSON.parse(literal.replaceAll('{', '[').replaceAll('}', ']').replace(/,\s*]/g, ']'));
}
export function parseGameRules(catalog, groupLua, blueprintLua, taskLua, statisticsLua) {
  const groups = entries(groupLua, 'ship_data_group');
  const blueprints = entries(blueprintLua, 'ship_data_blueprint');
  const tasks = entries(taskLua, 'task_data_template');
  const missileGroups = new Set();
  for (const body of entries(statisticsLua, 'ship_data_statistics').values()) {
    if ([20, 21].includes(number(body, 'type'))) missileGroups.add(Math.floor(number(body, 'skin_id') / 10));
  }
  const ships = {}, research = [];
  for (const ship of catalog.ships) {
    const code = /^Plan/.test(ship.id) ? 20000 + Number(ship.id.slice(4)) : /^META/.test(ship.id) ? 30000 + Number(ship.id.slice(4)) : Number(ship.id);
    const group = groups.get(code);
    if (!group) throw new Error(`No client group for ${ship.id} ${ship.name}`);
    const groupId = number(group, 'group_type'), type = number(group, 'type');
    ships[ship.id] = { groupId, nation: number(group, 'nationality'), type };
    if (type === 1 && missileGroups.has(groupId)) ships[ship.id].alternateTypes = [20, 21];
    if (!ship.id.startsWith('Plan')) continue;
    const blueprint = blueprints.get(groupId);
    if (!blueprint) throw new Error(`No blueprint for ${ship.id}`);
    const stages = array(blueprint, 'unlock_task').map(([id]) => [id, tasks.get(id)]).filter(([, task]) => task && number(task, 'sub_type') === 1041).map(([taskId, task]) => {
      const pairs = array(task, 'target_id');
      const nations = [...new Set(pairs.map(([nation]) => nation))];
      const types = [...new Set(pairs.map(([, type]) => type))];
      const front = types.every(type => [1, 2, 3, 18, 19, 20, 23].includes(type));
      const back = types.every(type => [4, 5, 6, 7, 9, 10, 12, 13, 21, 24].includes(type));
      if (!pairs.length || !pairs.every(pair => pair.length === 2) || (!front && !back)) throw new Error(`Unknown research requirements: ${taskId}`);
      return { taskId, exp: number(task, 'target_num'), position: front ? 'vanguard' : 'main', requirements: nations.map(nation => ({ nation, types: pairs.filter(pair => pair[0] === nation).map(pair => pair[1]) })) };
    });
    if (stages.length !== 2) throw new Error(`${ship.id} needs exactly two XP tasks`);
    research.push({ id: ship.id, season: number(blueprint, 'blueprint_version'), stages });
  }
  if (research.length < 47 || Object.keys(ships).length !== catalog.ships.length) throw new Error('Incomplete game rules snapshot');
  return { ships, research };
}
async function main() {
  const sourceIndex = process.argv.indexOf('--source-dir');
  const local = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : null;
  // Resolve one immutable revision before downloading related tables.
  const revisionIndex = process.argv.indexOf('--revision');
  if (local && revisionIndex < 0) throw new Error('--source-dir requires --revision with the source commit SHA');
  const commit = local ? process.argv[revisionIndex + 1] : JSON.parse(await download('https://api.github.com/repos/AzurLaneTools/AzurLaneLuaScripts/commits/main')).sha;
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid source revision');
  const sources = await Promise.all(paths.map(path => local ? readFile(resolve(local, path.split('/').at(-1)), 'utf8') : download(`https://raw.githubusercontent.com/AzurLaneTools/AzurLaneLuaScripts/${commit}/${path}`)));
  const catalog = JSON.parse(await readFile(resolve(root, 'data/ships.json'), 'utf8'));
  const rules = parseGameRules(catalog, ...sources);
  const snapshot = { schemaVersion: 1, source: repository, sourceRevision: commit, updatedAt: new Date().toISOString(), ...rules };
  await writeFile(resolve(root, 'data/game-rules.json'), JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Validated ${Object.keys(rules.ships).length} client groups and ${rules.research.length} research ships (two stages each).`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
