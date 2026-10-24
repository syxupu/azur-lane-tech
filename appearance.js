import { PRESETS, DEFAULT_APPEARANCE, normalizeAppearance, resolveMode, getPalette, buildTheme } from './theme.js';
import { icon } from './ui-icons.js';

const KEY = 'azur-tech:appearance:v1';
const $ = id => document.getElementById(id);
const systemMode = matchMedia('(prefers-color-scheme: dark)');
const fields = ['accent', 'background', 'surface'];
const fieldLabels = { accent: '强调色', background: '页面背景', surface: '卡片底色' };
let settings = normalizeAppearance(DEFAULT_APPEARANCE);
let invalidFields = new Set();
let applied;
let feedbackTimer;

try {
  const saved = JSON.parse(localStorage.getItem(KEY));
  if (saved?.version === 1) settings = normalizeAppearance(saved);
} catch { /* Appearance falls back independently of fleet progress and target preferences. */ }

function applyTheme() {
  applied = buildTheme(settings, systemMode.matches);
  const root = document.documentElement;
  for (const [name, value] of Object.entries(applied.tokens)) root.style.setProperty(name, value);
  root.style.colorScheme = applied.mode;
  root.style.setProperty('--color-scheme', applied.mode);
  root.dataset.mode = applied.mode;
  root.dataset.palette = settings.palette;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', applied.tokens['--bg']);
}

function report(message) {
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => { $('theme-feedback').textContent = message; }, 160);
}

function saveAppearance() {
  try {
    // Both variants are cached so system mode can use the correct colors before the next first paint.
    const cache = Object.fromEntries(['dark', 'light'].map(mode => [mode, buildTheme({ ...settings, mode }).tokens]));
    localStorage.setItem(KEY, JSON.stringify({ version: 1, ...settings, cache }));
    $('appearance-warning').hidden = true;
    report('外观已保存到本地');
  } catch {
    $('appearance-warning').textContent = '浏览器未能保存外观设置。当前配色仍可使用，刷新后可能恢复原设置。';
    $('appearance-warning').hidden = false;
    report('外观未保存，本次预览仍然有效');
  }
}

function resetValidation() {
  invalidFields.clear();
  for (const field of fields) {
    $(`theme-${field}-hex`).removeAttribute('aria-invalid');
    $(`theme-${field}-error`).textContent = '';
  }
}

function syncPanel(forceInputs = false) {
  const mode = applied.mode;
  const modeName = mode === 'dark' ? '深色' : '浅色';
  for (const button of document.querySelectorAll('[data-theme-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.themeMode === settings.mode));
  }
  $('effective-mode').textContent = settings.mode === 'system' ? `当前跟随系统：${modeName}` : '';
  for (const preset of PRESETS) {
    const button = $('theme-presets').querySelector(`[data-palette="${preset.id}"]`);
    const colors = getPalette({ ...settings, palette: preset.id }, mode);
    button.setAttribute('aria-pressed', String(settings.palette === preset.id));
    button.style.setProperty('--swatch-bg', colors.background);
    button.style.setProperty('--swatch-surface', colors.surface);
    button.style.setProperty('--swatch-accent', colors.accent);
  }
  const custom = settings.palette === 'custom';
  $('use-custom').setAttribute('aria-pressed', String(custom));
  $('custom-theme-section').hidden = !custom;
  $('custom-mode-label').textContent = `正在编辑${modeName}配色`;
  const colors = settings.custom[mode];
  for (const field of fields) {
    if (invalidFields.has(field)) continue;
    $(`theme-${field}-color`).value = colors[field];
    // Do not move the text caret while the user types a complete HEX value.
    if (forceInputs || document.activeElement !== $(`theme-${field}-hex`)) $(`theme-${field}-hex`).value = colors[field].toUpperCase();
  }
  $('theme-current-name').textContent = `${custom ? '自定义' : PRESETS.find(p => p.id === settings.palette).name} · ${modeName}`;
  $('theme-adjustments').hidden = !custom || !applied.adjusted;
  $('theme-adjustments').textContent = applied.adjusted
    ? `已自动调整${applied.adjustments.map(item => `${fieldLabels[item.field]}为 ${item.actual.toUpperCase()}`).join('、')}，保留你输入的原色。`
    : '';
}

function updateSettings(next, clearInputs = true) {
  settings = normalizeAppearance(next);
  if (clearInputs) resetValidation();
  applyTheme(); syncPanel(); saveAppearance();
}

function setColor(field, value) {
  const mode = resolveMode(settings.mode, systemMode.matches);
  invalidFields.delete(field);
  $(`theme-${field}-hex`).removeAttribute('aria-invalid');
  $(`theme-${field}-error`).textContent = '';
  updateSettings({ ...settings, palette: 'custom', custom: { ...settings.custom, [mode]: { ...settings.custom[mode], [field]: value } } }, false);
}

// These controls remain in the DOM while preview colors update, preserving keyboard focus.
$('theme-presets').innerHTML = PRESETS.map(p => `<button class="theme-preset" data-palette="${p.id}" aria-pressed="false" aria-label="${p.name}配色"><span class="palette-swatch" aria-hidden="true"><span></span><i></i></span><span class="palette-caption"><strong>${p.name}</strong>${icon('check','palette-check')}</span><span class="palette-description">${p.description}</span></button>`).join('');

for (const node of $('settings-dialog').querySelectorAll('[data-icon]')) node.innerHTML = icon(node.dataset.icon);
$('settings').querySelector('[data-icon]').innerHTML = icon('settings');

$('settings').addEventListener('click', () => {
  resetValidation(); syncPanel();
  $('settings-dialog').showModal();
  document.querySelector(`[data-theme-mode="${settings.mode}"]`).focus();
});
$('settings-dialog').addEventListener('close', () => {
  resetValidation();
  $('settings').focus({ preventScroll: true });
});
$('settings-dialog').addEventListener('click', event => {
  const mode = event.target.closest('[data-theme-mode]');
  if (mode) updateSettings({ ...settings, mode: mode.dataset.themeMode });
  const preset = event.target.closest('.theme-preset[data-palette]');
  if (preset) updateSettings({ ...settings, palette: preset.dataset.palette });
});
$('use-custom').addEventListener('click', () => updateSettings({ ...settings, palette: 'custom' }));
$('reset-appearance').addEventListener('click', () => {
  updateSettings(DEFAULT_APPEARANCE);
  report('已恢复深海青 · 深色外观');
});
for (const field of fields) {
  $(`theme-${field}-color`).addEventListener('input', event => {
    $(`theme-${field}-hex`).value = event.target.value.toUpperCase();
    setColor(field, event.target.value);
  });
  $(`theme-${field}-hex`).addEventListener('input', event => {
    const value = event.target.value.trim();
    if (!/^#?[\da-f]{6}$/i.test(value)) {
      invalidFields.add(field);
      event.target.setAttribute('aria-invalid', 'true');
      $(`theme-${field}-error`).textContent = '请输入6位HEX颜色，如 #7CE3D2';
      return;
    }
    setColor(field, (value.startsWith('#') ? value : '#' + value).toLowerCase());
  });
  $(`theme-${field}-hex`).addEventListener('blur', event => {
    if (!invalidFields.has(field)) event.target.value = settings.custom[applied.mode][field].toUpperCase();
  });
}
systemMode.addEventListener('change', () => {
  if (settings.mode !== 'system') return;
  resetValidation(); applyTheme(); syncPanel(true);
  report(`已跟随系统切换为${applied.mode === 'dark' ? '深色' : '浅色'}`);
});

applyTheme();
syncPanel();
