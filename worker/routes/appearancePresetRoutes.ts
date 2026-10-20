import { APPEARANCE_FORMAT_VERSION, appearanceValues, readAppearancePresetImport, serializeAppearancePresets } from '../../services/appearancePresets';
import type { AppearancePreset } from '../../services/appearancePreferences';
import { error, json, type RouteContext } from './types';

const PREFIX = 'appearance_preset_v1:';
const MIGRATED_PREFIX = 'appearance_preset_migrated_v1:';
const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200 && id.trim() === id && !id.startsWith('builtin-');
const identity = (preset: AppearancePreset) => JSON.stringify({ name: preset.name, ...appearanceValues(preset) });

export async function handleAppearancePresetRoute({ request, path, method, db }: RouteContext): Promise<Response | null> {
  const base = '/api/appearance-presets';
  if (path !== base && !path.startsWith(base + '/')) return null;
  const list = async () => {
    const rows = await db.prepare('SELECT value FROM settings WHERE key GLOB ? ORDER BY key').bind(PREFIX + '*').all<{ value: string }>();
    const presets = rows.results.length ? readAppearancePresetImport('[' + rows.results.map(row => row.value).join(',') + ']') : [];
    return json({ version: APPEARANCE_FORMAT_VERSION, presets: presets.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)) }, 200, { 'Cache-Control': 'no-store' });
  };
  if (path === base && method === 'GET') return list();
  const migrating = path === base + '/migrate';
  let id: string;
  try { id = decodeURIComponent(path.slice(base.length + 1)); } catch { return error('主题数据无效', 400); }
  if (path !== base && !migrating && !validId(id)) return error('主题数据无效', 400);
  if (!((path === base || migrating) && method === 'POST') && !(path !== base && !migrating && ['PUT', 'DELETE'].includes(method))) return error('不支持的主题操作', 405);
  if (method === 'DELETE') {
    await db.prepare('DELETE FROM settings WHERE key = ?').bind(PREFIX + id).run();
    return list();
  }
  let presets: AppearancePreset[];
  try {
    const body = await request.json();
    if (method === 'PUT' && body && typeof body.name === 'string' && body.name.trim() && Object.keys(body).length === 1) {
      await db.prepare("UPDATE settings SET value = json_set(value, '$.name', ?) WHERE key = ?").bind(body.name.trim().slice(0, 30), PREFIX + id).run();
      if (!await db.prepare('SELECT value FROM settings WHERE key = ?').bind(PREFIX + id).first()) return error('主题已被删除，请刷新主题库', 404);
      return list();
    }
    presets = readAppearancePresetImport(JSON.stringify(body));
    if (presets.some(preset => !validId(preset.id)) || (method === 'PUT' && (presets.length !== 1 || presets[0].id !== id))) throw Error();
  } catch { return error('主题数据无效', 400); }
  const stored = (preset: AppearancePreset) => JSON.parse(serializeAppearancePresets([preset])).presets[0];
  if (method === 'PUT') {
    await db.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(JSON.stringify(stored(presets[0])), PREFIX + id).run();
    if (!await db.prepare('SELECT value FROM settings WHERE key = ?').bind(PREFIX + id).first()) return error('主题已被删除，请刷新主题库', 404);
  } else if (!migrating) {
    // 单条记录写入，不能用一台设备的旧列表覆盖另一台设备新增的主题。
    await db.batch(presets.map(preset => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind(PREFIX + preset.id, JSON.stringify(stored(preset)))));
  } else {
    for (const preset of presets) {
      const marker = MIGRATED_PREFIX + preset.id;
      if (await db.prepare('SELECT value FROM settings WHERE key = ?').bind(marker).first()) continue;
      const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(PREFIX + preset.id).first<{ value: string }>();
      let copy = preset;
      if (row && identity(readAppearancePresetImport(row.value)[0]) !== identity(preset)) {
        // 同 ID 的旧本地改稿保留为稳定副本；重试不重复创建，已迁入后删除也不会复活。
        const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity(preset))));
        copy = { ...preset, id: 'legacy-' + [...hash].map(value => value.toString(16).padStart(2, '0')).join('') };
      }
      await db.batch([
        db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(PREFIX + copy.id, JSON.stringify(stored(copy))),
        db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(marker, copy.id),
      ]);
    }
  }
  return list();
}
