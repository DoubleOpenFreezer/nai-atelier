import React from 'react';
import { t } from '../services/i18n';
import { normalizeThemePalettes, resolveThemePalette, themeContrast, ThemePalettes, THEME_PALETTE_KEYS } from '../services/themePalette';

const LABELS = { canvas: '背景', sidebar: '侧栏', toolbar: '工具栏', panel: '面板', text: '正文', mutedText: '次要文字', border: '边框' };

export const AppearancePaletteEditor: React.FC<{ palette?: ThemePalettes; onChange: (palette: ThemePalettes | undefined) => void }> = ({ palette, onChange }) => (
  <details className="mt-4 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
    <summary className="cursor-pointer text-xs font-bold text-gray-700 dark:text-gray-200">{t('自定义明暗配色')}</summary>
    <div className="mt-3 grid gap-4 sm:grid-cols-2">
      {(['light', 'dark'] as const).map(mode => {
        const colors = resolveThemePalette(palette, mode === 'dark');
        const label = t(mode === 'light' ? '浅色配色' : '深色配色');
        return <fieldset key={mode} className="min-w-0">
          <legend className="mb-2 text-meta font-bold text-gray-600 dark:text-gray-300">{label}</legend>
          <div className="grid grid-cols-2 gap-2">
            {THEME_PALETTE_KEYS.map(key => <label key={key} className="flex min-w-0 items-center gap-2 text-meta text-gray-600 dark:text-gray-300">
              <input type="color" value={colors[key]} aria-label={`${label} · ${t(LABELS[key])}`} onChange={event => onChange(normalizeThemePalettes({ ...palette, [mode]: { ...palette?.[mode], [key]: event.target.value } }))} className="h-8 w-8 shrink-0 cursor-pointer rounded border border-gray-300 bg-transparent p-0.5 dark:border-gray-600" />
              <span>{t(LABELS[key])}</span>
            </label>)}
          </div>
          {themeContrast(colors.text, colors.panel) < 4.5 && <p role="status" className="mt-2 text-meta text-amber-700 dark:text-amber-300">{t('正文与面板对比度较低，请调整配色')}</p>}
        </fieldset>;
      })}
    </div>
    {palette && <button type="button" onClick={() => onChange(undefined)} className="mobile-touch mt-3 rounded-lg px-2 py-1 text-meta text-indigo-600 dark:text-indigo-300">{t('恢复默认配色')}</button>}
  </details>
);
