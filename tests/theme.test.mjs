import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, DEFAULT_APPEARANCE, normalizeAppearance, resolveMode, getPalette, buildTheme, contrastRatio, relativeLuminance } from '../theme.js';

const backgroundKeys = ['--bg','--surface','--surface-raised','--surface-inset','--topbar','--hover','--selected','--accent-soft','--pending-bg','--success-bg','--danger-bg','--warning-bg'];
const rarityKeys = ['--rarity-gold','--rarity-pink','--rarity-purple','--rarity-blue','--rarity-mint'];
const foregroundKeys = ['--text','--muted','--accent','--accent-strong','--gold','--success','--danger','--warning-text',...rarityKeys];
function assertReadable(theme) {
  for (const [name, value] of Object.entries(theme.tokens)) {
    assert.match(value, name === '--shadow' || name === '--backdrop' ? /^rgba\(/ : /^#[0-9a-f]{6}$/, name);
  }
  for (const background of backgroundKeys) {
    const bg = theme.tokens[background];
    assert.ok(theme.mode === 'dark' ? relativeLuminance(bg) <= 0.12 : relativeLuminance(bg) >= 0.65, `${theme.mode} ${background} must stay in mode`);
    for (const foreground of foregroundKeys) {
      assert.ok(contrastRatio(theme.tokens[foreground], bg) >= 4.5, `${foreground}/${background} must be readable`);
    }
    // Check intermediate sRGB colors too: gradient endpoints alone are not enough.
    for (let index=1;index<=rarityKeys.length;index++) for(let step=1;step<10;step++) {
      const channels=key=>theme.tokens[key].slice(1).match(/../g).map(value=>parseInt(value,16));
      const first=channels(rarityKeys[index-1]),last=channels(rarityKeys[index % rarityKeys.length]);
      const color='#'+first.map((value,channel)=>Math.round(value+(last[channel]-value)*step/10).toString(16).padStart(2,'0')).join('');
      assert.ok(contrastRatio(color,bg)>=4.5,`rarity gradient/${background} must be readable`);
    }
    assert.ok(contrastRatio(theme.tokens['--control-border'], bg) >= 3, `control border/${background}`);
  }
  for (const background of ['--accent','--accent-hover']) {
    assert.ok(contrastRatio(theme.tokens['--on-accent'], theme.tokens[background]) >= 4.5, `primary text/${background}`);
  }
}

test('六套预设分别提供明暗配色，所有文本与控件对比度达标', () => {
  assert.equal(PRESETS.length, 6);
  assert.equal(new Set(PRESETS.map(p => p.id)).size, 6);
  for (const preset of PRESETS) for (const mode of ['dark','light']) {
    const theme = buildTheme({ mode, palette: preset.id });
    assert.equal(theme.mode, mode);
    assertReadable(theme);
  }
  const original = buildTheme();
  assert.equal(original.tokens['--bg'], '#0d1826');
  assert.equal(original.tokens['--surface'], '#17283b');
  assert.equal(original.tokens['--accent'], '#7ce3d2');
});

test('损坏设置只回退无效字段，输出无未知属性且不共享输入引用', () => {
  for (const raw of [null, undefined, 1, false, [], 'dark']) assert.deepEqual(normalizeAppearance(raw), DEFAULT_APPEARANCE);
  const raw = { mode: 'invalid', palette: 'missing', custom: { dark: { background: '#123456', surface: 'url(x)', accent: '#ABCDEF', extra: 'x' } }, unknown: true };
  const result = normalizeAppearance(raw);
  assert.equal(result.mode, 'dark');
  assert.equal(result.palette, 'ocean');
  assert.deepEqual(result.custom.dark, { background: '#123456', surface: '#17283b', accent: '#abcdef' });
  assert.deepEqual(Object.keys(result), ['mode','palette','custom']);
  result.custom.dark.background = '#ffffff';
  assert.equal(raw.custom.dark.background, '#123456');
  assert.equal(DEFAULT_APPEARANCE.custom.dark.background, '#0d1826');
});

test('明暗自定义互相独立，自动修正仅影响应用色，不覆盖原输入', () => {
  const settings = normalizeAppearance({ mode: 'dark', palette: 'custom', custom: {
    dark: { background: '#ffffff', surface: '#eeeeee', accent: '#000000' },
    light: { background: '#000000', surface: '#111111', accent: '#ffffff' },
  } });
  const before = JSON.stringify(settings);
  const dark = buildTheme(settings), light = buildTheme({ ...settings, mode: 'light' });
  assertReadable(dark); assertReadable(light);
  assert.ok(dark.adjusted && light.adjusted);
  assert.ok(dark.adjustments.some(a => a.field === 'background' && a.requested === '#ffffff'));
  assert.equal(JSON.stringify(settings), before);
  assert.deepEqual(getPalette(settings, 'dark'), settings.custom.dark);
  assert.deepEqual(getPalette(settings, 'light'), settings.custom.light);
  const palette = getPalette(settings, 'dark');
  palette.background = '#999999';
  assert.equal(settings.custom.dark.background, '#ffffff');
});

test('黑白混合和高饱和极端自定义仍保持模式、文字与按钮可读', () => {
  const colors = ['#000000','#ffffff','#777777','#ff0000','#00ff00','#0000ff','#ffff00','#00ffff','#ff00ff'];
  for (const mode of ['dark','light']) for (let index = 0; index < colors.length; index++) {
    const theme = buildTheme({ mode, palette: 'custom', custom: { [mode]: {
      background: colors[index], surface: colors[(index+3)%colors.length], accent: colors[(index+6)%colors.length],
    } } });
    assertReadable(theme);
  }
});

test('跟随系统只改变实际模式，显式明暗设置不受系统影响', () => {
  assert.equal(resolveMode('system', true), 'dark');
  assert.equal(resolveMode('system', false), 'light');
  assert.equal(resolveMode('dark', false), 'dark');
  assert.equal(resolveMode('light', true), 'light');
  assert.equal(buildTheme({ mode: 'system' }, true).mode, 'dark');
  assert.equal(buildTheme({ mode: 'system' }, false).mode, 'light');
});

test('对比度计算符合黑白基准且主题生成不修改保存值', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#123456', '#123456'), 1);
  const settings = normalizeAppearance({ mode: 'light', palette: 'violet' });
  const before = JSON.stringify(settings);
  buildTheme(settings); buildTheme(settings, true);
  assert.equal(JSON.stringify(settings), before);
});
