// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppearancePresetPreview } from '../../components/AppearancePresetPreview';
import { BUILTIN_APPEARANCE_PRESET } from '../../services/appearancePreferences';

afterEach(cleanup);
describe('主题卡片独立预览', () => {
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
});
