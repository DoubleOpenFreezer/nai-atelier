import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILTIN_APPEARANCE_PRESETS } from '../../services/builtinAppearancePresets';
import { appearanceValues, BUILTIN_APPEARANCE_PRESET, DEFAULT_APPEARANCE_PREFERENCES, normalizeAppearancePreferences, readAppearancePresetImport, serializeAppearancePresets } from '../../services/appearancePreferences';

describe('内置外观主题', () => {
  it('全新工坊自带默认与苹果主题，苹果参数直接来自公开原件且三项效果开启', () => {
    expect(BUILTIN_APPEARANCE_PRESETS[0]).toBe(BUILTIN_APPEARANCE_PRESET);
    expect(BUILTIN_APPEARANCE_PRESETS.map(preset => preset.id)).toEqual(['builtin-default', 'builtin-cupertino-liquid-glass']);
    const glass = BUILTIN_APPEARANCE_PRESETS[1];
    const exported = readAppearancePresetImport(readFileSync('public/themes/cupertino-liquid-glass.json', 'utf8'))[0];
    expect(appearanceValues(glass)).toEqual(appearanceValues(exported));
    expect(glass).toMatchObject({ isBuiltin: true, createdAt: 0, galleryFrostedCaption: true, galleryHoverFloat: true, gallerySelectionFocus: true, details: { material: 'glass', light: { accentColor: '#007aff' }, dark: { accentColor: '#0a84ff' } } });
    expect(DEFAULT_APPEARANCE_PREFERENCES.activePresetId).toBe('builtin-default');
    expect(normalizeAppearancePreferences({ ...appearanceValues(glass), activePresetId: glass.id }).activePresetId).toBe(glass.id);
  });

  it('每个内置主题导出后都能作为普通副本导入，不携带锁定身份', () => {
    for (const preset of BUILTIN_APPEARANCE_PRESETS) {
      const [imported] = readAppearancePresetImport(serializeAppearancePresets([preset]));
      expect(imported.isBuiltin).toBeUndefined();
      expect(appearanceValues(imported)).toEqual(appearanceValues(preset));
    }
  });
});
