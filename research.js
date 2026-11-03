export const NATIONS = { 1: '白鹰', 2: '皇家', 3: '重樱', 4: '铁血', 5: '东煌', 6: '撒丁帝国', 7: '北方联合', 8: '自由鸢尾', 9: '维希教廷', 11: '郁金王国', 12: '晶环联盟' };
export const POSITIONS = { vanguard: '先锋（前排）', main: '主力（后排）' };
export const DEFAULT_RESEARCH = { shipId: '', stage: 0, onlyMatches: false, missileMode: 'vanguard' };

export function normalizeResearch(value, catalog) {
  if (!value || !catalog.some(item => item.id === value.shipId)) return { ...DEFAULT_RESEARCH };
  return { shipId: value.shipId, stage: value.stage === 1 ? 1 : 0, onlyMatches: value.onlyMatches === true, missileMode: value.missileMode === 'main' ? 'main' : 'vanguard' };
}
export function researchStage(selection, catalog) {
  return catalog.find(item => item.id === selection.shipId)?.stages[selection.stage] || null;
}
export function matchesResearch(ship, stage, metadata, missileMode = 'vanguard', researchShipId = '') {
  if (!stage || ship.id === researchShipId) return false;
  const info = metadata[ship.id];
  if (!info || ship.faction === 'META') return false;
  const type = info.alternateTypes ? (missileMode === 'main' ? 21 : 20) : info.type;
  return stage.requirements.some(condition => condition.nation === info.nation && condition.types.includes(type));
}
export function describeStage(stage) {
  return `${stage.requirements.map(condition => NATIONS[condition.nation] || `阵营${condition.nation}`).join(' / ')} · ${POSITIONS[stage.position]} · ${stage.exp / 10000}万经验`;
}
