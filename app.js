import { STATUS, DEFAULT_FILTERS, HULLS, STATS, reconcile, filterShips, counts, summarize, validateBackup, makeBackup } from './core.js';
import { icon } from './ui-icons.js';
import { normalizeTargets, addTarget, removeTarget, targetKey } from './targets.js';

const $ = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const STORE = 'azur-tech:progress:v1';
const PREFS = 'azur-tech:preferences:v1';
const PAGE_SIZE = 60;
const mobile = matchMedia('(max-width: 1023px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let ships = [], statuses = {}, filters = { ...DEFAULT_FILTERS }, view = 'grid', page = 1;
let selected = new Set(), previous = null, importData = null, filtered = [], ready = false;
let toastTimer, announceTimer;
let userTargets = [], hullIcons = {};

for (const node of document.querySelectorAll('[data-icon]')) node.innerHTML = icon(node.dataset.icon);

function hullIcon(hull) {
  const path = hullIcons[hull]?.path;
  return path ? `<img class="hull-icon" src="${esc(path)}" alt="" width="52" height="32" aria-hidden="true">` : icon('ship', 'hull-fallback');
}
function renderTargets() {
  $('targets-empty').hidden = userTargets.length > 0;
  $('quick-targets').innerHTML = userTargets.map(({target,stat},i) => `
    <div class="target-item"><button class="target-card" data-quick="${i}" aria-pressed="false">
      <span class="target-top"><span class="target-symbol">${hullIcon(target)}</span><span class="target-name">${esc(target)} <strong>${esc(stat)}</strong></span></span>
      <span class="target-bottom"><span><b class="q-pending">—</b> 艘待练</span><span class="target-earned">已得 <b class="q-done">+0</b><span class="q-total"> / —</span></span></span>
      <span class="target-progress" aria-hidden="true"><span></span></span>
    </button><button class="target-remove icon-button" data-remove-target="${i}" aria-label="删除目标：${esc(target+stat)}" title="删除目标">${icon('x')}</button></div>`).join('');
}
function updateTargetForm() {
  const target = $('new-target-hull').value, stat = $('new-target-stat').value;
  $('new-target-icon').innerHTML = target ? hullIcon(target) : icon('target');
  const duplicate = userTargets.some(t => targetKey(t.target,t.stat) === targetKey(target,stat));
  $('save-target').disabled = !target || !stat || duplicate;
  $('target-form-message').classList.toggle('duplicate', duplicate);
  if (duplicate) $('target-form-message').textContent = '这个目标已在你的清单中，无需重复添加。';
  else if (target && stat) {
    const s = summarize(ships,statuses,target,stat);
    const pending = filterShips(ships,statuses,{...DEFAULT_FILTERS,target,stat,status:'pending'}).length;
    $('target-form-message').textContent = `${s.ships} 艘提供此项科技，${pending} 艘待练。已获得 +${s.done} / ${s.total}。`;
  } else $('target-form-message').textContent = '选择受益舰种与属性，保存为你的科技目标。';
}
function openTargetForm() {
  if (!ready) return;
  $('new-target-hull').value = '';
  $('new-target-stat').innerHTML = '<option value="">先选择受益舰种</option>';
  $('new-target-stat').disabled = true;
  updateTargetForm();
  $('target-dialog').showModal();
  $('new-target-hull').focus();
}

function announce(message) {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { $('live-message').textContent = message; }, 120);
}
function toast(message, error = false) {
  $('toast').innerHTML = `${icon(error ? 'help' : 'circle-check')}<span>${esc(message)}</span>`;
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  announce(message);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 7000 : 4500);
}
function warning(message) {
  $('storage-warning').textContent = message;
  $('storage-warning').hidden = false;
  $('save-status').innerHTML = `${icon('help')}保存遇到问题`;
}
function saveProgress() {
  try {
    localStorage.setItem(STORE, JSON.stringify(makeBackup(statuses)));
    $('storage-warning').hidden = true;
    $('save-status').innerHTML = `${icon('shield')}已保存到本地`;
  } catch { warning('浏览器未能保存记录。当前页面的修改仍在，请导出备份后再关闭页面。'); }
}
function savePrefs() {
  try { localStorage.setItem(PREFS, JSON.stringify({ filters, view, targets: userTargets, dismissed: $('onboarding').hidden })); }
  catch { warning('浏览器未能保存设置，请导出练级记录备份。'); }
}
function fillSelect(id, values) {
  $(id).insertAdjacentHTML('beforeend', values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join(''));
}
function scrollToList() {
  $('collection').scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
}
function setFilters(patch) {
  if (!ready) return;
  const chipHadFocus = document.activeElement?.hasAttribute('data-remove-filter');
  filters = { ...filters, ...patch };
  page = 1;
  selected.clear();
  syncControls(); savePrefs(); render();
  if (chipHadFocus) ($('active-filters').querySelector('button') || $('search')).focus({ preventScroll: true });
  announce(`找到 ${filtered.length} 艘${filters.status ? STATUS[filters.status] : ''}舰船。`);
}
function syncControls() {
  for (const select of document.querySelectorAll('[data-filter]')) select.value = filters[select.dataset.filter];
  if ($('search').value !== filters.search) $('search').value = filters.search;
  $('sort').value = filters.sort;
  for (const v of ['grid','table']) {
    $(`${v}-view`).classList.toggle('active', view === v);
    $(`${v}-view`).setAttribute('aria-pressed', String(view === v));
  }
  for (const button of document.querySelectorAll('[data-status]')) {
    const active = filters.status === button.dataset.status;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}
function renderOverview() {
  const c = counts(ships, statuses);
  const percent = ships.length ? Math.round(c.done / ships.length * 100) : 0;
  for (const key of Object.keys(c)) {
    $(`count-${key}`).textContent = c[key];
    $(`mobile-count-${key}`).textContent = c[key];
  }
  $('percent').innerHTML = `${percent}<small>%</small>`;
  $('completion-fraction').innerHTML = `${c.done} <span>/ ${ships.length}</span> <small>艘</small>`;
  $('progress-ring').style.setProperty('--progress', `${ships.length ? c.done / ships.length * 360 : 0}deg`);
  $('progress-ring').setAttribute('aria-valuenow', String(percent));
  $('progress-ring').setAttribute('aria-valuetext', `${c.done} 艘已达120级，共 ${ships.length} 艘`);
  userTargets.forEach(({target,stat},i) => {
    const s = summarize(ships,statuses,target,stat);
    const pending = filterShips(ships,statuses,{...DEFAULT_FILTERS,target,stat,status:'pending'}).length;
    const button = document.querySelector(`[data-quick="${i}"]`);
    const active = filters.target === target && filters.stat === stat;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.querySelector('.q-pending').textContent = pending;
    button.querySelector('.q-done').textContent = `+${s.done}`;
    button.querySelector('.q-total').textContent = ` / ${s.total}`;
    button.querySelector('.target-progress > span').style.transform = `scaleX(${s.total ? s.done/s.total : 0})`;
  });
  if ($('tech-dialog').open) renderMatrix();
}
function renderMatrix() {
  const target = $('matrix-target').value;
  $('tech-matrix').innerHTML = STATS.map(stat => {
    const s = summarize(ships,statuses,target,stat);
    return `<button class="matrix-card" data-matrix-target="${esc(target)}" data-matrix-stat="${stat}" ${s.total ? '' : 'disabled'} aria-label="${esc(target)}${stat}，已获得${s.done}，上限${s.total}，查看舰船"><span class="matrix-title">${stat}${icon('arrow-up-right')}</span><strong>+${s.done}<small> / ${s.total}</small></strong><span>${s.total ? `待练可得 +${s.pending} · 未拥有 +${s.unowned}` : '暂无120级科技加成'}</span></button>`;
  }).join('');
}
function renderFilters() {
  const labels = { target:'受益', stat:'属性', hull:'自身', faction:'阵营', rarity:'稀有度', search:'搜索' };
  const active = Object.keys(labels).filter(key => filters[key]);
  $('active-filters').innerHTML = active.map(key => `<button class="filter-chip" data-remove-filter="${key}" aria-label="清除${labels[key]}筛选：${esc(filters[key])}">${labels[key]}：${esc(filters[key])}${icon('x')}</button>`).join('');
  const formCount = ['target','stat','hull','faction','rarity'].filter(k => filters[k]).length;
  $('active-filter-count').textContent = formCount || '';
  $('goal-summary').hidden = !filters.target || !filters.stat;
  if (filters.target && filters.stat) {
    const s = summarize(ships,statuses,filters.target,filters.stat);
    $('goal-summary').innerHTML = `<div class="goal-title">${hullIcon(filters.target)}<span><strong>${filters.target} · ${filters.stat}</strong><small>该目标全名单的120级奖励</small></span></div><div class="goal-values"><span>已获得<b>+${s.done}</b></span><span>待练可得<b>+${s.pending}</b></span><span>未拥有可得<b>+${s.unowned}</b></span></div>`;
  }
  const c = counts(filterShips(ships,statuses,{...filters,status:''}),statuses);
  $('status-count-all').textContent = c.pending + c.done + c.unowned;
  for (const key of Object.keys(c)) $(`status-count-${key}`).textContent = c[key];
  const title = filters.target && filters.stat ? `${filters.target}${filters.stat}` : '舰船清单';
  $('list-title').innerHTML = `${esc(title)} <span id="result-count">${filtered.length}<small> 艘</small></span>`;
  $('list-subtitle').textContent = `待练级 → 未拥有 → 已达120级。点击${view === 'grid' ? '卡片' : '整行'}选择，再次点击取消；舰名可打开百科。`;
  $('selection-scope').textContent = `（${filtered.length}艘，含其他页）`;
  $('apply-filters').textContent = `查看 ${filtered.length} 艘舰船`;
}
function portrait(s) {
  return `<span class="portrait rarity-${esc(s.rarity)}"><span class="portrait-fallback" aria-hidden="true">${esc(s.name.slice(0,2))}</span><img src="${esc(s.avatar)}" alt="${esc(s.name)}头像" loading="lazy" decoding="async" width="64" height="64"></span>`;
}
function bonuses(s) {
  return s.bonuses.map(b => `<span class="bonus"><span class="bonus-targets">${esc(b.targets.join(' / '))}</span><strong>${esc(b.stat)} <b>+${b.value}</b></strong></span>`).join('');
}
function statusSelect(s) {
  const state = statuses[s.id];
  return `<label class="status-select ${state}">${icon(state === 'done' ? 'circle-check' : state === 'pending' ? 'clock' : 'minus')}<span class="sr-only">${esc(s.name)}的练级状态</span><select data-ship-status="${esc(s.id)}" aria-label="${esc(s.name)}的练级状态">${Object.entries(STATUS).map(([v,label]) => `<option value="${v}" ${state === v ? 'selected' : ''}>${label}</option>`).join('')}</select>${icon('chevron-down','select-chevron')}</label>`;
}
function selectControl(s) {
  return `<button class="ship-select-toggle" data-select="${esc(s.id)}" aria-label="选择${esc(s.name)}" aria-pressed="${selected.has(s.id)}" aria-describedby="ship-selection-help"></button>`;
}
function card(s) {
  return `<article class="ship-card ${statuses[s.id]} ${selected.has(s.id)?'selected':''}" data-card="${s.id}">${selectControl(s)}<div class="card-top"><span class="ship-id">NO. ${esc(s.id)}</span><span class="selected-mark" aria-hidden="true">${icon('check')}已选</span><span class="rarity-label">${esc(s.rarity)}</span></div><div class="ship-identity">${portrait(s)}<div><a class="ship-name" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="在BWIKI查看${esc(s.name)}">${esc(s.name)}</a>${s.aliases.length ? `<span class="ship-alias">${esc(s.aliases.join(' / '))}</span>` : ''}<div class="ship-meta">${esc(s.faction)}<span class="hull-label">${hullIcon(s.hull)}${esc(s.hull)}</span></div></div></div><div class="card-bonus"><span class="bonus-label">120级科技加成</span>${bonuses(s)}</div><div class="card-bottom">${statusSelect(s)}</div></article>`;
}
function tableRow(s) {
  return `<tr data-card="${s.id}" class="${statuses[s.id]} ${selected.has(s.id)?'selected':''}"><td class="ship-id" data-label="图鉴编号">${selectControl(s)}${esc(s.id)}<span class="selected-mark" aria-hidden="true">${icon('check')}已选</span></td><td class="row-identity" data-label="舰船"><div class="table-identity">${portrait(s)}<div><a class="ship-name" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a><div class="ship-meta"><span class="hull-label">${hullIcon(s.hull)}${esc(s.hull)}</span>${s.aliases.length ? ' · '+esc(s.aliases.join(' / ')) : ''}</div></div></div></td><td class="row-faction" data-label="阵营 / 稀有度"><div>${esc(s.faction)}</div><span class="ship-meta">${esc(s.rarity)}</span></td><td class="row-bonus" data-label="120级加成">${bonuses(s)}</td><td class="row-status" data-label="练级状态">${statusSelect(s)}</td></tr>`;
}
function renderList() {
  const visible = filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
  $('ship-list').className = view === 'grid' ? 'ship-grid' : 'ship-table-wrap';
  $('ship-list').setAttribute('aria-busy', 'false');
  if (!visible.length) {
    $('ship-list').innerHTML = `<div class="empty"><span class="empty-icon">${icon('search')}</span><h3>没有符合条件的舰船</h3><p>调整科技目标或练级状态，继续寻找下一艘目标。</p><button class="button primary" id="empty-reset">清除全部筛选</button></div>`;
  } else if (view === 'grid') {
    $('ship-list').innerHTML = visible.map(card).join('');
  } else {
    $('ship-list').innerHTML = `<table class="ship-table"><caption class="sr-only">当前筛选的舰船和120级科技加成</caption><thead><tr><th scope="col">编号</th><th scope="col">舰船 / 自身舰种</th><th scope="col">阵营 / 稀有度</th><th scope="col">120级加成</th><th scope="col">练级状态</th></tr></thead><tbody>${visible.map(tableRow).join('')}</tbody></table>`;
  }
  for (const img of $('ship-list').querySelectorAll('img')) img.addEventListener('error', () => { img.hidden = true; }, { once: true });
  const pages = Math.ceil(filtered.length/PAGE_SIZE);
  $('pagination').innerHTML = pages > 1 ? `<span>显示 ${(page-1)*PAGE_SIZE+1}–${Math.min(page*PAGE_SIZE,filtered.length)} / ${filtered.length} 艘</span><div><button class="icon-button" data-page="${page-1}" ${page===1?'disabled':''} aria-label="上一页">${icon('chevron-left')}</button><span>${page} / ${pages}</span><button class="icon-button" data-page="${page+1}" ${page===pages?'disabled':''} aria-label="下一页">${icon('chevron-right')}</button></div>` : `<span>已显示全部 ${filtered.length} 艘舰船</span>`;
  syncSelection();
}
function syncSelection() {
  $('selection-count').textContent = selected.size ? `已选 ${selected.size}` : '';
  $('batch-count').textContent = selected.size;
  $('batch-bar').hidden = !selected.size;
  document.body.classList.toggle('has-selection', selected.size > 0);
  $('select-all').checked = filtered.length > 0 && filtered.every(s => selected.has(s.id));
  $('select-all').indeterminate = selected.size > 0 && !$('select-all').checked;
  $('select-all').disabled = !filtered.length;
  for (const control of $('ship-list').querySelectorAll('[data-select]')) {
    const active = selected.has(control.dataset.select);
    control.setAttribute('aria-pressed', String(active));
    control.closest('[data-card]').classList.toggle('selected', active);
  }
}
function focusBookmark() {
  const el = document.activeElement;
  const id = el?.dataset.shipStatus || el?.dataset.select;
  return id ? { id, type: el.dataset.shipStatus ? 'data-ship-status' : 'data-select', index: [...$('ship-list').querySelectorAll(`[${el.dataset.shipStatus ? 'data-ship-status' : 'data-select'}]`)].indexOf(el) } : null;
}
function restoreFocus(bookmark) {
  if (!bookmark) return;
  const nodes = [...$('ship-list').querySelectorAll(`[${bookmark.type}]`)];
  const target = nodes.find(el => el.getAttribute(bookmark.type) === bookmark.id) || nodes[Math.min(bookmark.index,nodes.length-1)] || $('list-title');
  target.focus({ preventScroll: true });
}
function render() {
  const bookmark = focusBookmark();
  filtered = filterShips(ships,statuses,filters);
  page = Math.max(1,Math.min(page,Math.ceil(filtered.length/PAGE_SIZE)||1));
  renderOverview(); renderFilters(); renderList();
  $('undo').disabled = previous === null;
  restoreFocus(bookmark);
}
function changeStatuses(ids, state) {
  if (!ready || !Object.hasOwn(STATUS,state)) return;
  const changes = ids.filter(id => statuses[id] !== state);
  if (!changes.length) { toast('所选舰船已经是这个状态'); return; }
  const fromBatch = Boolean(document.activeElement?.closest('#batch-bar'));
  previous = { ...statuses };
  for (const id of changes) statuses[id] = state;
  selected.clear(); saveProgress(); render();
  if (fromBatch) { $('list-title').focus({ preventScroll: true }); scrollToList(); }
  toast(`已将 ${changes.length} 艘舰船标记为${STATUS[state]}。可撤销本次修改。`);
}
function exportBackup() {
  if (!ready) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(makeBackup(statuses),null,2)],{ type:'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `港区科技备份-${new Date().toLocaleDateString('sv-SE')}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
  toast('备份已导出，请妥善保存文件。');
}
function openFilters() {
  if (!ready || !mobile.matches) return;
  $('mobile-filter-slot').append($('filters-panel'));
  $('mobile-filter').setAttribute('aria-expanded','true');
  $('filter-dialog').showModal();
  $('filter-target').focus();
}
$('filter-dialog').addEventListener('close', () => {
  $('desktop-filter-slot').append($('filters-panel'));
  $('mobile-filter').setAttribute('aria-expanded','false');
  (mobile.matches ? $('mobile-filter') : $('list-title')).focus({ preventScroll: true });
});
mobile.addEventListener('change', () => { if (!mobile.matches && $('filter-dialog').open) $('filter-dialog').close(); });
new ResizeObserver(([entry]) => {
  const height = entry.target.hidden ? 0 : entry.target.getBoundingClientRect().height;
  document.documentElement.style.setProperty('--batch-height', `${height}px`);
}).observe($('batch-bar'));

document.addEventListener('click', event => {
  const select = event.target.closest('[data-select]');
  if (select) {
    const id = select.dataset.select;
    selected.has(id) ? selected.delete(id) : selected.add(id);
    syncSelection(); announce(`已选择 ${selected.size} 艘舰船。`);
  }
  const quick = event.target.closest('[data-quick]');
  if (quick && ready) { const {target,stat} = userTargets[+quick.dataset.quick]; setFilters({...DEFAULT_FILTERS,target,stat,status:'pending'}); }
  const remove = event.target.closest('[data-remove-target]');
  if (remove && ready) {
    const index = +remove.dataset.removeTarget, {target,stat} = userTargets[index];
    userTargets = removeTarget(userTargets,target,stat); savePrefs(); renderTargets(); renderOverview();
    const next = $('quick-targets').querySelector(`[data-remove-target="${Math.min(index,userTargets.length-1)}"]`);
    (next || $('add-target')).focus(); toast(`已删除${target}${stat}目标。`);
  }
  if (event.target.closest('[data-add-target]')) openTargetForm();
  const status = event.target.closest('[data-status]'); if (status) setFilters({status:status.dataset.status});
  const chip = event.target.closest('[data-remove-filter]'); if (chip) setFilters({[chip.dataset.removeFilter]:''});
  const batch = event.target.closest('[data-batch]'); if (batch) changeStatuses([...selected],batch.dataset.batch);
  const overview = event.target.closest('[data-overview]'); if (overview) setFilters({status:overview.dataset.overview});
  if (event.target.closest('[data-open-tech]') && ready) {
    $('matrix-target').value = filters.target || $('matrix-target').options[0]?.value || ''; renderMatrix(); $('tech-dialog').showModal();
  }
  const matrix = event.target.closest('[data-matrix-target]');
  if (matrix) { setFilters({...DEFAULT_FILTERS,target:matrix.dataset.matrixTarget,stat:matrix.dataset.matrixStat}); $('tech-dialog').close(); $('list-title').focus({preventScroll:true}); scrollToList(); }
  const close = event.target.closest('[data-close-dialog]'); if (close) $(close.dataset.closeDialog).close();
  const pagination = event.target.closest('[data-page]');
  if (pagination && !pagination.disabled) { page = +pagination.dataset.page; renderList(); $('list-title').focus({preventScroll:true}); scrollToList(); announce(`第 ${page} 页，共 ${filtered.length} 艘舰船。`); }
  if (event.target.closest('#empty-reset')) { setFilters({...DEFAULT_FILTERS}); $('search').focus(); }
});
document.addEventListener('change', event => {
  const el = event.target;
  if (el.dataset.filter) setFilters({[el.dataset.filter]:el.value});
  if (el.dataset.shipStatus) changeStatuses([el.dataset.shipStatus],el.value);
});
$('search').addEventListener('input', () => setFilters({search:$('search').value}));
$('sort').addEventListener('change', () => setFilters({sort:$('sort').value}));
$('reset').addEventListener('click', () => setFilters({...DEFAULT_FILTERS}));
$('select-all').addEventListener('change', () => { selected = $('select-all').checked ? new Set(filtered.map(s=>s.id)) : new Set(); syncSelection(); announce(`已选择 ${selected.size} 艘舰船，包含当前筛选的所有分页。`); });
$('clear-selection').addEventListener('click', () => { selected.clear(); syncSelection(); $('select-all').focus({preventScroll:true}); scrollToList(); announce('已取消全部选择。'); });
$('undo').addEventListener('click', () => {
  if (previous) { statuses = previous; previous = null; selected.clear(); saveProgress(); render(); $('list-title').focus({preventScroll:true}); toast('已恢复上一次修改前的记录。'); }
});
for (const v of ['grid','table']) $(`${v}-view`).addEventListener('click', () => { if (!ready) return; view = v; syncControls(); savePrefs(); renderFilters(); renderList(); announce(`已切换到${v==='grid'?'头像网格':'紧凑表格'}。`); });
$('dismiss-onboarding').addEventListener('click', () => { $('onboarding').hidden = true; savePrefs(); $('list-title').focus({preventScroll:true}); });
$('mobile-filter').addEventListener('click', openFilters);
$('close-filters').addEventListener('click', () => $('filter-dialog').close());
$('apply-filters').addEventListener('click', () => { $('filter-dialog').close(); scrollToList(); });
$('matrix-target').addEventListener('change', renderMatrix);
$('new-target-hull').addEventListener('change', () => {
  const target = $('new-target-hull').value;
  $('new-target-stat').innerHTML = `<option value="">${target ? '请选择属性' : '先选择受益舰种'}</option>`;
  if (target) fillSelect('new-target-stat', STATS.filter(stat => ships.some(s => s.bonuses.some(b => b.targets.includes(target) && b.stat === stat && b.value > 0))));
  $('new-target-stat').disabled = !target; updateTargetForm();
});
$('new-target-stat').addEventListener('change', updateTargetForm);
$('target-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!ready || $('save-target').disabled) return;
  const target = $('new-target-hull').value, stat = $('new-target-stat').value;
  userTargets = addTarget(userTargets,{target,stat},ships);
  savePrefs(); renderTargets(); renderOverview(); $('target-dialog').close();
  $('quick-targets').querySelector(`[data-quick="${userTargets.length-1}"]`)?.focus();
  toast(`已添加${target}${stat}目标。`);
});
$('help').addEventListener('click', () => $('help-dialog').showModal());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const r = dialog.getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
});
$('export').addEventListener('click', exportBackup);
$('import').addEventListener('click', () => { if (ready) $('import-file').click(); });
$('import-file').addEventListener('change', async () => {
  const file = $('import-file').files[0]; $('import-file').value = ''; if (!file) return;
  try {
    if (file.size > 2*1024*1024) throw new Error('备份文件过大，请选择本工具导出的JSON文件。');
    importData = validateBackup(JSON.parse(await file.text()));
    const merged = reconcile(ships,importData), c = counts(ships,merged.statuses);
    const known = new Set(ships.map(s=>s.id)), unknown = Object.keys(importData.statuses).filter(id=>!known.has(id)).length;
    $('import-preview').innerHTML = `<strong>${esc(file.name)}</strong><div class="import-counts"><span>已达120级<b>${c.done}</b></span><span>待练级<b>${c.pending}</b></span><span>未拥有<b>${c.unowned}</b></span></div><p>未包含的 ${merged.added} 艘将设为待练级。${unknown ? `另保留 ${unknown} 条未知舰船记录，等待名单更新匹配。` : ''}</p>`;
    $('import-dialog').showModal();
  } catch (error) { importData = null; toast(error instanceof SyntaxError ? '文件不是有效JSON，原有记录未改变。' : error.message, true); }
});
$('apply-import').addEventListener('click', () => {
  if (!importData) return;
  previous = {...statuses}; statuses = reconcile(ships,importData).statuses; importData = null; selected.clear();
  saveProgress(); render(); $('import-dialog').close(); $('import').focus(); toast('备份已恢复，可撤销本次导入。');
});

async function init() {
  try {
    const response = await fetch('data/ships.json'); if (!response.ok) throw new Error('舰船数据加载失败');
    const catalog = await response.json(); ships = catalog.ships;
    if (catalog.schemaVersion !== 1 || !Array.isArray(ships) || !ships.length) throw new Error('舰船数据格式不受支持');
    let saved = null, prefs = {}, corrupt = false;
    try { const raw = localStorage.getItem(STORE); if (raw) saved = validateBackup(JSON.parse(raw)); }
    catch { corrupt = true; warning('无法读取原存档。当前显示默认记录，请导入备份恢复；原始存档暂未覆盖。'); }
    try { const raw = localStorage.getItem(PREFS); if (raw) prefs = JSON.parse(raw) || {}; } catch { /* UI preferences can safely fall back without discarding progress. */ }
    userTargets = normalizeTargets(prefs.targets,ships);
    try {
      const iconResponse = await fetch('assets/hulls/manifest.json');
      if (iconResponse.ok) {
        const manifest = await iconResponse.json();
        hullIcons = manifest.icons || {};
      }
    } catch { /* Text labels remain usable when optional icons are unavailable. */ }
    const result = reconcile(ships,saved); statuses = result.statuses;
    if (prefs.filters && typeof prefs.filters === 'object') for (const key of Object.keys(DEFAULT_FILTERS)) if (typeof prefs.filters[key] === 'string') filters[key] = prefs.filters[key];
    view = prefs.view === 'table' ? 'table' : 'grid';
    const targets = HULLS.filter(h=>ships.some(s=>s.bonuses.some(b=>b.targets.includes(h))));
    fillSelect('filter-target', targets); fillSelect('matrix-target', targets);
    fillSelect('new-target-hull', targets);
    fillSelect('filter-stat', STATS.filter(stat=>ships.some(s=>s.bonuses.some(b=>b.stat===stat))));
    fillSelect('filter-hull', [...new Set(ships.map(s=>s.hull))].sort((a,b)=>HULLS.indexOf(a)-HULLS.indexOf(b)));
    fillSelect('filter-faction', [...new Set(ships.map(s=>s.faction))]); fillSelect('filter-rarity', [...new Set(ships.map(s=>s.rarity))]);
    for (const el of document.querySelectorAll('[data-filter]')) if (![...el.options].some(o=>o.value===filters[el.dataset.filter])) filters[el.dataset.filter] = '';
    if (filters.status && !Object.hasOwn(STATUS,filters.status)) filters.status = '';
    if (!['id','name','bonus'].includes(filters.sort)) filters.sort = 'id';
    $('catalog-count').textContent = '全舰种科技档案';
    const updated = new Date(catalog.updatedAt).toLocaleDateString('zh-CN');
    $('data-source').innerHTML = `数据：<a href="${esc(catalog.source)}" target="_blank" rel="noopener noreferrer">碧蓝航线 BWIKI ${icon('arrow-up-right')}</a> · ${updated}`;
    $('onboarding').hidden = Boolean(saved && prefs.dismissed !== false);
    if (result.added) { $('onboarding').hidden = false; $('onboarding-text').textContent = `名单新增 ${result.added} 艘舰船，已设为待练级。原有记录已保留，请核对新增舰船。`; }
    ready = true;
    for (const el of document.querySelectorAll('#export, #import, [data-add-target]')) el.disabled = false;
    renderTargets(); syncControls(); render(); if (!corrupt) saveProgress();
  } catch (error) {
    $('ship-list').setAttribute('aria-busy','false');
    $('ship-list').innerHTML = `<div class="empty">${icon('help')}<h3>暂时无法读取档案</h3><p>${esc(error.message)}，请刷新重试。若在本机使用，请通过“启动工具.cmd”打开。</p><button class="button primary" id="retry-load">重新加载</button></div>`;
    $('retry-load').addEventListener('click', () => location.reload());
  }
}
init();
