import cupertinoJson from '../public/themes/cupertino-liquid-glass.json?raw';
import { BUILTIN_APPEARANCE_PRESET, type AppearancePreset } from './appearancePreferences';
import { readAppearancePresetImport } from './appearancePresets';

// 内置主题与可下载文件共用原件，避免两份参数随迭代分叉。
export const BUILTIN_APPEARANCE_PRESETS: AppearancePreset[] = [
  BUILTIN_APPEARANCE_PRESET,
  {
    ...readAppearancePresetImport(cupertinoJson)[0],
    id: 'builtin-cupertino-liquid-glass',
    createdAt: 0,
    isBuiltin: true,
  },
];
