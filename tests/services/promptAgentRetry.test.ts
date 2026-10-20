import { describe, expect, it, vi, afterEach } from 'vitest';
import { promptAgentService } from '../../services/promptAgent';

/**
 * 「结果未知先查询再重试」在库生成链路上的落地：
 * 只在**连接级失败**（没拿到响应）时用同一操作标识重试一次；
 * 服务器已应答的错误不重试；两次请求体里的 operationId 必须一致，服务端才能去重。
 */
describe('库生成的结果未知处理', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('连接级失败后用同一 operationId 重试一次并成功', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(Response.json({ items: [{ name: 'a', prompt: 'blonde_hair' }], provider: 'p', model: 'm', count: 1, kind: 'appearance' }));
    vi.stubGlobal('fetch', fetch);
    const result = await promptAgentService.generateLibraryPrompt({ kind: 'appearance', brief: '金发少女', count: 1 });
    expect(result.items[0].prompt).toBe('blonde_hair');
    expect(fetch).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String(fetch.mock.calls[0][1].body));
    const second = JSON.parse(String(fetch.mock.calls[1][1].body));
    expect(first.operationId).toBe(second.operationId);
    expect(first.operationId).toMatch(/^[0-9a-f]{8}$/);
  });

  it('服务器已应答的错误不重试（结果确定，重试只会白花一次调用）', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: '提示词库分类无效' }, { status: 400 }));
    vi.stubGlobal('fetch', fetch);
    await expect(promptAgentService.generateLibraryPrompt({ kind: 'appearance', brief: 'x' })).rejects.toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('主动取消不重试', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetch = vi.fn().mockRejectedValue(abort);
    vi.stubGlobal('fetch', fetch);
    await expect(promptAgentService.generateLibraryPrompt({ kind: 'appearance', brief: 'x' })).rejects.toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
