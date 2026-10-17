// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CreationFootprint } from '../../components/CreationFootprint';
import type { UsageStats } from '../../services/usageStats';

const mocks = vi.hoisted(() => ({
  getStats: vi.fn(),
  collection: [] as { sourceType: string; sourceId: string; archived?: boolean }[],
}));

vi.mock('../../services/usageStats', async original => ({ ...await original<typeof import('../../services/usageStats')>(), getUsageStats: mocks.getStats }));
vi.mock('../../services/collectionFavorites', () => ({
  ensureCollection: async () => {},
  collectionSnapshot: () => mocks.collection,
  subscribeCollection: () => () => {},
  collectionRevision: () => 0,
}));

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = new Date();
const todayKey = dayKey(today);
const yesterdayKey = dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
const now = Date.now();

const stats = (overrides: Partial<UsageStats> = {}): UsageStats => ({
  totals: { images: 120, activeDays: 12, favoriteImages: 8, firstAt: now - 30 * 86400000, lastAt: now, currentStreak: 3 },
  daily: [{ date: todayKey, images: 4 }, { date: yesterdayKey, images: 2 }],
  chains: [{ id: 'chain-a', name: '厚涂冷色', images: 80, lastAt: now }],
  artists: [{ name: 'alpha_artist', images: 60, lastAt: now }],
  models: [{ model: 'nai-diffusion-4-5-full', images: 100 }],
  sizes: [{ width: 832, height: 1216, images: 90 }],
  steps: [{ steps: 28, images: 70 }],
  operations: [{ operation: 'text-to-image', images: 100 }, { operation: 'inpaint', images: 20 }],
  uniqueChains: 2,
  uniqueArtists: 5,
  artistScan: { scanned: 120, truncated: false },
  generatedAt: now,
  ...overrides,
});

const setup = (overrides: Partial<UsageStats> = {}) => {
  const onOpenHistory = vi.fn(), onOpenCollection = vi.fn(), onOpenLab = vi.fn();
  mocks.getStats.mockResolvedValue(stats(overrides));
  const view = render(<CreationFootprint active onOpenHistory={onOpenHistory} onOpenCollection={onOpenCollection} onOpenLab={onOpenLab} />);
  return { ...view, onOpenHistory, onOpenCollection, onOpenLab };
};

beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); mocks.collection = [];
});
afterEach(cleanup);

it('显示概览、热力图、风格串与画师排行，并落到真实历史筛选', async () => {
  const { onOpenHistory } = setup();
  expect(await screen.findByText('作品总数')).toBeTruthy();
  expect(screen.getByText('120')).toBeTruthy();
  expect(screen.getByRole('grid', { name: '近一年创作热力图' })).toBeTruthy();
  expect(screen.getByText('风格串使用排行')).toBeTruthy();
  expect(screen.getByText('画师使用排行')).toBeTruthy();

  fireEvent.click(screen.getAllByRole('button', { name: /厚涂冷色/ }).at(-1)!);
  expect(onOpenHistory).toHaveBeenLastCalledWith({ source: 'chain-a', sort: 'newest' });
  fireEvent.click(screen.getAllByRole('button', { name: /alpha_artist/ }).at(-1)!);
  expect(onOpenHistory).toHaveBeenLastCalledWith({ search: 'artist:alpha_artist', sort: 'newest' });

  const cell = screen.getByRole('gridcell', { name: `${todayKey} · 4 张` });
  fireEvent.click(cell);
  expect(onOpenHistory).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'newest' }));
  expect(onOpenHistory.mock.calls.at(-1)![0].from).toBeLessThanOrEqual(now);
});

it('切换时间范围重新读取，切到近 7 天不保留旧 30 天结果', async () => {
  setup();
  await screen.findByText('作品总数');
  expect(mocks.getStats).toHaveBeenLastCalledWith('30', expect.any(AbortSignal));
  fireEvent.click(screen.getByRole('button', { name: '近 7 天' }));
  await waitFor(() => expect(mocks.getStats).toHaveBeenLastCalledWith('7', expect.any(AbortSignal)));
  expect(localStorage.getItem('nai_footprint_range')).toBe('7');
});

it('总数与收藏来自本地统计与收藏快照，不把收藏当成生成量', async () => {
  mocks.collection = [
    { sourceType: 'chain', sourceId: 'chain-a' },
    { sourceType: 'artist', sourceId: 'alpha_artist' },
    { sourceType: 'history', sourceId: 'one' },
    { sourceType: 'history', sourceId: 'two', archived: true },
  ];
  setup();
  await screen.findByText('作品总数');
  expect(screen.getByText('收藏的风格串')).toBeTruthy();
  expect(screen.getAllByText('1').length).toBeGreaterThan(0);
  expect(screen.getByText('120')).toBeTruthy();
});

it('没有记录时给出空态与去实验室入口', async () => {
  const { onOpenLab } = setup({ totals: { images: 0, activeDays: 0, favoriteImages: 0, firstAt: null, lastAt: null, currentStreak: 0 }, daily: [], chains: [], artists: [], models: [], sizes: [], steps: [], operations: [], uniqueChains: 0, uniqueArtists: 0, artistScan: { scanned: 0, truncated: false } });
  expect(await screen.findByText('还没有创作记录')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '去实验室创作' }));
  expect(onOpenLab).toHaveBeenCalledOnce();
});

it('统计读取失败时显示错误并可重试', async () => {
  mocks.getStats.mockRejectedValueOnce(new Error('合成统计失败')).mockResolvedValueOnce(stats());
  render(<CreationFootprint active onOpenHistory={() => {}} onOpenCollection={() => {}} onOpenLab={() => {}} />);
  expect(await screen.findByText('合成统计失败')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('作品总数')).toBeTruthy();
});
