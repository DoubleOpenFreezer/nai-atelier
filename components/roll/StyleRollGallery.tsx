import React, { useState } from 'react';
import { Check, Compass, Dice5, RotateCcw, Save, Sparkles, Trash2 } from 'lucide-react';
import type { LocalGenItem } from '../../types';
import { t } from '../../services/i18n';
import { type RollCandidate, type RollExperiment } from '../../services/styleRoll';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../../services/imageDisplayPreferences';
import { useGalleryFrostedCaption } from '../../services/appearancePreferences';
import { ShortestColumnMasonry, useMasonryColumnCount } from '../ShortestColumnMasonry';
import { PressRevealSurface } from '../PressRevealSurface';
import { SmartImage } from '../SmartImage';
import { IMAGE_CARD_ACTION_CLASS, ImageShareActions } from '../ImageShareActions';
import { EmptyState } from '../DesignSystem';

interface Props {
  experiment: RollExperiment; candidates: RollCandidate[]; images: Map<string, LocalGenItem>; selectedId: string; selectionFocusEnabled: boolean;
  historyReady: boolean; historyLoading: boolean;
  selecting: boolean; selectedIds: Set<string>; onSelect: (id: string) => void; onToggle: (id: string) => void;
  onSave: (id: string) => void; onArchive: (id: string) => void; busy: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>; onScroll: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
}

const methodMeta: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  random: { label: '随机', icon: <Dice5 className="h-3 w-3" />, color: 'text-sky-500 bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800' },
  mutate: { label: '变异', icon: <Sparkles className="h-3 w-3" />, color: 'text-amber-500 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800' },
  manual: { label: '手动', icon: <Compass className="h-3 w-3" />, color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800' },
};

const GENE_COLORS = [
  'bg-indigo-500 text-indigo-700 dark:text-indigo-300',
  'bg-emerald-500 text-emerald-700 dark:text-emerald-300',
  'bg-purple-500 text-purple-700 dark:text-purple-300',
  'bg-amber-500 text-amber-700 dark:text-amber-300',
  'bg-rose-500 text-rose-700 dark:text-rose-300',
  'bg-cyan-500 text-cyan-700 dark:text-cyan-300',
];

export const StyleRollGallery: React.FC<Props> = ({ experiment, candidates, images, selectedId, selectionFocusEnabled, historyReady, historyLoading, selecting, selectedIds, onSelect, onToggle, onSave, onArchive, busy, scrollRef, onScroll, notify }) => {
  const display = useMobileImageDisplayPreferences('roll');
  const requestedColumns = useMasonryColumnCount(display, undefined, scrollRef, 220);
  const columns = display.desktopColumns === 'auto' ? Math.min(4, requestedColumns) : requestedColumns;
  const frosted = useGalleryFrostedCaption();
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const ratio = (candidate: RollCandidate) => ratios[candidate.id] || (images.get(candidate.id)?.params.width ?? experiment.template.params.width) / (images.get(candidate.id)?.params.height ?? experiment.template.params.height);

  const renderCard = (candidate: RollCandidate) => {
    const item = images.get(candidate.id), index = experiment.candidates.indexOf(candidate) + 1;
    const selected = selecting ? selectedIds.has(candidate.id) : selectedId === candidate.id;
    const method = methodMeta[candidate.method] || methodMeta.random;
    const activate = () => { if (selecting) { if (!busy) onToggle(candidate.id); } else onSelect(selectedId === candidate.id ? '' : candidate.id); };

    // 计算总权重以便展示多彩权重条
    const totalWeight = candidate.genes.reduce((sum, g) => sum + Math.max(0.1, g.weight), 0) || 1;

    return <PressRevealSurface key={candidate.id} pressDisabled={selecting} role={selecting ? 'checkbox' : 'button'} tabIndex={0}
      data-agent-action="select" data-gallery-work-id={candidate.id} data-safe-mode-work="true"
      aria-label={t(selecting ? '选择画风 {0}' : '查看候选 {0}', [index])} aria-checked={selecting ? selected : undefined} aria-pressed={selecting ? undefined : selected} aria-disabled={selecting ? busy : undefined}
      onClick={activate} onKeyDown={event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); activate(); } }}
      className={`mobile-gallery-item gallery-image-card gallery-card-visual group relative flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-2xl border bg-white shadow-sm text-left transition-all duration-200 dark:bg-gray-850 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${selected ? '!border-indigo-500 ring-2 ring-indigo-500/25 shadow-md shadow-indigo-500/10' : 'border-gray-200/90 hover:border-indigo-400 hover:shadow-md dark:border-gray-800/80 dark:hover:border-indigo-500/50'} ${!selecting && selectionFocusEnabled && selectedId && !selected ? 'brightness-[.7]' : ''}`}>

      {/* 顶部微型信息徽章 */}
      <div className="absolute left-2.5 top-2.5 z-20 flex items-center gap-1.5 pointer-events-none">
        <span className="flex items-center gap-1 rounded-full border border-black/10 bg-black/40 px-2 py-0.5 text-xs font-mono font-medium text-white shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-black/60">
          #{index}
        </span>
        {candidate.method && (
          <span className={`hidden sm:inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs font-semibold backdrop-blur-md shadow-sm ${method.color}`}>
            {method.icon}
            <span>{t(method.label)}</span>
          </span>
        )}
      </div>

      <div className="mobile-gallery-frame relative w-full overflow-hidden border-b border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-950" style={{ '--mobile-image-ratio': String(ratio(candidate)) } as React.CSSProperties}>
        {item ? <SmartImage src={item.imageUrl} alt={t('候选 {0}', [index])} className="h-full w-full object-contain" onLoad={event => { const image = event.currentTarget, next = image.naturalWidth / Math.max(1, image.naturalHeight); if (next > 0 && next !== ratios[candidate.id]) setRatios(current => ({ ...current, [candidate.id]: next })); }} />
          : <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 px-4 text-gray-400 dark:text-gray-500">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-900 text-gray-400">
                <Dice5 className="h-6 w-6 animate-pulse" />
              </div>
              <span className="text-xs font-medium">{t(historyReady ? '待生成' : historyLoading ? '加载中…' : '历史暂不可用')}</span>
            </div>}

        {selecting ? (
          <span aria-hidden="true" className={`absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full border shadow backdrop-blur transition-all ${selected ? 'border-indigo-500 bg-indigo-600 text-white scale-105' : 'border-white/80 bg-black/35 text-transparent hover:scale-105'}`}><Check className="h-4 w-4" /></span>
        ) : (
          <>
            {/* 优雅的操作按钮（丢弃 / 恢复） */}
            <div data-card-action="true" className="hover-reveal-md absolute left-2.5 bottom-2.5 z-20">
              <button type="button" aria-label={t(candidate.archived ? '恢复画风 {0}' : '丢弃画风 {0}', [index])} title={t(candidate.archived ? '恢复' : '丢弃')} disabled={busy} onClick={event => { event.stopPropagation(); onArchive(candidate.id); }} className={`mobile-size-locked flex h-9 w-9 items-center justify-center rounded-full text-white shadow-md backdrop-blur-md transition-all hover:scale-110 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white md:h-8 md:w-8 ${candidate.archived ? 'bg-amber-500/90 hover:bg-amber-600' : 'bg-black/50 hover:bg-red-600'}`}>
                {candidate.archived ? <RotateCcw className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </div>

            {/* 右上角操作岛（分享 / 存为风格串） */}
            <div data-card-action="true" className="absolute right-2 top-2 z-20 flex flex-col items-center gap-1.5">
              {item && <ImageShareActions imageUrl={item.imageUrl} filename={`roll-${item.id}.png`} generationData={item} favorite={{ imageUrl: item.imageUrl, sourceType: 'history', sourceId: item.id }} notify={notify} variant="card" className="flex-col" />}
              {!candidate.savedChainId && !candidate.archived && item && (
                <button
                  type="button"
                  aria-label={t('保存画风 {0}', [index])}
                  title={t('存为风格串')}
                  disabled={busy}
                  onClick={event => { event.stopPropagation(); onSave(candidate.id); }}
                  className={`hover-reveal-md ${IMAGE_CARD_ACTION_CLASS} inline-flex items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg backdrop-blur-md transition-all hover:bg-emerald-500 hover:scale-110 active:scale-95 disabled:opacity-40`}
                >
                  <Save className="h-4 w-4" />
                </button>
              )}
            </div>
          </>
        )}

        {/* 底部微型画师权重渐变色带 */}
        {candidate.genes.length > 0 && (
          <div className="absolute inset-x-0 bottom-0 z-10 flex h-1 w-full overflow-hidden opacity-80 group-hover:opacity-100 transition-opacity">
            {candidate.genes.map((gene, gIdx) => {
              const pct = (Math.max(0.1, gene.weight) / totalWeight) * 100;
              const colorClass = GENE_COLORS[gIdx % GENE_COLORS.length].split(' ')[0];
              return (
                <div key={gene.tag} className={`${colorClass} h-full transition-all`} style={{ width: `${pct}%` }} title={`${gene.tag}: ${gene.weight.toFixed(1)}`} />
              );
            })}
          </div>
        )}
      </div>



      {/* 卡片底栏信息：精炼高颜值，只保留一组精致画师标签，消除文本重复 */}
      <div className="gallery-card-caption flex items-center justify-between px-3 py-2 gap-2 bg-white/95 dark:bg-gray-850/95 border-t border-gray-100 dark:border-gray-800">
        <div className="flex flex-wrap items-center gap-1.5 overflow-hidden min-w-0 flex-1" title={candidate.genes.map(gene => `${gene.tag} (${gene.weight.toFixed(1)})`).join(', ')}>
          {candidate.genes.slice(0, 3).map((gene, gIdx) => (
            <span key={gene.tag} className="inline-flex items-center gap-1 rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-200 truncate max-w-[130px] border border-gray-200/50 dark:border-gray-700/50">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${GENE_COLORS[gIdx % GENE_COLORS.length].split(' ')[0]}`} />
              <span className="truncate">{gene.tag}</span>
              <span className="font-mono text-xs opacity-60 font-semibold">{gene.weight.toFixed(1)}</span>
            </span>
          ))}
          {candidate.genes.length > 3 && (
            <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              +{candidate.genes.length - 3}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {candidate.savedChainId && (
            <span aria-label={t('已保存画风 {0}', [index])} title={t('已保存到风格串')} className="flex items-center gap-0.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
              <Check className="h-3 w-3" />
              <span>{t('已保存')}</span>
            </span>
          )}
          <span className="gallery-card-meta font-mono text-xs text-gray-400">#{index}</span>
        </div>
      </div>
    </PressRevealSurface>;
  };

  return <section ref={scrollRef} onScroll={onScroll} aria-label={t('画风库')} className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3 md:p-5">
    {candidates.length ? display.layout === 'masonry' ? <ShortestColumnMasonry items={candidates} columns={columns} getItemKey={candidate => candidate.id} estimateItemHeight={(candidate, width) => width / ratio(candidate) + (frosted ? 2 : 62)} renderItem={renderCard} />
      : <div className={`${mobileGalleryClassName(display)} workspace-card-grid workspace-roll-grid`} style={mobileGalleryStyle(display, columns)}>{candidates.map(renderCard)}</div>
      : <EmptyState className="h-full min-h-60" title={t('暂无匹配画风')} />}
  </section>;
};
