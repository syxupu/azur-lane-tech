export const STATUS = { pending: '待练级', awakening: '待觉醒', done: '已达120级', unowned: '未拥有' };
const STATUS_ORDER = { pending: 0, awakening: 1, unowned: 2, done: 3 };
const BACKUP_STATUSES = new Set(['pending', 'done', 'unowned']);
export const DEFAULT_FILTERS = { target: '', stat: '', status: '', hull: '', faction: '', rarity: '', search: '', sort: 'rarity' };
export const HULLS = ['驱逐','轻巡','重巡','超巡','战巡','战列','航战','航母','轻航','重炮','维修','潜艇','潜母','运输','风帆','风帆S','风帆V','风帆M'];
export const STATS = ['装填','航空','炮击','命中','雷击','机动','防空','耐久','反潜'];
const RARITY_ORDER = { '普通': 2, '稀有': 3, '精锐': 4, '超稀有': 5, '最高方案': 5, '海上传奇': 6, '决战方案': 6 };

// Client: ShipIndexConst.sortByCfg("rarity") => -getRarity(), configId.
// Technology entries do not track individual retrofit or breakout states.
export function compareRarity(a, b) {
  return (RARITY_ORDER[b.rarity] || 0) - (RARITY_ORDER[a.rarity] || 0) ||
    (a.gameGroupId ?? Number.MAX_SAFE_INTEGER) - (b.gameGroupId ?? Number.MAX_SAFE_INTEGER) ||
    a.id.localeCompare(b.id, 'en', { numeric: true });
}

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
  const withinStatus = filters.sort === 'rarity' ? compareRarity : filters.sort === 'name' ? (a,b) => a.name.localeCompare(b.name, 'zh-CN') || idOrder(a,b) : filters.sort === 'bonus' ? (a,b) => bonusValue(b, filters.target, filters.stat) - bonusValue(a, filters.target, filters.stat) || idOrder(a,b) : idOrder;
  result.sort((a,b) => (STATUS_ORDER[statuses[a.id]] ?? 0) - (STATUS_ORDER[statuses[b.id]] ?? 0) || withinStatus(a,b));
  return result;
}

export function counts(ships, statuses) {
  const result = { done: 0, pending: 0, awakening: 0, unowned: 0 };
  for (const s of ships) result[statuses[s.id] || 'pending']++;
  return result;
}

export function summarize(ships, statuses, target, stat) {
  const result = { total: 0, done: 0, pending: 0, awakening: 0, unowned: 0, ships: 0 };
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
  if (entries.length > 10000 || !entries.every(([id, state]) => /^[A-Za-z0-9_-]{1,80}$/.test(id) && BACKUP_STATUSES.has(state))) throw new Error('备份中的舰船编号或练级状态不正确，原有记录未改变。');
  const awakening = Object.hasOwn(input, 'awakening') ? input.awakening : [];
  if (!Array.isArray(awakening) || awakening.length > 10000 || new Set(awakening).size !== awakening.length || !awakening.every(id => typeof id === 'string' && Object.hasOwn(input.statuses, id) && input.statuses[id] === 'pending')) throw new Error('备份中的待觉醒记录不正确，原有记录未改变。');
  const statuses = Object.fromEntries(entries);
  for (const id of awakening) statuses[id] = 'awakening';
  return { app: input.app, version: 1, statuses };
}

export function makeBackup(statuses) {
  // Preserve the v1 status vocabulary so older versions can still read progress.
  // The optional ID list restores the more precise state in this version.
  const awakening = Object.keys(statuses).filter(id => statuses[id] === 'awakening');
  return { app: 'azur-tech-checklist', version: 1, exportedAt: new Date().toISOString(),
    statuses: Object.fromEntries(Object.entries(statuses).map(([id, state]) => [id, state === 'awakening' ? 'pending' : state])),
    ...(awakening.length ? { awakening } : {}) };
}
