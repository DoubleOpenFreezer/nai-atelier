// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtistSampleManager } from '../../components/ArtistSampleManager';
import type { ArtistSampleStatus } from '../../services/artistSamples';

const mocks = vi.hoisted(() => ({ status: vi.fn(), control: vi.fn(), broadcast: vi.fn() }));
vi.mock('../../services/artistSamples', () => ({ getArtistSampleStatus: mocks.status, controlArtistSamplePack: mocks.control, broadcastArtistSamplesChanged: mocks.broadcast }));
vi.mock('../../services/platform', () => ({ isAndroidApp: () => false }));

const makeStatus = (patch: Partial<ArtistSampleStatus> = {}): ArtistSampleStatus => ({
  available: true, canManage: true,
  packs: [
    { id: 'v45', label: 'V4.5', filename: 'artist_thumbnail_nai', path: 'D:\\samples\\v45.json', phase: 'ready', progress: 100, processedBytes: 2_000_000, totalBytes: 2_000_000, count: 31000, revision: 'a', download: { stage: 'missing', receivedBytes: 0, totalBytes: 0 } },
    { id: 'v5', label: 'V5', filename: 'NAID5-33000-55000-Curated', path: '', phase: 'unconfigured', progress: 0, processedBytes: 0, totalBytes: 0, count: 0, revision: '', download: { stage: 'missing', receivedBytes: 0, totalBytes: 0 } },
  ], ...patch,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.status.mockResolvedValue(makeStatus());
  mocks.control.mockResolvedValue({ status: makeStatus() });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('直接下载V5调用后台而不是文件选择器；显示进度并支持暂停和继续', async () => {
  const downloading = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], download: { stage: 'downloading', receivedBytes: 410 * 1024 * 1024, totalBytes: 1000 * 1024 * 1024 },
  }] });
  const paused = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], download: { stage: 'paused', receivedBytes: 410 * 1024 * 1024, totalBytes: 1000 * 1024 * 1024 },
  }] });
  mocks.control.mockResolvedValueOnce({ status: downloading }).mockResolvedValueOnce({ status: paused }).mockResolvedValueOnce({ status: downloading });
  render(<ArtistSampleManager />);
  expect(await screen.findByText('可用 · 31000 个画师 Tag')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: /下载图包/ })[1]);
  await waitFor(() => expect(mocks.control).toHaveBeenCalledWith('download', 'v5'));
  expect(await screen.findByText(/已接收 410.0 MB \/ 1000.0 MB · 41%/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '暂停下载' }));
  await screen.findByRole('button', { name: '继续下载' });
  expect(mocks.control).toHaveBeenLastCalledWith('pause', 'v5');
  fireEvent.click(screen.getByRole('button', { name: '继续下载' }));
  await waitFor(() => expect(mocks.control).toHaveBeenLastCalledWith('download', 'v5'));
  expect(mocks.control).not.toHaveBeenCalledWith('pick', 'v5');
});

it('文件对话框取消不制造失败状态，也不会启动索引', async () => {
  mocks.control.mockResolvedValue({ cancelled: true, status: makeStatus() });
  render(<ArtistSampleManager />);
  await screen.findByText('可用 · 31000 个画师 Tag');
  fireEvent.click(screen.getAllByRole('button', { name: '图包管理' })[1]);
  fireEvent.click(screen.getByRole('button', { name: '使用本地文件' }));
  await waitFor(() => expect(mocks.control).toHaveBeenCalledWith('pick', 'v5'));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('未下载')).toBeTruthy();
});

it('索引失败就地显示原因，仍可重新索引或解除关联；解除关联只调用服务', async () => {
  mocks.status.mockResolvedValue(makeStatus({ packs: [
    { ...makeStatus().packs[0], phase: 'error', error: 'JSON 无法解析' }, makeStatus().packs[1],
  ] }));
  mocks.control.mockRejectedValueOnce(new Error('重新索引失败'));
  render(<ArtistSampleManager />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: '图包管理' })[0]);
  fireEvent.click(screen.getByRole('button', { name: '重新建立索引' }));
  expect(await screen.findByText('重新索引失败')).toBeTruthy();
  expect((screen.getAllByRole('button', { name: '图包管理' })[0] as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getAllByRole('button', { name: '图包管理' })[0]);
  fireEvent.click(screen.getByRole('button', { name: '解除关联（不删文件）' }));
  await waitFor(() => expect(mocks.control).toHaveBeenLastCalledWith('remove', 'v45'));
});


it('下载失败说明原因并可重试', async () => {
  const failed = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], download: { stage: 'error', receivedBytes: 0, totalBytes: 1024, error: '下载校验失败' },
  }] });
  const downloading = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], download: { stage: 'downloading', receivedBytes: 0, totalBytes: 1024 },
  }] });
  mocks.control.mockRejectedValueOnce(new Error('网络中断')).mockResolvedValueOnce({ status: failed }).mockResolvedValueOnce({ status: downloading });
  render(<ArtistSampleManager />);
  await screen.findByText('可用 · 31000 个画师 Tag');
  fireEvent.click(screen.getAllByRole('button', { name: /下载图包/ })[1]);
  expect(await screen.findByText('网络中断')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: /下载图包/ })[1]);
  expect(await screen.findByText('下载校验失败')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试下载' }));
  await waitFor(() => expect(mocks.control).toHaveBeenLastCalledWith('download', 'v5'));
  expect(screen.getByRole('progressbar', { name: '图包下载进度' })).toBeTruthy();
});

it('校验期间仍可暂停，点击只调用后台pause', async () => {
  const verifying = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], download: { stage: 'verifying', receivedBytes: 1000, totalBytes: 1000 },
  }] });
  mocks.status.mockResolvedValue(verifying);
  mocks.control.mockResolvedValue({ status: verifying });
  render(<ArtistSampleManager />);
  expect((await screen.findAllByText('正在校验图包…')).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: '暂停下载' }));
  await waitFor(() => expect(mocks.control).toHaveBeenCalledWith('pause', 'v5'));
  expect(mocks.control).not.toHaveBeenCalledWith('download', 'v5');
  expect(mocks.control).not.toHaveBeenCalledWith('pick', 'v5');
});

it('托管包索引失败时允许重试后台关联并恢复已下载状态', async () => {
  const brokenManaged = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], phase: 'error', error: '托管图包索引失败', managed: true,
    download: { stage: 'ready', receivedBytes: 1000, totalBytes: 1000 },
  }] });
  const recovered = makeStatus({ packs: [makeStatus().packs[0], {
    ...brokenManaged.packs[1], phase: 'ready', error: undefined, progress: 100, count: 22000, revision: 'fixed',
  }] });
  mocks.status.mockResolvedValue(brokenManaged);
  mocks.control.mockResolvedValueOnce({ status: recovered });
  render(<ArtistSampleManager />);
  expect(await screen.findByText('托管图包索引失败')).toBeTruthy();
  const retry = screen.getAllByRole('button', { name: '重试下载' })[0];
  expect((retry as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(retry);
  await waitFor(() => expect(mocks.control).toHaveBeenCalledWith('download', 'v5'));
  expect(await screen.findByRole('button', { name: '已下载' })).toBeTruthy();
});

it('后台下载完成后索引就绪，轮询期间发一次图库更新事件', async () => {
  vi.useFakeTimers();
  const downloading = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], download: { stage: 'downloading', receivedBytes: 500, totalBytes: 1000 },
  }] });
  const ready = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], phase: 'ready', progress: 100, count: 22000, revision: 'new', managed: true,
    download: { stage: 'ready', receivedBytes: 1000, totalBytes: 1000 },
  }] });
  mocks.status.mockResolvedValueOnce(makeStatus()).mockResolvedValueOnce(ready);
  mocks.control.mockResolvedValueOnce({ status: downloading });
  render(<ArtistSampleManager />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getAllByRole('button', { name: /下载图包/ })[1]);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByText('可用 · 22000 个画师 Tag')).toBeTruthy();
  expect(mocks.broadcast).toHaveBeenCalledOnce();
});

it('状态轮询暂时失败会显示手动重试并继续按间隔读取，恢复后清除错误', async () => {
  vi.useFakeTimers();
  const downloading = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], download: { stage: 'downloading', receivedBytes: 500, totalBytes: 1000 },
  }] });
  const ready = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], phase: 'ready', progress: 100, count: 22000, revision: 'new', managed: true,
    download: { stage: 'ready', receivedBytes: 1000, totalBytes: 1000 },
  }] });
  mocks.status.mockResolvedValueOnce(makeStatus()).mockRejectedValueOnce(new Error('暂时无法读取状态')).mockResolvedValueOnce(ready);
  mocks.control.mockResolvedValueOnce({ status: downloading });
  render(<ArtistSampleManager />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getAllByRole('button', { name: /下载图包/ })[1]);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByText('暂时无法读取状态')).toBeTruthy();
  expect(screen.getByRole('button', { name: '重试读取状态' })).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.queryByText('暂时无法读取状态')).toBeNull();
  expect(mocks.status).toHaveBeenCalledTimes(3);
  expect(mocks.broadcast).toHaveBeenCalledOnce();
});

it('卸载时中止在途下载状态轮询', async () => {
  vi.useFakeTimers();
  let pollSignal: AbortSignal | undefined;
  const downloading = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], download: { stage: 'downloading', receivedBytes: 5, totalBytes: 100 },
  }] });
  mocks.status.mockResolvedValueOnce(makeStatus()).mockImplementationOnce(signal => {
    pollSignal = signal;
    return new Promise(() => {});
  });
  mocks.control.mockResolvedValueOnce({ status: downloading });
  const view = render(<ArtistSampleManager />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getAllByRole('button', { name: /下载图包/ })[1]);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(pollSignal).toBeDefined();
  view.unmount();
  expect(pollSignal?.aborted).toBe(true);
});

it('设置只保留资源管理，下载时不误报尚未关联，维护按状态禁用', async () => {
  mocks.status.mockResolvedValue(makeStatus({ packs: [{ ...makeStatus().packs[1], download: { stage: 'downloading', receivedBytes: 5, totalBytes: 10 } }] }));
  render(<ArtistSampleManager />);
  await screen.findByText('图包下载中：50%');
  expect(screen.queryByText('样张配置')).toBeNull();
  expect(screen.queryByText('正向提示词')).toBeNull();
  expect(screen.queryAllByText('未下载')).toHaveLength(1);
  fireEvent.click(screen.getAllByRole('button', { name: '图包管理' })[1]);
  expect((screen.getByRole('button', { name: '使用本地文件' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '重新建立索引' }) as HTMLButtonElement).disabled).toBe(true);
});
it('没有关联路径时禁用重新索引与解除关联，另一包下载时不能选择文件或解除关联', async () => {
  const value = makeStatus();
  value.packs[1].download = { stage: 'downloading', receivedBytes: 5, totalBytes: 10 };
  mocks.status.mockResolvedValue(value);
  render(<ArtistSampleManager />);
  await screen.findByText('可用 · 31000 个画师 Tag');
  fireEvent.click(screen.getAllByRole('button', { name: '图包管理' })[0]);
  expect((screen.getByRole('button', { name: '使用本地文件' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '解除关联（不删文件）' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '重新建立索引' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(screen.getAllByRole('button', { name: '图包管理' })[1]);
  expect((screen.getByRole('button', { name: '重新建立索引' }) as HTMLButtonElement).disabled).toBe(true);
});
