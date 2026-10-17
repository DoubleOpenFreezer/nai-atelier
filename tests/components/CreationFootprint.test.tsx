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
vi.mock('../../services/anlasBudget', () => ({ useAnlasBudget: () => ({ remaining: 100, personal: { anlasSpent: 0, opusImages: 0 }, loading: false }) }));
vi.mock('../../services/naiUsage', () => ({ useNovelaiUsage: () => ({ info: null }) }));
vi.mock('../../services/styleRollApi', () => ({ loadRollExperiments: async () => [] }));
vi.mock('../../services/vibeService', () => ({ vibeService: { list: async () => [], listGroups: async () => [] } }));
vi.mock('../../services/promptAgent', () => ({ promptAgentService: { listSessions: async () => [] } }));
vi.mock('../../services/usageEvents', () => ({ getUsageEventStats: async () => ({ totals: [], daily: [], generatedAt: 0 }) }));

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = new Date();
const todayKey = dayKey(today);
const yesterdayKey = dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
const weekStart = (time: number) => {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
};
const previousMonth = (() => {
  const date = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
})();
const now = Date.now();

const stats = (overrides: Partial<UsageStats> = {}): UsageStats => ({
  totals: { images: 120, activeDays: 12, favoriteImages: 8, firstAt: now - 30 * 86400000, lastAt: now, currentStreak: 3 },
  daily: [{ date: todayKey, images: 4 }, { date: yesterdayKey, images: 2 }],
  chains: [{ id: 'chain-a', name: '厚涂冷色', images: 80, lastAt: now }],
  artists: [{ name: 'alpha_artist', images: 60, lastAt: now }],
  characters: [{ id: 'character-a', name: '角色甲', images: 20, lastAt: now }],
  tags: [{ name: '1girl', images: 100 }, { name: 'solo', images: 90 }],
  characterUsage: { images: 30, slots: 45 },
  vibeUsage: { images: 12, slots: 18 },
  referenceUsage: { images: 8, slots: 10 },
  models: [{ model: 'nai-diffusion-4-5-full', images: 100 }],
  sizes: [{ width: 832, height: 1216, images: 90 }],
  steps: [{ steps: 28, images: 70 }],
  operations: [{ operation: 'text-to-image', images: 100 }, { operation: 'inpaint', images: 20 }],
  uniqueChains: 2,
  uniqueArtists: 5,
  uniqueCharacters: 3,
  artistScan: { scanned: 120, truncated: false },
  generatedAt: now,
  ...overrides,
});

const setup = (overrides: Partial<UsageStats> = {}) => {
  const onOpenHistory = vi.fn(), onOpenCollection = vi.fn(), onOpenLab = vi.fn(), onOpenRoll = vi.fn();
  mocks.getStats.mockResolvedValue(stats(overrides));
  const view = render(<CreationFootprint active chains={[]} onOpenHistory={onOpenHistory} onOpenCollection={onOpenCollection} onOpenLab={onOpenLab} onOpenRoll={onOpenRoll} />);
  return { ...view, onOpenHistory, onOpenCollection, onOpenLab, onOpenRoll };
};

beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); mocks.collection = [];
});
afterEach(cleanup);

it('显示概览、热力图、风格串与画师排行，并落到真实历史筛选', async () => {
  const { onOpenHistory } = setup();
  expect(await screen.findByText('作品总数')).toBeTruthy();
  expect(screen.getByText('120')).toBeTruthy();
  expect(screen.getByRole('grid', { name: '创作活动热力图' })).toBeTruthy();
  expect(screen.getAllByRole('gridcell').length).toBeGreaterThanOrEqual(365);
  expect(screen.getByText('风格串使用排行')).toBeTruthy();
  expect(screen.getByText('画师使用排行')).toBeTruthy();
  expect(screen.getByText('角色使用排行')).toBeTruthy();
  expect(screen.getByText('创作资产')).toBeTruthy();
  expect(screen.getByText('创作助手')).toBeTruthy();
  expect(screen.getByText('成本与边界')).toBeTruthy();
  expect(screen.getByText(/1girl/)).toBeTruthy();

  fireEvent.click(screen.getAllByRole('button', { name: /厚涂冷色/ }).at(-1)!);
  expect(onOpenHistory).toHaveBeenLastCalledWith({ search: '厚涂冷色', sort: 'newest' });
  fireEvent.click(screen.getAllByRole('button', { name: /alpha_artist/ }).at(-1)!);
  expect(onOpenHistory).toHaveBeenLastCalledWith({ search: 'artist:alpha_artist', sort: 'newest' });

  const cell = screen.getByRole('gridcell', { name: `${todayKey} · 4 张` });
  fireEvent.click(cell);
  expect(onOpenHistory).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'newest' }));
  expect(onOpenHistory.mock.calls.at(-1)![0].from).toBeLessThanOrEqual(now);
});

it('周视图使用下拉选择，只列到本周', async () => {
  localStorage.setItem('nai_footprint_granularity_v2', 'week');
  setup();
  expect(await screen.findByText('作品总数')).toBeTruthy();
  expect(screen.getAllByRole('gridcell')).toHaveLength(7);
  const select = screen.getByLabelText('选择周') as HTMLSelectElement;
  const currentWeek = weekStart(now);
  expect(Number(select.value)).toBe(currentWeek);
  const options = [...select.options].map(option => Number(option.value));
  expect(Math.max(...options)).toBe(currentWeek);
  const previousWeek = currentWeek - 7 * 86400000;
  fireEvent.change(select, { target: { value: String(previousWeek) } });
  await waitFor(() => expect(mocks.getStats).toHaveBeenLastCalledWith('7', expect.any(AbortSignal), expect.any(String), undefined, expect.objectContaining({ start: previousWeek, end: previousWeek + 7 * 86400000 - 1 })));
  fireEvent.click(screen.getByRole('button', { name: '月' }));
  await waitFor(() => expect(mocks.getStats).toHaveBeenLastCalledWith('month', expect.any(AbortSignal), expect.any(String), undefined, undefined));
  expect(localStorage.getItem('nai_footprint_granularity_v2')).toBe('month');
});

it('可以按月下拉切换，统计与热力图切换到该月', async () => {
  setup();
  await screen.findByText('作品总数');
  fireEvent.click(screen.getByRole('button', { name: '月' }));
  const select = screen.getByLabelText('选择月份') as HTMLSelectElement;
  fireEvent.change(select, { target: { value: previousMonth } });
  await waitFor(() => expect(mocks.getStats).toHaveBeenLastCalledWith('month', expect.any(AbortSignal), previousMonth, undefined, undefined));
  expect(localStorage.getItem('nai_footprint_month')).toBe(previousMonth);
  expect(screen.getAllByRole('gridcell')).toHaveLength(new Date(today.getFullYear(), today.getMonth(), 0).getDate());
});

it('年模式下拉选择年份，全部年份回到全历史', async () => {
  setup();
  await screen.findByText('作品总数');
  fireEvent.click(screen.getByRole('button', { name: '年' }));
  const select = await screen.findByLabelText('选择年份') as HTMLSelectElement;
  const year = String(new Date().getFullYear());
  await waitFor(() => expect(mocks.getStats).toHaveBeenLastCalledWith('all', expect.any(AbortSignal), expect.any(String), year, undefined));
  expect(select.value).toBe(year);
  fireEvent.change(select, { target: { value: '' } });
  await waitFor(() => expect(mocks.getStats).toHaveBeenLastCalledWith('all', expect.any(AbortSignal), expect.any(String), undefined, undefined));
  fireEvent.change(select, { target: { value: year } });
  await waitFor(() => expect(mocks.getStats).toHaveBeenLastCalledWith('all', expect.any(AbortSignal), expect.any(String), year, undefined));
  expect(localStorage.getItem('nai_footprint_year')).toBe(year);
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
  const { onOpenLab } = setup({ totals: { images: 0, activeDays: 0, favoriteImages: 0, firstAt: null, lastAt: null, currentStreak: 0 }, daily: [], chains: [], artists: [], characters: [], tags: [], characterUsage: { images: 0, slots: 0 }, vibeUsage: { images: 0, slots: 0 }, referenceUsage: { images: 0, slots: 0 }, models: [], sizes: [], steps: [], operations: [], uniqueChains: 0, uniqueArtists: 0, uniqueCharacters: 0, artistScan: { scanned: 0, truncated: false } });
  expect(await screen.findByText('还没有创作记录')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '去实验室创作' }));
  expect(onOpenLab).toHaveBeenCalledOnce();
});

it('统计读取失败时显示错误并可重试', async () => {
  mocks.getStats.mockRejectedValueOnce(new Error('合成统计失败')).mockResolvedValueOnce(stats());
  render(<CreationFootprint active chains={[]} onOpenHistory={() => {}} onOpenCollection={() => {}} onOpenLab={() => {}} onOpenRoll={() => {}} />);
  expect(await screen.findByText('合成统计失败')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('作品总数')).toBeTruthy();
});
