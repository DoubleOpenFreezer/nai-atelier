import React from 'react';
import { Search, Image, SlidersHorizontal } from 'lucide-react';
import type { AppearancePreset } from '../services/appearancePreferences';
import { mixThemeColor, resolveThemePalette, themeForeground } from '../services/themePalette';
import { resolveThemeDetails } from '../services/themeDetails';
import { themeBackgroundStyle } from '../services/themeBackground';
import { t } from '../services/i18n';

export const AppearancePresetPreview: React.FC<{ preset: AppearancePreset; isDark: boolean }> = ({ preset, isDark }) => {
  const activeDark = preset.themeMode === 'system' ? isDark : preset.themeMode === 'dark';
  return <div className="atelier-theme-preview grid w-full min-w-0 grid-cols-2 gap-2" aria-hidden="true">
    {[false, true].map(dark => {
      const colors = resolveThemePalette(preset.palette, dark);
      const details = resolveThemeDetails(preset.details, dark);
      const accent = details?.accentColor || preset.accentColor;
      const radius = details?.panelRadius !== undefined ? details.panelRadius / 2 : preset.corners === 'sharp' ? 3 : preset.corners === 'soft' ? 12 : 8;
      const controlRadius = details?.controlRadius !== undefined ? details.controlRadius / 2 : radius;
      const cardRadius = details?.cardRadius !== undefined ? details.cardRadius / 2 : radius;
      const gap = (preset.density === 'compact' ? 3 : preset.density === 'comfortable' ? 7 : 5) * ((details?.spacing ?? .25) / .25);
      const translucent = preset.surfaces === 'translucent';
      const glass = translucent && details?.material === 'glass';
      const surface = (color: string, opacity: number) => translucent ? `color-mix(in srgb, ${color} ${opacity * 100}%, transparent)` : color;
      const border = mixThemeColor(colors.border, colors.panel, details?.borderOpacity ?? .45);
      const control = { borderRadius: controlRadius, padding: `${gap}px`, minWidth: 0 };
      const filter = translucent ? `blur(${(details?.blur ?? 22) / 2}px) saturate(${details?.saturation ?? 130}%)` : undefined;
      return <div key={String(dark)} className="min-w-0">
        <div className="mb-1 text-meta text-gray-500 dark:text-gray-400" style={{ fontWeight: dark === activeDark ? 600 : 400 }}>{t(dark ? '深色' : '浅色')}</div>
        <div data-preview-mode={dark ? 'dark' : 'light'} data-preview-active={dark === activeDark} className="relative isolate grid min-w-0 overflow-hidden border" style={{
          gridTemplateColumns: '1.5rem minmax(0, 1fr)', backgroundColor: colors.canvas,
          borderColor: border, borderRadius: radius,
          color: colors.text, fontFamily: details?.fontFamily || 'system-ui, sans-serif', fontSize: '11px',
          lineHeight: details?.lineHeight ?? 1.5, letterSpacing: `${details?.letterSpacing ?? 0}em`,
          boxShadow: glass ? 'inset 0 1px 0 #ffffff66' : undefined,
        }}>
          <div data-preview-part="background" className="theme-background-preview pointer-events-none absolute inset-0 -z-10" style={{ ...themeBackgroundStyle(preset.background, colors.canvas), '--nai-background-blur': '6px' } as React.CSSProperties & { '--nai-background-blur': string }} />
          <div data-preview-part="sidebar" style={{ backgroundColor: surface(colors.sidebar, details?.globalOpacity ?? details?.sidebarOpacity ?? .82), padding: gap, backdropFilter: filter }}>
            <Image size={14} strokeWidth={details?.iconStroke ?? 1.8} style={{ color: accent, marginBlock: gap }} />
            <SlidersHorizontal size={14} strokeWidth={details?.iconStroke ?? 1.8} style={{ color: colors.mutedText, marginTop: gap * 2 }} />
          </div>
          <div className="min-w-0">
            <div data-preview-part="toolbar" style={{ padding: gap, backgroundColor: surface(colors.toolbar, details?.globalOpacity ?? details?.toolbarOpacity ?? .78), backdropFilter: filter }}>
              <div className="flex items-center gap-1" style={{ ...control, backgroundColor: surface(colors.panel, .55), color: colors.mutedText, border: `1px solid ${border}` }}>
                <Search size={12} /><span className="truncate">{t('搜索')}</span>
              </div>
            </div>
            <div style={{ padding: gap }}>
              <div className="grid grid-cols-2 gap-0.5" style={{ padding: 2, borderRadius: controlRadius + 2, backgroundColor: mixThemeColor(colors.mutedText, colors.panel, .16) }}>
                <span data-preview-part="selected" className="truncate text-center" style={{ ...control, backgroundColor: colors.panel, fontWeight: details?.strongWeight ?? 600, boxShadow: '0 1px 3px #00000026' }}>{t('文生图')}</span>
                <span className="truncate text-center" style={{ ...control, color: colors.mutedText }}>{t('图生图')}</span>
              </div>
              <div data-preview-part="content" className="truncate" style={{ marginBlock: gap, padding: gap, borderRadius: cardRadius, backgroundColor: surface(colors.panel, details?.labEditorOpacity ?? (dark ? .6 : .425)) }}>{t('提示词')}</div>
              <span data-preview-part="action" className="block truncate text-center" style={{ ...control, backgroundColor: accent, color: themeForeground(accent), fontWeight: details?.strongWeight ?? 600 }}>{t('生成')}</span>
            </div>
          </div>
        </div>
      </div>;
    })}
  </div>;
};
