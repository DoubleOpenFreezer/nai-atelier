// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TagDictionaryUpdater } from '../../components/TagDictionaryUpdater';
import { TagUpdateStatus } from '../../services/tagDictionaryUpdater';
import { setLanguage } from '../../services/i18n';

const mocks = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), reset: vi.fn() }));
vi.mock('../../services/tagDictionaryUpdater', () => ({ getTagUpdateStatus: mocks.get, startTagUpdate: mocks.start }));
vi.mock('../../services/tagDictionary', () => ({ resetTagDictionaryCache: mocks.reset }));
const idle: TagUpdateStatus = { available: true, running: false, phase: 'idle', message: '可以检查更新', startedAt: null, finishedAt: null, manifest: { count: 123, generatedAt: null, sourceLastModified: null } };
beforeEach(() => { vi.resetAllMocks(); mocks.get.mockResolvedValue(idle); });
afterEach(() => { cleanup(); vi.useRealTimers(); setLanguage('zh-CN'); });

it('设置行直接更新，进度与词库摘要留在原位，不创建弹窗', async () => {
  const running = { ...idle, running: true, phase: 'downloading', message: '正在下载最新数据库…' };
  const view = render(<div className="safe-mode dark"><TagDictionaryUpdater notify={vi.fn()} /></div>);
  await screen.findByText('123');
  expect(screen.queryByRole('progressbar')).toBeNull();
  mocks.start.mockResolvedValue(running); mocks.get.mockResolvedValue(running);
  fireEvent.click(screen.getByRole('button', { name: '更新词库' }));
  const progress = await screen.findByRole('progressbar');
  expect(mocks.start).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(progress.closest('.safe-mode.dark')).toBe(view.container.firstElementChild);
  expect(progress.getAttribute('aria-valuenow')).toBe('40');
  expect((screen.getByRole('button', { name: '更新中…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(view.container.querySelector('h4')?.parentElement?.classList.contains('flex-wrap')).toBe(true);
  expect(screen.getByText('词库生成时间：未知').parentElement?.classList.contains('flex-wrap')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '更新中…' }));
  expect(mocks.start).toHaveBeenCalledTimes(1);
});

it('主备线路错误逐行显示，失败后可以直接重试', async () => {
  const message = '主线路（primary.invalid）：连接超时\n备用线路（fallback.invalid）：下载服务器返回 403 Forbidden';
  mocks.get.mockResolvedValue({ ...idle, phase: 'error', message });
  render(<TagDictionaryUpdater notify={vi.fn()} />);
  const error = await screen.findByRole('alert');
  expect(error.textContent).toBe(message);
  expect(error.classList.contains('whitespace-pre-line')).toBe(true);
  expect(error.classList.contains('[overflow-wrap:anywhere]')).toBe(true);
  expect((screen.getByRole('button', { name: '更新词库' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole('progressbar').firstElementChild?.classList.contains('bg-red-500')).toBe(true);
  mocks.start.mockResolvedValue({ ...idle, running: true, phase: 'checking' });
  fireEvent.click(screen.getByRole('button', { name: '更新词库' }));
  await screen.findByRole('button', { name: '更新中…' });
  expect(mocks.start).toHaveBeenCalledTimes(1);
});

it('完成后更新摘要且不重复处理，重新打开设置刷新缓存并省去旧通知', async () => {
  vi.useFakeTimers();
  const notify = vi.fn();
  const running = { ...idle, running: true, phase: 'generating' };
  mocks.get.mockResolvedValue(running);
  const view = render(<TagDictionaryUpdater notify={notify} />);
  await act(async () => {});
  const completed = { ...idle, phase: 'completed', message: 'Tag 词库更新完成', finishedAt: '2026-10-12T00:00:00Z', manifest: { ...idle.manifest!, count: 456, generatedAt: '2026-10-12T00:00:00Z' } };
  mocks.get.mockResolvedValue(completed);
  await act(async () => { await vi.advanceTimersByTimeAsync(701); });
  expect(screen.getByText('456')).toBeTruthy();
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  expect(mocks.reset).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(3001); });
  expect(mocks.reset).toHaveBeenCalledTimes(1);
  view.unmount();
  render(<TagDictionaryUpdater notify={notify} />);
  await act(async () => {});
  expect(notify).toHaveBeenCalledTimes(1);
  expect(mocks.reset).toHaveBeenCalledTimes(2);
});

it.each([
  ['zh-TW', '主線路（primary.invalid）', '備用線路（fallback.invalid）'],
  ['en', 'Primary (primary.invalid)', 'Fallback (fallback.invalid)'],
  ['ja', '主回線（primary.invalid）', '予備回線（fallback.invalid）'],
  ['ko', '기본 경로 (primary.invalid)', '예비 경로 (fallback.invalid)'],
] as const)('%s 主备线路标签分别翻译，域名和服务错误保持原文', async (language, primary, fallback) => {
  setLanguage(language);
  mocks.get.mockResolvedValue({ ...idle, phase: 'error', message: '主线路（primary.invalid）：HTTP 502\n备用线路（fallback.invalid）：HTTP 403' });
  render(<TagDictionaryUpdater notify={vi.fn()} />);
  const error = await screen.findByRole('alert');
  expect(error.textContent).toContain(primary);
  expect(error.textContent).toContain(fallback);
  expect(error.textContent).toContain('HTTP 502\n');
  expect(error.textContent).toContain('HTTP 403');
});

it('首次手机安装没有词库清单时正常显示零条与未知时间', async () => {
  mocks.get.mockResolvedValue({ ...idle, manifest: null });
  render(<TagDictionaryUpdater notify={vi.fn()} />);
  await screen.findByText('0');
  expect(screen.getByText('词库生成时间：未知')).toBeTruthy();
});

it('请求尚未返回时禁用更新；连接失败在设置行内提示并恢复操作', async () => {
  let reject!: (error: Error) => void;
  mocks.start.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
  const notify = vi.fn();
  render(<TagDictionaryUpdater notify={notify} />);
  await screen.findByText('123');
  fireEvent.click(screen.getByRole('button', { name: '更新词库' }));
  expect((screen.getByRole('button', { name: '更新中…' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { reject(new Error('更新服务不可用')); });
  expect(screen.getByRole('alert').textContent).toBe('更新服务不可用');
  expect((screen.getByRole('button', { name: '更新词库' }) as HTMLButtonElement).disabled).toBe(false);
  expect(notify).toHaveBeenCalledWith('更新服务不可用', 'error');
});
