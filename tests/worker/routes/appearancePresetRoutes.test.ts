import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleAppearancePresetRoute } from '../../../worker/routes/appearancePresetRoutes';
import type { D1Database, D1PreparedStatement, RouteContext } from '../../../worker/routes/types';
import { BUILTIN_APPEARANCE_PRESET } from '../../../services/appearancePreferences';
import worker from '../../../worker';

let sqlite: DatabaseSync;
let db: D1Database;
const preset = (id: string, name = id) => {
  const { isBuiltin: _builtin, ...base } = BUILTIN_APPEARANCE_PRESET;
  return { ...base, id, name, details: { fontSize: 15, material: 'glass' as const, refraction: 8 } };
};
const invoke = async (method: string, suffix = '', body?: unknown) => {
  const url = new URL('http://localhost/api/appearance-presets' + suffix);
  return (await handleAppearancePresetRoute({ db, path: url.pathname, method, request: new Request(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) }) } as RouteContext))!;
};
const names = async () => ((await (await invoke('GET')).json()) as { presets: { name: string }[] }).presets.map(p => p.name);
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('unrelated', 'keep');");
  const prepare = (sql: string, values: SQLInputValue[] = []): D1PreparedStatement => ({
    bind: (...next) => prepare(sql, next),
    first: async <T>() => (sqlite.prepare(sql).get(...values) ?? null) as T | null,
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...values) as T[], success: true, meta: {} }),
    run: async <T>() => ({ results: [] as T[], success: true, meta: sqlite.prepare(sql).run(...values) }),
    raw: async <T>() => [] as T[],
  });
  db = { prepare, batch: async (statements: D1PreparedStatement[]) => {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
});
afterEach(() => sqlite.close());

describe('工坊共享主题库', () => {
  it('背景随共享主题完整保存，非法外链背景不能部分写入', async () => {
    const background = { image: 'data:image/png;base64,AAAA', fit: 'tile', opacity: .7, tileSize: 64 };
    expect((await invoke('POST', '', [{ ...preset('bg'), background }])).status).toBe(200);
    const saved = await (await invoke('GET')).json() as { presets: { background: unknown }[] };
    expect(saved.presets[0].background).toEqual(background);
    expect((await invoke('POST', '', [preset('ok'), { ...preset('bad'), background: { image: 'https://example.invalid/a.png' } }])).status).toBe(400);
    expect(await names()).toEqual(['bg']);
  });
  it('两个客户端逐条新增互不覆盖，重命名不覆盖已更新的配色，删除不触碰其他设置', async () => {
    expect(await names()).toEqual([]);
    expect((await invoke('POST', '', [preset('a')])).status).toBe(200);
    expect((await invoke('POST', '', [preset('b')])).status).toBe(200);
    expect(await names()).toEqual(['a', 'b']);
    await invoke('PUT', '/a', [{ ...preset('a'), accentColor: '#123456' }]);
    await invoke('PUT', '/a', { name: '新名字' });
    const data = await (await invoke('GET')).json() as { presets: { id: string; accentColor: string; name: string; details: unknown }[] };
    expect(data.presets.find(p => p.id === 'a')).toMatchObject({ accentColor: '#123456', name: '新名字', details: { refraction: 8 } });
    await invoke('DELETE', '/a');
    expect(await names()).toEqual(['b']);
    expect((await invoke('PUT', '/a', [preset('a')])).status).toBe(404);
    expect(sqlite.prepare("SELECT value FROM settings WHERE key='unrelated'").get()?.value).toBe('keep');
  });
  it('旧浏览器合并不覆盖共享原件，冲突副本与重试保持稳定，删除后再次迁入不会复活', async () => {
    await invoke('POST', '', [preset('a', '共享原件')]);
    const legacy = [preset('a', '旧本地改稿'), preset('b', '另一个旧主题')];
    await invoke('POST', '/migrate', legacy);
    expect(await names()).toEqual(expect.arrayContaining(['共享原件', '旧本地改稿', '另一个旧主题']));
    await invoke('POST', '/migrate', legacy);
    expect(await names()).toHaveLength(3);
    await invoke('DELETE', '/b');
    await invoke('POST', '/migrate', legacy);
    expect(await names()).toHaveLength(2);
    expect(await names()).not.toContain('另一个旧主题');
  });
  it('整份请求先校验，未知字段与非法高级参数不写入，默认主题受保护', async () => {
    for (const body of [[preset('a'), { ...preset('b'), details: { refraction: 100 } }], [{ ...preset('a'), script: 'bad' }], [preset('builtin-default')], [preset('builtin-cupertino-liquid-glass')]]) {
      expect((await invoke('POST', '', body)).status).toBe(400);
      expect(await names()).toEqual([]);
    }
    expect((await invoke('DELETE', '/builtin-default')).status).toBe(400);
    expect((await invoke('DELETE', '/builtin-cupertino-liquid-glass')).status).toBe(400);
    expect((await invoke('PUT', '/builtin-cupertino-liquid-glass', { name: '改名' })).status).toBe(400);
    expect((await invoke('PATCH')).status).toBe(405);
    const response = await worker.fetch(new Request('http://192.168.1.2/api/appearance-presets'), { LAN_ACCESS_SECRET: 'test-only', ASSETS: {} } as never);
    expect(response.status).toBe(401);
  });
});
