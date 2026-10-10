import { notifyLanAccessRequired, parseErrorResponse } from './api';
import type { GenerationPlacement } from './generationTask';
import type { GenerationJobDescriptor, GenerationJobSnapshot, GenerationJobState } from '../worker/generationJobs.mjs';

export type { GenerationJobDescriptor, GenerationJobSnapshot, GenerationJobState };
export type GenerationJobPreview = NonNullable<GenerationJobSnapshot['preview']>;

const JOB_PATH = '/api/generation-job';
const REQUEST_TIMEOUT = 15_000;

export const isGenerationJobState = (value: unknown): value is GenerationJobState =>
    value === 'waiting' || value === 'preparing' || value === 'generating' || value === 'saving' || value === 'paused'
    || value === 'awaiting_confirmation' || value === 'succeeded' || value === 'cancelled' || value === 'failed';

export const isGenerationJobTerminal = (state: GenerationJobState) => state === 'succeeded' || state === 'cancelled' || state === 'failed';

const send = async (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    key: string,
    token: string,
    options: { body?: unknown; headers?: Record<string, string>; viaQuery?: boolean; previewVersion?: number; keepalive?: boolean } = {},
): Promise<GenerationJobSnapshot> => {
    const response = await fetch(options.viaQuery ? `${JOB_PATH}?token=${encodeURIComponent(token)}${options.previewVersion === undefined ? '' : `&previewVersion=${options.previewVersion}`}` : JOB_PATH, {
        method,
        cache: 'no-store',
        ...(options.keepalive ? { keepalive: true } : { signal: AbortSignal.timeout(REQUEST_TIMEOUT) }),
        headers: {
            Authorization: `Bearer ${key}`,
            // GET 通过查询串标识任务；其余动作沿用任务头，避免出现在地址与日志中。
            ...(options.viaQuery ? {} : { 'X-Nai-Generation-Task': token }),
            ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...options.headers,
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    notifyLanAccessRequired(response);
    if (!response.ok) throw await parseErrorResponse(response);
    return response.json() as Promise<GenerationJobSnapshot>;
};

/** 提交一次有限后台任务；同一 token 重复提交只会返回既有任务，不会重复生图。 */
export const startGenerationJob = async (
    key: string,
    token: string,
    descriptor: GenerationJobDescriptor,
    count: number,
    placement?: GenerationPlacement,
): Promise<GenerationJobSnapshot> => send('POST', key, token, {
    body: descriptor,
    headers: {
        'X-Nai-Generation-Count': String(count),
        ...(placement ? { 'X-Nai-Generation-Placement': placement } : {}),
    },
});

export const getGenerationJob = async (key: string, token: string, previewVersion?: number): Promise<GenerationJobSnapshot> => send('GET', key, token, { viaQuery: true, previewVersion });

/** 取消入口按 Key 访问；关闭/刷新页面用 keepalive 让请求在卸载后仍能送达。 */
export const cancelGenerationJob = async (key: string, token: string, options: { keepalive?: boolean } = {}): Promise<void> => {
    await send('DELETE', key, token, options.keepalive ? { keepalive: true } : {});
};

/** 费用上涨后由用户显式更新剩余授权；未确认前后端保持停止。 */
export const updateGenerationJobApproval = async (key: string, token: string, approvedCost: number): Promise<GenerationJobSnapshot> =>
    send('PATCH', key, token, { body: { approvedCost } });
