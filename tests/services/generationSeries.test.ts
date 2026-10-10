// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LocalGenItem } from '../../types';
import {
    approveGenerationSeries, beginGenerationSeries, getGenerationSeriesSession, getQueuedGenerationSeries,
    stopGenerationSeriesSession, subscribeGenerationSeries,
} from '../../services/generationSeries';
import type { GenerationJobDescriptor, GenerationJobSnapshot } from '../../services/generationJob';

// 只替换四个网络函数；状态判定与全部状态机逻辑走真实实现。
const job = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), cancel: vi.fn(), approve: vi.fn() }));
vi.mock('../../services/generationJob', async importOriginal => Object.assign({}, await importOriginal(), {
    startGenerationJob: job.start, getGenerationJob: job.get, cancelGenerationJob: job.cancel, updateGenerationJobApproval: job.approve,
}));

const MODEL = 'nai-diffusion-4-5-full';
const params = { model: MODEL, width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler' };
const descriptor = (): GenerationJobDescriptor => ({
    payload: { model: MODEL, action: 'generate', parameters: { ...params } },
    history: { prompt: 'synthetic prompt', negativePrompt: 'synthetic negative', params: { ...params } },
    randomSeed: true, stream: false, approvedCost: 5,
});
const snapshot = (overrides: Partial<GenerationJobSnapshot> = {}): GenerationJobSnapshot => ({
    token: 'synthetic-token', state: 'preparing', completedCount: 0, requestedCount: 3, historyIds: [], ...overrides,
});
const callsFor = (token: string) => job.cancel.mock.calls.filter(call => call[1] === token);

let scopeSeq = 0;
const nextScope = () => `synthetic-series-${++scopeSeq}`;

beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    job.start.mockReset().mockResolvedValue(snapshot({ state: 'preparing' }));
    job.get.mockReset().mockResolvedValue(snapshot({ state: 'succeeded', completedCount: 3, historyIds: ['h1', 'h2', 'h3'] }));
    job.cancel.mockReset().mockResolvedValue(undefined);
    job.approve.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); sessionStorage.clear(); });

it('一次 POST 后只轮询观察：进度、预览与已保存项透传，终态退出并给出成功回执', async () => {
    const scope = nextScope();
    const listener = vi.fn();
    const unsubscribe = subscribeGenerationSeries(listener);
    const built = descriptor();
    const saved = { id: 'h1', imageUrl: '/api/local-history/h1/image', prompt: 'synthetic prompt', params: { ...params }, createdAt: 1000 } as LocalGenItem;
    job.get
        .mockResolvedValueOnce(snapshot({ state: 'generating', completedCount: 1, historyIds: ['h1'], lastSavedItem: saved, preview: { image: 'data:image/png;base64,AQID', step: 4 } }))
        .mockResolvedValueOnce(snapshot({ state: 'succeeded', completedCount: 3, historyIds: ['h1', 'h2', 'h3'] }));
    const { session, settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 3, agent: true, descriptor: built });
    // POST 只发生一次，且只用 scope 内的这一个 token 观察。
    expect(job.start).toHaveBeenCalledOnce();
    expect(job.start).toHaveBeenCalledWith('synthetic-key', session.token, built, 3, undefined);

    await vi.advanceTimersByTimeAsync(0);
    expect(session.progress).toEqual({ current: 0, total: 3, stopping: false });
    expect(listener.mock.calls.length).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.state).toBe('generating');
    expect(session.progress).toEqual({ current: 1, total: 3, stopping: false });
    expect(session.historyIds).toEqual(['h1']);
    expect(session.preview).toEqual({ image: 'data:image/png;base64,AQID', step: 4 });
    expect(session.lastSavedItem).toEqual(saved);
    expect(job.get).toHaveBeenCalledOnce();
    expect(job.get).toHaveBeenCalledWith('synthetic-key', session.token);

    unsubscribe();
    const publishedWhileSubscribed = listener.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(settle).resolves.toMatchObject({
        success: true, historySaved: true, outcome: 'succeeded', requestedCount: 3, completedCount: 3, historyIds: ['h1', 'h2', 'h3'],
    });
    expect(listener.mock.calls.length).toBe(publishedWhileSubscribed);
    expect(job.start).toHaveBeenCalledOnce();
    expect(job.get).toHaveBeenCalledTimes(2);
    expect(getGenerationSeriesSession(scope)).toBeNull();
    expect(getQueuedGenerationSeries(scope)).toEqual([]);
});

it('当前任务在请求间隔等待时仍保留活动结果，不误归类为队尾等待任务', async () => {
    const scope = nextScope();
    const saved: LocalGenItem = { id: 'saved-during-interval', imageUrl: '/api/local-history/saved-during-interval/image', prompt: 'synthetic', params, createdAt: 1000 };
    job.start.mockResolvedValueOnce(snapshot({ state: 'waiting', position: 0, completedCount: 1, historyIds: [saved.id], lastSavedItem: saved }));
    const { session, settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 3, agent: false, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    expect(getGenerationSeriesSession(scope)).toBe(session);
    expect(getQueuedGenerationSeries(scope)).toEqual([]);
    expect(session.lastSavedItem?.imageUrl).toBe(saved.imageUrl);
    expect(session.progress.current).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle;
});

it('同 scope 无位置时拒绝并发；有位置可排队，排队会话不算活动会话', async () => {
    const busyScope = nextScope();
    const queuedScope = nextScope();
    const built = descriptor();
    const first = beginGenerationSeries({ scope: busyScope, key: 'synthetic-key', count: 1, agent: false, descriptor: built });
    let failure: unknown = null;
    try { beginGenerationSeries({ scope: busyScope, key: 'synthetic-key', count: 1, agent: false, descriptor: built }); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'generation_busy' });

    const next = beginGenerationSeries({ scope: busyScope, key: 'synthetic-key', count: 1, agent: false, placement: 'next', descriptor: built });
    expect(next.session.queued).toBe(true);
    expect(next.session.state).toBe('waiting');
    expect(getGenerationSeriesSession(busyScope)).toBe(first.session);
    expect(getQueuedGenerationSeries(busyScope)).toEqual([next.session]);

    const solo = beginGenerationSeries({ scope: queuedScope, key: 'synthetic-key', count: 1, agent: false, placement: 'end', descriptor: built });
    expect(getGenerationSeriesSession(queuedScope)).toBeNull();
    expect(getQueuedGenerationSeries(queuedScope)).toEqual([solo.session]);
    expect(job.start).toHaveBeenCalledWith('synthetic-key', solo.session.token, built, 1, 'end');

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    for (const result of await Promise.all([first.settle, next.settle, solo.settle])) {
        expect(result).toMatchObject({ success: true, outcome: 'succeeded', requestedCount: 1, completedCount: 1 });
    }
    expect(getGenerationSeriesSession(busyScope)).toBeNull();
    expect(getQueuedGenerationSeries(busyScope)).toEqual([]);
});

it('等待费用确认时暴露待确认信息，补充授权发 PATCH，停止发 DELETE 并保留已保存图片', async () => {
    const scope = nextScope();
    job.get
        .mockResolvedValueOnce(snapshot({ state: 'awaiting_confirmation', cost: 12, completedCount: 1, requestedCount: 3, historyIds: ['h1'] }))
        .mockResolvedValueOnce(snapshot({ state: 'cancelled', completedCount: 1, requestedCount: 3, historyIds: ['h1'] }));
    const { session, settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 3, agent: true, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.state).toBe('awaiting_confirmation');
    expect(session.awaiting).toEqual({ cost: 12, completedCount: 1, requestedCount: 3 });

    await approveGenerationSeries(session, 40);
    expect(job.approve).toHaveBeenCalledWith('synthetic-key', session.token, 40);

    stopGenerationSeriesSession(session);
    expect(session.stopped).toBe(true);
    expect(session.progress.stopping).toBe(true);
    expect(job.cancel).toHaveBeenCalledWith('synthetic-key', session.token);
    expect(callsFor(session.token)).toHaveLength(1);
    // 已停止的会话不会重复发送取消。
    stopGenerationSeriesSession(session);
    expect(callsFor(session.token)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(settle).resolves.toMatchObject({
        success: false, historySaved: false, outcome: 'cancelled', code: 'user_stopped',
        requestedCount: 3, completedCount: 1, historyIds: ['h1'],
    });
    expect(getGenerationSeriesSession(scope)).toBeNull();
});

it('后端失败终态保留错误码，忙碌归类为 blocked', async () => {
    const failedScope = nextScope();
    job.get.mockResolvedValue(snapshot({ state: 'failed', completedCount: 1, requestedCount: 2, historyIds: ['h1'], code: 'quota_exceeded', error: '额度不足' }));
    const failed = beginGenerationSeries({ scope: failedScope, key: 'synthetic-key', count: 2, agent: true, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(failed.settle).resolves.toMatchObject({ success: false, outcome: 'failed', code: 'quota_exceeded', completedCount: 1, historyIds: ['h1'] });

    const busyScope = nextScope();
    job.get.mockResolvedValue(snapshot({ state: 'failed', completedCount: 0, requestedCount: 1, historyIds: [], code: 'generation_busy', error: '此 Key 正在生成' }));
    const busy = beginGenerationSeries({ scope: busyScope, key: 'synthetic-key', count: 1, agent: true, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(busy.settle).resolves.toMatchObject({ success: false, outcome: 'blocked', code: 'generation_busy' });
});

it('页面卸载只对未终态会话发送 keepalive 取消，已终态会话不再取消', async () => {
    const doneScope = nextScope();
    const done = beginGenerationSeries({ scope: doneScope, key: 'synthetic-key', count: 1, agent: false, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await done.settle;
    expect(getGenerationSeriesSession(doneScope)).toBeNull();

    const liveScope = nextScope();
    const live = beginGenerationSeries({ scope: liveScope, key: 'synthetic-key', count: 1, agent: false, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    expect(getGenerationSeriesSession(liveScope)).toBe(live.session);

    window.dispatchEvent(new Event('pagehide'));
    expect(callsFor(live.session.token)).toEqual([['synthetic-key', live.session.token, { keepalive: true }]]);
    expect(callsFor(done.session.token)).toEqual([]);

    job.get.mockResolvedValue(snapshot({ state: 'cancelled', completedCount: 0, requestedCount: 1, historyIds: [] }));
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(live.settle).resolves.toMatchObject({ outcome: 'cancelled', code: 'user_stopped' });
});

it('Key 变更后旧 Key 归属的会话被取消', async () => {
    const scope = nextScope();
    sessionStorage.setItem('nai_api_key', 'synthetic-key');
    const { session, settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 1, agent: false, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    sessionStorage.setItem('nai_api_key', 'synthetic-rotated');
    window.dispatchEvent(new Event('nai-api-key-changed'));
    expect(session.stopped).toBe(true);
    expect(job.cancel).toHaveBeenCalledWith('synthetic-key', session.token);
    expect(callsFor(session.token).every(call => call.length === 2)).toBe(true);

    job.get.mockResolvedValue(snapshot({ state: 'cancelled', completedCount: 0, requestedCount: 1, historyIds: [] }));
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(settle).resolves.toMatchObject({ outcome: 'cancelled', code: 'user_stopped' });
    expect(getGenerationSeriesSession(scope)).toBeNull();
});

it('临时观察失败只就地提示并保留归属，恢复后仍按后端终态回执', async () => {
    const scope = nextScope();
    job.get
        .mockRejectedValueOnce(new Error('网络不可达'))
        .mockRejectedValueOnce(new Error('网关 502'))
        .mockRejectedValueOnce(new Error('鉴权过期'));
    const { session, settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 2, agent: true, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    for (let attempt = 0; attempt < 3; attempt++) {
        await vi.advanceTimersByTimeAsync(1_000);
        expect(getGenerationSeriesSession(scope)).toBe(session);
    }
    expect(session.connectionError).toBeTruthy();
    expect(session.stopped).toBe(false);
    // 失联期间归属仍在：页面卸载照常送达 keepalive 取消。
    window.dispatchEvent(new Event('pagehide'));
    expect(callsFor(session.token)).toEqual([['synthetic-key', session.token, { keepalive: true }]]);

    job.get.mockResolvedValue(snapshot({ state: 'succeeded', completedCount: 2, historyIds: ['h1', 'h2'] }));
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(settle).resolves.toMatchObject({ success: true, outcome: 'succeeded', requestedCount: 2, completedCount: 2, historyIds: ['h1', 'h2'] });
    expect(session.connectionError).toBeUndefined();
    expect(getGenerationSeriesSession(scope)).toBeNull();
    expect(job.start).toHaveBeenCalledOnce();
    expect(job.get).toHaveBeenCalledTimes(4);
});

it('后端明确回答任务不存在才终结归属，回执取该 404 的 code', async () => {
    const scope = nextScope();
    job.get.mockRejectedValueOnce(Object.assign(new Error('生成任务不存在或已结束'), { status: 404, code: 'generation_task_expired' }));
    const { session, settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 1, agent: true, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(settle).resolves.toMatchObject({ success: false, outcome: 'failed', code: 'generation_task_expired' });
    expect(session.connectionError).toBeUndefined();
    expect(getGenerationSeriesSession(scope)).toBeNull();
});

it('POST 回执丢失时用同一 token 核实，不重复提交也不新建任务', async () => {
    const scope = nextScope();
    job.start.mockRejectedValueOnce(new Error('提交响应丢失'));
    job.get
        .mockResolvedValueOnce(snapshot({ state: 'generating', completedCount: 1, historyIds: ['h1'] }))
        .mockResolvedValueOnce(snapshot({ state: 'succeeded', completedCount: 3, historyIds: ['h1', 'h2', 'h3'] }));
    const { session, settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 3, agent: true, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    expect(job.start).toHaveBeenCalledOnce();
    expect(job.get).toHaveBeenCalledOnce();
    expect(job.get).toHaveBeenCalledWith('synthetic-key', session.token);
    expect(session.connectionError).toBeUndefined();
    expect(session.state).toBe('generating');
    expect(session.progress).toEqual({ current: 1, total: 3, stopping: false });

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(settle).resolves.toMatchObject({ success: true, outcome: 'succeeded', requestedCount: 3, completedCount: 3 });
    expect(job.start).toHaveBeenCalledOnce();
    expect(getGenerationSeriesSession(scope)).toBeNull();
});

it('POST 失败且核实发现任务不存在时，以原始提交错误回执', async () => {
    const scope = nextScope();
    job.start.mockRejectedValueOnce(Object.assign(new Error('提交时网关超时'), { code: 'generation_submit_failed' }));
    job.get.mockRejectedValueOnce(Object.assign(new Error('生成任务不存在或已结束'), { status: 404, code: 'generation_job_not_found' }));
    const { settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 1, agent: true, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    await expect(settle).resolves.toMatchObject({ success: false, outcome: 'failed', code: 'generation_submit_failed', error: '提交时网关超时' });
    expect(getGenerationSeriesSession(scope)).toBeNull();
});

it('取消失败不静默当作已取消，保留取消中并就地说明', async () => {
    const scope = nextScope();
    job.cancel.mockRejectedValueOnce(new Error('取消请求超时'));
    const { session, settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 1, agent: true, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    stopGenerationSeriesSession(session);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.stopped).toBe(true);
    expect(session.progress.stopping).toBe(true);
    expect(session.connectionError).toBeTruthy();
    expect(getGenerationSeriesSession(scope)).toBe(session);

    job.get.mockResolvedValue(snapshot({ state: 'cancelled', completedCount: 1, requestedCount: 1, historyIds: ['h1'] }));
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(settle).resolves.toMatchObject({ outcome: 'cancelled', code: 'user_stopped', requestedCount: 1, completedCount: 1, historyIds: ['h1'] });
    expect(session.connectionError).toBeUndefined();
    expect(getGenerationSeriesSession(scope)).toBeNull();
});

it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('拒绝无效张数 %s', count => {
    expect(() => beginGenerationSeries({ scope: nextScope(), key: 'synthetic-key', count, agent: false, descriptor: descriptor() })).toThrow('生成张数');
    expect(job.start).not.toHaveBeenCalled();
});
