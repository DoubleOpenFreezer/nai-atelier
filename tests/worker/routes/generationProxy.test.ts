import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleSettingsRoute } from '../../../worker/routes/settingsRoutes';
import type { D1Database, RouteContext } from '../../../worker/routes/types';

// 只使用内存合成设置，不打开真实 D1，也不执行初始化或迁移。
const fixture = (gateway: string | undefined = 'http://127.0.0.1:3000/__internal/aitag-fetch') => {
  const rows = new Map<string, string>();
  const prepare = vi.fn(() => { throw new Error('生成不应读取或改写旧模式设置'); });
  const db = { prepare } as unknown as D1Database;
  const route = async (path: string, method: string, key = '', body?: unknown, headers: Record<string, string> = {}) => {
    const request = new Request('http://localhost' + path, { method, headers: { ...headers, ...(key ? { Authorization: 'Bearer ' + key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const context: RouteContext = { request, path, method, url: new URL(request.url), db, currentUser: { role: 'admin' },
      env: { AITAG_LOCAL_PROXY_URL: gateway, ASSETS: { fetch: async () => { throw new Error('不能读取资产'); } } }, initDB: async () => { throw new Error('不能初始化'); } };
    return handleSettingsRoute(context);
  };
  return { rows, prepare, route };
};

afterEach(() => vi.restoreAllMocks());

describe('纯 Worker 生成代理', () => {
  it.each(['/api/generate', '/api/generate-stream'])('%s 携带原参数与 Key 回到统一工坊网关，不另开官方请求', async path => {
    const { rows, prepare, route } = fixture();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('synthetic-key'));
    const storedKey = 'low_consumption_v1:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    rows.set(storedKey, 'true');
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('synthetic image'));
    const payload = { model: 'nai-diffusion-4-5-full', action: 'img2img', parameters: { steps: 40, width: 1536, height: 1536, strength: 0.35 } };
    const response = await route(path, 'POST', 'synthetic-key', payload);
    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe('synthetic image');
    expect(upstream).toHaveBeenCalledOnce();
    const [forwarded] = upstream.mock.calls[0];
    expect((forwarded as Request).url).toBe('http://127.0.0.1:3000' + path);
    expect((forwarded as Request).headers.get('authorization')).toBe('Bearer synthetic-key');
    expect((forwarded as Request).headers.get('X-Nai-Generation-Forwarded')).toBe('1');
    expect(await (forwarded as Request).json()).toEqual(payload);
    expect(prepare).not.toHaveBeenCalled();
    expect(rows.get(storedKey)).toBe('true');
  });

  it.each(['/api/generate', '/api/generate-stream'])('%s 无 Key 不调用上游', async path => {
    const { route } = fixture();
    const upstream = vi.spyOn(globalThis, 'fetch');
    expect((await route(path, 'POST', '', {}))?.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each(['GET', 'PUT'])('旧设置接口 %s 已移除，不读取或改写数据', async method => {
    const { prepare, route } = fixture();
    expect(await route('/api/low-consumption', method, 'synthetic-key', method === 'PUT' ? { enabled: true } : undefined)).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });
});

it('无统一网关的 Worker 入口拒绝生成，不能绕过后端任务锁', async () => {
 const { route } = fixture(''); const upstream = vi.spyOn(globalThis, 'fetch');
 const response = await route('/api/generate', 'POST', 'synthetic-key', {});
 expect(response?.status).toBe(503); expect(await response?.json()).toMatchObject({ code: 'generation_backend_required' });
 expect(upstream).not.toHaveBeenCalled();
});

 it('网关尚未重启时的 Worker 回流不会形成循环转发', async () => {
  const { route } = fixture(); const upstream = vi.spyOn(globalThis, 'fetch');
  const response = await route('/api/generation-task', 'POST', 'synthetic-key', undefined, { 'X-Nai-Generation-Forwarded': '1' });
  expect(response?.status).toBe(503); expect(await response?.json()).toMatchObject({ code: 'generation_backend_required' });
  expect(upstream).not.toHaveBeenCalled();
 });
it('Worker 原样转发单张准备与进度头，不能在另一入口丢掉插队交接信息', async () => {
  const { route } = fixture(); const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"position":1}'));
  const response = await route('/api/generation-task', 'PUT', 'synthetic-key', undefined, { 'X-Nai-Generation-Task': 'synthetic-owner', 'X-Nai-Generation-Prepare': '1' });
  expect(await response?.json()).toEqual({ position: 1 });
  const request = upstream.mock.calls[0][0] as Request;
  expect(request.headers.get('X-Nai-Generation-Prepare')).toBe('1');
  expect(request.headers.get('X-Nai-Generation-Task')).toBe('synthetic-owner');
});

it('Worker 转发间隔设置与明确 Key，不另建独立计时器', async () => {
  const { route } = fixture(); const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"intervalSeconds":4}'));
  expect(await (await route('/api/generation-task', 'PATCH', 'synthetic-key', undefined, { 'X-Nai-Generation-Action': 'interval', 'X-Nai-Generation-Interval': '4' }))?.json()).toEqual({ intervalSeconds: 4 });
  const forwarded = upstream.mock.calls[0][0] as Request;
  expect(forwarded.headers.get('X-Nai-Generation-Interval')).toBe('4');
  expect(forwarded.headers.get('X-Nai-Generation-Action')).toBe('interval');
  expect(forwarded.headers.get('authorization')).toBe('Bearer synthetic-key');
});
