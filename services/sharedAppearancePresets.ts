import { api } from './api';
import type { AppearancePreset } from './appearancePreferences';
import { readAppearancePresetImport, serializeAppearancePresets } from './appearancePresets';

const ENDPOINT = '/appearance-presets';
const MIGRATED_KEY = 'nai_shared_appearance_presets_v1';
const LEGACY_BACKUP_KEY = 'nai_legacy_appearance_presets_v1';
const read = (value: unknown): AppearancePreset[] => {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { presets?: unknown }).presets)) throw Error('主题库响应无效');
  return (value as { presets: unknown[] }).presets.length ? readAppearancePresetImport(JSON.stringify(value)) : [];
};
const payload = (presets: AppearancePreset[]) => JSON.parse(serializeAppearancePresets(presets));

export const sharedAppearancePresets = {
  async load(legacy: AppearancePreset[]) {
    let migrated = false;
    try { migrated = localStorage.getItem(MIGRATED_KEY) === '1'; } catch { /* 禁止本地存储时仍可使用工坊主题。 */ }
    let presets = read(await api.get(ENDPOINT, { cache: 'no-store' }));
    if (!migrated && legacy.length) {
      // 原始本地主题留作回退副本；确认后端保存后才更换浏览器缓存。
      try { localStorage.setItem(LEGACY_BACKUP_KEY, serializeAppearancePresets(legacy)); } catch { /* 后端仍保存主题原件。 */ }
      presets = read(await api.post(ENDPOINT + '/migrate', payload(legacy)));
    }
    try { localStorage.setItem(MIGRATED_KEY, '1'); } catch { /* 后端逐条记住合并来源，重复请求也不复活已删除项。 */ }
    return presets;
  },
  async add(presets: AppearancePreset[]) { return read(await api.post(ENDPOINT, payload(presets))); },
  async update(preset: AppearancePreset) { return read(await api.put(ENDPOINT + '/' + encodeURIComponent(preset.id), payload([preset]))); },
  async rename(id: string, name: string) { return read(await api.put(ENDPOINT + '/' + encodeURIComponent(id), { name })); },
  async remove(id: string) { return read(await api.delete(ENDPOINT + '/' + encodeURIComponent(id))); },
};
