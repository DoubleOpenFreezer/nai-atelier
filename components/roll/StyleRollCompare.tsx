import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, SkipForward, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import type { LocalGenItem } from '../../types';
import { t, useLanguage } from '../../services/i18n';
import { formatRollStyle, scoreRollCandidates, type RollExperiment, type RollVote } from '../../services/styleRoll';
import { OriginalImage } from '../SmartImage';
import { EmptyState, IconButton, ToolbarButton } from '../DesignSystem';
import { isTopmostModal } from '../useModalA11y';

interface Props {
  experiment: RollExperiment; pair: [string, string] | null; images: Map<string, LocalGenItem>;
  active: boolean; busy: boolean; historyReady: boolean; hasSkipped: boolean;
  context?: string; undoAllowed?: boolean;
  onVote: (result: RollVote['result']) => void; onSkip: () => void; onUndo: () => void;
}

export const StyleRollCompare: React.FC<Props> = ({ experiment, pair, images, active, busy, historyReady, hasSkipped, context, undoAllowed = true, onVote, onSkip, onUndo }) => {
  useLanguage();
  const [blind, setBlind] = useState(true), [loaded, setLoaded] = useState(new Set<string>()), [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState(new Set<string>()), [retry, setRetry] = useState(0);
  const [position, setPosition] = useState({ x: 50, y: 50 });
  const scores = scoreRollCandidates(experiment);
  const pairId = pair?.join(':') || '';
  const ready = Boolean(historyReady && pair && pair.every(id => images.get(id) && loaded.has(images.get(id)!.id)));
  useEffect(() => { setZoom(1); setPosition({ x: 50, y: 50 }); }, [pairId]);
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      if (event.repeat || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || busy ||
        (event.target instanceof Element && event.target.closest('input, textarea, select, button, [contenteditable="true"]')) || Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]')).some(dialog => isTopmostModal(dialog))) return;
      if (ready && ['ArrowLeft', 'ArrowRight', 'Enter'].includes(event.key)) { event.preventDefault(); onVote(event.key === 'ArrowLeft' ? 'left' : event.key === 'ArrowRight' ? 'right' : 'draw'); }
      else if (event.key === 'Backspace' && experiment.votes.length && undoAllowed) { event.preventDefault(); onUndo(); }
      else if (event.key === ' ' && pair) { event.preventDefault(); onSkip(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [active, busy, ready, onVote, onSkip, onUndo, experiment.votes.length, pair, undoAllowed]);
  return <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
    {context && <h2 className="px-4 pt-3 text-sm font-semibold">{context}</h2>}
    <div className="flex flex-none flex-wrap items-center gap-2 px-4 py-3">
      <ToolbarButton active={blind} onClick={() => setBlind(!blind)}>{blind ? <EyeOff /> : <Eye />}{t(blind ? '盲选已开启' : '显示画师')}</ToolbarButton>
      <IconButton label="缩小图片" disabled={zoom <= 1} onClick={() => setZoom(Math.max(1, zoom - 0.5))}><ZoomOut /></IconButton>
      <span className="text-xs tabular-nums text-gray-500">{zoom.toFixed(1)}×</span>
      <IconButton label="放大图片" disabled={zoom >= 4} onClick={() => setZoom(Math.min(4, zoom + 0.5))}><ZoomIn /></IconButton>
      <span className="ml-auto text-xs text-gray-500">{t('已对比 {0} 次', [experiment.votes.length])}</span>
    </div>
    {pair ? <>
      <div className="grid min-h-[240px] flex-1 grid-cols-2 gap-2 px-3 md:gap-4 md:px-4">
        {pair.map((id, index) => {
          const candidate = experiment.candidates.find(item => item.id === id)!, item = images.get(id)!, score = scores.get(id)!;
          return <div key={index} className="flex min-h-0 min-w-0 flex-col gap-2">
            <div className="relative min-h-[180px] flex-1 overflow-hidden rounded-2xl border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-950" style={{ touchAction: zoom > 1 ? 'none' : 'auto' }}
              onPointerMove={event => { if (zoom <= 1 || (event.pointerType !== 'mouse' && !event.buttons)) return; const rect = event.currentTarget.getBoundingClientRect(); setPosition({ x: Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)) }); }}>
              <OriginalImage key={`${item.id}:${retry}`} src={item.imageUrl} alt={t(index ? '右侧候选' : '左侧候选')} className="absolute inset-0 h-full w-full object-contain" draggable={false}
                style={{ transform: `scale(${zoom})`, transformOrigin: `${position.x}% ${position.y}%` }}
                onLoad={() => { setLoaded(current => new Set([...current, item.id])); setFailed(current => { const next = new Set(current); next.delete(item.id); return next; }); }}
                onError={() => { setLoaded(current => { const next = new Set(current); next.delete(item.id); return next; }); setFailed(current => new Set([...current, item.id])); }} />
              {!loaded.has(item.id) && (failed.has(item.id) ? <div role="alert" className="absolute inset-x-2 bottom-3 flex flex-wrap items-center justify-center gap-2 text-center text-xs text-red-500"><span>{t('对照图加载失败')}</span><button type="button" className="mobile-touch underline" onClick={() => { setFailed(new Set()); setLoaded(new Set()); setRetry(current => current + 1); }}>{t('重试')}</button></div> : <span role="status" className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-gray-500">{t('等待图片加载')}</span>)}
            </div>
            {!blind && <div className="h-16 overflow-y-auto text-xs text-gray-500"><span className="font-semibold">#{experiment.candidates.indexOf(candidate) + 1} · Elo {Math.round(score.rating)} · {score.matches} {t('次对比')}</span><p className="mt-1 break-words">{formatRollStyle(candidate.genes)}</p></div>}
            <ToolbarButton className="!h-11 w-full" disabled={busy || !ready} onClick={() => onVote(index ? 'right' : 'left')}>{t(index ? '更喜欢右边' : '更喜欢左边')}<span className="hidden text-xs opacity-60 md:inline">{index ? '→' : '←'}</span></ToolbarButton>
          </div>;
        })}
      </div>
      <div className="flex flex-none flex-wrap items-center justify-center gap-2 p-3">
        <ToolbarButton disabled={busy || !ready} onClick={() => onVote('draw')}>{t('难分高下')}</ToolbarButton>
        <ToolbarButton disabled={busy} onClick={onSkip}><SkipForward />{t('跳过')}</ToolbarButton>
        <ToolbarButton disabled={busy || !experiment.votes.length || !undoAllowed} onClick={onUndo}><Undo2 />{t('撤销上次对比')}</ToolbarButton>
      </div>
    </> : <EmptyState title={t('暂无可对比的图片')} hint="同一实验至少生成两个候选后开始对比；跳过的组合可重新加入。" className="min-h-64 flex-1" action={hasSkipped || experiment.votes.length ? <div className="flex flex-wrap justify-center gap-2">
      {hasSkipped && <ToolbarButton onClick={onSkip}>{t('重新配对')}</ToolbarButton>}
      {!!experiment.votes.length && <ToolbarButton disabled={busy || !undoAllowed} onClick={onUndo}><Undo2 />{t('撤销上次对比')}</ToolbarButton>}
    </div> : undefined} />}
  </div>;
};
