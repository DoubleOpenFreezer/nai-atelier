import { afterEach, expect, it, vi } from 'vitest';
import { getStorageLocationStatus, pickStorageDirectory, setStorageCacheDirectory, switchStorageDataDirectory } from '../../services/storageLocations';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('存储动作有界等待，迁移超时提示检查实际状态且不会自动重发', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const fetcher = vi.fn((_url, options) => { signal = options.signal; return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')))); });
  vi.stubGlobal('fetch', fetcher);
  const pending = switchStorageDataDirectory('D:\\synthetic', 'migrate');
  const rejected = expect(pending).rejects.toThrow('检查实际状态');
  await vi.advanceTimersByTimeAsync(15_000); await rejected;
  expect(signal!.aborted).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
  let finish: (value: unknown) => void = () => {};
  vi.stubGlobal('fetch', vi.fn((_url, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); }));
  const picking = pickStorageDirectory('data');
  await vi.advanceTimersByTimeAsync(300_000); expect(signal!.aborted).toBe(false);
  finish(new Response('{"path":"","cancelled":true}')); await expect(picking).resolves.toMatchObject({ cancelled: true });
});
it('存储管理使用真实单层 /api 路径，修改携带本机控制头与完整动作', async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
  await getStorageLocationStatus();
  await pickStorageDirectory('backup');
  await setStorageCacheDirectory('D:\\synthetic-cache');
  await switchStorageDataDirectory('D:\\synthetic-workshop', 'open');
  for (const [url] of fetcher.mock.calls) expect(url).toBe('/api/local-maintenance/storage');
  const request = fetcher.mock.calls[3][1] as RequestInit;
  expect(request.headers).toMatchObject({ 'x-nai-local-control': 'true' });
  expect(JSON.parse(request.body as string)).toEqual({ action: 'switchData', directory: 'D:\\synthetic-workshop', operation: 'open' });
});
