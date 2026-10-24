/** Pure, dependency-free theme generation. Saved input is kept separate from readable UI colors. */
export const PRESETS = Object.freeze([
  { id: 'ocean', name: '深海青', description: '深海蓝与清透青绿',
    dark: { background: '#0d1826', surface: '#17283b', accent: '#7ce3d2' },
    light: { background: '#edf5f7', surface: '#ffffff', accent: '#087b6c' } },
  { id: 'blue', name: '海盐蓝', description: '清爽海蓝，简洁耐看',
    dark: { background: '#111b2c', surface: '#1b2b43', accent: '#91beff' },
    light: { background: '#f0f5fc', surface: '#ffffff', accent: '#2867be' } },
  { id: 'violet', name: '鸢尾紫', description: '柔和紫调与冷灰背景',
    dark: { background: '#1a172b', surface: '#2b2540', accent: '#c5a8ff' },
    light: { background: '#f5f2fc', surface: '#ffffff', accent: '#7850ae' } },
  { id: 'rose', name: '樱花粉', description: '温柔樱粉，低饱和底色',
    dark: { background: '#241820', surface: '#382530', accent: '#f4a7c4' },
    light: { background: '#fcf2f5', surface: '#ffffff', accent: '#b74474' } },
  { id: 'green', name: '松林绿', description: '沉静森林与自然绿意',
    dark: { background: '#131f1b', surface: '#20332b', accent: '#94d7a8' },
    light: { background: '#f0f7f1', surface: '#ffffff', accent: '#357b4a' } },
  { id: 'amber', name: '暖沙金', description: '暖灰沙色与柔和金黄',
    dark: { background: '#211d16', surface: '#343025', accent: '#eaca85' },
    light: { background: '#faf5eb', surface: '#fffdf8', accent: '#95631a' } },
].map(preset => Object.freeze({ ...preset, dark: Object.freeze(preset.dark), light: Object.freeze(preset.light) })));

export const DEFAULT_APPEARANCE = Object.freeze({
  mode: 'dark', palette: 'ocean',
  custom: Object.freeze({ dark: PRESETS[0].dark, light: PRESETS[0].light }),
});

const HEX = /^#[0-9a-f]{6}$/i;
const FIELDS = ['background', 'surface', 'accent'];

/** Return a detached, validated preference object; never preserve unexpected properties. */
export function normalizeAppearance(input) {
  const value = input && !Array.isArray(input) && typeof input === 'object' ? input : {};
  const palette = PRESETS.some(p => p.id === value.palette) || value.palette === 'custom' ? value.palette : DEFAULT_APPEARANCE.palette;
  const mode = ['dark', 'light', 'system'].includes(value.mode) ? value.mode : DEFAULT_APPEARANCE.mode;
  const custom = {};
  for (const variant of ['dark', 'light']) {
    const raw = value.custom?.[variant];
    custom[variant] = Object.fromEntries(FIELDS.map(field => [field,
      typeof raw?.[field] === 'string' && HEX.test(raw[field]) ? raw[field].toLowerCase() : DEFAULT_APPEARANCE.custom[variant][field],
    ]));
  }
  return { mode, palette, custom };
}

export function resolveMode(mode, systemDark = false) {
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode === 'light' ? 'light' : 'dark';
}

/** Get requested colors for an explicit, resolved mode. The caller can safely edit the returned object. */
export function getPalette(settings, mode) {
  const normalized = normalizeAppearance(settings);
  const resolved = mode === 'light' ? 'light' : mode === 'dark' ? 'dark' : resolveMode(normalized.mode);
  const source = normalized.palette === 'custom' ? normalized.custom : PRESETS.find(p => p.id === normalized.palette);
  return { ...source[resolved] };
}

const channels = hex => hex.slice(1).match(/../g).map(c => Number.parseInt(c, 16));
const toHex = values => '#' + values.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, amount) => toHex(channels(a).map((c, i) => c + (channels(b)[i] - c) * amount));

export function relativeLuminance(hex) {
  const linear = channels(hex).map(v => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function contrastRatio(a, b) {
  const first = relativeLuminance(a), second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function moveUntil(color, endpoint, predicate) {
  if (predicate(color)) return color;
  // The endpoints are known to pass for our bounded surfaces. Integer sRGB steps keep the output deterministic.
  for (let step = 1; step <= 255; step++) {
    const candidate = mix(color, endpoint, step / 255);
    if (predicate(candidate)) return candidate;
  }
  return endpoint;
}

function normalizeSurface(color, mode, isBase = false) {
  const dark = mode === 'dark';
  const limit = dark ? (isBase ? 0.075 : 0.12) : (isBase ? 0.78 : 0.65);
  return moveUntil(color, dark ? '#000000' : '#ffffff', c => dark ? relativeLuminance(c) <= limit : relativeLuminance(c) >= limit);
}

function readable(color, surfaces, minimum, mode) {
  return moveUntil(color, mode === 'dark' ? '#ffffff' : '#000000', candidate => surfaces.every(bg => contrastRatio(candidate, bg) >= minimum));
}

/** Derive all UI colors, keeping mode appearance and contrast valid even for extreme custom inputs. */
export function buildTheme(settings, systemDark = false) {
  const normalized = normalizeAppearance(settings);
  const mode = resolveMode(normalized.mode, systemDark), dark = mode === 'dark';
  const requested = getPalette(normalized, mode);
  const bg = normalizeSurface(requested.background, mode, true);
  const surface = normalizeSurface(requested.surface, mode, true);
  const tone = color => normalizeSurface(color, mode);
  const endpoint = dark ? '#ffffff' : '#000000';
  const raised = tone(mix(surface, endpoint, dark ? 0.045 : 0.028));
  const inset = tone(mix(bg, dark ? '#000000' : '#ffffff', 0.12));
  const topbar = tone(mix(bg, surface, 0.45));
  const hover = tone(mix(surface, requested.accent, dark ? 0.10 : 0.055));
  const accentSoft = tone(mix(surface, requested.accent, dark ? 0.12 : 0.10));
  const selected = tone(mix(accentSoft, requested.accent, 0.065));
  const pendingBg = tone(mix(surface, dark ? '#e6b96d' : '#bd7f0b', dark ? 0.10 : 0.07));
  const successBg = tone(mix(surface, dark ? '#54d6ac' : '#218257', dark ? 0.12 : 0.08));
  const dangerBg = tone(mix(surface, dark ? '#ef8383' : '#c53c42', dark ? 0.10 : 0.07));
  const warningBg = tone(mix(surface, dark ? '#ebc07e' : '#c28a1b', dark ? 0.12 : 0.08));
  const surfaces = [bg, surface, raised, inset, topbar, hover, accentSoft, selected, pendingBg, successBg, dangerBg, warningBg];
  const text = readable(dark ? '#f1f6fc' : '#17283b', surfaces, 4.5, mode);
  const muted = readable(dark ? '#b3c3d3' : '#53647a', surfaces, 4.5, mode);
  const accent = readable(requested.accent, surfaces, 4.5, mode);
  const accentHover = mix(accent, endpoint, 0.10);
  const onAccent = ['#000000', '#ffffff'].sort((a,b) =>
    Math.min(contrastRatio(b, accent), contrastRatio(b, accentHover)) - Math.min(contrastRatio(a, accent), contrastRatio(a, accentHover)))[0];
  const tokens = {
    '--bg': bg,
    '--surface': surface,
    '--surface-raised': raised,
    '--surface-inset': inset,
    '--text': text,
    '--muted': muted,
    '--accent': accent,
    '--accent-hover': accentHover,
    '--on-accent': onAccent,
    '--accent-soft': accentSoft,
    '--accent-strong': accent,
    '--gold': readable(dark ? '#f2ca8a' : '#8a5d0b', surfaces, 4.5, mode),
    '--pending-bg': pendingBg,
    '--success': readable(dark ? '#8de2bd' : '#23704a', surfaces, 4.5, mode),
    '--success-bg': successBg,
    '--border': mix(surface, muted, dark ? 0.27 : 0.28),
    '--control-border': readable(dark ? '#7892a7' : '#7b8794', surfaces, 3, mode),
    '--topbar': topbar,
    '--track': mix(surface, muted, 0.26),
    '--hover': hover,
    '--selected': selected,
    '--danger': readable(dark ? '#ffb4b4' : '#b02e38', surfaces, 4.5, mode),
    '--danger-bg': dangerBg,
    '--warning-bg': warningBg,
    '--warning-text': readable(dark ? '#ffe1ae' : '#805400', surfaces, 4.5, mode),
    '--shadow': dark ? 'rgba(0, 0, 0, 0.40)' : 'rgba(23, 40, 59, 0.16)',
    '--backdrop': dark ? 'rgba(5, 12, 23, 0.72)' : 'rgba(35, 48, 65, 0.30)',
  };
  const palette = { background: bg, surface, accent };
  const adjustments = FIELDS.filter(field => requested[field] !== palette[field]).map(field => ({ field, requested: requested[field], actual: palette[field] }));
  return { mode, palette, tokens, adjusted: adjustments.length > 0, adjustments };
}
