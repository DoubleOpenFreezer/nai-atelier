import React, { useMemo, useState } from 'react';
import { Check, Dice5, RotateCcw, Save, Trash2 } from 'lucide-react';
import type { LocalGenItem } from '../../types';
import { t } from '../../services/i18n';
import { scoreRollCandidates, type RollCandidate, type RollExperiment } from '../../services/styleRoll';
import { rollTier } from '../../services/styleRollWorkflow';
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
  selecting: boolean; selectedIds: Set<string>; sort: string; onSelect: (id: string) => void; onToggle: (id: string) => void;
  onSave: (id: string) => void; onArchive: (id: string) => void; busy: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>; onScroll: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
}
export const StyleRollGallery: React.FC<Props> = ({ experiment, candidates, images, selectedId, selectionFocusEnabled, historyReady, historyLoading, selecting, selectedIds, sort, onSelect, onToggle, onSave, onArchive, busy, scrollRef, onScroll, notify }) => {
  const display = useMobileImageDisplayPreferences('roll');
  const requestedColumns = useMasonryColumnCount(display, undefined, scrollRef, 220);
  const columns = display.desktopColumns === 'auto' ? Math.min(4, requestedColumns) : requestedColumns;
  const frosted = useGalleryFrostedCaption();
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const scores = useMemo(() => scoreRollCandidates(experiment), [experiment]);
  const ratings = [...scores.values()].filter(score => score.matches).map(score => score.rating);
  const ratio = (candidate: RollCandidate) => ratios[candidate.id] || (images.get(candidate.id)?.params.width ?? experiment.template.params.width) / (images.get(candidate.id)?.params.height ?? experiment.template.params.height);
  const renderCard = (candidate: RollCandidate) => {
    const item = images.get(candidate.id), index = experiment.candidates.indexOf(candidate) + 1;
    const selected = selecting ? selectedIds.has(candidate.id) : selectedId === candidate.id;
    const score = scores.get(candidate.id)!;
    const activate = () => { if (selecting) { if (!busy) onToggle(candidate.id); } else onSelect(selectedId === candidate.id ? '' : candidate.id); };
    return <PressRevealSurface key={candidate.id} pressDisabled={selecting} role={selecting ? 'checkbox' : 'button'} tabIndex={0}
      data-agent-action="select" data-gallery-work-id={candidate.id} data-safe-mode-work="true"
      aria-label={t(selecting ? '选择画风 {0}' : '查看候选 {0}', [index])} aria-checked={selecting ? selected : undefined} aria-pressed={selecting ? undefined : selected} aria-disabled={selecting ? busy : undefined}
      onClick={activate} onKeyDown={event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); activate(); } }}
      className={`mobile-gallery-item gallery-image-card gallery-card-visual group relative flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border bg-white text-left transition-[border-color,box-shadow,transform] dark:bg-gray-850 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${selected ? '!border-indigo-500 ring-2 ring-indigo-500/20' : 'border-gray-200 hover:border-indigo-500 dark:border-gray-800/80 dark:hover:border-indigo-500/50'} ${!selecting && selectionFocusEnabled && selectedId && !selected ? 'brightness-[.7]' : ''}`}>
      <div className="mobile-gallery-frame relative w-full overflow-hidden border-b border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-950" style={{ '--mobile-image-ratio': String(ratio(candidate)) } as React.CSSProperties}>
        {item ? <SmartImage src={item.imageUrl} alt={t('候选 {0}', [index])} className="h-full w-full object-contain" onLoad={event => { const image = event.currentTarget, next = image.naturalWidth / Math.max(1, image.naturalHeight); if (next > 0 && next !== ratios[candidate.id]) setRatios(current => ({ ...current, [candidate.id]: next })); }} />
          : <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 px-4 text-gray-400"><Dice5 className="h-8 w-8" /><span className="text-xs">{t(historyReady ? score.matches ? '原图暂不可用' : '待生成' : historyLoading ? '加载中…' : '历史暂不可用')}</span></div>}
        {selecting ? <span aria-hidden="true" className={`absolute left-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full border shadow backdrop-blur ${selected ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-white/80 bg-black/35 text-transparent'}`}><Check className="h-4 w-4" /></span>
          : <>
            <div data-card-action="true" className="hover-reveal-md absolute left-2 top-2 z-20">
              <button type="button" aria-label={t(candidate.archived ? '恢复画风 {0}' : '丢弃画风 {0}', [index])} title={t(candidate.archived ? '恢复' : '丢弃')} disabled={busy} onClick={event => { event.stopPropagation(); onArchive(candidate.id); }} className="mobile-size-locked flex h-11 w-11 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white md:h-8 md:w-8">{candidate.archived ? <RotateCcw className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}</button>
            </div>
            <div data-card-action="true" className="absolute right-2 top-2 z-20 flex flex-col items-center gap-2">
              {item && <ImageShareActions imageUrl={item.imageUrl} filename={`roll-${item.id}.png`} generationData={item} favorite={{ imageUrl: item.imageUrl, sourceType: 'history', sourceId: item.id }} notify={notify} variant="card" className="flex-col" />}
              {!candidate.savedChainId && !candidate.archived && item && <button type="button" aria-label={t('保存画风 {0}', [index])} title={t('存为风格串')} disabled={busy} onClick={event => { event.stopPropagation(); onSave(candidate.id); }} className={`hover-reveal-md ${IMAGE_CARD_ACTION_CLASS} inline-flex items-center justify-center disabled:opacity-40`}><Save className="h-4 w-4" /></button>}
            </div>
          </>}

      </div>
      <div className="gallery-card-caption flex h-12 items-center gap-2 px-3">
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-gray-700 dark:text-gray-200" title={candidate.genes.map(gene => gene.tag).join(', ')}>{candidate.genes.map(gene => gene.tag).join(' · ')}</p></div>
        {candidate.savedChainId && <span aria-label={t('已保存画风 {0}', [index])} title={t('已保存到风格串')} className="shrink-0 text-emerald-500"><Check className="h-4 w-4" /></span>}
        <span className="gallery-card-meta shrink-0 text-xs text-gray-400">#{index}</span>
        {sort === 'rating' && <span className="gallery-card-badge shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-300">{rollTier(score.rating, score.matches, ratings).tier} · {Math.round(score.rating)}</span>}
      </div>
    </PressRevealSurface>;
  };
  return <section ref={scrollRef} onScroll={onScroll} aria-label={t('画风库')} className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3 md:p-5">
    {candidates.length ? display.layout === 'masonry' ? <ShortestColumnMasonry items={candidates} columns={columns} getItemKey={candidate => candidate.id} estimateItemHeight={(candidate, width) => width / ratio(candidate) + (frosted ? 2 : 50)} renderItem={renderCard} />
      : <div className={`${mobileGalleryClassName(display)} workspace-card-grid workspace-roll-grid`} style={mobileGalleryStyle(display, columns)}>{candidates.map(renderCard)}</div>
      : <EmptyState className="h-full min-h-60" title={t('暂无匹配画风')} />}
  </section>;
};
