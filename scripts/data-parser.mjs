export const SOURCE = 'https://wiki.biligame.com/blhx/舰队科技';
const decode = s => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const text = s => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (s, key) => decode(s.match(new RegExp(`${key}="([^"]*)"`))?.[1] || '');
const hull = s => s === '正航' ? '航母' : s;

export function parseWiki(html) {
  const ships = [];
  for (const match of html.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)) {
    if (!match[1].includes('data-param8=')) continue;
    const cells = [...match[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
    if (cells.length !== 10) throw new Error('科技表结构变化：预期10列');
    const id = text(cells[0]);
    const name = attr(cells[1], 'title');
    const targets = [...new Set(attr(match[1], 'data-param8').split(',').map(hull).filter(Boolean))];
    const stat = attr(match[1], 'data-param10');
    const bonusText = text(cells[9]);
    const bonusMatch = bonusText.match(/^(.+?)\s+([^\s+]+)\s*\+(\d+)$/);
    const value = Number(bonusMatch?.[3]);
    const cellTargets = bonusMatch?.[1].split('/').map(s => hull(s.trim())).sort();
    if (!targets.length || !stat || !value || bonusMatch[2] !== stat || JSON.stringify([...targets].sort()) !== JSON.stringify(cellTargets)) throw new Error(`不能解析120级奖励：${id} ${bonusText}`);
    const image = attr(cells[1], 'src');
    const originalImage = image.replace('/thumb/', '/').replace(/\/25px-[^/]+$/, '');
    const link = attr(cells[1], 'href');
    const aliasMatch = text(cells[1]).match(/[（(]([^）)]+)[）)]/);
    ships.push({ id, name, aliases: aliasMatch ? [aliasMatch[1]] : [], hull: text(cells[3]), faction: text(cells[2]), rarity: attr(match[1], 'data-param2'), avatar: `assets/ships/${id}.jpg`, avatarSource: originalImage, url: new URL(link, SOURCE).href, bonuses: [{ targets, stat, value }] });
  }
  validateShips(ships);
  return ships;
}

export function validateShips(ships) {
  if (ships.length < 600) throw new Error(`数据不完整：仅${ships.length}艘，拒绝替换快照`);
  const seen = new Set();
  for (const s of ships) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(s.id) || seen.has(s.id)) throw new Error(`重复或无效ID：${s.id}`);
    seen.add(s.id);
    if (![s.name, s.hull, s.faction, s.rarity, s.url].every(Boolean)) throw new Error(`字段缺失：${s.id}`);
    for (const b of s.bonuses) {
      if (!b.targets.length || !b.stat || !Number.isInteger(b.value) || b.value <= 0) throw new Error(`奖励异常：${s.id}`);
    }
  }
}
