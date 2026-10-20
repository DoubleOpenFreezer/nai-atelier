import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Dice5, Lock, LockOpen, RefreshCw } from 'lucide-react';
import { t } from '../services/i18n';
import type { PromptChain } from '../types';
import { KINDS, META } from '../services/contentRoll';
import type { RollRow } from '../services/contentRoll';
import { draw, evidenceOf, rerollOne } from '../services/contentRollDraw';

interface ContentRollWorkspaceProps {
  active: boolean;
  chains: PromptChain[];
  notify: (message: string, kind?: 'success' | 'error') => void;
}

/** 一次抽取的结果（会话内保留最近 20 组；只存派生数据，不存条目对象）。 */
interface RollRecord {
  seed: string;
  seeds: Record<string, string>;
  picks: Record<string, RollRow>;
  locked: Record<string, string>;
  checks: Record<string, boolean>;
  at: number;
}

const STORE_KEY = 'nai-content-roll';
const HISTORY_LIMIT = 20;

const newSeed = (): string => `r${Math.floor(Math.random() * 0x7fffffff).toString(36)}`;

const readStore = (): { history: RollRecord[]; cursor: number } => {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return { history: [], cursor: -1 };
    const parsed = JSON.parse(raw) as { history?: RollRecord[]; cursor?: number };
    const history = Array.isArray(parsed.history) ? parsed.history.slice(-HISTORY_LIMIT) : [];
    const cursor = Number.isFinite(Number(parsed.cursor)) ? Number(parsed.cursor) : history.length - 1;
    return { history, cursor: Math.min(Math.max(cursor, -1), history.length - 1) };
  } catch {
    return { history: [], cursor: -1 };
  }
};

const shortText = (value: string, max = 48): string => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/**
 * 一键 Roll 工作区：六类内容各抽 1 条，可勾选参与、固定、单栏「换一个」，并保留会话内的抽取历史。
 * 全部随机与证据逻辑在 services/contentRoll（快照/约束）与 services/contentRollDraw（池子/随机流），
 * 本组件只负责界面与本地草稿，不写库、不触发生成。
 */
export const ContentRollWorkspace: React.FC<ContentRollWorkspaceProps> = ({ active, chains, notify }) => {
  const [initial] = useState(readStore);
  const [history, setHistory] = useState<RollRecord[]>(initial.history);
  const [cursor, setCursor] = useState(initial.cursor);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [locked, setLocked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);

  const current = cursor >= 0 ? history[cursor] : null;

  /* 会话草稿只留在本机：刷新后仍能看到上次这一组，但不会写库 */
  useEffect(() => {
    if (!active) return;
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify({ history: history.slice(-HISTORY_LIMIT), cursor }));
    } catch {
      /* localStorage 不可用时不影响使用 */
    }
  }, [active, history, cursor]);

  const commit = useCallback((record: RollRecord) => {
    setHistory(previous => {
      const kept = previous.slice(0, cursor + 1);
      const next = [...kept, record].slice(-HISTORY_LIMIT);
      setCursor(next.length - 1);
      return next;
    });
  }, [cursor]);

  const rollOnce = useCallback(() => {
    setBusy(true);
    try {
      const result = draw({ chains, seed: newSeed(), checks, locked });
      commit({ seed: result.seed, seeds: result.seeds, picks: result.picks, locked: result.locked, checks: result.checks, at: Date.now() });
      const missing = result.notes.filter(note => note.code !== 'pool_empty').length;
      notify(missing ? t('已抽取；有 {0} 条说明需要看一眼', [String(missing)]) : t('已抽取一组六类内容'));
    } finally {
      setBusy(false);
    }
  }, [chains, checks, locked, commit, notify]);

  /* 「再抽未固定项」：只换没固定的栏，并排除当前条目（候选不足时核会如实保留并说明） */
  const rollAgain = useCallback(() => {
    if (!current) return;
    setBusy(true);
    try {
      const avoid: Record<string, string | undefined> = {};
      for (const kind of KINDS) {
        if (locked[kind]) continue;
        avoid[kind] = current.picks[kind]?.id || undefined;
      }
      const result = draw({ chains, seed: newSeed(), checks, locked, avoid });
      commit({ seed: result.seed, seeds: result.seeds, picks: result.picks, locked: result.locked, checks: result.checks, at: Date.now() });
      const kept = result.notes.filter(note => note.code === 'avoid_short').length;
      notify(kept ? t('已重抽；{0} 栏只有一条候选，已保留并说明', [String(kept)]) : t('已重新抽取未固定的栏'));
    } finally {
      setBusy(false);
    }
  }, [chains, current, checks, locked, commit, notify]);

  const rerollKind = useCallback((kind: string) => {
    if (!current) return;
    const result = rerollOne({ chains, checks, picks: current.picks, locked }, kind, newSeed());
    if (!result.ok) {
      notify(result.message, 'error');
      return;
    }
    const swapped = history.map((record, index) => (index === cursor
      ? { ...record, picks: { ...record.picks, [kind]: result.row as unknown as RollRow }, seeds: { ...record.seeds, [kind]: String(result.seed) } }
      : record));
    setHistory(swapped);
    const note = result.note === 'avoid_short' ? t('（只有这一条可换，已保留）') : '';
    notify(t('已为「{0}」换了一条', [t(META[kind].title)]) + note);
  }, [chains, checks, locked, current, history, cursor, notify]);

  const toggleCheck = (kind: string) => setChecks(previous => ({ ...previous, [kind]: previous[kind] === false }));
  const toggleLock = (kind: string) => {
    const id = current?.picks[kind]?.id || '';
    if (!id) {
      notify(t('这一栏还没有内容，先抽一次再固定'), 'error');
      return;
    }
    setLocked(previous => {
      const next = { ...previous };
      if (next[kind]) delete next[kind];
      else next[kind] = id;
      return next;
    });
  };

  const evidenceText = useMemo(() => {
    if (!current) return '';
    const evidence = evidenceOf({ ...current, chains });
    return JSON.stringify(evidence, null, 2);
  }, [current, chains]);

  const copyEvidence = async () => {
    try {
      await navigator.clipboard.writeText(evidenceText);
      notify(t('已复制这一组的证据（算法版本 / 随机码 / 每栏随机流 / 池指纹）'));
    } catch {
      notify(t('复制失败：浏览器拒绝了剪贴板权限'), 'error');
    }
  };

  const rows = KINDS.map(kind => ({ kind, meta: META[kind], row: current?.picks[kind] || null }));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto w-full max-w-5xl space-y-4 p-4 md:p-6">
        <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">{t('一键 Roll')}</h2>
            <span className="text-[11px] text-gray-400">
              {current ? t('组合随机码 {0}', [current.seed]) : t('还没有抽取')}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            {t('六个库各抽 1 条。每栏使用独立随机流，固定或跳过某一栏不会改变其它栏；抽中的条目只被读取，不会改写词库。')}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={rollOnce} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              <Dice5 className="h-4 w-4" />{t('抽一次')}
            </button>
            <button type="button" onClick={rollAgain} disabled={busy || !current}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300">
              <RefreshCw className="h-4 w-4" />{t('再抽未固定项')}
            </button>
            <span className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700" />
            <button type="button" onClick={() => setCursor(index => Math.max(0, index - 1))} disabled={cursor <= 0}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs disabled:opacity-40 dark:border-gray-700">
              <ChevronLeft className="h-4 w-4" />{t('上一组')}
            </button>
            <button type="button" onClick={() => setCursor(index => Math.min(history.length - 1, index + 1))} disabled={cursor >= history.length - 1}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs disabled:opacity-40 dark:border-gray-700">
              {t('下一组')}<ChevronRight className="h-4 w-4" />
            </button>
            <span className="text-[11px] text-gray-400">
              {history.length ? t('第 {0} / {1} 组', [String(cursor + 1), String(history.length)]) : ''}
            </span>
          </div>
        </section>

        <section className="space-y-2">
          {rows.map(({ kind, meta, row }) => {
            const on = checks[kind] !== false;
            const isLocked = !!locked[kind];
            return (
              <div key={kind} data-content-roll-row={kind} data-content-roll-on={String(on)}
                className={`rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900 ${on ? '' : 'opacity-60'}`}>
                <div className="flex flex-wrap items-start gap-3">
                  <label className="flex select-none items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <input type="checkbox" checked={on} onChange={() => toggleCheck(kind)} aria-label={t('参与「{0}」的抽取', [t(meta.title)])} />
                    {t('参与')}
                  </label>
                  <span className="w-16 shrink-0 text-xs font-semibold text-indigo-600 dark:text-indigo-300">{t(meta.title)}</span>
                  <div className="min-w-0 flex-1">
                    {row && row.filled ? (
                      <>
                        <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-100" data-content-roll-name={kind}>{row.name}</p>
                        <p className="mt-0.5 line-clamp-2 break-words font-mono text-[11px] text-gray-500 dark:text-gray-400">{row.text}</p>
                        {row.constraints?.notes ? (
                          <p className="mt-1 text-[11px] leading-4 text-amber-600 dark:text-amber-400" data-content-roll-constraint={kind}>{row.constraints.notes}</p>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-xs text-gray-400" data-content-roll-note={kind}>
                        {!on ? t('本次不参与：不抽取、也不会填入实验室') : row?.reason === 'empty' ? t('该库当前 0 条，该栏留空') : t('还没有结果')}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => toggleLock(kind)}
                      aria-pressed={isLocked} title={t(isLocked ? '解除固定' : '固定这一条')}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] ${isLocked ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300' : 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'}`}>
                      {isLocked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                      {t(isLocked ? '已固定' : '固定')}
                    </button>
                    <button type="button" onClick={() => rerollKind(kind)} disabled={!current || !on}
                      className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-500 disabled:opacity-40 dark:border-gray-700 dark:text-gray-400">
                      {t('换一个')}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        {current ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('这一组的证据')}</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setShowEvidence(value => !value)}
                  className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  {t(showEvidence ? '收起' : '展开')}
                </button>
                <button type="button" onClick={() => void copyEvidence()}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <Copy className="h-3.5 w-3.5" />{t('复制证据')}
                </button>
              </div>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-gray-400">
              {t('组合随机码只用于复现这一组，不是生图 seed。')}
            </p>
            {showEvidence ? (
              <pre data-content-roll-evidence="true" className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-gray-50 p-2 font-mono text-[10px] leading-4 text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
                {evidenceText}
              </pre>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
};
