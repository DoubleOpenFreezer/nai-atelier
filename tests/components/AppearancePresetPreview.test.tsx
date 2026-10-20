// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppearancePresetPreview } from '../../components/AppearancePresetPreview';
import { BUILTIN_APPEARANCE_PRESET } from '../../services/appearancePreferences';

afterEach(cleanup);
describe('主题卡片独立预览', () => {
  it('预览取保存的背景显示参数，缺少背景不残留之前的图片', () => {
    const background = { image: 'data:image/png;base64,AAAA', fit: 'tile' as const, opacity: .8, tileSize: 64 };
    const view = render(<AppearancePresetPreview preset={{ ...BUILTIN_APPEARANCE_PRESET, background }} isDark />);
    const preview = view.container.firstElementChild as HTMLElement;
    expect(preview.style.backgroundSize).toBe('auto, 64px auto');
    view.rerender(<AppearancePresetPreview preset={BUILTIN_APPEARANCE_PRESET} isDark />);
    expect(preview.style.backgroundSize).toBe('');
  });
  it('预览使用自己的明暗覆盖，不借用当前界面的强调色或几何', () => {
    const view = render(<AppearancePresetPreview preset={{ ...BUILTIN_APPEARANCE_PRESET, details: { panelRadius: 16, dark: { accentColor: '#123456', panelRadius: 24 } } }} isDark />);
    const preview = view.container.firstElementChild as HTMLElement;
    expect(preview.style.borderRadius).toBe('12px');
    expect(view.container.querySelector('.w-8')?.getAttribute('style')).toContain('rgb(18, 52, 86)');
  });
  it('浅色主题在深色界面仍预览自己的配色、圆角和密度，跟随系统时才使用当前明暗', () => {
    const preset = { ...BUILTIN_APPEARANCE_PRESET, themeMode: 'light' as const, corners: 'sharp' as const, density: 'compact' as const, palette: { light: { canvas: '#fff4dd', sidebar: '#eee2ce', panel: '#fffaf0', text: '#362415', border: '#a08060' } } };
    const view = render(<AppearancePresetPreview preset={preset} isDark />);
    const preview = view.container.firstElementChild as HTMLElement;
    expect(preview.dataset.previewMode).toBe('light');
    expect(preview.style.backgroundColor).toBe('rgb(255, 244, 221)');
    expect(preview.style.borderColor).toBe('rgb(160, 128, 96)');
    expect(preview.style.borderRadius).toBe('3px');
    expect((preview.firstElementChild as HTMLElement).style.padding).toBe('3px');
    expect(view.container.querySelector('[style*="rgb(54, 36, 21)"]')).toBeTruthy();
    view.rerender(<AppearancePresetPreview preset={{ ...preset, themeMode: 'system', corners: 'soft' }} isDark />);
    expect(preview.dataset.previewMode).toBe('dark');
    expect(preview.style.backgroundColor).toBe('rgb(13, 15, 20)');
    expect(preview.style.borderRadius).toBe('12px');
  });
  it('高级面板、控件和卡片几何各自预览，实色不显示玻璃高光', () => {
    const preset = { ...BUILTIN_APPEARANCE_PRESET, details: { controlRadius: 999, panelRadius: 24, cardRadius: 8, spacing: .2, material: 'glass' as const } };
    const view = render(<AppearancePresetPreview preset={preset} isDark={false} />);
    const preview = view.container.firstElementChild as HTMLElement;
    expect(preview.style.borderRadius).toBe('12px');
    expect(preview.style.boxShadow).toBe('');
    expect(view.container.querySelector('.h-5')?.getAttribute('style')).toContain('border-radius: 499.5px');
    expect(view.container.querySelector('.h-6')?.getAttribute('style')).toContain('border-radius: 4px');
    expect((preview.firstElementChild as HTMLElement).style.padding).toBe('4px');
    view.rerender(<AppearancePresetPreview preset={{ ...preset, surfaces: 'translucent' }} isDark={false} />);
    expect(preview.style.boxShadow).toContain('inset');
  });
});
