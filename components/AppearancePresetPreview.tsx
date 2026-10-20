import React from 'react';
import type { AppearancePreset } from '../services/appearancePreferences';
import { mixThemeColor, resolveThemePalette } from '../services/themePalette';

export const AppearancePresetPreview: React.FC<{ preset: AppearancePreset; isDark: boolean }> = ({ preset, isDark }) => {
  const dark = preset.themeMode === 'system' ? isDark : preset.themeMode === 'dark';
  const colors = resolveThemePalette(preset.palette, dark);
  const radius = preset.corners === 'sharp' ? 3 : preset.corners === 'soft' ? 12 : 8;
  const gap = preset.density === 'compact' ? 3 : preset.density === 'comfortable' ? 7 : 5;
  const panel = preset.surfaces === 'translucent' ? mixThemeColor(colors.panel, colors.canvas, .85) : colors.panel;
  return <div className="atelier-theme-preview grid h-20 w-28 flex-none overflow-hidden border" aria-hidden="true" data-preview-mode={dark ? 'dark' : 'light'} style={{ gridTemplateColumns: '1.8rem 1fr', backgroundColor: colors.canvas, borderColor: colors.border, borderRadius: radius }}>
    <div style={{ backgroundColor: colors.sidebar, borderRight: `1px solid ${colors.border}`, padding: gap }}>
      {[preset.accentColor, colors.mutedText, colors.mutedText].map((color, index) => <span key={index} className="block h-1" style={{ backgroundColor: color, marginTop: gap, borderRadius: radius }} />)}
    </div>
    <div style={{ padding: gap, background: `linear-gradient(${colors.toolbar} 0 16%, transparent 16%)` }}>
      <span className="block h-2 w-8" style={{ backgroundColor: preset.accentColor, borderRadius: radius }} />
      <div className="h-5 border" style={{ marginTop: gap, padding: gap, borderColor: colors.border, backgroundColor: panel, borderRadius: radius }}><span className="block h-1 w-6" style={{ backgroundColor: colors.text, borderRadius: radius }} /></div>
      <div className="grid grid-cols-2" style={{ marginTop: gap, gap }}>{[0, 1].map(index => <span key={index} className="h-6" style={{ backgroundColor: panel, borderRadius: radius }} />)}</div>
    </div>
  </div>;
};
