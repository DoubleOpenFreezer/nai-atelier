import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Activity, ArrowRight, BarChart3, Brush, CalendarDays, Flame, Footprints,
  Heart, Image as ImageIcon, LoaderCircle, Palette, RefreshCw, Sparkles,
} from 'lucide-react';
import { EmptyState, ToolbarButton, WorkspaceToolbar } from './DesignSystem';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';
import { collectionRevision, collectionSnapshot, ensureCollection, subscribeCollection } from '../services/collectionFavorites';
import { getNaiModelDisplayLabel } from '../services/naiModels';
import { getLanguage, t, useLanguage } from '../services/i18n';
import { getUsageStats, type UsageChainRow, type UsageRange, type UsageStats } from '../services/usageStats';
import type { HistoryBrowseQuery } from '../services/historyBrowse';

interface CreationFootprintProps {
  active?: boolean;
  onOpenHistory: (query?: HistoryBrowseQuery) => void;
  onOpenCollection: () => void;
  onOpenLab: () => void;
}

const RANGES: { id: UsageRange; label: string }[] = [
  { id: '7', label: '近 7 天' },
  { id: '30', label: '近 30 天' },
  { id: '365', label: '近一年' },
  { id: 'all', label: '全部' },
];

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const formatDay = (timestamp: number) => {
  if (!timestamp) return t('暂无');
  return new Intl.DateTimeFormat(getLanguage(), { month: 'short', day: 'numeric' }).format(new Date(timestamp));
};
const formatNumber = (value: number) => value.toLocaleString(getLanguage());
const formatMonth = (date: Date) => new Intl.DateTimeFormat(getLanguage(), { month: 'short' }).format(date);
const dayKeyToTime = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
};

const heatClass = (count: number) => count <= 0
  ? 'bg-gray-200/80 dark:bg-gray-800'
  : count === 1
    ? 'bg-indigo-200 dark:bg-indigo-900/70'
    : count <= 3
      ? 'bg-indigo-300 dark:bg-indigo-800'
      : count <= 6
        ? 'bg-indigo-400 dark:bg-indigo-700'
        : count <= 12
          ? 'bg-indigo-500 dark:bg-indigo-600'
          : 'bg-indigo-600 dark:bg-indigo-500';

const OPERATION_LABELS: Record<string, string> = {
  'text-to-image': '文生图',
  'image-to-image': '图生图',
  img2img: '图生图',
  inpaint: '局部重绘',
  outpaint: '扩图',
};

const StatCard: React.FC<{ label: string; value: React.ReactNode; detail?: React.ReactNode; icon?: React.ReactNode; title?: string }> = ({ label, value, detail, icon, title }) => (
  <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
    <div className="flex items-center justify-between gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
      <span className="truncate">{label}</span>
      {icon && <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-indigo-50 text-indigo-500 dark:bg-indigo-950/50 dark:text-indigo-300 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
    </div>
    <div title={title} className="mt-2 truncate text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{value}</div>
    {detail && <div className="mt-1 truncate text-xs text-gray-400 dark:text-gray-500">{detail}</div>}
  </div>
);

const RankingRow: React.FC<{ name: string; images: number; lastAt: number; onClick: () => void; accent?: 'indigo' | 'rose' }> = ({ name, images, lastAt, onClick, accent = 'indigo' }) => (
  <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-gray-800/70">
    <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg text-xs font-bold ${accent === 'rose' ? 'bg-rose-50 text-rose-500 dark:bg-rose-950/40 dark:text-rose-300' : 'bg-indigo-50 text-indigo-500 dark:bg-indigo-950/40 dark:text-indigo-300'}`}>
      {String(images)}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-semibold text-gray-800 dark:text-gray-100" title={name}>{name}</span>
      <span className="mt-0.5 block text-micro text-gray-400 dark:text-gray-500">{t('{0} 张 · 最近 {1}', [formatNumber(images), formatDay(lastAt)])}</span>
    </span>
    <ArrowRight className="h-3.5 w-3.5 flex-none text-gray-300 dark:text-gray-600" />
  </button>
);

const SectionCard: React.FC<{ title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, hint, action, children, className = '' }) => (
  <section className={`rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 ${className}`}>
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{hint}</p>}
      </div>
      {action}
    </div>
    {children}
  </section>
);

export const CreationFootprint: React.FC<CreationFootprintProps> = ({ active = true, onOpenHistory, onOpenCollection, onOpenLab }) => {
  const language = useLanguage();
  const [range, setRange] = useState<UsageRange>(() => {
    const saved = localStorage.getItem('nai_footprint_range');
    return saved === '7' || saved === '30' || saved === '365' || saved === 'all' ? saved : '30';
  });
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const requestRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const onScrollRestore = useKeepAliveScrollRestore(scrollRef, 'footprint');
  const collectionRevisionValue = useSyncExternalStore(subscribeCollection, collectionRevision, collectionRevision);

  useEffect(() => { localStorage.setItem('nai_footprint_range', range); }, [range]);
  useEffect(() => { void ensureCollection().catch(() => { /* 收藏读取失败不阻断足迹统计。 */ }); }, []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const request = ++requestRef.current;
    setLoading(true); setError('');
    void getUsageStats(range, controller.signal)
      .then(data => { if (request === requestRef.current) setStats(data); })
      .catch(cause => {
        if (request !== requestRef.current || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : t('统计加载失败，请稍后重试'));
      })
      .finally(() => { if (request === requestRef.current) setLoading(false); });
    return () => controller.abort();
  }, [active, range, reload]);

  const collectionCounts = useMemo(() => {
    const items = collectionSnapshot().filter(item => !item.archived);
    return {
      chains: items.filter(item => item.sourceType === 'chain').length,
      artists: items.filter(item => item.sourceType === 'artist').length,
      images: items.length,
    };
  }, [collectionRevisionValue]);

  const heatmap = useMemo(() => {
    const counts = new Map((stats?.daily || []).map(point => [point.date, point.images]));
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const gridStart = new Date(end);
    gridStart.setDate(gridStart.getDate() - 364 - gridStart.getDay());
    const weeks: { key: string; count: number; today: boolean; future: boolean }[][] = [];
    let week: { key: string; count: number; today: boolean; future: boolean }[] = [];
    for (let cursor = new Date(gridStart); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const date = new Date(cursor);
      const key = dayKey(date);
      week.push({ key, count: counts.get(key) || 0, today: key === dayKey(end), future: false });
      if (week.length === 7) { weeks.push(week); week = []; }
    }
    if (week.length) {
      while (week.length < 7) week.push({ key: '', count: 0, today: false, future: true });
      weeks.push(week);
    }
    const labels: { label: string; monthKey: string; weekIndex: number }[] = [];
    weeks.forEach((days, weekIndex) => {
      const first = days.find(day => day.key && !day.future);
      if (!first) return;
      const [year, month] = first.key.split('-').map(Number);
      const monthKey = `${year}-${month}`;
      if (labels.at(-1)?.monthKey === monthKey) return;
      labels.push({ label: formatMonth(new Date(year, month - 1, 1)), monthKey, weekIndex });
    });
    return { weeks, labels, startKey: weeks[0]?.find(day => day.key)?.key || '' };
  }, [stats?.daily, language]);

  const trend = useMemo(() => {
    const counts = new Map((stats?.daily || []).map(point => [point.date, point.images]));
    const days: { key: string; count: number }[] = [];
    const today = new Date();
    for (let index = 29; index >= 0; index--) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - index);
      const key = dayKey(date);
      days.push({ key, count: counts.get(key) || 0 });
    }
    return days;
  }, [stats?.daily]);

  const openDay = (key: string) => {
    if (!key) return;
    const [year, month, day] = key.split('-').map(Number);
    const from = new Date(year, month - 1, day).getTime();
    onOpenHistory({ from, to: startOfDay(new Date(year, month - 1, day + 1)) - 1, sort: 'newest' });
  };
  const openChain = (id: string) => onOpenHistory({ source: id, sort: 'newest' });
  const openArtist = (name: string) => onOpenHistory({ search: `artist:${name}`, sort: 'newest' });
  const openModel = (model: string) => onOpenHistory({ model, sort: 'newest' });
  const openOperation = (operation: string) => onOpenHistory({ operation, sort: 'newest' });
  const chainLabel = (chain: UsageChainRow) => chain.name || (chain.id === 'playground' ? t('生图实验室') : t('已移除的预设'));

  const totals = stats?.totals;
  const topChain = stats?.chains[0];
  const topArtist = stats?.artists[0];
  const topModel = stats?.models[0];
  const topSize = stats?.sizes[0];
  const topSteps = stats?.steps[0];
  const averagePerActiveDay = totals && totals.activeDays > 0 ? (totals.images / totals.activeDays).toFixed(1) : '0';
  const maxTrend = Math.max(1, ...trend.map(point => point.count));
  const hasData = Boolean(totals && totals.images > 0);

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      <WorkspaceToolbar>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-xl bg-indigo-50 text-indigo-500 dark:bg-indigo-950/50 dark:text-indigo-300"><Footprints className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold text-gray-900 dark:text-gray-100">{t('创作足迹')}</h1>
            <p className="hidden truncate text-micro text-gray-400 dark:text-gray-500 sm:block">{t('回看创作节奏、常用资产与收藏')}</p>
          </div>
        </div>
        <div className="flex max-w-[52vw] flex-none items-center gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-gray-100 p-0.5 dark:border-gray-700 dark:bg-gray-950 md:max-w-none">
          {RANGES.map(item => <button key={item.id} type="button" aria-pressed={range === item.id} onClick={() => setRange(item.id)} className={`mobile-touch whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-bold transition ${range === item.id ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-800 dark:text-indigo-300' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}>{t(item.label)}</button>)}
        </div>
        <ToolbarButton aria-label={t('刷新统计')} title={t('刷新统计')} onClick={() => setReload(value => value + 1)} disabled={loading} className="!px-2.5">
          {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}<span className="hidden lg:inline">{t('刷新')}</span>
        </ToolbarButton>
        <ToolbarButton onClick={() => onOpenHistory({ sort: 'newest' })} className="!px-2.5">
          <CalendarDays /><span className="hidden sm:inline">{t('打开历史')}</span>
        </ToolbarButton>
      </WorkspaceToolbar>

      <div ref={scrollRef} onScroll={onScrollRestore} className="flex-1 overflow-y-auto p-4 pb-28 md:p-6 md:pb-10">
        <div className="mx-auto w-full max-w-6xl space-y-4">
          {loading && !stats && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map(item => <div key={item} className="h-24 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900" />)}</div>}

          {error && !loading && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
            <div className="flex flex-wrap items-center gap-3"><span className="min-w-0 flex-1">{error}</span><button type="button" onClick={() => setReload(value => value + 1)} className="mobile-touch rounded-lg border border-current px-3 py-1 text-xs font-semibold">{t('重试')}</button><button type="button" onClick={() => onOpenHistory({ sort: 'newest' })} className="mobile-touch text-xs font-semibold underline">{t('打开历史')}</button></div>
          </div>}

          {!error && !loading && !hasData && <div className="rounded-2xl border border-gray-200 bg-white py-14 dark:border-gray-800 dark:bg-gray-900">
            <EmptyState icon={<Footprints className="h-8 w-8" />} title={t('还没有创作记录')} hint={t('生成并保存作品后，这里会记录你的创作节奏、常用画师与风格串。')} action={<div className="flex flex-wrap items-center justify-center gap-2"><ToolbarButton tone="primary" onClick={onOpenLab}>{t('去实验室创作')}</ToolbarButton><ToolbarButton onClick={() => onOpenHistory({ sort: 'newest' })}>{t('打开历史')}</ToolbarButton></div>} />
          </div>}

          {!error && hasData && totals && stats && <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              <StatCard label={t('作品总数')} value={formatNumber(totals.images)} detail={t('最近 {0}', [formatDay(totals.lastAt || 0)])} icon={<ImageIcon />} />
              <StatCard label={t('活跃天数')} value={formatNumber(totals.activeDays)} detail={t('平均每个活跃日 {0} 张', [averagePerActiveDay])} icon={<CalendarDays />} />
              <StatCard label={t('连续创作')} value={`${formatNumber(totals.currentStreak)} ${t('天')}`} icon={<Flame />} />
              <StatCard label={t('历史收藏')} value={formatNumber(totals.favoriteImages)} detail={t('已收藏的历史作品')} icon={<Heart />} />
              <StatCard label={t('最常用风格串')} value={topChain ? chainLabel(topChain) : t('暂无')} detail={topChain ? t('{0} 张', [formatNumber(topChain.images)]) : undefined} icon={<Palette />} title={topChain ? chainLabel(topChain) : undefined} />
              <StatCard label={t('最常用画师')} value={topArtist ? topArtist.name : t('暂无')} detail={topArtist ? t('{0} 张', [formatNumber(topArtist.images)]) : undefined} icon={<Brush />} title={topArtist?.name} />
            </div>

            <SectionCard title={t('创作活动')} hint={t('近一年每天生成的作品数；点击某天查看当天作品')} action={<span className="hidden items-center gap-1.5 text-micro text-gray-400 sm:flex">{t('少')}<span className="h-2.5 w-2.5 rounded-[2px] bg-gray-200 dark:bg-gray-800" /><span className="h-2.5 w-2.5 rounded-[2px] bg-indigo-300 dark:bg-indigo-800" /><span className="h-2.5 w-2.5 rounded-[2px] bg-indigo-400 dark:bg-indigo-700" /><span className="h-2.5 w-2.5 rounded-[2px] bg-indigo-500 dark:bg-indigo-600" /><span className="h-2.5 w-2.5 rounded-[2px] bg-indigo-600 dark:bg-indigo-500" />{t('多')}</span>}>
              <div className="overflow-x-auto pb-1">
                <div className="w-full min-w-[840px]">
                  <div aria-hidden="true" className="mb-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${heatmap.weeks.length}, minmax(0, 1fr))` }}>
                    {heatmap.labels.map(label => <span key={label.monthKey} style={{ gridColumnStart: label.weekIndex + 1, gridColumnEnd: `span ${Math.min(4, heatmap.weeks.length - label.weekIndex)}`, gridRowStart: 1 }} className="truncate text-micro text-gray-400 dark:text-gray-500">{label.label}</span>)}
                  </div>
                  <div className="flex w-full gap-1" role="grid" aria-label={t('近一年创作热力图')}>
                    {heatmap.weeks.map((week, weekIndex) => <div key={weekIndex} role="row" className="flex min-w-0 flex-1 flex-col gap-1">
                      {week.map((day, dayIndex) => <button key={dayIndex} type="button" role="gridcell" disabled={day.future} onClick={() => openDay(day.key)} title={day.future ? '' : t('{0} · {1} 张', [day.key, formatNumber(day.count)])} aria-label={day.future ? t('未来') : t('{0} · {1} 张', [day.key, formatNumber(day.count)])} className={`aspect-square w-full rounded-[2px] transition hover:ring-2 hover:ring-indigo-300 disabled:cursor-default disabled:opacity-0 dark:hover:ring-indigo-600 ${heatClass(day.count)} ${day.today ? 'ring-1 ring-indigo-500 ring-offset-1 dark:ring-offset-gray-900' : ''}`} />)}
                    </div>)}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex justify-between text-micro text-gray-400 dark:text-gray-500"><span>{heatmap.startKey ? formatDay(dayKeyToTime(heatmap.startKey)) : ''}</span><span>{t('今天')}</span></div>
            </SectionCard>

            <div className="grid gap-4 lg:grid-cols-2">
              <SectionCard title={t('风格串使用排行')} hint={t('按由该风格串生成的作品数排序')} action={<button type="button" onClick={() => onOpenHistory({ sort: 'newest' })} className="text-xs font-semibold text-indigo-600 dark:text-indigo-300">{t('打开历史')}</button>}>
                {stats.chains.length ? <div className="space-y-0.5">{stats.chains.slice(0, 8).map(chain => <RankingRow key={chain.id} name={chainLabel(chain)} images={chain.images} lastAt={chain.lastAt} onClick={() => openChain(chain.id)} />)}</div> : <p className="py-8 text-center text-sm text-gray-400">{t('暂无')}</p>}
              </SectionCard>
              <SectionCard title={t('画师使用排行')} hint={t('按历史 Prompt 中的 artist: 标签统计')}>
                {stats.artists.length ? <div className="space-y-0.5">{stats.artists.slice(0, 8).map(artist => <RankingRow key={artist.name} name={artist.name} images={artist.images} lastAt={artist.lastAt} onClick={() => openArtist(artist.name)} accent="rose" />)}</div> : <p className="py-8 text-center text-sm text-gray-400">{t('暂无')}</p>}
                {stats.artistScan.truncated && <p className="mt-2 text-micro text-gray-400">{t('基于最近 {0} 张作品统计', [formatNumber(stats.artistScan.scanned)])}</p>}
              </SectionCard>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <SectionCard title={t('最近 30 天趋势')} hint={t('每天生成的作品数')}>
                <div className="flex h-28 items-end gap-1" role="img" aria-label={t('最近 30 天趋势')}>
                  {trend.map(day => <button key={day.key} type="button" onClick={() => openDay(day.key)} title={t('{0} · {1} 张', [day.key, formatNumber(day.count)])} className="mobile-touch flex h-full flex-1 items-end rounded-t focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"><span className={`w-full rounded-t transition-colors ${day.count ? 'bg-indigo-500/85 hover:bg-indigo-500 dark:bg-indigo-400/80' : 'bg-gray-100 dark:bg-gray-800'}`} style={{ height: `${Math.max(3, day.count / maxTrend * 100)}%` }} /></button>)}
                </div>
                <div className="mt-2 flex justify-between text-micro text-gray-400"><span>{formatDay(Date.now() - 29 * 86400000)}</span><span>{t('今天')}</span></div>
              </SectionCard>

              <SectionCard title={t('收藏概览')} action={<button type="button" onClick={onOpenCollection} className="text-xs font-semibold text-indigo-600 dark:text-indigo-300">{t('打开收藏库')}</button>}>
                <div className="grid grid-cols-3 gap-2">
                  <button type="button" onClick={onOpenCollection} className="mobile-touch rounded-xl bg-gray-50 p-3 text-left dark:bg-gray-800/60"><span className="block text-lg font-bold tabular-nums text-gray-800 dark:text-gray-100">{formatNumber(collectionCounts.chains)}</span><span className="mt-0.5 block text-micro text-gray-400">{t('收藏的风格串')}</span></button>
                  <button type="button" onClick={onOpenCollection} className="mobile-touch rounded-xl bg-gray-50 p-3 text-left dark:bg-gray-800/60"><span className="block text-lg font-bold tabular-nums text-gray-800 dark:text-gray-100">{formatNumber(collectionCounts.artists)}</span><span className="mt-0.5 block text-micro text-gray-400">{t('收藏的画师')}</span></button>
                  <button type="button" onClick={onOpenCollection} className="mobile-touch rounded-xl bg-gray-50 p-3 text-left dark:bg-gray-800/60"><span className="block text-lg font-bold tabular-nums text-gray-800 dark:text-gray-100">{formatNumber(collectionCounts.images)}</span><span className="mt-0.5 block text-micro text-gray-400">{t('收藏的图片')}</span></button>
                </div>
                <p className="mt-3 text-micro leading-5 text-gray-400">{t('收藏是作品级记录；这里只汇总数量，不改变收藏内容。')}</p>
              </SectionCard>
            </div>

            <SectionCard title={t('创作洞察')} hint={t('从已保存作品归纳，不代表官方额度结算')}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <button type="button" onClick={() => topModel && openModel(topModel.model)} disabled={!topModel} className="mobile-touch rounded-xl border border-gray-100 p-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50/40 disabled:cursor-default dark:border-gray-800 dark:hover:border-indigo-900 dark:hover:bg-indigo-950/20"><span className="flex items-center gap-1.5 text-micro text-gray-400"><Sparkles className="h-3 w-3" />{t('最常用模型')}</span><span className="mt-1 block truncate text-sm font-bold text-gray-800 dark:text-gray-100">{topModel ? getNaiModelDisplayLabel(topModel.model) : t('暂无')}</span></button>
                <div className="rounded-xl border border-gray-100 p-3 dark:border-gray-800"><span className="flex items-center gap-1.5 text-micro text-gray-400"><BarChart3 className="h-3 w-3" />{t('最常用尺寸')}</span><span className="mt-1 block text-sm font-bold text-gray-800 dark:text-gray-100">{topSize ? `${topSize.width} × ${topSize.height}` : t('暂无')}</span></div>
                <div className="rounded-xl border border-gray-100 p-3 dark:border-gray-800"><span className="flex items-center gap-1.5 text-micro text-gray-400"><Activity className="h-3 w-3" />{t('最常用步数')}</span><span className="mt-1 block text-sm font-bold text-gray-800 dark:text-gray-100">{topSteps ? t('{0} 步', [topSteps.steps]) : t('暂无')}</span></div>
                <div className="rounded-xl border border-gray-100 p-3 dark:border-gray-800"><span className="flex items-center gap-1.5 text-micro text-gray-400"><Palette className="h-3 w-3" />{t('探索画师')}</span><span className="mt-1 block text-sm font-bold text-gray-800 dark:text-gray-100">{formatNumber(stats.uniqueArtists)}</span></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {stats.operations.map(operation => <button key={operation.operation} type="button" onClick={() => openOperation(operation.operation)} className="mobile-touch rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300">{t(OPERATION_LABELS[operation.operation] || operation.operation)} · {formatNumber(operation.images)}</button>)}
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300">{t('使用风格串')} · {formatNumber(stats.uniqueChains)}</span>
              </div>
            </SectionCard>
          </>}
        </div>
      </div>
    </div>
  );
};
