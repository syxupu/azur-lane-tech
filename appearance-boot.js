/* Apply the validated cache before first paint; appearance.js recalculates it from saved preferences. */
(() => {
  try {
    const saved = JSON.parse(localStorage.getItem('azur-tech:appearance:v1'));
    if (saved?.version !== 1 || !['dark', 'light', 'system'].includes(saved.mode)) return;
    const mode = saved.mode === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : saved.mode;
    const tokens = saved.cache?.[mode];
    if (!tokens || typeof tokens !== 'object') return;
    const names = new Set(['bg','surface','surface-raised','surface-inset','text','muted','accent','accent-hover','on-accent','accent-soft','accent-strong','gold','pending-bg','success','success-bg','border','control-border','topbar','track','hover','selected','danger','danger-bg','warning-bg','warning-text','shadow','backdrop'].map(name => '--' + name));
    const color = /^(?:#[\da-f]{6}|rgba\(\d{1,3},\s*\d{1,3},\s*\d{1,3},\s*(?:0(?:\.\d+)?|1(?:\.0+)?)\))$/i;
    if (!Object.entries(tokens).every(([name, value]) => names.has(name) && typeof value === 'string' && color.test(value))) return;
    if (!/^#[\da-f]{6}$/i.test(tokens['--bg'] || '')) return;
    for (const [name, value] of Object.entries(tokens)) document.documentElement.style.setProperty(name, value);
    document.documentElement.style.colorScheme = mode;
    document.documentElement.dataset.mode = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens['--bg']);
  } catch { /* Invalid or unavailable appearance storage does not affect the application. */ }
})();
