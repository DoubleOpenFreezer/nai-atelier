import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Images, ListEnd, ListStart, Minus, Pause, Play, Plus, Timer, X } from 'lucide-react';
import { AnchoredToolbarPopover, TOOLBAR_MENU_CLASS } from './ToolbarPopover';
import { ToolbarButton } from './DesignSystem';
import { MobileBottomSheet } from './MobileUI';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { t, useLanguage } from '../services/i18n';
import type { GenerationSeriesProgress } from '../services/generationSeries';
import type { GenerationPlacement, GenerationQueueSnapshot } from '../services/generationTask';
import { DEFAULT_GENERATION_INTERVAL_SECONDS, MAX_GENERATION_INTERVAL_SECONDS, validateGenerationInterval } from '../worker/generationTasks.mjs';

export interface GenerationCountControlProps {
  count: number; onCountChange: (count: number) => void;
  series: GenerationSeriesProgress | null; onStop: () => void;
  disabled?: boolean; onGenerate?: () => void; costLabel?: string; unavailableLabel?: string;
  busy?: boolean; queueState?: GenerationQueueSnapshot | null;
  onTogglePause?: () => void; pausePending?: boolean;
  onQueue?: (placement: GenerationPlacement) => void;
  queued?: { id: string; progress: GenerationSeriesProgress; onCancel: () => void }[];
  queueDisabled?: boolean;
  intervalSeconds?: number; onIntervalChange?: (seconds: number) => void; intervalPending?: boolean;
}

export const GenerationCountControl: React.FC<GenerationCountControlProps> = ({ count, onCountChange, series, onStop, disabled, onGenerate, costLabel, unavailableLabel, busy, queueState, onTogglePause, pausePending, onQueue, queued = [], queueDisabled, intervalSeconds = DEFAULT_GENERATION_INTERVAL_SECONDS, onIntervalChange, intervalPending }) => {
  useLanguage();
  const countId = React.useId();
  const intervalId = React.useId();
  const [value, setValue] = useState(String(count));
  const [intervalValue, setIntervalValue] = useState(intervalSeconds.toFixed(1));
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open || !mobile) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  }, [open, mobile, close]);
  useEffect(() => { setValue(String(count)); }, [count]);
  useEffect(() => { if (!intervalPending) setIntervalValue(intervalSeconds.toFixed(1)); }, [intervalSeconds, intervalPending]);
  useEffect(() => {
    const resize = () => { const next = window.innerWidth < 768; if (next !== mobile) { setMobile(next); setOpen(false); } };
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, [mobile]);
  const occupied = busy || queueState?.busy || Boolean(series);
  const paused = Boolean(queueState?.paused);
  const blocked = onQueue ? Boolean(queueDisabled) : Boolean(disabled);
  const completed = queueState?.completed ?? Math.max(0, series?.current || 0);
  const total = queueState?.total ?? ((series?.total || 0) + queued.reduce((sum, task) => sum + task.progress.total, 0));
  const waiting = queued;
  const panel = <>
    <div className="flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-1 text-sm text-gray-700 dark:text-gray-200">
      <Images aria-hidden="true" className="h-4 w-4 flex-none text-gray-400 dark:text-gray-500" />
      <label htmlFor={countId} className="w-16 shrink-0">{t("生成张数")}</label>
      <div className="flex w-28 shrink-0 items-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-950">
      <button type="button" aria-label={t("减少生成张数")} disabled={blocked || count <= 1} onClick={() => onCountChange(count - 1)} className="mobile-touch flex h-8 w-8 items-center justify-center text-gray-500 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-gray-800"><Minus className="h-3.5 w-3.5" /></button>
      <input id={countId} type="number" min={1} step={1} inputMode="numeric" aria-label={t("生成张数")} value={value} disabled={blocked}
        onChange={event => { setValue(event.target.value); const next = Number(event.target.value); if (Number.isSafeInteger(next) && next > 0) onCountChange(next); }}
        onBlur={() => setValue(String(count))}
        className="h-8 w-12 min-w-0 border-x border-gray-200 bg-transparent text-center text-sm font-semibold tabular-nums outline-none [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 disabled:opacity-50 dark:border-gray-700" />
      <button type="button" aria-label={t("增加生成张数")} disabled={blocked || count >= Number.MAX_SAFE_INTEGER} onClick={() => onCountChange(count + 1)} className="mobile-touch flex h-8 w-8 items-center justify-center text-gray-500 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-gray-800"><Plus className="h-3.5 w-3.5" /></button>
      </div>
    </div>
    {onIntervalChange && <div className="flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-1 text-sm text-gray-700 dark:text-gray-200" title={t("每张图片保存后等待；0 秒不额外等待")}>
      <Timer aria-hidden="true" className="h-4 w-4 flex-none text-gray-400 dark:text-gray-500" />
      <label htmlFor={intervalId} className="w-16 shrink-0">{t("生成间隔")}</label>
      <div className="flex w-28 shrink-0 items-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-950">
        <input id={intervalId} type="number" min={0} max={MAX_GENERATION_INTERVAL_SECONDS} step={0.1} inputMode="decimal" value={intervalValue} disabled={intervalPending}
          onChange={event => setIntervalValue(event.target.value)}
          onBlur={() => {
            if (!intervalValue.trim()) { setIntervalValue(intervalSeconds.toFixed(1)); return; }
            try {
              const next = validateGenerationInterval(Number(intervalValue));
              setIntervalValue(next.toFixed(1));
              if (next !== intervalSeconds) onIntervalChange(next);
            } catch { setIntervalValue(intervalSeconds.toFixed(1)); }
          }}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
          className="h-8 w-full min-w-0 bg-transparent pl-6 text-center text-sm font-semibold tabular-nums outline-none [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 disabled:opacity-50" />
        <span className="pr-3 text-xs text-gray-400">{t("秒")}</span>
      </div>
    </div>}
    {onQueue && <div className="mt-1 space-y-0.5 border-t border-gray-200 pt-1 dark:border-gray-800">
      <button type="button" disabled={blocked} onClick={() => { close(); onQueue('end'); }} className={TOOLBAR_MENU_CLASS + ' min-h-10 justify-center disabled:cursor-not-allowed disabled:opacity-40'}><ListEnd aria-hidden="true" className="text-gray-400 dark:text-gray-500" />{t("加入队列")}</button>
      <button type="button" disabled={blocked} onClick={() => { close(); onQueue('next'); }} className={TOOLBAR_MENU_CLASS + ' min-h-10 justify-center disabled:cursor-not-allowed disabled:opacity-40'}><ListStart aria-hidden="true" className="text-gray-400 dark:text-gray-500" />{t("排到下一位")}</button>
    </div>}
    {waiting.length > 0 && <div className="mt-1 max-h-48 space-y-0.5 overflow-y-auto border-t border-gray-200 pt-1 dark:border-gray-800">
      {waiting.map(task => <div key={task.id} className="flex min-h-10 items-center justify-between gap-2 pl-9 pr-1 text-xs text-gray-500 dark:text-gray-400">
        <span>{t("{0} 张 · 等待第 {1} 位", [task.progress.total - task.progress.current, task.progress.position ?? '…'])}</span>
        <button type="button" aria-label={t("取消待生成任务")} disabled={task.progress.stopping} onClick={task.onCancel} className="mobile-touch rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950"><X className="h-3.5 w-3.5" /></button>
      </div>)}
    </div>}
  </>;
  return <div className="relative inline-flex w-fit max-w-full min-w-0 items-stretch gap-2">
    <ToolbarButton onClick={onTogglePause || onStop} disabled={pausePending || series?.stopping || queueState?.pausing || (!occupied && !paused)}
      aria-label={t(queueState?.pausing ? "暂停中…" : paused ? "继续生成" : "暂停生成")}
      title={t(queueState?.pausing ? "当前图片保存后暂停" : paused ? "继续生成" : "暂停生成")}
      className="mobile-touch !h-auto min-h-10 !gap-1.5 !px-2.5 !text-xs tabular-nums lg:absolute lg:inset-y-0 lg:right-full lg:mr-3">
      <span>{completed}/{total}</span>{paused && !queueState?.pausing ? <Play aria-hidden="true" className="h-3.5 w-3.5" /> : <Pause aria-hidden="true" className="h-3.5 w-3.5" />}
    </ToolbarButton>
    <button ref={anchorRef} type="button" data-agent-action="business" aria-haspopup="dialog" aria-expanded={open} aria-disabled={blocked}
      onClick={() => { if (!blocked) { close(); if (occupied && onQueue) onQueue('end'); else onGenerate?.(); } }}
      onKeyDown={event => { if (event.altKey && event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}
      className="generation-action-button mobile-touch flex min-h-10 min-w-0 items-stretch overflow-hidden rounded-xl text-sm font-semibold">
      <span className={'flex min-w-0 flex-1 flex-wrap items-center justify-center gap-x-2 gap-y-1 px-3 py-2 ' + (blocked ? 'opacity-50' : '')}>
        <span>{blocked && unavailableLabel ? unavailableLabel : t(occupied ? "加入队列" : "生成")}</span>
        {(!blocked || !unavailableLabel) && <><span className="whitespace-nowrap text-xs font-medium opacity-80">{t("{0} 张", [count])}</span>{costLabel && <span className="generation-action-button__cost whitespace-nowrap">{costLabel}</span>}</>}
      </span>
      <span data-generation-menu title={t("生成选项")} onClick={event => { event.stopPropagation(); setOpen(value => !value); }} className={'flex min-h-10 w-9 shrink-0 items-center justify-center border-l border-current/15 hover:bg-current/5 ' + (open ? 'bg-current/5' : '')}><ChevronDown aria-hidden="true" className={'h-4 w-4 transition-transform ' + (open ? 'rotate-180' : '')} /></span>
    </button>
    {open && (mobile ? <ImagePreviewPortal><MobileBottomSheet open title={t("生成选项")} onClose={close}>{panel}</MobileBottomSheet></ImagePreviewPortal> : <AnchoredToolbarPopover anchorRef={anchorRef} title={t("生成选项")} above compact width={280} onClose={close}>{panel}</AnchoredToolbarPopover>)}
  </div>;
};
