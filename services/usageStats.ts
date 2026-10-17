import { api } from './api';

export type UsageRange = '7' | '30' | '365' | 'all';

export interface UsageTotals {
  images: number;
  activeDays: number;
  favoriteImages: number;
  firstAt: number | null;
  lastAt: number | null;
  currentStreak: number;
}

export interface UsageDailyPoint { date: string; images: number; }
export interface UsageChainRow { id: string; name: string; images: number; lastAt: number; }
export interface UsageArtistRow { name: string; images: number; lastAt: number; }
export interface UsageModelRow { model: string; images: number; }
export interface UsageSizeRow { width: number; height: number; images: number; }
export interface UsageStepsRow { steps: number; images: number; }
export interface UsageOperationRow { operation: string; images: number; }

export interface UsageStats {
  totals: UsageTotals;
  daily: UsageDailyPoint[];
  chains: UsageChainRow[];
  artists: UsageArtistRow[];
  models: UsageModelRow[];
  sizes: UsageSizeRow[];
  steps: UsageStepsRow[];
  operations: UsageOperationRow[];
  uniqueChains: number;
  uniqueArtists: number;
  artistScan: { scanned: number; truncated: boolean };
  generatedAt: number;
}

const count = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const rows = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

/** 只读取本地历史聚合；页面切换时由调用方中止，不缓存过期统计。 */
export const getUsageStats = async (range: UsageRange, signal?: AbortSignal): Promise<UsageStats> => {
  const tzOffset = -new Date().getTimezoneOffset();
  const payload = await api.get(`/local-history/stats?days=${range}&tzOffset=${tzOffset}`, { cache: 'no-store', signal }) as Partial<UsageStats> | null;
  const totals = payload?.totals;
  return {
    totals: {
      images: count(totals?.images),
      activeDays: count(totals?.activeDays),
      favoriteImages: count(totals?.favoriteImages),
      firstAt: totals?.firstAt ? Number(totals.firstAt) : null,
      lastAt: totals?.lastAt ? Number(totals.lastAt) : null,
      currentStreak: count(totals?.currentStreak),
    },
    daily: rows<UsageDailyPoint>(payload?.daily),
    chains: rows<UsageChainRow>(payload?.chains),
    artists: rows<UsageArtistRow>(payload?.artists),
    models: rows<UsageModelRow>(payload?.models),
    sizes: rows<UsageSizeRow>(payload?.sizes),
    steps: rows<UsageStepsRow>(payload?.steps),
    operations: rows<UsageOperationRow>(payload?.operations),
    uniqueChains: count(payload?.uniqueChains),
    uniqueArtists: count(payload?.uniqueArtists),
    artistScan: payload?.artistScan && typeof payload.artistScan === 'object'
      ? { scanned: count(payload.artistScan.scanned), truncated: Boolean(payload.artistScan.truncated) }
      : { scanned: 0, truncated: false },
    generatedAt: count(payload?.generatedAt),
  };
};
