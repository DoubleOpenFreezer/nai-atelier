// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyThemeColors, normalizeThemePalettes, resolveThemePalette, themeAccentColors, themeContrast, themeForeground, themePaletteVariables } from '../../services/themePalette';

describe('主题配色', () => {
  it('只保留受支持的明暗颜色，缺失字段回退默认值', () => {
    const palette = normalizeThemePalettes({ light: { canvas: '#FFF4DD', text: 'red', customCss: 'url(https://example.invalid)' }, dark: null });
    expect(palette).toEqual({ light: { canvas: '#fff4dd' } });
    expect(resolveThemePalette(palette, false)).toMatchObject({ canvas: '#fff4dd', panel: '#ffffff', text: '#171e2d' });
    expect(resolveThemePalette(palette, true).canvas).toBe('#0d0f14');
    expect(normalizeThemePalettes({ light: {} })).toBeUndefined();
  });

  it('所有强调色色阶都有可辨认的前景色，极浅、极深和灰色均覆盖', () => {
    for (const dark of [false, true]) for (const accent of ['#ffffff', '#000000', '#ffefcc', '#777777', '#0ea5e9', '#14b8a6']) {
      for (const background of Object.values(themeAccentColors(accent, dark))) expect(themeContrast(themeForeground(background), background)).toBeGreaterThanOrEqual(4.5);
      const root = document.createElement('div');
      applyThemeColors(root, undefined, dark, false, accent);
      for (const shade of [300, 500, 600, 700]) expect(themeContrast(root.style.getPropertyValue(`--nai-accent-text-${shade}`), resolveThemePalette(undefined, dark).panel)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('两套配色、透光材质与中性色阶一起生效，恢复默认清除旧覆盖', () => {
    const palette = { light: { canvas: '#fff4dd', panel: '#fffaf0', text: '#362415' }, dark: { canvas: '#211c19', panel: '#352c25', text: '#f5e8d3' } };
    const root = document.createElement('div');
    applyThemeColors(root, palette, false, false, '#ffffff');
    expect(root.style.getPropertyValue('--nai-canvas')).toBe('#fff4dd');
    expect(root.style.getPropertyValue('--color-gray-900')).toBe('#362415');
    expect(root.style.getPropertyValue('--nai-on-accent')).toBe('#000000');
    applyThemeColors(root, palette, true, true, '#000000');
    expect(root.style.getPropertyValue('--nai-canvas')).toBe('#211c19');
    expect(root.style.getPropertyValue('--color-gray-100')).toBe('#f5e8d3');
    expect(root.style.getPropertyValue('--nai-panel-surface')).toContain('#352c25 85%');
    expect(root.style.getPropertyValue('--nai-panel-solid-surface')).toBe('#352c25');
    expect(root.style.getPropertyValue('--nai-on-accent')).toBe('#ffffff');
    applyThemeColors(root, undefined, false, false, '#0ea5e9');
    for (const key of Object.keys(themePaletteVariables(palette, false, false))) expect(root.style.getPropertyValue(key)).toBe('');
    expect(root.dataset.customPalette).toBe('false');
  });
});
