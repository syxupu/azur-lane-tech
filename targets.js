/** A stable key for a beneficiary hull and level-120 stat pair. */
export function targetKey(target, stat) {
  return JSON.stringify([target, stat]);
}

function readTarget(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  if (typeof value.target !== 'string' || typeof value.stat !== 'string') return null;
  if (!value.target || !value.stat) return null;
  return { target: value.target, stat: value.stat };
}

function availableTargetKeys(ships) {
  const keys = new Set();
  for (const ship of Array.isArray(ships) ? ships : []) {
    for (const bonus of Array.isArray(ship?.bonuses) ? ship.bonuses : []) {
      if (typeof bonus?.stat !== 'string' || !Number.isFinite(bonus.value) || bonus.value <= 0) continue;
      for (const target of Array.isArray(bonus.targets) ? bonus.targets : []) {
        if (typeof target === 'string' && target) keys.add(targetKey(target, bonus.stat));
      }
    }
  }
  return keys;
}

/** Validate saved goals against actual rewards, preserving the first occurrence's order. */
export function normalizeTargets(input, ships) {
  if (!Array.isArray(input)) return [];
  const available = availableTargetKeys(ships);
  const seen = new Set();
  const result = [];
  for (const item of input) {
    const goal = readTarget(item);
    if (!goal) continue;
    const key = targetKey(goal.target, goal.stat);
    if (!available.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(goal);
  }
  return result;
}

/** Add a valid goal once. Invalid or duplicate additions leave the normalized list unchanged. */
export function addTarget(existing, goal, ships) {
  return normalizeTargets([...(Array.isArray(existing) ? existing : []), goal], ships);
}

/** Remove a pair without depending on the current catalog or changing other goals' order. */
export function removeTarget(existing, target, stat) {
  const removedKey = targetKey(target, stat);
  return (Array.isArray(existing) ? existing : [])
    .map(readTarget)
    .filter(goal => goal && targetKey(goal.target, goal.stat) !== removedKey);
}
