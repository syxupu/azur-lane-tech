// AzurPilot IDs identify game ship groups, not this site's technology entries.
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const RANK = { unowned: 0, pending: 1, awakening: 2, done: 3 };
const normalizeName = name => name.normalize('NFKC').trim().replace(/\s+/g, '').replace(/[·・•．.]/g, '·').toLocaleLowerCase();

export function normalizeFleetExport(input) {
  if (!isObject(input) || input.version !== 1) {
    throw new Error('请选择本工具的备份或 AzurPilot v1 船坞导出 JSON，原有记录未改变。');
  }
  const kind = input.format === 'azurpilot-fleet-export' ? 'fleet' :
    !Object.hasOwn(input, 'format') && !Object.hasOwn(input, 'app') && input.source === 'ledger' ? 'ledger' : null;
  if (!kind) throw new Error('请选择本工具的备份或 AzurPilot v1 船坞导出 JSON，原有记录未改变。');
  // A standalone ledger declares no confirmed-snapshot flag. Keep its origin
  // explicit instead of manufacturing one to pass the full-fleet validation.
  const instances = kind === 'fleet' ? input.instances : [{ instance: input.instance, ships: input.ships }];
  if (!Array.isArray(instances) || !instances.length || instances.length > 100) {
    throw new Error('船坞导出缺少有效实例，原有记录未改变。');
  }
  let total = 0;
  for (const instance of instances) {
    if (!isObject(instance) || typeof instance.instance !== 'string' || !instance.instance.trim() || instance.instance.length > 200 ||
        (kind === 'fleet' && typeof instance.has_confirmed_snapshot !== 'boolean') || !Array.isArray(instance.ships)) {
      throw new Error('船坞实例格式不正确，原有记录未改变。');
    }
    total += instance.ships.length;
    for (const ship of instance.ships) {
      if (!isObject(ship) || typeof ship.name !== 'string' || ship.name.length > 200 || typeof ship.review !== 'boolean' ||
          !(ship.group_type == null || (Number.isSafeInteger(ship.group_type) && ship.group_type > 0)) ||
          !(ship.level == null || (Number.isInteger(ship.level) && ship.level >= (ship.review ? 0 : 1) && ship.level <= 125))) {
        throw new Error('船坞舰船编号、等级或核对状态不正确，原有记录未改变。');
      }
    }
    if (instance.technology != null && !isObject(instance.technology)) throw new Error('船坞科技记录格式不正确。');
    const progress = instance.technology?.progress;
    if (progress != null) {
      if (!isObject(progress)) throw new Error('船坞科技记录格式不正确。');
      const entries = Object.entries(progress);
      total += entries.length;
      for (const [group, value] of entries) {
        if (!/^[1-9]\d{0,8}$/.test(group) || !isObject(value) ||
            !['owned', 'lv120', 'awakening_pending'].every(key => typeof value[key] === 'boolean')) {
          throw new Error('船坞科技编号或状态不正确，原有记录未改变。');
        }
      }
    }
    if (total > 50000) throw new Error('船坞导出记录过多，请分实例导出。');
  }
  return { kind, instances };
}

export function validateFleetExport(input) {
  normalizeFleetExport(input);
  return input;
}

export function previewFleetImport(input, instanceIndex, ships, current) {
  const { kind, instances } = normalizeFleetExport(input);
  const instance = instances[instanceIndex];
  if (!instance) throw new Error('请选择要导入的船坞实例。');
  if (kind === 'fleet' && !instance.has_confirmed_snapshot) throw new Error('此实例还没有已确认快照，请先在 AzurPilot 核对并确认船坞。');
  const groups = new Map(), names = new Map();
  for (const ship of ships) {
    if (ship.gameGroupId) groups.set(String(ship.gameGroupId), ship.id);
    // Ambiguous names never select an arbitrary technology entry.
    for (const name of new Set([ship.name, ...ship.aliases].map(normalizeName))) {
      if (!name) continue;
      names.set(name, names.has(name) && names.get(name) !== ship.id ? null : ship.id);
    }
  }
  const incoming = new Map();
  const report = { reviewed: 0, unmatchedShips: 0, unmatchedTechnology: 0, duplicates: 0, matched: 0, changed: 0 };
  const observed = new Set();
  const record = (id, state) => {
    if (!incoming.has(id) || RANK[state] > RANK[incoming.get(id)]) incoming.set(id, state);
  };
  for (const ship of instance.ships) {
    if (ship.review) { report.reviewed++; continue; }
    const id = ship.group_type != null ? groups.get(String(ship.group_type)) : names.get(normalizeName(ship.name));
    if (!id) { report.unmatchedShips++; continue; }
    if (observed.has(id)) report.duplicates++;
    observed.add(id);
    record(id, ship.level >= 120 ? 'done' : 'pending');
  }
  for (const [group, progress] of Object.entries(instance.technology?.progress || {})) {
    const id = groups.get(group);
    if (!id) { report.unmatchedTechnology++; continue; }
    record(id, progress.lv120 ? 'done' : progress.awakening_pending ? 'awakening' : progress.owned ? 'pending' : 'unowned');
  }
  // Incomplete scans cannot prove absence. Preserve existing completion and
  // awakening records, and never combine accounts or infer unowned from absence.
  const statuses = { ...current };
  for (const [id, state] of incoming) {
    const existing = statuses[id] || 'pending';
    if (RANK[state] > RANK[existing] || (state === 'unowned' && !Object.hasOwn(statuses, id))) statuses[id] = state;
    if (statuses[id] !== current[id]) report.changed++;
  }
  report.matched = incoming.size;
  return { statuses, report };
}
