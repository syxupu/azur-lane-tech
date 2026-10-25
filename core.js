export const STATUS = { pending: '待练级', done: '已达120级', unowned: '未拥有' };
const STATUS_ORDER = { pending: 0, unowned: 1, done: 2 };
export const DEFAULT_FILTERS = { target: '', stat: '', status: '', hull: '', faction: '', rarity: '', search: '', sort: 'id' };
export const HULLS = ['驱逐','轻巡','重巡','超巡','战巡','战列','航战','航母','轻航','重炮','维修','潜艇','潜母','运输','风帆','风帆S','风帆V','风帆M'];
export const STATS = ['装填','航空','炮击','命中','雷击','机动','防空','耐久','反潜'];

export function reconcile(ships, previous = null) {
  const statuses = { ...(previous?.statuses || {}) };
  let added = 0;
  for (const ship of ships) if (!Object.hasOwn(statuses, ship.id)) { statuses[ship.id] = 'pending'; added++; }
  return { statuses, added: previous ? added : 0 };
}

export function bonusValue(ship, target, stat) {
  return ship.bonuses.filter(b => (!target || b.targets.includes(target)) && (!stat || b.stat === stat)).reduce((sum, b) => sum + b.value, 0);
}

export function filterShips(ships, statuses, filters) {
  const search = filters.search.trim().toLocaleLowerCase();
  const result = ships.filter(s =>
    (!search || [s.name, s.id, ...s.aliases].some(x => x.toLocaleLowerCase().includes(search))) &&
    (!filters.status || statuses[s.id] === filters.status) &&
    (!filters.hull || s.hull === filters.hull) &&
    (!filters.faction || s.faction === filters.faction) &&
    (!filters.rarity || s.rarity === filters.rarity) &&
    s.bonuses.some(b => (!filters.target || b.targets.includes(filters.target)) && (!filters.stat || b.stat === filters.stat))
  );
  const idOrder = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true });
  const withinStatus = filters.sort === 'name' ? (a,b) => a.name.localeCompare(b.name, 'zh-CN') || idOrder(a,b) : filters.sort === 'bonus' ? (a,b) => bonusValue(b, filters.target, filters.stat) - bonusValue(a, filters.target, filters.stat) || idOrder(a,b) : idOrder;
  result.sort((a,b) => (STATUS_ORDER[statuses[a.id]] ?? 0) - (STATUS_ORDER[statuses[b.id]] ?? 0) || withinStatus(a,b));
  return result;
}

export function counts(ships, statuses) {
  const result = { done: 0, pending: 0, unowned: 0 };
  for (const s of ships) result[statuses[s.id] || 'pending']++;
  return result;
}

export function summarize(ships, statuses, target, stat) {
  const result = { total: 0, done: 0, pending: 0, unowned: 0, ships: 0 };
  for (const s of ships) {
    const value = bonusValue(s, target, stat);
    if (!value) continue;
    result.ships++;
    result.total += value;
    result[statuses[s.id] || 'pending'] += value;
  }
  return result;
}

export function validateBackup(input) {
  if (!input || input.app !== 'azur-tech-checklist' || input.version !== 1 || !input.statuses || typeof input.statuses !== 'object' || Array.isArray(input.statuses)) throw new Error('不是有效的舰队科技备份文件，或备份版本不受支持。');
  const entries = Object.entries(input.statuses);
  if (entries.length > 10000 || !entries.every(([id, state]) => /^[A-Za-z0-9_-]{1,80}$/.test(id) && Object.hasOwn(STATUS, state))) throw new Error('备份中的舰船编号或练级状态不正确，原有记录未改变。');
  return { app: input.app, version: 1, statuses: Object.fromEntries(entries) };
}

export function makeBackup(statuses) {
  return { app: 'azur-tech-checklist', version: 1, exportedAt: new Date().toISOString(), statuses: { ...statuses } };
}
