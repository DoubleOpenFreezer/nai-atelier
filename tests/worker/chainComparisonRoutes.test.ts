import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { handleChainComparisonRoute } from '../../worker/routes/chainComparisonRoutes';
import { INIT_SQL, type D1Database, type RouteContext } from '../../worker/routes/types';
import { comparisonFixture } from '../fixtures/chainComparison';
import { createRoleModeCopy, emptyRoleModeConfig } from '../../services/chainRoleModeModel';
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); });
const fixture = () => {
  const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite); sqlite.exec(INIT_SQL);
  const db = { prepare(query: string) { let values: any[] = []; return { bind(...next: any[]) { values = next; return this; }, async first() { return sqlite.prepare(query).get(...values) || null; }, async all() { return { results: sqlite.prepare(query).all(...values) }; } }; } } as unknown as D1Database;
  const invoke = (body?: unknown, id = 'owner', role = 'admin', method = body === undefined ? 'GET' : 'PUT', path = '/api/chain-comparisons') => {
    const request = new Request('http://localhost' + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return handleChainComparisonRoute({ path, method, request, db, currentUser: { id, role } } as RouteContext);
  };
  return { sqlite, invoke };
};
it('私人settings按用户隔离并版本比较，保存副本不创建风格串或图片', async () => {
  const f = fixture(), record = comparisonFixture(true);
  const saved = (await (await f.invoke(record))!.json() as any).record;
  expect(saved.revision).toBe(1); expect((await f.invoke(record))!.status).toBe(409);
  expect(await (await f.invoke(undefined, 'other'))!.json()).toEqual({ records: [] });
  expect(f.sqlite.prepare('SELECT count(*) AS n FROM chains').get()?.n).toBe(0);
});
it('旧轮次不可覆盖或删除，草稿变化产生新轮次且旧快照不变', async () => {
  const f = fixture(), record = comparisonFixture(true);
  record.rounds = [{ id: 'round-one', createdAt: 1, draft: structuredClone(record.draft) }];
  const saved = (await (await f.invoke(record))!.json() as any).record;
  expect((await f.invoke({ ...saved, rounds: [] }))!.status).toBe(400);
  const changed = structuredClone(saved); changed.rounds[0].draft.seed = 2;
  expect((await f.invoke(changed))!.status).toBe(400);
  saved.draft.seed = 7; saved.rounds.push({ id: 'round-two', createdAt: 2, draft: structuredClone(saved.draft) });
  expect((await f.invoke(saved))!.status).toBe(200);
});
it('访客/坏输入/损坏存档明确失败，不覆盖旧资料', async () => {
  const f = fixture(); expect((await f.invoke(undefined, 'owner', 'guest'))!.status).toBe(403);
  expect((await f.invoke({}))!.status).toBe(400); expect((await f.invoke(undefined, 'owner', 'admin', 'DELETE'))!.status).toBe(405);
  f.sqlite.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('chain_comparison_v1:owner:bad', '{broken');
  expect((await f.invoke())!.status).toBe(500);
  const record = comparisonFixture(true); record.id = 'bad'; expect((await f.invoke(record))!.status).toBe(500);
  expect(f.sqlite.prepare('SELECT value FROM settings WHERE key=?').get('chain_comparison_v1:owner:bad')?.value).toBe('{broken');
});
it('原卡模式配置与按需副本独立CAS，保留旧对比存档和原chains，其他用户/访客隔离', async () => {
  const f = fixture(), path = '/api/chain-comparisons/role-mode';
  await f.invoke(comparisonFixture());
  const config = emptyRoleModeConfig(); config.characters[0].prompt = 'common';
  const put = (body: unknown) => f.invoke(body, 'owner', 'admin', 'PUT', path);
  const saved = (await (await put({ kind: 'config', config }))!.json() as any).config;
  expect(saved.revision).toBe(1); expect((await put({ kind: 'config', config }))!.status).toBe(409);
  const copy = createRoleModeCopy(comparisonFixture().draft.entries[0].source, saved);
  const first = (await (await put({ kind: 'copy', copy }))!.json() as any).copy;
  expect(first.chain.previewImage).toBe(''); expect((await put({ kind: 'copy', copy }))!.status).toBe(409);
  first.chain.previewImage = '/copy.png'; expect((await put({ kind: 'copy', copy: first }))!.status).toBe(200);
  const read = await (await f.invoke(undefined, 'owner', 'admin', 'GET', path))!.json() as any;
  expect(read.copies).toHaveLength(1); expect(read.copies[0].chain.previewImage).toBe('/copy.png');
  expect((await (await f.invoke())!.json() as any).records).toHaveLength(1);
  expect((await (await f.invoke(undefined, 'other', 'admin', 'GET', path))!.json() as any).copies).toEqual([]);
  expect((await f.invoke(undefined, 'owner', 'guest', 'GET', path))!.status).toBe(403);
  expect(f.sqlite.prepare('SELECT count(*) AS n FROM chains').get()?.n).toBe(0);
});
