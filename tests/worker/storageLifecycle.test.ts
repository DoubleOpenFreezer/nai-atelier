import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import worker from '../../worker';
import { handleHistoryRoute } from '../../worker/routes/historyRoutes';
import { deleteR2File, getLocalOwner, handleSettingsRoute } from '../../worker/routes/settingsRoutes';
import { addColumnIfMissing, INIT_SQL, type D1Database, type Env, type RouteContext } from '../../worker/routes/types';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.restoreAllMocks(); });
const fixture = () => {
  const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite); sqlite.exec(INIT_SQL);
  const queries: string[] = [];
  let fail: RegExp | undefined;
  const db = { prepare(query: string) {
    queries.push(query); let values: any[] = [];
    return {
      bind(...next: any[]) { values = next; return this; },
      async first() { return sqlite.prepare(query).get(...values) || null; },
      async all() { return { results: sqlite.prepare(query).all(...values) }; },
      async run() {
        if (fail?.test(query)) throw new Error('synthetic database failure');
        return { success: true, meta: sqlite.prepare(query).run(...values) };
      },
    };
  } } as unknown as D1Database;
  const bucket = { delete: vi.fn(async (_key: string) => {}), get: vi.fn(), put: vi.fn() };
  const env = { DB: db, BUCKET: bucket, PERSONAL_MODE_ENABLED: 'true', LOCAL_HISTORY_ENABLED: 'true' } as unknown as Env;
  const invoke = async (path: string, method = 'DELETE') => {
    const request = new Request(`http://localhost${path}`, { method });
    const context = { request, url: new URL(request.url), path, method, db, env, currentUser: { id: 'owner', role: 'admin' } } as RouteContext;
    return path.startsWith('/api/local-history') ? handleHistoryRoute(context) : handleSettingsRoute(context);
  };
  return { sqlite, db, env, bucket, queries, invoke, fail: (pattern: RegExp) => { fail = pattern; } };
};

it.each(['history', 'chain', 'artist'])('删除 %s 的数据库写入失败时保留记录和全部图片', async kind => {
  const f = fixture();
  f.sqlite.exec("INSERT INTO chains (id,user_id,name,preview_image) VALUES ('c','owner','synthetic','/api/assets/cover.png'); INSERT INTO artists (id,name,image_url,preview_url,benchmarks) VALUES ('a','synthetic','/api/assets/original.png','/api/assets/preview.png','[\"/api/assets/old-benchmark.png\"]'); INSERT INTO local_generation_history (id,user_id,image_key,created_at) VALUES ('h','owner','synthetic.png',1)");
  const [table, id, path] = kind === 'history' ? ['local_generation_history', 'h', '/api/local-history/h'] : kind === 'chain' ? ['chains', 'c', '/api/chains/c'] : ['artists', 'a', '/api/artists/a'];
  f.sqlite.exec(`CREATE TRIGGER block_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, 'synthetic deletion failure'); END`);
  await expect(f.invoke(path)).rejects.toThrow('synthetic deletion failure');
  expect(f.sqlite.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id)?.id).toBe(id);
  expect(f.bucket.delete).not.toHaveBeenCalled();
});

it('删除历史保留灵感引用的原图，只清理已删除历史的蒙版', async () => {
  const f = fixture();
  f.sqlite.exec("INSERT INTO local_generation_history (id,user_id,image_key,created_at) VALUES ('h','owner','shared.png',1); INSERT INTO inspirations (id,user_id,title,image_key) VALUES ('i','owner','synthetic','shared.png')");
  expect((await f.invoke('/api/local-history/h'))?.status).toBe(200);
  expect(f.bucket.delete.mock.calls).toEqual([['local-history/owner/h.edit-mask']]);
  expect(f.sqlite.prepare('SELECT id FROM inspirations').get()?.id).toBe('i');
});

it('旧画师图片与 benchmarks 仍正常清理，R2 失败不会伪报成功', async () => {
  const f = fixture();
  f.sqlite.exec("INSERT INTO artists (id,name,image_url,preview_url,benchmarks) VALUES ('a','synthetic','/api/assets/original.png','/api/assets/preview.png','[\"/api/assets/old-benchmark.png\"]')");
  expect((await f.invoke('/api/artists/a'))?.status).toBe(200);
  expect(f.bucket.delete.mock.calls.flat()).toEqual(['original.png', 'preview.png', 'old-benchmark.png']);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  f.bucket.delete.mockRejectedValueOnce(new Error('synthetic R2 failure'));
  await expect(deleteR2File(f.env, '/api/assets/blocked.png')).rejects.toThrow('synthetic R2 failure');
});

it.each([/CREATE TABLE IF NOT EXISTS users/, /ALTER TABLE chains/, /CREATE TABLE IF NOT EXISTS aitag_works/])('初始化中的真实错误 %s 返回失败', async pattern => {
  const f = fixture(); f.fail(pattern); vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await worker.fetch(new Request('http://localhost/api/init'), f.env);
  expect(response.status).toBe(500);
  expect(await response.json()).not.toHaveProperty('success', true);
});

it('旧表补列保留原数据，重复初始化只忽略已存在列', async () => {
  const f = fixture();
  f.sqlite.exec("CREATE TABLE legacy (id TEXT); INSERT INTO legacy VALUES ('original')");
  await addColumnIfMissing(f.db, 'ALTER TABLE legacy ADD COLUMN note TEXT');
  await addColumnIfMissing(f.db, 'ALTER TABLE legacy ADD COLUMN note TEXT');
  expect(f.sqlite.prepare('SELECT * FROM legacy').get()).toEqual({ id: 'original', note: null });
  for (let i = 0; i < 2; i++) expect((await worker.fetch(new Request('http://localhost/api/init'), f.env)).status).toBe(200);
});

it('实际旧风格串、灵感与画师表补列后保留内容，重复初始化兼容', async () => {
  const f = fixture();
  for (const [table, columns] of [
    ['chains', ['user_id', 'username', 'type', 'variable_values', 'guest_hidden']],
    ['inspirations', ['user_id', 'username', 'negative_prompt', 'params']],
    ['artists', ['preview_url', 'benchmarks']],
  ] as const) for (const column of columns) f.sqlite.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  f.sqlite.exec("INSERT INTO chains (id,name,base_prompt) VALUES ('c','legacy-chain','original prompt'); INSERT INTO inspirations (id,title,prompt) VALUES ('i','legacy-inspiration','original idea'); INSERT INTO artists (id,name,image_url) VALUES ('a','legacy-artist','/api/assets/legacy.png')");
  for (let i = 0; i < 2; i++) expect((await worker.fetch(new Request('http://localhost/api/init'), f.env)).status).toBe(200);
  expect(f.sqlite.prepare('SELECT id,name,base_prompt,type,variable_values,guest_hidden FROM chains').get()).toEqual({ id: 'c', name: 'legacy-chain', base_prompt: 'original prompt', type: 'style', variable_values: '{}', guest_hidden: 0 });
  expect(f.sqlite.prepare('SELECT id,prompt,negative_prompt,params FROM inspirations').get()).toEqual({ id: 'i', prompt: 'original idea', negative_prompt: '', params: null });
  expect(f.sqlite.prepare('SELECT id,image_url,preview_url,benchmarks FROM artists').get()).toEqual({ id: 'a', image_url: '/api/assets/legacy.png', preview_url: null, benchmarks: '[]' });
  expect(f.bucket.delete).not.toHaveBeenCalled();
});

it('旧个人用户统一运行权限，保留 ID、持久角色和资料归属，已保存标识不重复写入', async () => {
  const f = fixture();
  f.sqlite.exec("INSERT INTO users (id,username,password,role,created_at) VALUES ('legacy','synthetic','','user',1); INSERT INTO chains (id,user_id,name) VALUES ('c','legacy','synthetic')");
  expect(await getLocalOwner(f.db)).toMatchObject({ id: 'legacy', role: 'admin' });
  f.queries.length = 0;
  expect(await getLocalOwner(f.db)).toMatchObject({ id: 'legacy', role: 'admin' });
  expect(f.queries.some(query => query.startsWith('INSERT'))).toBe(false);
  expect(f.sqlite.prepare('SELECT role FROM users WHERE id = ?').get('legacy')?.role).toBe('user');
  expect(f.sqlite.prepare('SELECT user_id FROM chains').get()?.user_id).toBe('legacy');
});

it.each(['GET', 'PUT'])('废弃 benchmark 配置入口 %s 返回 404，旧配置不删除', async method => {
  const f = fixture(); f.sqlite.exec("INSERT INTO settings VALUES ('benchmark_config','{\"legacy\":true}')");
  const response = await worker.fetch(new Request('http://localhost/api/config/benchmarks', { method }), f.env);
  expect(response.status).toBe(404);
  expect(f.sqlite.prepare("SELECT value FROM settings WHERE key = 'benchmark_config'").get()?.value).toBe('{"legacy":true}');
});
