import React, { useEffect, useState } from 'react';
import { Ban, Plus, RotateCcw, Search, Shuffle, X } from 'lucide-react';
import { t, useLanguage } from '../../services/i18n';
import { searchArtistDictionary, type ArtistDictionaryEntry } from '../../services/tagDictionary';
import { buildArtistSampleImageUrl, getArtistSampleCatalog, getArtistSampleStatus, normalizeArtistSampleTag, type ArtistSamplePack } from '../../services/artistSamples';
import { getArtistSampleData } from '../../services/artistSampleDrafts';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { IconButton, ToolbarButton } from '../DesignSystem';
import { SmartImage } from '../SmartImage';
import { isTopmostModal, useModalA11y } from '../useModalA11y';
import { useMobileHistoryLayer } from '../MobileUI';

const PARTY_LIMIT = 16;
const key = (tag: string) => tag.trim().replaceAll('_', ' ').replace(/\s+/g, ' ').toLowerCase();
const field = 'mobile-touch min-w-0 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-950';

interface Props {
  library: string[]; count: number; initial: string[]; blocked: string[];
  /** 只从有样张的画师中抽卡；手动添加与搜索不受限制。 */
  sampledOnly?: boolean;
  onBlock: (tags: string[]) => Promise<void>;
  onSave: (tags: string[]) => void;
  onClose: () => void;
}

export const StyleRollPartyDialog: React.FC<Props> = props => <ImagePreviewPortal><PartyForm {...props} /></ImagePreviewPortal>;

const PartyForm: React.FC<Props> = ({ library, count, initial, blocked, sampledOnly = false, onBlock, onSave, onClose }) => {
  useLanguage();
  const [picked, setPicked] = useState<string[]>(initial);
  const [blockedTags, setBlockedTags] = useState<string[]>(blocked);
  const [search, setSearch] = useState(''), [manual, setManual] = useState('');
  const [suggestions, setSuggestions] = useState<ArtistDictionaryEntry[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [sampleUrls, setSampleUrls] = useState<Map<string, string>>(new Map());
  const [samplesLoading, setSamplesLoading] = useState(true);
  const dialog = useModalA11y<HTMLDivElement>(true);
  const close = useMobileHistoryLayer(true, () => { if (busy) return false; onClose(); }, 'roll-party');

  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(dialog.current)) { event.preventDefault(); close(); } };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, [close, dialog]);
  useEffect(() => {
    let current = true;
    void (async () => {
      const urls = new Map<string, string>();
      const [status, data] = await Promise.all([
        getArtistSampleStatus().catch(() => null),
        getArtistSampleData().catch(() => ({ templates: {}, samples: [] })),
      ]);
      for (const sample of data.samples) urls.set(normalizeArtistSampleTag(sample.tag), sample.imageUrl);
      const ready = (['v45', 'v5'] as const).filter(pack => status?.packs.some(item => item.id === pack && item.phase === 'ready'));
      const catalogs = await Promise.all(ready.map(pack => getArtistSampleCatalog(pack).catch(() => null)));
      for (const [index, catalog] of catalogs.entries()) {
        if (!catalog) continue;
        for (const tag of catalog.tags) {
          const normalized = normalizeArtistSampleTag(tag);
          if (!urls.has(normalized)) urls.set(normalized, buildArtistSampleImageUrl(ready[index], tag, 0, catalog.revision));
        }
      }
      if (current) { setSampleUrls(urls); setSamplesLoading(false); }
    })().catch(() => { if (current) { setSampleUrls(new Map()); setSamplesLoading(false); } });
    return () => { current = false; };
  }, []);
  useEffect(() => {
    let current = true;
    if (!search.trim()) { setSuggestions([]); return; }
    const timer = setTimeout(() => { void searchArtistDictionary(search, 12).then(items => { if (current) setSuggestions(items); }).catch(() => { if (current) setSuggestions([]); }); }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [search]);

  const blockedKeys = new Set(blockedTags.map(key));
  const pickedKeys = new Set(picked.map(key));
  const sampleUrl = (tag: string) => sampleUrls.get(normalizeArtistSampleTag(tag)) || '';
  const available = () => library.filter(tag => !blockedKeys.has(key(tag)) && !pickedKeys.has(key(tag)) && (!sampledOnly || sampleUrls.has(normalizeArtistSampleTag(tag))));
  const draw = (size: number) => {
    const pool = available();
    const next = [...picked];
    while (next.length < Math.min(size, PARTY_LIMIT) && pool.length) next.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    setPicked(next); setError('');
  };
  const redraw = () => { const pool = available().concat(picked); const next: string[] = []; while (next.length < Math.min(count, PARTY_LIMIT) && pool.length) next.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]); setPicked(next); setError(''); };
  const add = (tag: string) => {
    if (picked.length >= PARTY_LIMIT || pickedKeys.has(key(tag)) || blockedKeys.has(key(tag))) return;
    setPicked([...picked, tag]); setError('');
  };
  const applyManual = () => {
    const seen = new Set<string>(), next: string[] = [];
    for (const part of manual.split(/[,，\n\r]+/).map(value => value.trim()).filter(Boolean)) {
      const weighted = part.match(/^([\d.]+)::\s*(.*?)\s*::$/);
      const tag = (weighted ? weighted[2] : part).replace(/^artist\s*:\s*/i, '').trim();
      if (!tag || seen.has(key(tag))) continue;
      seen.add(key(tag)); next.push(tag);
    }
    if (!next.length) { setError('没有识别到画师 Tag'); return; }
    if (next.length > PARTY_LIMIT) { setError(`最多固定 ${PARTY_LIMIT} 位画师`); return; }
    setPicked(next); setManual(''); setError('');
  };
  const blockPicked = async () => {
    if (!picked.length || busy) return;
    setBusy(true); setError('');
    try {
      const next = [...blockedTags];
      for (const tag of picked) if (!next.some(item => key(item) === key(tag))) next.push(tag);
      await onBlock(next); setBlockedTags(next); setPicked([]);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const submit = () => { if (!picked.length) { setError('请先抽卡或添加至少一位画师'); return; } onSave(picked); onClose(); };
  const hint = samplesLoading ? t('正在读取画师样张…') : sampledOnly && !sampleUrls.size ? t('没有可用的样张画师') : t('一次抽 {0} 位，可逐位替换', [count]);

  return <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm">
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={t('固定画师')} className="appearance-panel flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
      <header className="flex flex-none items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <strong className="min-w-0 flex-1 text-sm">{t('固定画师')}</strong>
        <span className="text-xs tabular-nums text-gray-500">{picked.length}/{PARTY_LIMIT}</span>
        <IconButton label="关闭" disabled={busy} onClick={close}><X /></IconButton>
      </header>

      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2.5 dark:border-gray-800">
        <ToolbarButton tone="primary" disabled={busy} onClick={() => draw(count)}><Shuffle />{t('抽卡')}</ToolbarButton>
        <ToolbarButton disabled={busy} onClick={redraw}><RotateCcw />{t('重抽')}</ToolbarButton>
        <ToolbarButton disabled={busy || picked.length >= PARTY_LIMIT} onClick={() => draw(picked.length + 1)}><Plus />{t('补抽')}</ToolbarButton>
        <span className="ml-auto text-xs text-gray-500">{hint}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
          {picked.map(tag => {
            const url = sampleUrl(tag);
            return <div key={tag} className="group relative aspect-[2/3] overflow-hidden rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-950">
              {url ? <SmartImage src={url} alt={tag} previewTransform={url.startsWith('/api/artist-samples/image?') ? 'artist-sample-padding-v1' : undefined} className="h-full w-full object-cover" containerClassName="absolute inset-0" />
                : <div className="flex h-full w-full items-center justify-center text-xs text-gray-400 dark:text-gray-600">{samplesLoading ? t('正在读取画师样张…') : t('暂无样张')}</div>}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2 pb-1.5 pt-8">
                <span className="block truncate text-xs font-medium text-white" title={tag}>{tag}</span>
              </div>
              <button type="button" aria-label={t('移除 {0}', [tag])} title={t('移除')} disabled={busy} onClick={() => setPicked(picked.filter(item => item !== tag))} className="mobile-size-locked absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition hover:bg-rose-600 disabled:opacity-40"><X className="h-3.5 w-3.5" /></button>
            </div>;
          })}
          {picked.length < PARTY_LIMIT && <button type="button" disabled={busy} onClick={() => draw(picked.length + 1)} className="mobile-touch flex aspect-[2/3] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-300 text-xs text-gray-400 transition hover:border-indigo-400 hover:text-indigo-500 disabled:opacity-40 dark:border-gray-700"><Plus className="h-5 w-5" />{t('补抽')}</button>}
        </div>
      </div>

      <div className="flex flex-none flex-col gap-2.5 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
        <div className="flex flex-wrap items-center gap-2">
          <ToolbarButton disabled={busy || !picked.length} onClick={() => void blockPicked()}><Ban />{t('屏蔽这些')}</ToolbarButton>
          <span className="text-xs text-gray-500">{t('已屏蔽 {0} 位', [blockedTags.length])}</span>
          {!!blockedTags.length && <details className="min-w-0"><summary className="mobile-touch cursor-pointer text-xs font-semibold text-gray-500 hover:text-indigo-500">{t('管理屏蔽')}</summary><div className="mt-2 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">{blockedTags.map(tag => <button key={tag} type="button" aria-label={t('取消屏蔽 {0}', [tag])} disabled={busy} onClick={async () => { const next = blockedTags.filter(item => item !== tag); setBusy(true); try { await onBlock(next); setBlockedTags(next); } finally { setBusy(false); } }} className="mobile-touch inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600 hover:text-rose-500 dark:bg-gray-800 dark:text-gray-300">{tag}<X className="h-3 w-3" /></button>)}</div></details>}
        </div>
        <div className="grid items-start gap-2.5 sm:grid-cols-2">
          <div className="min-w-0">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <input aria-label={t('从画师库添加')} className={`${field} !pl-9`} value={search} onChange={event => setSearch(event.target.value)} placeholder={t('从画师库添加')} disabled={busy} />
            </div>
            {!!suggestions.length && <div className="mt-1.5 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">{suggestions.map(artist => <button key={artist.name} type="button" className="mobile-touch rounded-lg border border-gray-200 px-2 py-1 text-xs hover:border-indigo-400 disabled:opacity-40 dark:border-gray-700" disabled={busy || pickedKeys.has(key(artist.name)) || blockedKeys.has(key(artist.name))} onClick={() => add(artist.name)}>{artist.name}</button>)}</div>}
          </div>
          <div className="min-w-0">
            <div className="flex items-start gap-2">
              <textarea aria-label={t('手动输入')} className={`${field} min-h-16 flex-1 resize-y font-mono`} value={manual} onChange={event => setManual(event.target.value)} placeholder="artist:..." disabled={busy} />
              <ToolbarButton disabled={busy || !manual.trim()} onClick={applyManual}>{t('应用')}</ToolbarButton>
            </div>
            <p className="mt-1 text-micro text-gray-400">{t('支持 1.2::artist:name :: 或直接粘贴画师名')}</p>
          </div>
        </div>
        {error && <p role="alert" className="text-xs text-red-500">{t(error)}</p>}
      </div>

      <footer className="flex flex-none items-center justify-between gap-3 border-t border-gray-200 px-4 py-2.5 dark:border-gray-800">
        <span className="min-w-0 text-xs text-gray-500">{t('已固定 {0} 位 · 之后每轮只抽权重', [picked.length])}</span>
        <div className="flex shrink-0 items-center gap-2">
          <ToolbarButton disabled={busy} onClick={close}>{t('取消')}</ToolbarButton>
          <ToolbarButton className="!border-emerald-600 !bg-emerald-600 !text-white" disabled={busy || !picked.length} onClick={submit}>{t('确定')}</ToolbarButton>
        </div>
      </footer>
    </div>
  </div>;
};
