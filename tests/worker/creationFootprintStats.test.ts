import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { handleHistoryRoute } from '../../worker/routes/historyRoutes';
import { INIT_SQL, type D1Database, type Env, type RouteContext } from '../../worker/routes/types';

const sqlite = new DatabaseSync(':memory:');
const db = { prepare(query: string) {
  let values: any[] = [];
  return {
    bind(...next: any[]) { values = next; return this; },
    async first() { return sqlite.prepare(query).get(...values) || null; },
    async all() { return { results: sqlite.prepare(query).all(...values) }; },
    async run() { return { success: true, meta: sqlite.prepare(query).run(...values) }; },
  };
} } as unknown as D1Database;
const env = { DB: db, LOCAL_HISTORY_ENABLED: 'true', BUCKET: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } } as unknown as Env;
const TO = Date.UTC(2026, 9, 17, 12, 0, 0);
const DAY = 86400000;
const params = (model: string, steps: number, operation?: string) => JSON.stringify({
  model, width: 832, height: 1216, steps, scale: 5,
  ...(operation ? { _local_edit: { operation } } : {}),
});
const invoke = async (path: string, method = 'GET', body?: unknown) => {
  const request = new Request(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const url = new URL(request.url);
  const context = { request, url, path: url.pathname, method, db, env, currentUser: { id: 'owner', username: 'owner', role: 'admin' } } as RouteContext;
  return (await handleHistoryRoute(context))!;
};
const insert = (id: string, userId: string, createdAt: number, prompt: string, options: { chain?: string; name?: string; favorite?: number; params?: string } = {}) => {
  sqlite.prepare(`INSERT INTO local_generation_history
    (id, user_id, image_key, prompt, negative_prompt, params, source_chain_id, source_chain_name, created_at, is_favorite)
    VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?)`)
    .run(id, userId, `local-history/${userId}/${id}.png`, prompt, options.params || params('nai-diffusion-4-5-full', 28), options.chain || 'chain-a', options.name || '厚涂冷色', createdAt, options.favorite || 0);
};

beforeAll(async () => { sqlite.exec(INIT_SQL); await invoke('/api/local-history/stats?days=30&to=' + TO); });
beforeEach(() => { sqlite.exec('DELETE FROM local_generation_history'); });
afterAll(() => sqlite.close());

it('聚合本地历史的活动、风格串、画师与参数，并按用户隔离', async () => {
  insert('one', 'owner', TO, 'solo, artist:alpha_artist, artist:beta_artist', { favorite: 1 });
  insert('two', 'owner', TO - DAY, 'solo, artist:alpha_artist');
  insert('three', 'owner', TO - 3 * DAY, 'solo, artist:beta_artist', {
    chain: 'chain-b', name: '雨夜霓虹', params: params('nai-diffusion-5-full', 40, 'inpaint'),
  });
  insert('other', 'other', TO, 'solo, artist:alpha_artist');

  const response = await invoke(`/api/local-history/stats?days=30&tzOffset=480&to=${TO}`);
  const payload = await response.json();
  expect(payload.totals).toMatchObject({ images: 3, activeDays: 3, favoriteImages: 1, currentStreak: 2 });
  expect(payload.daily).toEqual([
    { date: '2026-10-14', images: 1 },
    { date: '2026-10-16', images: 1 },
    { date: '2026-10-17', images: 1 },
  ]);
  expect(payload.chains).toEqual([
    { id: 'chain-a', name: '厚涂冷色', images: 2, lastAt: TO },
    { id: 'chain-b', name: '雨夜霓虹', images: 1, lastAt: TO - 3 * DAY },
  ]);
  expect(payload.uniqueChains).toBe(2);
  expect(payload.artists).toEqual([
    { name: 'alpha_artist', images: 2, lastAt: TO },
    { name: 'beta_artist', images: 2, lastAt: TO },
  ]);
  expect(payload.uniqueArtists).toBe(2);
  expect(payload.artistScan).toEqual({ scanned: 3, truncated: false });
  expect(payload.models).toEqual([
    { model: 'nai-diffusion-4-5-full', images: 2 },
    { model: 'nai-diffusion-5-full', images: 1 },
  ]);
  expect(payload.sizes).toEqual([{ width: 832, height: 1216, images: 3 }]);
  expect(payload.steps).toEqual([
    { steps: 28, images: 2 },
    { steps: 40, images: 1 },
  ]);
  expect(payload.operations).toEqual([
    { operation: 'text-to-image', images: 2 },
    { operation: 'inpaint', images: 1 },
  ]);
});

it('时间范围之外的作品不进入当前统计', async () => {
  insert('recent', 'owner', TO, 'artist:alpha_artist');
  insert('old', 'owner', TO - 40 * DAY, 'artist:beta_artist');
  const payload = await (await invoke(`/api/local-history/stats?days=30&tzOffset=480&to=${TO}`)).json();
  expect(payload.totals.images).toBe(1);
  expect(payload.artists.map((row: { name: string }) => row.name)).toEqual(['alpha_artist']);
});

it('画师样张补全等辅助生成不进入创作足迹', async () => {
  insert('creative', 'owner', TO, 'artist:alpha_artist', { chain: 'chain-a', name: '厚涂冷色' });
  insert('sample', 'owner', TO - DAY, 'solo, artist:gamma_artist', { chain: 'artist-sample:v45:gamma_artist', name: 'gamma_artist' });
  const payload = await (await invoke(`/api/local-history/stats?days=30&tzOffset=480&to=${TO}`)).json();
  expect(payload.totals.images).toBe(1);
  expect(payload.daily).toEqual([{ date: '2026-10-17', images: 1 }]);
  expect(payload.chains.map((row: { id: string }) => row.id)).toEqual(['chain-a']);
  expect(payload.artists.map((row: { name: string }) => row.name)).toEqual(['alpha_artist']);
  expect(payload.uniqueChains).toBe(1);
  expect(payload.uniqueArtists).toBe(1);
  expect(payload.artistScan.scanned).toBe(1);
});

it('自由实验室与导入文件名不进入风格串排行', async () => {
  insert('free', 'owner', TO, 'artist:alpha_artist', { chain: 'playground', name: '生图实验室' });
  insert('file', 'owner', TO, 'artist:beta_artist', { chain: 'uuid-chain', name: '4a6caa72-6be4-4509-a2f7-9b285aa7c19f.png' });
  insert('real', 'owner', TO, 'artist:gamma_artist', { chain: 'chain-a', name: '厚涂冷色' });
  const payload = await (await invoke(`/api/local-history/stats?days=30&tzOffset=480&to=${TO}`)).json();
  expect(payload.totals.images).toBe(3);
  expect(payload.chains.map((row: { id: string }) => row.id)).toEqual(['chain-a']);
  expect(payload.uniqueChains).toBe(1);
  expect(payload.artists.map((row: { name: string }) => row.name).sort()).toEqual(['alpha_artist', 'beta_artist', 'gamma_artist']);
});

it('失败与取消事件写入轻量账本并按范围聚合', async () => {
  const saved = await invoke('/api/local-usage/events', 'POST', { events: [
    { category: 'generation', action: 'failed', amount: 2, meta: { model: 'nai-diffusion-4-5-full' } },
    { category: 'generation', action: 'cancelled', amount: 1 },
  ] });
  expect(saved.status).toBe(200);
  const payload = await (await invoke('/api/local-usage/stats?days=30&tzOffset=480')).json();
  expect(payload.totals).toEqual([
    { category: 'generation', action: 'cancelled', count: 1, amount: 1, value: 0 },
    { category: 'generation', action: 'failed', count: 1, amount: 2, value: 0 },
  ]);
  expect(payload.daily).toHaveLength(2);
});

it('结构化角色从 params.characters 派生，缺少角色库来源时也能排行', async () => {
  insert('character', 'owner', TO, 'solo, artist:alpha_artist', {
    chain: 'chain-a', name: '厚涂冷色',
    params: JSON.stringify({ model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, characters: [{ id: 'c1', prompt: 'girl, red hair' }] }),
  });
  const payload = await (await invoke(`/api/local-history/stats?days=30&tzOffset=480&to=${TO}`)).json();
  expect(payload.characters).toEqual([{ id: 'girl, red hair', name: 'girl, red hair', images: 1, lastAt: TO }]);
  expect(payload.uniqueCharacters).toBe(1);
  expect(payload.characterUsage).toEqual({ images: 1, slots: 1 });
});

it('按月范围只统计所选月份', async () => {
  insert('october', 'owner', TO, 'artist:alpha_artist');
  insert('september', 'owner', Date.UTC(2026, 8, 30, 12), 'artist:beta_artist');
  const payload = await (await invoke(`/api/local-history/stats?days=month&month=2026-10&tzOffset=480&to=${TO + 86400000}`)).json();
  expect(payload.totals.images).toBe(1);
  expect(payload.artists.map((row: { name: string }) => row.name)).toEqual(['alpha_artist']);
});

it('年份筛选只统计所选年份', async () => {
  insert('this-year', 'owner', TO, 'artist:alpha_artist');
  insert('last-year', 'owner', Date.UTC(2025, 11, 30, 12), 'artist:beta_artist');
  const payload = await (await invoke(`/api/local-history/stats?days=all&year=2026&tzOffset=480&to=${TO}`)).json();
  expect(payload.totals.images).toBe(1);
  expect(payload.artists.map((row: { name: string }) => row.name)).toEqual(['alpha_artist']);
});

it('显式 from/to 优先于 days，用于周视图', async () => {
  insert('in-week', 'owner', TO, 'artist:alpha_artist');
  insert('before-week', 'owner', TO - 8 * 86400000, 'artist:beta_artist');
  const from = TO - 6 * 86400000;
  const to = TO + 3600000;
  const payload = await (await invoke(`/api/local-history/stats?days=7&from=${from}&to=${to}&tzOffset=480`)).json();
  expect(payload.totals.images).toBe(1);
  expect(payload.artists.map((row: { name: string }) => row.name)).toEqual(['alpha_artist']);
});

it('没有历史时返回空聚合而不是错误', async () => {
  const payload = await (await invoke(`/api/local-history/stats?days=7&tzOffset=480&to=${TO}`)).json();
  expect(payload.totals).toMatchObject({ images: 0, activeDays: 0, currentStreak: 0 });
  expect(payload.daily).toEqual([]); expect(payload.chains).toEqual([]); expect(payload.artists).toEqual([]);
  expect(payload.artistScan).toEqual({ scanned: 0, truncated: false });
});
