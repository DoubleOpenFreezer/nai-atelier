import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, Flame, ShieldAlert, SkipForward, Swords, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
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

  return <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-gray-50/50 dark:bg-gray-900/50">
    {/* 顶部对决状态栏 */}
    <div className="flex flex-none flex-wrap items-center justify-between gap-3 border-b border-gray-200/70 bg-white/70 px-4 py-2.5 backdrop-blur-md dark:border-gray-800/70 dark:bg-gray-900/70">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
          <Swords className="h-4 w-4" />
        </span>
        {context ? (
          <h2 className="text-sm font-bold tracking-tight text-gray-800 dark:text-gray-100">{context}</h2>
        ) : (
          <h2 className="text-sm font-bold tracking-tight text-gray-800 dark:text-gray-100">{t('画风对决')}</h2>
        )}
      </div>

      <div className="flex items-center gap-2">
        <ToolbarButton active={blind} onClick={() => setBlind(!blind)} className="!h-8 text-xs">
          {blind ? <EyeOff /> : <Eye />}
          {t(blind ? '盲选已开启' : '显示画师')}
        </ToolbarButton>

        <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-50/80 px-1 py-0.5 dark:border-gray-800 dark:bg-gray-950/50">
          <IconButton label="缩小图片" disabled={zoom <= 1} onClick={() => setZoom(Math.max(1, zoom - 0.5))} className="!h-7 !w-7 !rounded-lg !border-0 bg-transparent text-gray-500">
            <ZoomOut />
          </IconButton>
          <span className="min-w-8 text-center font-mono text-xs tabular-nums text-gray-600 dark:text-gray-300">{zoom.toFixed(1)}×</span>
          <IconButton label="放大图片" disabled={zoom >= 4} onClick={() => setZoom(Math.min(4, zoom + 0.5))} className="!h-7 !w-7 !rounded-lg !border-0 bg-transparent text-gray-500">
            <ZoomIn />
          </IconButton>
        </div>

        <span className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          <Flame className="h-3 w-3 text-amber-500" />
          <span>{t('已对比 {0} 次', [experiment.votes.length])}</span>
        </span>
      </div>
    </div>

    {pair ? <>
      {/* 对决主视界 */}
      <div className="relative mx-auto flex w-full max-w-6xl min-h-[300px] flex-1 flex-col justify-center p-3 md:p-6">
        <div className="grid flex-1 grid-cols-2 gap-3 md:gap-6">
          {pair.map((id, index) => {
            const candidate = experiment.candidates.find(item => item.id === id)!, item = images.get(id)!, score = scores.get(id)!;
            const sideLabel = t(index ? '右' : '左');
            const actionLabel = t(index ? '更喜欢右边' : '更喜欢左边');

            return <div key={index} className="flex min-h-0 min-w-0 flex-col gap-2.5 group">
              {/* 选手卡片顶部标头 */}
              <div className="flex items-center justify-between px-1">
                <span className="flex items-center gap-1.5 text-xs font-bold text-gray-700 dark:text-gray-200">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-gray-200 text-xs font-mono dark:bg-gray-800">
                    {sideLabel}
                  </span>
                  <span>{blind ? t(index ? '候选 B' : '候选 A') : `#${experiment.candidates.indexOf(candidate) + 1}`}</span>
                </span>
                {!blind && (
                  <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-mono font-semibold text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                    Elo {Math.round(score.rating)}
                  </span>
                )}
              </div>

              {/* 画面对比视窗 */}
              <div className="relative min-h-[220px] flex-1 overflow-hidden rounded-2xl border-2 border-gray-200 bg-white shadow-sm transition-all group-hover:border-indigo-400 dark:border-gray-800 dark:bg-gray-950" style={{ touchAction: zoom > 1 ? 'none' : 'auto' }}
                onPointerMove={event => { if (zoom <= 1 || (event.pointerType !== 'mouse' && !event.buttons)) return; const rect = event.currentTarget.getBoundingClientRect(); setPosition({ x: Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)) }); }}>
                <OriginalImage key={`${item.id}:${retry}`} src={item.imageUrl} alt={t(index ? '右侧候选' : '左侧候选')} className="absolute inset-0 h-full w-full object-contain transition-transform duration-100" draggable={false}
                  style={{ transform: `scale(${zoom})`, transformOrigin: `${position.x}% ${position.y}%` }}
                  onLoad={() => { setLoaded(current => new Set([...current, item.id])); setFailed(current => { const next = new Set(current); next.delete(item.id); return next; }); }}
                  onError={() => { setLoaded(current => { const next = new Set(current); next.delete(item.id); return next; }); setFailed(current => new Set([...current, item.id])); }} />

                {!loaded.has(item.id) && (failed.has(item.id) ? (
                  <div role="alert" className="absolute inset-x-2 bottom-3 flex flex-wrap items-center justify-center gap-2 rounded-xl bg-red-50/90 p-2 text-center text-xs text-red-600 backdrop-blur dark:bg-red-950/90 dark:text-red-300">
                    <ShieldAlert className="h-4 w-4" />
                    <span>{t('对照图加载失败')}</span>
                    <button type="button" className="mobile-touch font-semibold underline hover:text-red-700" onClick={() => { setFailed(new Set()); setLoaded(new Set()); setRetry(current => current + 1); }}>
                      {t('重试')}
                    </button>
                  </div>
                ) : (
                  <div role="status" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-50/80 backdrop-blur-sm text-xs text-gray-500 dark:bg-gray-950/80">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                    <span>{t('等待图片加载')}</span>
                  </div>
                ))}
              </div>

              {/* 画师详情（若盲选关闭时显示） */}
              {!blind ? (
                <div className="h-16 overflow-y-auto rounded-xl bg-white p-2.5 text-xs text-gray-600 shadow-sm border border-gray-100 dark:bg-gray-850 dark:border-gray-800 dark:text-gray-300">
                  <span className="font-semibold text-gray-800 dark:text-gray-100">
                    #{experiment.candidates.indexOf(candidate) + 1} · Elo {Math.round(score.rating)} · {score.matches} {t('次对比')}
                  </span>
                  <p className="mt-1 break-words font-mono text-xs leading-relaxed text-indigo-600 dark:text-indigo-400">
                    {formatRollStyle(candidate.genes)}
                  </p>
                </div>
              ) : (
                <div className="h-10 flex items-center justify-center rounded-xl bg-gray-100/70 border border-dashed border-gray-200 px-3 text-xs text-gray-400 dark:bg-gray-900/60 dark:border-gray-800">
                  <span>{t('盲选已遮盖画师信息')}</span>
                </div>
              )}

              {/* 主投票 CTA */}
              <button
                type="button"
                aria-label={actionLabel}
                disabled={busy || !ready}
                onClick={() => onVote(index ? 'right' : 'left')}
                className={`mobile-touch group/btn relative flex h-12 w-full items-center justify-center gap-2 rounded-2xl font-bold text-sm shadow-md transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed ${
                  index
                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm'
                }`}
              >
                <span>{actionLabel}</span>
                <span aria-hidden="true" className="hidden text-xs opacity-60 md:inline">{index ? '→' : '←'}</span>
                <kbd aria-hidden="true" className="ml-1 hidden sm:inline-flex items-center rounded-md bg-white/20 px-1.5 py-0.5 font-mono text-xs font-semibold text-white/90">
                  {index ? '→' : '←'}
                </kbd>
              </button>
            </div>;
          })}
        </div>

        {/* 底部裁判操作栏 */}
        <div className="mt-4 flex flex-none flex-wrap items-center justify-center gap-2.5 rounded-2xl border border-gray-200/80 bg-white/80 p-2.5 shadow-sm backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/80">
          <ToolbarButton
            aria-label={t('难分高下')}
            disabled={busy || !ready}
            onClick={() => onVote('draw')}
            className="!h-9"
          >
            {t('难分高下')}
            <kbd aria-hidden="true" className="ml-1 hidden font-mono text-xs opacity-60 sm:inline">Enter</kbd>
          </ToolbarButton>
          <ToolbarButton
            aria-label={t('跳过')}
            disabled={busy}
            onClick={onSkip}
            className="!h-9"
          >
            <SkipForward />
            {t('跳过')}
            <kbd aria-hidden="true" className="ml-1 hidden font-mono text-xs opacity-60 sm:inline">Space</kbd>
          </ToolbarButton>
          <ToolbarButton
            aria-label={t('撤销上次对比')}
            disabled={busy || !experiment.votes.length || !undoAllowed}
            onClick={onUndo}
            className="!h-9"
          >
            <Undo2 />
            {t('撤销上次对比')}
            <kbd aria-hidden="true" className="ml-1 hidden font-mono text-xs opacity-60 sm:inline">Backspace</kbd>
          </ToolbarButton>
        </div>
      </div>
    </> : (
      <EmptyState
        title={t('暂无可对比的图片')}
        hint="同一实验至少生成两个候选后开始对比；跳过的组合可重新加入。"
        className="min-h-64 flex-1"
        action={hasSkipped || experiment.votes.length ? (
          <div className="flex flex-wrap justify-center gap-2">
            {hasSkipped && <ToolbarButton onClick={onSkip}>{t('重新配对')}</ToolbarButton>}
            {!!experiment.votes.length && <ToolbarButton disabled={busy || !undoAllowed} onClick={onUndo}><Undo2 />{t('撤销上次对比')}</ToolbarButton>}
          </div>
        ) : undefined}
      />
    )}
  </div>;
};
