import React from 'react';
import type { AppearancePreset } from '../services/appearancePreferences';
import { mixThemeColor, resolveThemePalette } from '../services/themePalette';
import { resolveThemeDetails } from '../services/themeDetails';
import { themeBackgroundStyle } from '../services/themeBackground';

export const AppearancePresetPreview: React.FC<{ preset: AppearancePreset; isDark: boolean }> = ({ preset, isDark }) => {
  const dark = preset.themeMode === 'system' ? isDark : preset.themeMode === 'dark';
  const colors = resolveThemePalette(preset.palette, dark);
  const details = resolveThemeDetails(preset.details, dark);
  const accent = details?.accentColor || preset.accentColor;
  const radius = details?.panelRadius !== undefined ? details.panelRadius / 2 : preset.corners === 'sharp' ? 3 : preset.corners === 'soft' ? 12 : 8;
  const controlRadius = details?.controlRadius !== undefined ? details.controlRadius / 2 : radius;
  const cardRadius = details?.cardRadius !== undefined ? details.cardRadius / 2 : radius;
  const gap = (preset.density === 'compact' ? 3 : preset.density === 'comfortable' ? 7 : 5) * ((details?.spacing ?? .25) / .25);
  const panel = preset.surfaces === 'translucent' ? mixThemeColor(colors.panel, colors.canvas, details?.panelOpacity ?? details?.opacity ?? .85) : colors.panel;
  return <div className="atelier-theme-preview grid h-20 w-28 flex-none overflow-hidden border" aria-hidden="true" data-preview-mode={dark ? 'dark' : 'light'} style={{ gridTemplateColumns: '1.8rem 1fr', backgroundColor: colors.canvas, ...themeBackgroundStyle(preset.background, colors.canvas), borderColor: colors.border, borderRadius: radius, boxShadow: preset.surfaces === 'translucent' && preset.details?.material === 'glass' ? 'inset 0 1px 0 #ffffff99, 0 3px 12px #00000014' : undefined }}>
    <div style={{ backgroundColor: colors.sidebar, borderRight: `1px solid ${colors.border}`, padding: gap }}>
      {[accent, colors.mutedText, colors.mutedText].map((color, index) => <span key={index} className="block h-1" style={{ backgroundColor: color, marginTop: gap, borderRadius: radius }} />)}
    </div>
    <div style={{ padding: gap, background: `linear-gradient(${colors.toolbar} 0 16%, transparent 16%)` }}>
      <span className="block h-2 w-8" style={{ backgroundColor: accent, borderRadius: controlRadius }} />
      <div className="h-5 border" style={{ marginTop: gap, padding: gap, borderColor: colors.border, backgroundColor: panel, borderRadius: controlRadius }}><span className="block h-1 w-6" style={{ backgroundColor: colors.text, borderRadius: controlRadius }} /></div>
      <div className="grid grid-cols-2" style={{ marginTop: gap, gap }}>{[0, 1].map(index => <span key={index} className="h-6" style={{ backgroundColor: panel, borderRadius: cardRadius }} />)}</div>
    </div>
  </div>;
};
