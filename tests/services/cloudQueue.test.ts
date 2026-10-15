// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitCloudQueueStatus, getCachedCloudQueuePreferences, getCloudQueuePreferences, getCurrentCloudQueueStatus, reportCloudQueueCleanupError, scheduleCloudQueueStatusClear, subscribeCloudQueuePreferences, watchCloudQueueTask } from '../../services/cloudQueue';
import { api } from '../../services/api';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CloudQueueStatus, InlineCloudQueueStatus } from '../../components/CloudQueueStatus';

const waitingStatus = (taskId: string) => ({
  taskId,
  phase: 'waiting' as const,
  position: 1,
  queueSize: 2,
  cancelable: true,
});

describe('cloud queue key scoping', () => {
  beforeEach(() => {
    sessionStorage.clear();
    emitCloudQueueStatus(null);
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    emitCloudQueueStatus(null);
    vi.useRealTimers();
  });

  it('旧后台排队错误与清理警告不向弹窗透传HTML，保留任务归属且不改原回执', () => {
    sessionStorage.setItem('nai_api_key', 'key-a');
    const html = '<!DOCTYPE html><html><body>synthetic-ray</body></html>';
    const status = { ...waitingStatus('task-a'), phase: 'error' as const, error: html, cleanupError: html, cancelable: false };
    const listener = vi.fn(); window.addEventListener('nai-cloud-queue-status', listener);
    try {
      emitCloudQueueStatus(status, 'key-a');
      expect(getCurrentCloudQueueStatus()).toEqual({ ...status, error: '服务返回了错误页面，请稍后重试', cleanupError: '服务返回了错误页面，请稍后重试' });
      expect(listener.mock.calls[0][0].detail).toEqual(getCurrentCloudQueueStatus());
      expect(status.error).toBe(html); expect(status.cleanupError).toBe(html);
    } finally { window.removeEventListener('nai-cloud-queue-status', listener); }
  });

  it('切换 Key 后清理旧任务并拒绝旧 Key 的迟到状态', () => {
    sessionStorage.setItem('nai_api_key', 'key-a');
    emitCloudQueueStatus(waitingStatus('task-a'), 'key-a');
    expect(getCurrentCloudQueueStatus()?.taskId).toBe('task-a');

    sessionStorage.setItem('nai_api_key', 'key-b');
    window.dispatchEvent(new CustomEvent('nai-api-key-changed', { detail: 'key-b' }));
    expect(getCurrentCloudQueueStatus()).toBeNull();

    emitCloudQueueStatus(waitingStatus('late-task-a'), 'key-a');
    expect(getCurrentCloudQueueStatus()).toBeNull();
    emitCloudQueueStatus(waitingStatus('task-b'), 'key-b');
    expect(getCurrentCloudQueueStatus()?.taskId).toBe('task-b');
  });

  it('排队设置订阅随 Key 更新，旧 Key 的迟到响应不重新开启小按钮', async () => {
    const preferences = { enabled: true, serviceUrl: 'https://synthetic.example' };
    sessionStorage.setItem('nai_api_key', 'preferences-a');
    let respond!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(preferences)));
    vi.stubGlobal('fetch', fetchMock);
    await getCloudQueuePreferences();
    expect(getCachedCloudQueuePreferences().enabled).toBe(true);

    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { respond = resolve; }));
    const lateRequest = getCloudQueuePreferences();
    const listener = vi.fn();
    const unsubscribe = subscribeCloudQueuePreferences(listener);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ...preferences, enabled: false })));
    sessionStorage.setItem('nai_api_key', 'preferences-b');
    window.dispatchEvent(new Event('nai-api-key-changed'));
    expect(getCachedCloudQueuePreferences().enabled).toBe(false);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(3));
    respond(new Response(JSON.stringify(preferences)));
    await lateRequest;
    expect(getCachedCloudQueuePreferences().enabled).toBe(false);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.headers).toEqual({ Authorization: 'Bearer preferences-b' });
    unsubscribe();
  });

  it('同一任务的释放失败警告不会被随后写入的成功终态覆盖', () => {
    sessionStorage.setItem('nai_api_key', 'key-a');
    emitCloudQueueStatus(waitingStatus('task-a'), 'key-a');
    reportCloudQueueCleanupError('task-a', 'key-a');
    emitCloudQueueStatus({ taskId: 'task-a', phase: 'completed' }, 'key-a');
    expect(getCurrentCloudQueueStatus()?.phase).toBe('completed');
    expect(getCurrentCloudQueueStatus()?.cleanupError).toContain('释放失败');
    const html = renderToStaticMarkup(createElement(InlineCloudQueueStatus));
    expect(html).toContain('生成完成');
    expect(html).toContain('释放失败');
    expect(html).toContain('queue-status-surface--failure');
    expect(html).not.toContain('queue-status-spinner');
    emitCloudQueueStatus(waitingStatus('task-new'), 'key-a');
    expect(getCurrentCloudQueueStatus()?.cleanupError).toBeUndefined();
  });

  it('旧任务或旧 Key 的释放失败不能污染当前任务', () => {
    sessionStorage.setItem('nai_api_key', 'key-b');
    emitCloudQueueStatus(waitingStatus('task-b'), 'key-b');
    reportCloudQueueCleanupError('task-a', 'key-a');
    reportCloudQueueCleanupError('task-b', 'key-a');
    expect(getCurrentCloudQueueStatus()?.cleanupError).toBeUndefined();
  });

  it('正常完成后立即隐藏行内和跨页面提示，内部终态自动清理', async () => {
    vi.useFakeTimers();
    emitCloudQueueStatus({ taskId: 'done', phase: 'completed' });
    expect(renderToStaticMarkup(createElement(InlineCloudQueueStatus))).toBe('');
    expect(renderToStaticMarkup(createElement(CloudQueueStatus))).toBe('');
    await vi.advanceTimersByTimeAsync(1500);
    expect(getCurrentCloudQueueStatus()).toBeNull();
  });

  it.each(['cancelled', 'error'] as const)('%s 终态自行收尾，不依赖生成入口另设计时器', async phase => {
    vi.useFakeTimers();
    emitCloudQueueStatus({ taskId: 'done', phase });
    expect(renderToStaticMarkup(createElement(CloudQueueStatus))).not.toBe('');
    await vi.advanceTimersByTimeAsync(phase === 'error' ? 8000 : 1500);
    expect(getCurrentCloudQueueStatus()).toBeNull();
  });

  it('旧任务的清理计时不能取消当前错误提示的自动收尾', async () => {
    vi.useFakeTimers();
    emitCloudQueueStatus({ taskId: 'current', phase: 'error' });
    scheduleCloudQueueStatusClear('old', 100);
    await vi.advanceTimersByTimeAsync(8000);
    expect(getCurrentCloudQueueStatus()).toBeNull();
  });

  it('同一 Key 的旧请求终态不能覆盖新任务', () => {
    emitCloudQueueStatus(waitingStatus('current'));
    emitCloudQueueStatus({ taskId: 'old', phase: 'completed' });
    expect(getCurrentCloudQueueStatus()?.taskId).toBe('current');
    expect(getCurrentCloudQueueStatus()?.phase).toBe('waiting');
  });

  it('网关完成后仍以成图接收为准，慢速传图期间保留清理警告', async () => {
    vi.useFakeTimers();
    emitCloudQueueStatus({ taskId: 'task', phase: 'generating' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ taskId: 'task', phase: 'completed' }))));
    await watchCloudQueueTask('task', () => false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(getCurrentCloudQueueStatus()?.phase).toBe('generating');
    reportCloudQueueCleanupError('task', '');
    emitCloudQueueStatus({ taskId: 'task', phase: 'completed' });
    expect(getCurrentCloudQueueStatus()?.cleanupError).toContain('释放失败');
    await vi.advanceTimersByTimeAsync(8000);
    expect(getCurrentCloudQueueStatus()).toBeNull();
  });

  it.each(['finished', 'cleared', 'new-task', 'new-key'] as const)('迟到轮询在 %s 后不能恢复旧排队提示', async change => {
    vi.useFakeTimers();
    sessionStorage.setItem('nai_api_key', 'key-a');
    emitCloudQueueStatus(waitingStatus('old'), 'key-a');
    let finish = false;
    let respond!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => { respond = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const watcher = watchCloudQueueTask('old', () => finish, 'key-a');
    if (change === 'new-task') emitCloudQueueStatus(waitingStatus('new'), 'key-a');
    else if (change === 'new-key') {
      sessionStorage.setItem('nai_api_key', 'key-b');
      window.dispatchEvent(new Event('nai-api-key-changed'));
    } else {
      finish = true;
      emitCloudQueueStatus({ taskId: 'old', phase: 'completed' }, 'key-a');
      if (change === 'cleared') await vi.advanceTimersByTimeAsync(1500);
    }
    const expected = getCurrentCloudQueueStatus();
    respond(new Response(JSON.stringify(waitingStatus('old'))));
    await watcher;
    expect(getCurrentCloudQueueStatus()).toEqual(expected);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (change === 'finished') {
      await vi.advanceTimersByTimeAsync(1500);
      expect(getCurrentCloudQueueStatus()).toBeNull();
    }
  });

  it('SSE 释放失败事件不丢弃 final、不发起重试', async () => {
    sessionStorage.setItem('nai_api_key', 'key-a');
    emitCloudQueueStatus(waitingStatus('task-a'), 'key-a');
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      'event: final\ndata: {"image":"image"}\n\nevent: nai_queue_cleanup_error\ndata: {"message":"释放失败"}\n\n',
      { headers: { 'X-Nai-Queue-Task-Id': 'task-a' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const events: string[] = [];
    await api.postSse('/generate-stream', {}, { Authorization: 'Bearer key-a' }, event => events.push(event.event));
    expect(events).toEqual(['final', 'nai_queue_cleanup_error']);
    expect(getCurrentCloudQueueStatus()?.cleanupError).toContain('释放失败');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
