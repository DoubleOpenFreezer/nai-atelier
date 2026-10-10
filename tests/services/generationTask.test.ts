// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { getGenerationQueue, setGenerationInterval, setGenerationQueuePaused } from '../../services/generationTask';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

it('队列只读查询用固定路径与 Key，不缓存也不上传任务标识', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ busy: true, completed: 1, total: 5, paused: true, pausing: false, waiting: [] }));
    vi.stubGlobal('fetch', fetch);
    expect(await getGenerationQueue('synthetic-key')).toMatchObject({ busy: true, completed: 1, total: 5, paused: true });
    const [path, options] = fetch.mock.calls[0];
    expect(path).toBe('/api/generation-task');
    expect(options).toMatchObject({ method: 'GET', cache: 'no-store', headers: { Authorization: 'Bearer synthetic-key' } });
    expect(options).not.toHaveProperty('body');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
});

it('暂停、恢复与间隔设置共用一条路径，各自带独立动作头', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ paused: false, intervalSeconds: 0.5 }));
    vi.stubGlobal('fetch', fetch);
    await setGenerationQueuePaused('synthetic-key', true);
    await setGenerationQueuePaused('synthetic-key', false);
    await setGenerationInterval('synthetic-key', 0.5);
    expect(fetch.mock.calls.map(call => call[1]?.method)).toEqual(['PATCH', 'PATCH', 'PATCH']);
    expect(fetch.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer synthetic-key', 'X-Nai-Generation-Action': 'pause' } });
    expect(fetch.mock.calls[1][1]).toMatchObject({ headers: { Authorization: 'Bearer synthetic-key', 'X-Nai-Generation-Action': 'resume' } });
    expect(fetch.mock.calls[2][1]).toMatchObject({ headers: { 'X-Nai-Generation-Action': 'interval', 'X-Nai-Generation-Interval': '0.5' } });
    for (const [path, options] of fetch.mock.calls) {
        expect(path).toBe('/api/generation-task');
        expect(options).toMatchObject({ cache: 'no-store' });
        expect(options?.headers).not.toHaveProperty('X-Nai-Generation-Task');
        expect(options).not.toHaveProperty('body');
        expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
});

it('间隔设置只发送秒数并保留后端拒绝', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(json({ intervalSeconds: 0.5 }))
        .mockResolvedValueOnce(json({ error: 'invalid interval', code: 'invalid_generation_interval' }, 400));
    vi.stubGlobal('fetch', fetch);
    expect(await setGenerationInterval('synthetic-key', 0.5)).toMatchObject({ intervalSeconds: 0.5 });
    await expect(setGenerationInterval('synthetic-key', -1)).rejects.toMatchObject({ code: 'invalid_generation_interval', status: 400 });
});

it('保留后端忙碌错误码，401 沿用局域网解锁事件', async () => {
    const unlock = vi.fn(); window.addEventListener('nai-lan-access-required', unlock);
    const fetch = vi.fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(json({ error: '此 Key 正在生成', code: 'generation_busy' }, 409))
        .mockResolvedValueOnce(json({ error: '需要解锁', code: 'LAN_ACCESS_REQUIRED' }, 401));
    vi.stubGlobal('fetch', fetch);
    try {
        await expect(getGenerationQueue('synthetic-key')).rejects.toMatchObject({ code: 'generation_busy', status: 409 });
        await expect(setGenerationQueuePaused('synthetic-key', true)).rejects.toMatchObject({ code: 'LAN_ACCESS_REQUIRED', status: 401 });
        await vi.waitFor(() => expect(unlock).toHaveBeenCalledOnce());
        expect(fetch).toHaveBeenCalledTimes(2);
    } finally { window.removeEventListener('nai-lan-access-required', unlock); }
});
