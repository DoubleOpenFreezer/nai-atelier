import { confirmationCostScope } from '../services/dailyConfirmation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Copy, Dice5, Download, FlaskConical, ImagePlus, ListChecks, LoaderCircle, MoreHorizontal, Pause, Plus, RefreshCw, RotateCcw, Save, Settings2, SlidersHorizontal, Trash2, X } from 'lucide-react';
import type { LocalGenItem, PromptChain } from '../types';
import { t, useLanguage } from '../services/i18n';
import { DEFAULT_ROLL_RULES, formatRollStyle, manualRollVariant, resolveRollArtists, rollCandidateToChain, rollSourceId, type RollCandidate, type RollExperiment } from '../services/styleRoll';
import { beginRollRound, currentRollRound } from '../services/styleRollWorkflow';
import { rollPendingCandidates, rollWorkspaceCandidates } from '../services/styleRollWorkspace';
import { getArtistSampleDictionary } from '../services/artistSamples';
import { loadRollExperiments, loadRollHistory, rollCandidateImages, saveRollExperiment } from '../services/styleRollApi';
import { beginRollGeneration, readRollApiKey } from '../services/styleRollGeneration';
import { api, notifyLanAccessRequired, parseErrorResponse } from '../services/api';
import { parseHttpError } from '../services/httpErrors.mjs';
import { applyEstimatorRuntime, estimateV45GenerationCost, formatGenerationCostLabel, useAnlasBudget } from '../services/anlasBudget';
import { isActiveOpusSubscription, useNovelaiUsage } from '../services/naiUsage';
import { useNaiRuntime } from '../services/naiRuntime';
import { applyNaiModelSettings, DEFAULT_NAI_MODEL, getRuntimeNaiModelInfo } from '../services/naiModels';
import { approveGenerationSeries, getGenerationSeriesSession, stopGenerationSeriesSession, subscribeGenerationSeries, type GenerationSeriesSession } from '../services/generationSeries';
import { setGenerationQueuePaused } from '../services/generationTask';
import { localHistory } from '../services/localHistory';
import { IMPORT_SESSION_KEY } from '../services/metadataService';
import { saveExportBlob } from '../services/exportLocation';
import { createUuid } from '../services/id';
import { useConfirmDialog } from './ConfirmDialog';
import { EmptyState, IconButton, PageSpinner, ToolbarButton, ToolbarSearch, ToolbarSelect, WorkspaceToolbar } from './DesignSystem';
import { ToolbarPopover, TOOLBAR_FIELD_CLASS, TOOLBAR_MENU_CLASS } from './ToolbarPopover';
import { SmartImage } from './SmartImage';
import { ImageLightbox } from './ImageLightbox';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { ImageShareActions } from './ImageShareActions';
import { PressRevealSurface } from './PressRevealSurface';
import { MobileDetailView } from './MobileUI';
import { StyleRollSetup } from './roll/StyleRollSetup';
import { StyleRollGallery } from './roll/StyleRollGallery';
import { useGallerySelectionAnchor } from './useGallerySelectionAnchor';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';

interface Props {
  active: boolean; chains: PromptChain[]; enforceFreeStepLimit: boolean; generationStreamPreview: boolean; selectionFocusEnabled?: boolean;
  continuousGenerationEnabled?: boolean;
  notify: (message: string, type?: 'success' | 'error') => void;
  onSaveChain: (chain: PromptChain) => Promise<PromptChain>;
  onOpenChain: (id: string) => void;
  onNavigateToPlayground: () => void;
}
const methodLabels = { random: '随机组合', mutate: '参考保留组合', manual: '手动变体' };
const selectClass = 'mobile-touch h-10 min-w-0 rounded-xl border border-gray-200 bg-white px-2 text-sm dark:border-gray-700 dark:bg-gray-900';
const GENE_ACCENTS = ['bg-indigo-500', 'bg-emerald-500', 'bg-purple-500', 'bg-amber-500', 'bg-rose-500', 'bg-sky-500'];

export const StyleRollPage: React.FC<Props> = ({ active, chains, enforceFreeStepLimit, generationStreamPreview, selectionFocusEnabled = true, continuousGenerationEnabled = true, notify, onSaveChain, onOpenChain, onNavigateToPlayground }) => {
  useLanguage();
  const confirm = useConfirmDialog();
  const runtime = useNaiRuntime(); applyEstimatorRuntime(runtime);
  const subscription = useNovelaiUsage(), budget = useAnlasBudget();
  const [experiments, setExperiments] = useState<RollExperiment[]>([]), [experimentId, setExperimentId] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setErrorState] = useState('');
  const [errorSource, setErrorSource] = useState<'request' | 'generation'>('request');
  const setError = useCallback((message: string, source: 'request' | 'generation' = 'request') => { setErrorState(message ? parseHttpError(message).message : ''); setErrorSource(source); }, []);
  const [library, setLibrary] = useState<string[]>([]), [libraryLoading, setLibraryLoading] = useState(true), [libraryError, setLibraryError] = useState('');
  const [history, setHistory] = useState<LocalGenItem[]>([]), [historyLoading, setHistoryLoading] = useState(false);
  const [historyReadyId, setHistoryReadyId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [filter, setFilter] = useState('all'), [count, setCount] = useState(6), [artistsPerMix, setArtistsPerMix] = useState(4);
  const [query, setQuery] = useState(''), [sort, setSort] = useState('new'), [roundId, setRoundId] = useState('');
  const [selecting, setSelecting] = useState(false), [selectedIds, setSelectedIds] = useState(new Set<string>());
  const [savingProgress, setSavingProgress] = useState<{ completed: number; total: number } | null>(null);
  const [recordName, setRecordName] = useState('');
  const [setup, setSetup] = useState<RollExperiment | null>(null), [lightbox, setLightbox] = useState<LocalGenItem | null>(null);
  const [manualWeights, setManualWeights] = useState<number[] | null>(null);
  const [session, setSession] = useState<GenerationSeriesSession | null>(null), [preparing, setPreparing] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const busyRef = useRef(false), generatingRef = useRef(false), selectedExperimentRef = useRef(experimentId), historySequence = useRef(0);
  const loadingRef = useRef(true), loadSequence = useRef(0);
  const savedChains = useRef(new Map<string, PromptChain>()), mounted = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectionAnchor = useGallerySelectionAnchor(scrollRef, scrollRef, selectedId || null, active, selectionFocusEnabled);
  const rememberScroll = useKeepAliveScrollRestore(scrollRef, `roll:${experimentId}:${filter}`, { skipRestore: selectionAnchor.hasAnchor });
  selectedExperimentRef.current = experimentId;
  const experiment = experiments.find(item => item.id === experimentId && !item.archived);
  const selected = experiment?.candidates.find(item => item.id === selectedId);
  const images = useMemo(() => experiment ? rollCandidateImages(experiment, history) : new Map<string, LocalGenItem>(), [experiment, history]);
  const round = experiment && currentRollRound(experiment);
  const selectedImage = selected && images.get(selected.id);
  const historyReady = Boolean(experiment && historyReadyId === experiment.id);
  const cost = experiment ? estimateV45GenerationCost(experiment.template.params, isActiveOpusSubscription(subscription.info), subscription.info?.usage?.isNegative ?? true) : 0;
  const costLabel = !subscription.info ? t(subscription.loading ? '费用确认中…' : '费用未知') : t(formatGenerationCostLabel(cost, experiment?.template.params.model));
  const visible = useMemo(() => experiment ? rollWorkspaceCandidates(experiment, images, { filter, roundId, query, sort }) : [], [experiment, images, filter, roundId, query, sort]);
  const chosen = visible.filter(candidate => selectedIds.has(candidate.id));
  useEffect(() => { if (!busy) setSelectedIds(current => { const next = new Set([...current].filter(id => visible.some(candidate => candidate.id === id))); return next.size === current.size ? current : next; }); }, [visible, busy]);
  useEffect(() => { if (selectedId && !visible.some(candidate => candidate.id === selectedId)) { setSelectedId(''); selectionAnchor.clearAnchor(); } }, [visible, selectedId]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { const media = window.matchMedia('(max-width: 767px)'); const changed = () => setIsMobile(media.matches); media.addEventListener('change', changed); return () => media.removeEventListener('change', changed); }, []);
  const reload = useCallback(async () => {
    const sequence = ++loadSequence.current; loadingRef.current = true;
    setLoading(true); setError('');
    try { const values = await loadRollExperiments(); if (!mounted.current || sequence !== loadSequence.current) return; setExperiments(values); setExperimentId(current => values.some(value => value.id === current && !value.archived) ? current : values.find(value => !value.archived)?.id || ''); }
    catch (cause) { if (mounted.current && sequence === loadSequence.current) setError((cause as Error).message); }
    finally { if (mounted.current && sequence === loadSequence.current) { loadingRef.current = false; setLoading(false); } }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const reloadLibrary = useCallback(async () => {
    setLibraryLoading(true); setLibraryError('');
    try { const artists = await getArtistSampleDictionary(); if (!artists.length) throw new Error('画师词库为空，请在画师库中检查词库资源'); if (mounted.current) setLibrary(artists.map(artist => artist.name)); }
    catch (cause) { if (mounted.current) setLibraryError((cause as Error).message); }
    finally { if (mounted.current) setLibraryLoading(false); }
  }, []);
  useEffect(() => { if (active) void reloadLibrary(); }, [active, reloadLibrary]);
  const refreshHistory = useCallback(async (id: string) => {
    const sequence = ++historySequence.current;
    if (!id) { setHistory([]); return; }
    setHistoryLoading(true); setHistoryReadyId('');
    try { const values = await loadRollHistory(id); if (mounted.current && selectedExperimentRef.current === id && sequence === historySequence.current) { setHistory(values); setHistoryReadyId(id); } }
    catch (cause) { if (mounted.current && selectedExperimentRef.current === id && sequence === historySequence.current) setError((cause as Error).message); }
    finally { if (mounted.current && sequence === historySequence.current) setHistoryLoading(false); }
  }, []);
  useEffect(() => { setHistory([]); setSelectedId(''); setSelectedIds(new Set()); setSelecting(false); setRoundId(''); setQuery(''); setFilter('all'); }, [experimentId]);
  useEffect(() => { setRecordName(experiment?.name || ''); }, [experiment?.id, experiment?.name]);
  useEffect(() => { setManualWeights(null); }, [selectedId, experimentId]);
  useEffect(() => { if (experiment) setArtistsPerMix(experiment.rules.minArtists === experiment.rules.maxArtists ? experiment.rules.minArtists : 4); }, [experimentId]);
  useEffect(() => { if (active && experimentId) void refreshHistory(experimentId); }, [active, experimentId, refreshHistory]);
  useEffect(() => localHistory.subscribe(() => { if (selectedExperimentRef.current) void refreshHistory(selectedExperimentRef.current); }), [refreshHistory]);
  useEffect(() => {
    const update = () => {
      const found = experiments.map(item => getGenerationSeriesSession(rollSourceId(item.id))).find(Boolean);
      setSession(found ? { ...found } : null);
    };
    update(); return subscribeGenerationSeries(update);
  }, [experiments]);

  const store = async (next: RollExperiment) => {
    const saved = await saveRollExperiment(next);
    if (mounted.current) setExperiments(current => [saved, ...current.filter(item => item.id !== saved.id)]);
    return saved;
  };
  const perform = async (action: () => Promise<void>) => {
    if (busyRef.current || loadingRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const makeExperiment = () => {
    const now = Date.now();
    const next: RollExperiment = {
      version: 1, id: createUuid(), name: t('画风记录 {0}', [experiments.length + 1]), revision: 0, createdAt: now, updatedAt: now,
      artists: experiment ? structuredClone(experiment.artists) : [], rules: experiment ? { ...experiment.rules } : { ...DEFAULT_ROLL_RULES },
      template: experiment ? structuredClone(experiment.template) : { prompt: '{style}, 1girl, solo, upper body, simple background, looking at viewer', negativePrompt: '',
        params: applyNaiModelSettings({ model: DEFAULT_NAI_MODEL, width: 832, height: 1216, steps: runtime.freeMaxSteps, scale: 5, sampler: 'k_euler_ancestral', qualityToggle: false, ucPreset: 4, seed: 0, characters: [] }, runtime) },
      candidates: [], rounds: [],
    };
    return next;
  };
  const generate = async (candidates: RollCandidate[] = selected ? [selected] : [], target = experiment) => {
    if (!target || target.archived || !candidates.length || manualWeights || candidates.some(candidate => candidate.archived || images.has(candidate.id)) || loadingRef.current || generatingRef.current || session || (target.id === experiment?.id && (historyLoading || !historyReady))) return;
    if (!continuousGenerationEnabled && candidates.length > 1) { setError(t('连续生成已关闭，请开启后生成本轮')); return; }
    const key = readRollApiKey();
    if (!key) { setError(t('请先在“全局设置”中配置 NovelAI API Key')); return; }
    generatingRef.current = true; setPreparing(true); setError('');
    const reportError = (message: string) => {
      if (!mounted.current) return;
      if (selectedExperimentRef.current === target.id) setError(message, 'generation');
      else notify(t('实验 {0}：{1}', [target.name, t(parseHttpError(message).message)]), 'error');
    };
    try {
      void subscription.refreshIfStale();
      const eachCost = estimateV45GenerationCost(target.template.params, isActiveOpusSubscription(subscription.info), subscription.info?.usage?.isNegative ?? true), totalCost = eachCost * candidates.length;
      if (totalCost > 0 && !await confirm({ rememberKey: 'roll.generate', rememberScope: confirmationCostScope(key, eachCost, candidates.length, budget.remaining, target.template.params.model), title: budget.remaining <= 0 ? 'Anlas 预算已用尽' : '确认生成图片',
        message: t('本轮生成 {0} 张，预计共消耗 {1} Anlas。本地剩余预算：{2}。', [candidates.length, totalCost, budget.remaining]),
        confirmLabel: t('消耗 {0} 点并生成', [totalCost]), ...(totalCost > budget.remaining ? { tone: 'danger' as const } : {}) })) return;
      const started = await beginRollGeneration(target, candidates.length === 1 ? candidates[0] : candidates, key, eachCost, generationStreamPreview && getRuntimeNaiModelInfo(target.template.params.model, runtime).supportsStreamedResponses);
      const receipt = await started.settle;
      if (mounted.current) {
        if (started.session.accountingFailed) reportError(t('图片已保存，但本地记账异常，请核对额度后再继续'));
        else if (started.session.cleanupError) reportError(t('后台任务清理异常：{0}', [started.session.cleanupError]));
        else if (!receipt.success && receipt.outcome !== 'cancelled') reportError(receipt.error || t('生成失败'));
        if (selectedExperimentRef.current === target.id) {
          const saved = started.session.lastSavedItem;
          if (saved) setHistory(current => [...current.filter(item => item.id !== saved.id), saved]);
          await refreshHistory(target.id);
        }
      }
    } catch (cause) { reportError((cause as Error).message); }
    finally { generatingRef.current = false; if (mounted.current) setPreparing(false); }
  };
  const approve = () => void perform(async () => {
    if (!session?.awaiting) return;
    const current = getGenerationSeriesSession(session.scope); if (!current?.awaiting) return;
    const nextCost = current.awaiting.cost;
    const remaining = current.awaiting.requestedCount - current.awaiting.completedCount;
    if (!await confirm({ rememberKey: 'roll.cost-increase', rememberScope: confirmationCostScope(current.key, nextCost, remaining, budget.remaining), title: '后台任务费用已变化', message: t('本轮剩余 {0} 张，当前每张预计 {1} Anlas，共 {2} Anlas。本地剩余预算：{3}。', [remaining, nextCost, nextCost * remaining, budget.remaining]), confirmLabel: t('消耗 {0} 点并生成', [nextCost * remaining]), tone: 'danger' })) { stopGenerationSeriesSession(current); return; }
    if (readRollApiKey() !== current.key) throw new Error('NovelAI Key 已变化，请重新发起生成');
    await approveGenerationSeries(current, nextCost);
  });
  const runRound = () => void perform(async () => {
    if (session || generatingRef.current) return;
    if (experiment && (!historyReady || historyLoading)) throw new Error('历史暂不可用，请重新加载后再生成。');
    if (!continuousGenerationEnabled && count > 1) throw new Error('连续生成已关闭，请开启后生成本轮');
    if (libraryLoading || libraryError || !library.length) throw new Error(libraryError || '画师词库尚未就绪，请重新加载');
    let source = experiment || makeExperiment();
    if (round && !round.closedAt) source = { ...source, rounds: source.rounds.map(item => item.id === round.id ? { ...item, closedAt: Date.now() } : item) };
    source = { ...source, rules: { ...source.rules, minArtists: artistsPerMix, maxArtists: artistsPerMix } };
    const next = beginRollRound(source, library, count);
    const saved = await store(next), created = currentRollRound(saved)!;
    selectedExperimentRef.current = saved.id; setExperimentId(saved.id); setSelectedId(''); setSelectedIds(new Set()); setSelecting(false); setFilter('all'); setQuery(''); setRoundId(created.id);
    void generate(saved.candidates.filter(candidate => created.candidateIds.includes(candidate.id)), saved);
  });
  const generatePending = (ids?: string[]) => void perform(async () => {
    if (!experiment || !historyReady || historyLoading || session || generatingRef.current) return;
    let source = experiment;
    const pending = rollPendingCandidates(experiment, images, ids).slice(0, continuousGenerationEnabled ? 24 : 1);
    if (!pending.length) return;
    if (ids || !round || round.closedAt) source = await store({ ...experiment, rounds: [...experiment.rounds.map(item => item.id === round?.id && !item.closedAt ? { ...item, closedAt: Date.now() } : item), { id: createUuid(), candidateIds: pending.map(candidate => candidate.id), createdAt: Date.now() }] });
    setSelectedId(''); setSelecting(false); setSelectedIds(new Set()); setRoundId(currentRollRound(source)?.id || ''); setFilter('all'); void generate(pending, source);
  });
  const resume = () => void perform(async () => {
    if (!session || session.state !== 'paused') return;
    if (readRollApiKey() !== session.key) throw new Error('NovelAI Key 已变化，请重新发起生成');
    await setGenerationQueuePaused(session.key, false);
  });
  const persistCandidate = async (target: RollExperiment, id: string) => {
    const candidate = target.candidates.find(item => item.id === id); if (!candidate) return target;
    const image = images.get(id);
    let saved = savedChains.current.get(`${target.id}:${id}`) || chains.find(chain => chain.id === candidate.savedChainId);
    if (!saved) {
      const chain = rollCandidateToChain(target, candidate);
      if (image) {
        const response = await fetch(image.imageUrl); notifyLanAccessRequired(response);
        if (!response.ok) throw await parseErrorResponse(response);
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) throw new Error('当前预览内容不是有效图片');
        chain.previewImage = (await api.uploadFile(new File([blob], 'roll-cover.png', { type: blob.type }), 'covers')).url;
        chain.basePrompt = image.prompt; chain.negativePrompt = image.negativePrompt ?? ''; chain.params = structuredClone(image.params);
      }
      saved = await onSaveChain(chain); savedChains.current.set(`${target.id}:${id}`, saved);
    }
    return store({ ...target, candidates: target.candidates.map(item => item.id === id ? { ...item, savedChainId: saved!.id } : item) });
  };
  const saveCandidate = (id = selectedId) => void perform(async () => {
    if (!experiment) return;
    await persistCandidate(experiment, id);
    notify('已保存到风格串');
  });
  const saveChosen = () => void perform(async () => {
    if (!experiment || !historyReady) return;
    const items = chosen.filter(candidate => images.has(candidate.id) && !candidate.archived && !candidate.savedChainId);
    let next = experiment;
    setSelectedIds(new Set(chosen.filter(candidate => !candidate.savedChainId).map(candidate => candidate.id)));
    setSavingProgress({ completed: 0, total: items.length });
    try {
      for (const [index, candidate] of items.entries()) {
        next = await persistCandidate(next, candidate.id);
        setSavingProgress({ completed: index + 1, total: items.length });
        setSelectedIds(current => new Set([...current].filter(id => id !== candidate.id)));
      }
      notify(t('已保存 {0} 套画风', [items.length]), 'success');
    } finally { setSavingProgress(null); }
  });
  const archiveCandidates = (ids: string[], archived: boolean) => void perform(async () => {
    if (!experiment) return;
    await store({ ...experiment, candidates: experiment.candidates.map(candidate => ids.includes(candidate.id) ? { ...candidate, archived } : candidate) });
    setSelectedIds(new Set()); setSelectedId('');
  });
  const archiveRecord = (record: RollExperiment, archived: boolean) => void perform(async () => {
    if (getGenerationSeriesSession(rollSourceId(record.id)) || generatingRef.current) return;
    await store({ ...record, archived });
    if (archived && record.id === experimentId) setExperimentId(experiments.find(item => item.id !== record.id && !item.archived)?.id || '');
    if (!archived) setExperimentId(record.id);
  });
  const sendToLab = () => {
    if (!experiment || !selected) return;
    const chain = rollCandidateToChain(experiment, selected);
    sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify({ mode: 'prompt-fragments', targetMode: 'text-to-image', fullMetadata: true, replace: true,
      prompt: selectedImage?.prompt ?? chain.basePrompt, negativePrompt: selectedImage?.negativePrompt ?? chain.negativePrompt,
      params: selectedImage?.params ?? chain.params, importSettings: true, importSeed: true, importModel: true }));
    onNavigateToPlayground();
  };
  const saveManualWeights = () => void perform(async () => {
    if (!experiment || !selected || !manualWeights) return;
    const candidate = manualRollVariant({ ...experiment, artists: resolveRollArtists(library, experiment.artists, selected.genes) }, selected, manualWeights);
    await store({ ...experiment, candidates: [...experiment.candidates, candidate] });
    setManualWeights(null); setFilter('all'); setRoundId(''); setQuery(''); setSelectedId(candidate.id);
  });

  const detail = experiment && selected ? <div className="space-y-4 p-4">
    {selectedImage ? <PressRevealSurface className="group relative overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-950" data-safe-mode-work="true">
      <button className="block w-full" type="button" aria-label={t('放大图片')} onClick={() => setLightbox(selectedImage)}><SmartImage src={selectedImage.imageUrl} alt={t('候选 {0}', [experiment.candidates.indexOf(selected) + 1])} eager className="max-h-[45vh] w-full object-contain" containerClassName="w-full" /></button>
      <ImageShareActions imageUrl={selectedImage.imageUrl} filename={`roll-${selectedImage.id}.png`} generationData={selectedImage} favorite={{ imageUrl: selectedImage.imageUrl, sourceType: 'history', sourceId: selectedImage.id }} notify={notify} variant="card" className="absolute right-2 top-2 flex-col" />
    </PressRevealSurface> : <div className="flex min-h-36 items-center justify-center rounded-xl border border-dashed border-gray-300 text-gray-400 dark:border-gray-700"><ImagePlus className="h-8 w-8" /></div>}
    <div className="flex flex-wrap gap-2 text-xs text-gray-500"><span className="rounded-lg bg-gray-100 px-2 py-1 dark:bg-gray-800">{t(methodLabels[selected.method])}</span></div>
    {!!selected.parents.length && <div className="flex flex-wrap items-center gap-1 text-xs text-gray-500">{t('来源候选')}{selected.parents.map(id => <button key={id} type="button" className="mobile-touch rounded-md px-2 text-indigo-500 hover:underline" onClick={() => { setFilter('all'); setRoundId(''); setQuery(''); setSelectedId(id); }}>#{experiment.candidates.findIndex(candidate => candidate.id === id) + 1}</button>)}</div>}
    <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3.5 space-y-2.5 dark:border-gray-800/80 dark:bg-gray-900/40 shadow-inner">
      <div className="flex items-center justify-between text-xs font-semibold text-gray-500 dark:text-gray-400">
        <span>{t('画师基因配方')}</span>
        <span className="font-mono text-xs">{selected.genes.length} {t('位画师')}</span>
      </div>
      <div className="space-y-2">{selected.genes.map((gene, index) => {
        const artist = experiment.artists.find(item => item.tag === gene.tag);
        const barColor = GENE_ACCENTS[index % GENE_ACCENTS.length];
        return <div key={gene.tag} className="flex min-w-0 items-center gap-2 text-sm">
          <span className={`h-2 w-2 rounded-full shrink-0 ${barColor}`} />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-800 dark:text-gray-200" title={gene.tag}>{gene.tag}</span>
          {manualWeights ? <input aria-label={t('候选权重：{0}', [gene.tag])} type="number" className={`${selectClass} w-20 text-right font-mono text-xs`} min={experiment.rules.minWeight} max={experiment.rules.maxWeight} step={0.1} value={artist?.locked ? artist.weight : manualWeights[index]} disabled={busy || loading || artist?.locked} onChange={event => setManualWeights(current => current?.map((weight, i) => i === index ? Number(event.target.value) : weight) || null)} /> : <div className="flex items-center gap-2"><span className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"><span className={`block h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, Math.max(5, (gene.weight / 3) * 100))}%` }} /></span><span className="w-7 text-right font-mono text-xs font-semibold text-gray-600 dark:text-gray-300">{gene.weight.toFixed(1)}</span></div>}
        </div>;
      })}</div>
    </div>
    {manualWeights && <div className="flex flex-wrap gap-2"><ToolbarButton className="!border-emerald-600 !bg-emerald-600 !text-white" disabled={busy || loading} onClick={saveManualWeights}>{t('保存为新变体')}</ToolbarButton><ToolbarButton disabled={busy} onClick={() => setManualWeights(null)}>{t('取消')}</ToolbarButton></div>}
    {!selectedImage && <ToolbarButton data-agent-action="business" tone="primary" className="!h-11 w-full" disabled={busy || loading || preparing || Boolean(session) || Boolean(manualWeights) || historyLoading || !historyReady || selected.archived} onClick={() => void generate()}>{preparing ? <LoaderCircle className="animate-spin" /> : <ImagePlus />}{t('生成图片')} · {costLabel}</ToolbarButton>}
    {!historyLoading && !historyReady && <p className="text-xs text-amber-600 dark:text-amber-400">{t('历史暂不可用，请重新加载后再生成。')}</p>}
    <div className="grid grid-cols-2 gap-2">
      <ToolbarButton disabled={busy || loading || Boolean(manualWeights)} tone="primary" className="!h-10 rounded-xl font-bold shadow-sm" onClick={selected.savedChainId && chains.some(chain => chain.id === selected.savedChainId) ? () => onOpenChain(selected.savedChainId!) : () => saveCandidate()}><Save />{t(selected.savedChainId && chains.some(chain => chain.id === selected.savedChainId) ? '打开风格串' : '存为风格串')}</ToolbarButton>
      <ToolbarButton disabled={busy || Boolean(manualWeights)} className="!h-10 rounded-xl border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300 font-bold shadow-sm" onClick={() => { try { sendToLab(); } catch (cause) { setError((cause as Error).message); } }}><FlaskConical />{t('送往实验室')}</ToolbarButton>
    </div>
    <details className="rounded-2xl border border-gray-100 bg-gray-50/50 p-3 transition-all dark:border-gray-800/80 dark:bg-gray-900/40">
      <summary className="mobile-touch cursor-pointer text-xs font-semibold text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400">{t('更多操作')}</summary>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <ToolbarButton disabled={busy || loading || Boolean(manualWeights)} onClick={() => void perform(async () => { if (!navigator.clipboard?.writeText) throw new Error('当前环境无法直接复制，请从完整提示词中手动复制'); await navigator.clipboard.writeText(formatRollStyle(selected.genes)); notify('已复制提示词'); })}><Copy />{t('复制画风')}</ToolbarButton>
        <ToolbarButton disabled={busy || loading || Boolean(manualWeights)} onClick={() => archiveCandidates([selected.id], !selected.archived)}>{selected.archived ? <RotateCcw /> : <Trash2 />}{t(selected.archived ? '恢复候选' : '丢弃')}</ToolbarButton>
        <ToolbarButton disabled={busy || loading || selected.archived || Boolean(manualWeights)} onClick={() => setManualWeights(selected.genes.map(gene => gene.weight))}><SlidersHorizontal />{t('手动调整权重')}</ToolbarButton>
      </div>
    </details>
    <details className="rounded-2xl border border-gray-100 bg-gray-50/50 p-3 transition-all dark:border-gray-800/80 dark:bg-gray-900/40 text-xs text-gray-500">
      <summary className="mobile-touch cursor-pointer font-semibold text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400">{t('完整提示词')}</summary>
      <p className="mt-2 break-words rounded-xl bg-white p-2.5 font-mono leading-relaxed text-gray-700 shadow-inner dark:bg-gray-950 dark:text-gray-300">{rollCandidateToChain(experiment, selected).basePrompt}</p>
    </details>
  </div> : null;

  const candidates = experiment ? experiment.candidates.filter(candidate => !candidate.archived) : [];
  const roundPending = experiment ? rollPendingCandidates(experiment, images) : [];
  const scopedRound = experiment?.rounds.find(item => item.id === roundId);
  const selectedPending = experiment ? rollPendingCandidates(experiment, images, chosen.map(candidate => candidate.id)) : [];
  const saveable = chosen.filter(candidate => images.has(candidate.id) && !candidate.archived && !candidate.savedChainId);
  const working = Boolean(session || preparing), frozen = busy || loading;
  const canStart = !frozen && !working && !libraryLoading && !libraryError && library.length > 0 && (!experiment || historyReady);
  const savedCount = candidates.filter(candidate => candidate.savedChainId).length;
  return <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100" data-roll-page="true">
    <WorkspaceToolbar>
      {selecting ? <>
        <div role="group" aria-label={t('画风批量操作')} className="flex h-full min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none]">
          <b aria-live="polite" className="shrink-0 text-xs text-gray-600 dark:text-gray-300">{savingProgress ? t('正在保存 {0}/{1}', [savingProgress.completed, savingProgress.total]) : t('已选 {0} 套', [chosen.length])}</b>
          {filter !== 'archived' && <ToolbarButton tone="primary" disabled={frozen || !historyReady || !saveable.length} onClick={saveChosen}><Save />{t('保存所选')}</ToolbarButton>}
          {!!selectedPending.length && <ToolbarButton data-agent-action="business" disabled={frozen || working || !historyReady} onClick={() => generatePending(selectedPending.map(candidate => candidate.id))}><ImagePlus />{t('生成所选')} · {Math.min(selectedPending.length, continuousGenerationEnabled ? 24 : 1)}</ToolbarButton>}
          <ToolbarButton tone={filter === 'archived' ? 'neutral' : 'danger'} disabled={frozen || !chosen.length} onClick={() => archiveCandidates(chosen.map(candidate => candidate.id), filter !== 'archived')}>{filter === 'archived' ? <RotateCcw /> : <Trash2 />}{t(filter === 'archived' ? '恢复所选' : '丢弃所选')}</ToolbarButton>
          <ToolbarButton disabled={frozen} onClick={() => setSelectedIds(new Set(visible.map(candidate => candidate.id)))}>{t('全选筛选结果')}</ToolbarButton>
          <ToolbarButton disabled={frozen} onClick={() => setSelectedIds(new Set(visible.filter(candidate => !selectedIds.has(candidate.id)).map(candidate => candidate.id)))}>{t('反选筛选结果')}</ToolbarButton>
          <ToolbarButton disabled={frozen || !chosen.length} onClick={() => setSelectedIds(new Set())}>{t('清空选择')}</ToolbarButton>
        </div>
        <ToolbarButton aria-label={t('退出多选')} disabled={frozen} onClick={() => { setSelecting(false); setSelectedIds(new Set()); }}><X /><span className="hidden sm:inline">{t('退出多选')}</span></ToolbarButton>
      </> : <div data-roll-toolbar-scroll="true" className="flex h-full min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none]">
        {/* 左侧：实验选择与管理（胶囊卡片，归正核心上下文） */}
        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-gray-200/80 bg-gray-100/60 p-0.5 dark:border-gray-800 dark:bg-gray-800/40">
          <ToolbarSelect label={t('切换画风记录')} containerClassName="max-w-32 sm:max-w-44 lg:max-w-56 min-w-0" className="!h-8 !border-transparent !bg-transparent !pl-2 !text-xs font-semibold" value={experimentId} disabled={frozen || preparing} onChange={event => setExperimentId(event.target.value)}>
            {!experiment && <option value="">{t('新画风记录')}</option>}{experiments.filter(item => !item.archived).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </ToolbarSelect>
          <ToolbarPopover title={t('画风记录管理')} label={t('管理记录')} icon={<MoreHorizontal className="h-4 w-4" />} iconOnly disabled={frozen || working || selecting} width={320} className="[&_button]:!h-7 [&_button]:!w-7">
            {close => <div className="space-y-3">
              {experiment && <form onSubmit={event => { event.preventDefault(); if (!recordName.trim() || recordName.trim() === experiment.name) return; void perform(async () => { await store({ ...experiment, name: recordName.trim() }); close(); }); }}>
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('记录名称')}<input aria-label={t('记录名称')} value={recordName} maxLength={120} onChange={event => setRecordName(event.target.value)} className={TOOLBAR_FIELD_CLASS} /></label>
                <ToolbarButton type="submit" className="mt-2 w-full" disabled={!recordName.trim() || recordName.trim() === experiment.name}>{t('重命名')}</ToolbarButton>
              </form>}
              <div className="space-y-1">
                <button type="button" className={TOOLBAR_MENU_CLASS} onClick={() => { setSetup(makeExperiment()); close(); }}><Plus />{t('新建记录')}</button>
                <button type="button" className={TOOLBAR_MENU_CLASS} onClick={() => { void reload(); void reloadLibrary(); if (experimentId) void refreshHistory(experimentId); close(); }}><RefreshCw />{t('重新加载实验')}</button>
                {experiment && <><button type="button" className={TOOLBAR_MENU_CLASS} onClick={() => { void saveExportBlob(new Blob([JSON.stringify(experiment, null, 2)], { type: 'application/json' }), `roll-${experiment.id}.json`).catch(cause => setError((cause as Error).message)); close(); }}><Download />{t('导出实验配置')}</button>
                <button type="button" className={`${TOOLBAR_MENU_CLASS} !text-red-500`} onClick={() => { archiveRecord(experiment, true); close(); }}><Trash2 />{t('将记录移入回收站')}</button></>}
              </div>
              {experiments.some(item => item.archived) && <div className="space-y-1 border-t border-gray-200 pt-3 dark:border-gray-800"><p className="mb-2 text-xs text-gray-400">{t('记录回收站')}</p>{experiments.filter(item => item.archived).map(item => <div key={item.id} className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate">{item.name}</span><button type="button" className="mobile-touch shrink-0 px-2 text-xs text-indigo-500" aria-label={t('恢复记录：{0}', [item.name])} onClick={() => { archiveRecord(item, false); close(); }}>{t('恢复')}</button></div>)}</div>}
            </div>}
          </ToolbarPopover>
        </div>

        {/* 中间：自适应搜索框铺满可用宽度 */}
        <ToolbarSearch value={query} onChange={event => { setQuery(event.target.value); setSelectedId(''); selectionAnchor.clearAnchor(); }} aria-label={t('搜索画师或编号')} placeholder={t('搜索画师或编号')} containerClassName="flex-1 !max-w-none md:!max-w-none min-w-[160px] mx-1 md:mx-2" disabled={!experiment} />

        {/* 右侧集群：紧密贴紧屏幕最右端，彻底消除右侧空白 */}
        <div className="ml-auto flex shrink-0 items-center gap-1.5 md:gap-2">
          {/* 筛选与排序 */}
          <ToolbarPopover title={t('筛选与排序')} label={t('筛选')} count={Number(filter !== 'all') + Number(Boolean(roundId)) + Number(sort !== 'new')} disabled={!experiment}>
            {close => <div className="space-y-4">
              <div role="group" aria-label={t('画风筛选')} className="grid grid-cols-2 gap-2">
                {(['all', 'originals', 'variants', 'saved', 'pending', 'archived'] as const).map(value => <ToolbarButton key={value} aria-label={t(value === 'all' ? '全部' : value === 'originals' ? '纯新探索' : value === 'variants' ? '微调变体' : value === 'saved' ? '已保存' : value === 'pending' ? '待生成' : '回收站')} active={filter === value} onClick={() => { setFilter(value); setSelectedId(''); selectionAnchor.clearAnchor(); close(); }}>{t(value === 'all' ? '全部' : value === 'originals' ? '纯新探索' : value === 'variants' ? '微调变体' : value === 'saved' ? '已保存' : value === 'pending' ? '待生成' : '回收站')}<span className="ml-auto text-xs opacity-60">{experiment ? rollWorkspaceCandidates(experiment, images, { filter: value, roundId, query: '', sort }).length : 0}</span></ToolbarButton>)}
              </div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{t('查看轮次')}<select aria-label={t('查看轮次')} value={roundId} onChange={event => { setRoundId(event.target.value); setSelectedId(''); }} className={TOOLBAR_FIELD_CLASS}><option value="">{t('全部轮次')}</option>{[...(experiment?.rounds || [])].reverse().map(item => <option key={item.id} value={item.id}>{t('第 {0} 轮', [(experiment?.rounds.indexOf(item) ?? 0) + 1])} · {item.candidateIds.length}</option>)}</select></label>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{t('排序')}<select aria-label={t('画风排序')} value={sort} onChange={event => setSort(event.target.value)} className={TOOLBAR_FIELD_CLASS}><option value="new">{t('最新生成')}</option><option value="old">{t('最早优先')}</option></select></label>
              <button type="button" className="mobile-touch text-xs font-semibold text-indigo-600 dark:text-indigo-300" onClick={() => { setFilter('all'); setRoundId(''); setSort('new'); setQuery(''); close(); }}>{t('重置筛选')}</button>
            </div>}
          </ToolbarPopover>

          {/* 快速清除筛选标记 */}
          {(query || roundId || filter !== 'all') && (
            <button type="button" aria-label={t('清除筛选')} className="mobile-touch hidden sm:flex shrink-0 items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300 hover:text-red-500" onClick={() => { setFilter('all'); setRoundId(''); setQuery(''); }}>
              {t(filter === 'saved' ? '已保存' : filter === 'pending' ? '待生成' : filter === 'archived' ? '回收站' : '已筛选')}<X className="h-3 w-3" />
            </button>
          )}

          {/* 批量多选 */}
          <ToolbarButton aria-label={t('批量选择画风')} title={t('多选')} disabled={frozen || !experiment} onClick={() => { setSelectedId(''); setSelecting(true); setSelectedIds(new Set()); }}><ListChecks /><span className="hidden xl:inline">{t('多选')}</span></ToolbarButton>

          {experiment && <span className="hidden xl:inline text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
            {`${scopedRound ? t('第 {0} 轮', [experiment.rounds.indexOf(scopedRound) + 1]) : t('全部轮次')} · ${t('显示 {0} 套', [visible.length])}`}
          </span>}

          {/* 最右侧主 CTA 组合：开始 Roll + 本轮设置 */}
          <div className="flex shrink-0 items-center">
            <ToolbarButton aria-label={t(experiment ? '再 Roll 一轮' : '开始 Roll')} data-agent-action="business" tone="primary" disabled={!canStart} className="!rounded-r-none !border-r-0 font-bold shadow-sm transition-transform active:scale-95" onClick={() => runRound()}><Dice5 className="h-4 w-4" /><span className="sm:hidden">Roll</span><span className="hidden sm:inline">{t(experiment ? '再 Roll 一轮' : '开始 Roll')}</span></ToolbarButton>
            <ToolbarPopover label={t('本轮设置')} title={t('本轮设置')} icon={<ChevronDown />} disabled={frozen || working} width={320} className="[&_button[aria-haspopup]]:rounded-l-none [&_button[aria-haspopup]>span]:hidden">
              {close => <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('每串画师')}<input type="number" aria-label={t('每串画师数')} className={TOOLBAR_FIELD_CLASS} min={1} max={16} value={artistsPerMix} onChange={event => setArtistsPerMix(Number(event.target.value))} /></label>
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('本轮张数')}<input type="number" aria-label={t('本轮生成张数')} className={TOOLBAR_FIELD_CLASS} min={1} max={24} value={count} onChange={event => setCount(Number(event.target.value))} /></label>
                </div>
                <p className="text-xs text-gray-500">{savedCount ? t('优先参考已保存的 {0} 套组合', [savedCount]) : t('从画师库自动抽取 · {0} 位画师', [library.length])}</p>
                <ToolbarButton className="w-full" onClick={() => { setSetup(experiment || makeExperiment()); close(); }}><Settings2 />{t('提示词与生成设置')}</ToolbarButton>
              </div>}
            </ToolbarPopover>
          </div>
        </div>
      </div>}
    </WorkspaceToolbar>
    {error && <div role="alert" className="flex flex-none items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"><span className="min-w-0 flex-1 break-words">{t(error)}</span>{errorSource !== 'generation' && <button type="button" className="mobile-touch shrink-0 px-2 underline" onClick={() => { void reload(); if (experimentId) void refreshHistory(experimentId); }}>{t('重新加载')}</button>}<IconButton label="关闭错误提示" className="!h-8 !w-8 !border-transparent !bg-transparent !text-current" onClick={() => setError('')}><X /></IconButton></div>}
    {libraryError && <div role="alert" className="flex flex-none items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"><span className="flex-1">{t(libraryError)}</span><button type="button" className="mobile-touch px-2 underline" onClick={() => void reloadLibrary()}>{t('重新加载')}</button></div>}
    {working && <div role="status" className="flex flex-none flex-wrap items-center gap-2 border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-xs text-indigo-600 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-300"><LoaderCircle className="h-4 w-4 animate-spin" /><span className="min-w-0 flex-1">{t(session?.connectionError || (session?.awaiting ? '等待费用确认' : session?.state === 'paused' ? '任务已暂停' : '正在逐张出图…'))}{session ? ` ${session.progress.current}/${session.progress.total}` : ''}</span>{session?.awaiting && <ToolbarButton data-agent-action="business" disabled={busy} onClick={approve}>{t('确认费用')}</ToolbarButton>}{session?.state === 'paused' ? <ToolbarButton data-agent-action="business" disabled={busy} onClick={resume}>{t('继续')}</ToolbarButton> : session && continuousGenerationEnabled && <ToolbarButton disabled={busy} onClick={() => void perform(async () => { if (readRollApiKey() !== session.key) throw new Error('NovelAI Key 已变化，请重新发起生成'); await setGenerationQueuePaused(session.key, true); })}><Pause />{t('暂停')}</ToolbarButton>}{session && <button type="button" disabled={session.stopped} className="mobile-touch px-2 underline" onClick={() => { const current = getGenerationSeriesSession(session.scope); if (current) stopGenerationSeriesSession(current); }}>{t(session.stopped ? '取消中…' : '取消')}</button>}</div>}
    {!working && historyReady && experiment && roundPending.length > 0 && <div className="flex flex-none items-center gap-2 border-b border-gray-200 px-3 py-2 text-xs text-gray-500 dark:border-gray-800 md:px-5"><span className="min-w-0 flex-1">{t('本轮已出图 {0}/{1}', [round!.candidateIds.filter(id => images.has(id)).length, round!.candidateIds.length])}</span><ToolbarButton data-agent-action="business" disabled={frozen || !historyReady} onClick={() => generatePending()}><ImagePlus />{t('补齐剩余 {0} 张', [continuousGenerationEnabled ? roundPending.length : 1])}</ToolbarButton></div>}
    {loading && !experiment ? <PageSpinner className="flex-1" /> : !experiment ? <EmptyState className="flex-1 p-6" icon={<Dice5 className="h-8 w-8" />} title={t('Roll 出你的画风')} hint="一键出图，只保存喜欢的画风。" />
      : <div className="relative flex min-h-0 flex-1">
        <StyleRollGallery experiment={experiment} candidates={visible} images={images} historyReady={historyReady} historyLoading={historyLoading} selectedId={selectedId} selectionFocusEnabled={selectionFocusEnabled} selecting={selecting} selectedIds={selectedIds} onSelect={setSelectedId} onToggle={id => setSelectedIds(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; })} onSave={id => saveCandidate(id)} onArchive={id => archiveCandidates([id], !experiment.candidates.find(candidate => candidate.id === id)!.archived)} busy={frozen} scrollRef={scrollRef} onScroll={() => { selectionAnchor.onScroll(); rememberScroll(); }} notify={notify} />
        {!isMobile && selected && <aside className="flex w-84 max-w-[40%] flex-none flex-col border-l border-gray-200/80 bg-white/95 backdrop-blur-md dark:border-gray-800/80 dark:bg-gray-900/95 xl:w-92 shadow-sm"><div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-800"><strong className="text-sm">{t('候选 {0}', [experiment.candidates.indexOf(selected) + 1])}</strong><IconButton label="关闭候选详情" onClick={() => setSelectedId('')}><X /></IconButton></div><div className="min-h-0 flex-1 overflow-y-auto">{detail}</div></aside>}
      </div>}
    {experiment && isMobile && <ImagePreviewPortal><MobileDetailView open={Boolean(selected) && !setup} title={t('候选 {0}', [experiment.candidates.findIndex(candidate => candidate.id === selectedId) + 1])} onClose={() => setSelectedId('')}>{detail}</MobileDetailView></ImagePreviewPortal>}
    {setup && <StyleRollSetup initial={setup} chains={chains} libraryCount={library.length} libraryLoading={libraryLoading} enforceFreeStepLimit={enforceFreeStepLimit} onClose={() => setSetup(null)} onSave={async value => { await store(value); if (!experiments.some(item => item.id === value.id)) setExperimentId(value.id); }} />}
    {lightbox && <ImageLightbox src={lightbox.imageUrl} generationData={lightbox} favorite={{ imageUrl: lightbox.imageUrl, sourceType: 'history', sourceId: lightbox.id }} notify={notify} onClose={() => setLightbox(null)} />}
  </div>;
};
