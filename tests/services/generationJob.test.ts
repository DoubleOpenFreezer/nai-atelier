// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import {
    cancelGenerationJob, getGenerationJob, isGenerationJobState, isGenerationJobTerminal, startGenerationJob, updateGenerationJobApproval,
} from '../../services/generationJob';
import type { GenerationJobDescriptor, GenerationJobSnapshot, GenerationJobState } from '../../services/generationJob';

afterEach(() => vi.unstubAllGlobals());

const MODEL = 'nai-diffusion-4-5-full';
const params = { model: MODEL, width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler' };
const descriptor: GenerationJobDescriptor = {
    payload: { model: MODEL, action: 'generate', parameters: { ...params } },
    history: { prompt: 'synthetic prompt', negativePrompt: 'synthetic negative', params: { ...params } },
    randomSeed: true, stream: false, approvedCost: 5,
};
const snapshot: GenerationJobSnapshot = {
    token: 'synthetic-token', state: 'generating', completedCount: 1, requestedCount: 3, historyIds: ['h1'],
};

it('状态取值只接受后端约定，终态仅成功、取消与失败', () => {
    const states: GenerationJobState[] = ['waiting', 'preparing', 'generating', 'saving', 'paused', 'awaiting_confirmation', 'succeeded', 'cancelled', 'failed'];
    expect(states.every(state => isGenerationJobState(state))).toBe(true);
    expect([undefined, null, '', 'queued', 'done'].some(value => isGenerationJobState(value))).toBe(false);
    expect(states.filter(state => isGenerationJobTerminal(state))).toEqual(['succeeded', 'cancelled', 'failed']);
});

it('提交任务只发一次 POST，带 Key、任务头、张数与位置，body 是完整 descriptor', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(snapshot)));
    vi.stubGlobal('fetch', fetch);
    expect(await startGenerationJob('synthetic-key', 'synthetic-token', descriptor, 3, 'next')).toEqual(snapshot);
    expect(fetch).toHaveBeenCalledOnce();
    const [path, options] = fetch.mock.calls[0];
    expect(path).toBe('/api/generation-job');
    expect(options).toMatchObject({
        method: 'POST', cache: 'no-store',
        headers: {
            Authorization: 'Bearer synthetic-key', 'X-Nai-Generation-Task': 'synthetic-token',
            'X-Nai-Generation-Count': '3', 'X-Nai-Generation-Placement': 'next', 'Content-Type': 'application/json',
        },
        body: JSON.stringify(descriptor),
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    // 费用上限随 descriptor 一起提交，后端不依赖本地状态。
    expect(JSON.parse(String(options?.body))).toMatchObject({ approvedCost: 5, randomSeed: true, payload: { action: 'generate' } });

    await startGenerationJob('synthetic-key', 'synthetic-token', descriptor, 1);
    expect(fetch.mock.calls[1][1]?.headers).toMatchObject({ 'X-Nai-Generation-Count': '1' });
    expect(fetch.mock.calls[1][1]?.headers).not.toHaveProperty('X-Nai-Generation-Placement');
});

it('状态查询是可缓存的只读 GET，用 token 查询串且不重复发送任务头', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(snapshot)));
    vi.stubGlobal('fetch', fetch);
    expect(await getGenerationJob('synthetic-key', 'synthetic-token')).toEqual(snapshot);
    const [path, options] = fetch.mock.calls[0];
    expect(path).toBe('/api/generation-job?token=synthetic-token');
    expect(options).toMatchObject({ method: 'GET', cache: 'no-store', headers: { Authorization: 'Bearer synthetic-key' } });
    expect(options?.headers).not.toHaveProperty('X-Nai-Generation-Task');
    expect(options).not.toHaveProperty('body');
    expect(options?.signal).toBeInstanceOf(AbortSignal);

    await getGenerationJob('synthetic-key', 'a b/c');
    expect(fetch.mock.calls[1][0]).toBe('/api/generation-job?token=a%20b%2Fc');
    await getGenerationJob('synthetic-key', 'synthetic-token', 7);
    expect(fetch.mock.calls[2][0]).toBe('/api/generation-job?token=synthetic-token&previewVersion=7');
});

it('取消按 Key 发送 DELETE，页面卸载的 keepalive 请求不再挂超时信号', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await cancelGenerationJob('synthetic-key', 'synthetic-token');
    expect(fetch.mock.calls[0][0]).toBe('/api/generation-job');
    expect(fetch.mock.calls[0][1]).toMatchObject({
        method: 'DELETE', cache: 'no-store', headers: { Authorization: 'Bearer synthetic-key', 'X-Nai-Generation-Task': 'synthetic-token' },
    });
    expect(fetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('body');

    await cancelGenerationJob('synthetic-key', 'synthetic-token', { keepalive: true });
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'DELETE', keepalive: true });
    expect(fetch.mock.calls[1][1]).not.toHaveProperty('signal');
});

it('费用上涨后的补充授权只上传 approvedCost，并返回后端快照', async () => {
    const awaiting = { ...snapshot, state: 'awaiting_confirmation' as const, cost: 12 };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(awaiting)));
    vi.stubGlobal('fetch', fetch);
    expect(await updateGenerationJobApproval('synthetic-key', 'synthetic-token', 12)).toEqual(awaiting);
    expect(fetch.mock.calls[0][1]).toMatchObject({
        method: 'PATCH', cache: 'no-store',
        headers: { Authorization: 'Bearer synthetic-key', 'X-Nai-Generation-Task': 'synthetic-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedCost: 12 }),
    });
});

it('后端拒绝保留结构化 code 与状态码，401 沿用局域网解锁事件', async () => {
    const unlock = vi.fn(); window.addEventListener('nai-lan-access-required', unlock);
    const fetch = vi.fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: '此 Key 正在生成', code: 'generation_busy' }), { status: 409 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: '需要解锁', code: 'LAN_ACCESS_REQUIRED' }), { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    try {
        await expect(startGenerationJob('synthetic-key', 'synthetic-token', descriptor, 1)).rejects.toMatchObject({ code: 'generation_busy', status: 409 });
        await expect(getGenerationJob('synthetic-key', 'synthetic-token')).rejects.toMatchObject({ code: 'LAN_ACCESS_REQUIRED', status: 401 });
        await vi.waitFor(() => expect(unlock).toHaveBeenCalledOnce());
        expect(fetch).toHaveBeenCalledTimes(2);
    } finally { window.removeEventListener('nai-lan-access-required', unlock); }
});
