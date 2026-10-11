import { useGalleryFrostedCaption } from '../services/appearancePreferences';
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BookOpen, Copy, RefreshCw, Settings2 } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import type { User, ImageEditOperation } from '../types';
import { IMPORT_SESSION_KEY, type BaseImageImport, type PromptFragmentImport } from '../services/metadataService';
import { codexCharactersToParams, codexEntryMatches, loadCodexBook, loadCodexBootstrap, loadCodexCommunity, readCodexImageFile, readCodexImageMetadata, type CodexBootstrap, type CodexEntry, type CodexImageMetadata, type CodexResult } from '../services/codexService';
import { collectionRevision, collectionTargetActive, subscribeCollection, type CollectionImage, type CollectionTarget } from '../services/collectionFavorites';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { getMobileOriginalUrl } from '../services/mobileImageCache';
import { EmptyState, IconButton, MediaCardShell, PageSpinner, ToolbarButton, ToolbarSearch, WorkspaceToolbar } from './DesignSystem';
import { DetailSidePanel, DetailImageStage } from './DetailPanel';
import { ImageShareOverlay } from './ImageShareActions';
import { SmartImage } from './SmartImage';
import { ViewableImage } from './ImageLightbox';
import { ShortestColumnMasonry, useMasonryColumnCount } from './ShortestColumnMasonry';
import { ToolbarPopover, TOOLBAR_FIELD_CLASS } from './ToolbarPopover';
import { useMobileHistoryLayer } from './MobileUI';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';
import { useGallerySelectionAnchor } from './useGallerySelectionAnchor';
import { CodexImportDialog } from './CodexImportDialog';
import { CodexPromptTools } from './CodexPromptTools';

type Mode = 'books' | 'community';
type Filters = { query: string; scope: 'book' | 'all'; path: string; category: string; rating: string; images: string; favorite: boolean; update: string; sort: string };
const defaults = (): Filters => ({ query: '', scope: 'book', path: '', category: '', rating: 'all', images: 'all', favorite: false, update: '', sort: 'default' });
const savedBook = () => { try { return localStorage.getItem('nai-codex-book') || ''; } catch { return ''; } };
const bookKinds: Record<string, string> = { codex: '法典', string: '画师／画风', composition: '构图／服装／场景', pack: '精选图包' };

export function codexCollectionImage(entry: CodexEntry, page: number): CollectionImage {
  const image = entry.images[page];
  return { imageUrl: image.originalUrl || image.url, title: entry.title, sourceType: entry.source,
    sourceId: entry.source === 'codex' ? `${entry.bookId}:${entry.id}` : entry.id, sourceUrl: entry.sourceUrl, imageId: image.id,
    prompt: image.prompt ?? entry.prompt, negativePrompt: image.negative ?? entry.negative,
    params: (image.characters ?? entry.characters).length ? { characters: codexCharactersToParams(image.characters ?? entry.characters) } : undefined,
    analysis: { codex: { bookId: entry.bookId, bookTitle: entry.bookTitle, entryId: entry.id, page, author: entry.author, path: entry.path,
      note: entry.note, raw: image.raw, nsfw: entry.nsfw, r18g: entry.r18g, originalAvailable: Boolean(image.originalUrl), parameterSource: image.parameterSource,
      prompt: entry.prompt, negative: entry.negative, characters: entry.characters }, externalSourcePage: page, collectionGroupSize: entry.images.length },
  };
}
const groupTarget = (entry: CodexEntry): CollectionTarget => ({ ...codexCollectionImage(entry, entry.coverIndex), groupSize: entry.images.length,
  getGroup: async () => entry.images.map((_, page) => codexCollectionImage(entry, page)),
});

export const CodexGallery: React.FC<{ active: boolean; currentUser: User; notify: (message: string, type?: 'success' | 'error') => void; onNavigateToPlayground: () => void }> = ({ active, notify, onNavigateToPlayground }) => {
  useLanguage();
  const [mode, setMode] = useState<Mode>('books');
  const [bookId, setBookId] = useState(savedBook);
  const [boot, setBoot] = useState<CodexBootstrap>();
  const [data, setData] = useState<Record<Mode, CodexResult | undefined>>({ books: undefined, community: undefined });
  const [filters, setFilters] = useState<Record<Mode, Filters>>({ books: defaults(), community: defaults() });
  const [selectedKeys, setSelectedKeys] = useState<Record<Mode, string | null>>({ books: null, community: null });
  const [pages, setPages] = useState<Record<Mode, number>>({ books: 0, community: 0 });
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [visibleLimit, setVisibleLimit] = useState(120);
  const [importEntry, setImportEntry] = useState<{ entry: CodexEntry; metadata?: CodexImageMetadata }>();
  const [reading, setReading] = useState(false);
  const [bookSearch, setBookSearch] = useState('');
  const [directorySearch, setDirectorySearch] = useState('');
  const bootstrapRefresh = useRef(0);
  const contentRefresh = useRef(0);
  const requestRevision = useRef(0);
  const originalRevision = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const galleryRef = useRef<HTMLDivElement>(null);
  const display = useMobileImageDisplayPreferences();
  const columns = useMasonryColumnCount(display);
  const filter = filters[mode];
  const result = data[mode];
  const entries = result?.entries || [];
  const selectedKey = selectedKeys[mode];
  const selected = entries.find(entry => entry.key === selectedKey);
  const page = pages[mode];
  const selectedImage = selected?.images[page];
  const anchor = useGallerySelectionAnchor(scrollRef, galleryRef, selectedKey, active);
  const scrollRestore = useKeepAliveScrollRestore(scrollRef, `codex-${mode}`, { skipRestore: anchor.hasAnchor });
  const closeDetail = useMobileHistoryLayer(Boolean(active && selected), () => { anchor.preserveOnClose(); setSelectedKeys(current => ({ ...current, [mode]: null })); }, 'codex-detail');
  const favoritesVersion = useSyncExternalStore(subscribeCollection, collectionRevision, collectionRevision);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const refresh = reload !== bootstrapRefresh.current;
    bootstrapRefresh.current = reload;
    void loadCodexBootstrap(refresh, controller.signal).then(next => {
      setBoot(next);
      setBookId(current => next.books.some(book => book.id === current) ? current : next.books.find(book => book.id === 'suozhang_nai5')?.id || next.books[0].id);
    }).catch(cause => { if (!controller.signal.aborted) { setError(cause.message); setLoading(false); } });
    return () => controller.abort();
  }, [active, reload]);

  useEffect(() => {
    if (!active || (mode === 'books' && (!boot || !bookId))) return;
    const controller = new AbortController();
    const revision = ++requestRevision.current;
    const refresh = reload !== contentRefresh.current;
    contentRefresh.current = reload;
    setLoading(true); setError(''); setProgress('');
    const run = async () => {
      if (mode === 'community') return loadCodexCommunity(controller.signal);
      const books = filter.scope === 'all' ? boot!.books : boot!.books.filter(book => book.id === bookId);
      const all: CodexEntry[] = [];
      const failures: string[] = [];
      let offline = false;
      for (let i = 0; i < books.length; i++) {
        controller.signal.throwIfAborted();
        setProgress(t('正在读取书目 {0}/{1}', [i + 1, books.length]));
        try {
          const loaded = await loadCodexBook(books[i], boot!, refresh, controller.signal);
          all.push(...loaded.entries); offline ||= Boolean(loaded.offline);
          if (loaded.error) failures.push(`${books[i].title}：${loaded.error}`);
        } catch (cause) {
          if (controller.signal.aborted) throw cause;
          failures.push(`${books[i].title}：${cause instanceof Error ? cause.message : '读取失败'}`);
        }
      }
      if (!all.length && failures.length) throw new Error(failures.join('；'));
      return { entries: all, release: boot!.release, offline, error: failures.join('；') };
    };
    void run().then(next => {
      if (revision !== requestRevision.current || controller.signal.aborted) return;
      setData(current => ({ ...current, [mode]: next }));
      setSelectedKeys(current => ({ ...current, [mode]: next.entries.some(entry => entry.key === current[mode]) ? current[mode] : null }));
    }).catch(cause => { if (!controller.signal.aborted && revision === requestRevision.current) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted && revision === requestRevision.current) { setLoading(false); setProgress(''); } });
    return () => controller.abort();
  }, [active, mode, bookId, filter.scope, boot?.release, reload]);

  useEffect(() => { originalRevision.current++; setReading(false); setImportEntry(undefined); }, [active, selectedKey, page]);
  const changeFilter = (patch: Partial<Filters>) => {
    setFilters(current => ({ ...current, [mode]: { ...current[mode], ...patch } }));
    setSelectedKeys(current => ({ ...current, [mode]: null })); setVisibleLimit(120);
    scrollRef.current?.scrollTo({ top: 0 });
  };
  const selectBook = (id: string) => {
    setBookId(id);
    try { localStorage.setItem('nai-codex-book', id); } catch { /* 浏览偏好不影响读取。 */ }
    changeFilter({ scope: 'book', path: '', update: '' });
    setData(current => ({ ...current, books: undefined }));
  };
  const paths = useMemo(() => [...new Set(entries.flatMap(entry => entry.path.map((_, i) => entry.path.slice(0, i + 1).join('/'))))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [entries]);
  const updates = useMemo(() => [...new Set(entries.flatMap(entry => entry.updates))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })), [entries]);
  const categories = useMemo(() => [...new Set(entries.flatMap(entry => entry.path))], [entries]);
  const filtered = useMemo(() => {
    const matched = entries.filter(entry => codexEntryMatches(entry, filter.query)
      && (!filter.path || entry.path.join('/').startsWith(`${filter.path}/`) || entry.path.join('/') === filter.path)
      && (!filter.category || entry.path.includes(filter.category))
      && (filter.rating === 'all' || (filter.rating === 'normal' ? !entry.nsfw && !entry.r18g : filter.rating === 'r18g' ? entry.r18g : entry.nsfw && !entry.r18g))
      && (filter.images === 'all' || (filter.images === 'original' ? entry.images.some(image => image.originalUrl) : filter.images === 'none' ? !entry.images.length : entry.images.length > 0))
      && (!filter.update || (filter.update === 'latest' ? entry.isNew || entry.updates.includes(updates[0]) : entry.updates.includes(filter.update)))
      && (!filter.favorite || entry.images.some((_, i) => collectionTargetActive(codexCollectionImage(entry, i)))));
    if (filter.sort === 'name') matched.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
    if (filter.sort === 'new' || (mode === 'community' && filter.sort === 'default')) matched.sort((a, b) => b.createdAt - a.createdAt);
    if (filter.sort === 'likes') matched.sort((a, b) => b.likeCount - a.likeCount);
    return matched;
  }, [entries, filter, updates, favoritesVersion, mode]);
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); notify(t('已复制提示词')); } catch { notify(t('无法复制，请手动选择文本'), 'error'); } };
  const applyImport = (value: PromptFragmentImport) => { sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify(value)); setImportEntry(undefined); onNavigateToPlayground(); };
  const readOriginal = async () => {
    if (!selected || !selectedImage?.originalUrl || reading) return;
    const revision = ++originalRevision.current;
    setReading(true);
    try {
      const metadata = await readCodexImageMetadata(await readCodexImageFile(selectedImage.originalUrl));
      if (revision !== originalRevision.current) return;
      if (!metadata) throw new Error(t('这张图片没有可读取的 NovelAI 配置'));
      setImportEntry({ entry: selected, metadata });
    } catch (cause) { if (revision === originalRevision.current) notify(cause instanceof Error ? cause.message : t('原图读取失败'), 'error'); }
    finally { if (revision === originalRevision.current) setReading(false); }
  };
  const sendBaseImage = (operation: ImageEditOperation) => {
    if (!selectedImage) return;
    const payload: BaseImageImport = { mode: 'base-image', imageEditOperation: operation, baseImageUrl: getMobileOriginalUrl(selectedImage.originalUrl || selectedImage.url) };
    // 缺省配置让工作台保留当前创作；原图配置由另一个明确动作取用。
    sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify(payload)); onNavigateToPlayground();
  };
  const promptSection = (label: string, text: string, open = false) => text ? <details key={`${selectedKey}:${label}`} open={open} className="rounded-xl border border-gray-200 dark:border-gray-800">
    <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-semibold"><span className="mr-auto">{t(label)}</span><IconButton label={t('复制提示词')} onClick={event => { event.preventDefault(); void copy(text); }}><Copy /></IconButton></summary>
    <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 text-xs leading-relaxed text-gray-600 dark:text-gray-300">{text}</pre>
  </details> : null;
  const frostedCaption = useGalleryFrostedCaption();
  const estimateHeight = useCallback((entry: CodexEntry, width: number) => {
    const image = entry.images[entry.coverIndex];
    return image ? width / (image.width && image.height ? image.width / image.height : 0.75) + (frostedCaption ? 2 : 55) : 160;
  }, [frostedCaption]);
  const renderCard = (entry: CodexEntry) => {
    const image = entry.images[entry.coverIndex];
    const partial = image && !collectionTargetActive(groupTarget(entry)) && entry.images.some((_, i) => collectionTargetActive(codexCollectionImage(entry, i)));
    return <MediaCardShell pressReveal key={entry.key} data-gallery-work-id={entry.key} data-safe-mode-work="true" selected={selectedKey === entry.key} className={`mobile-gallery-item ${image ? 'gallery-image-card' : ''} group relative flex-col ${selectedKey && selectedKey !== entry.key ? 'brightness-[.7]' : ''}`}>
      <button type="button" onClick={() => { setSelectedKeys(current => ({ ...current, [mode]: entry.key })); setPages(current => ({ ...current, [mode]: entry.coverIndex })); }} className={`block w-full text-left ${image ? 'gallery-card-visual' : ''}`}>
        {image ? <div className="mobile-gallery-frame relative aspect-[3/4] overflow-hidden bg-gray-200 dark:bg-gray-800" style={{ '--mobile-image-ratio': `${image.width || 3} / ${image.height || 4}` } as React.CSSProperties}>
          <SmartImage src={image.url} alt={entry.title} />
          {!frostedCaption && (entry.images.length > 1 || partial) && <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-1 text-micro text-white">{partial ? `${t('部分已收藏')} · ` : ''}{t('{0}页', [entry.images.length])}</span>}
        </div> : <div className="max-h-40 overflow-hidden bg-gray-50 p-3 text-xs leading-relaxed text-gray-500 dark:bg-gray-950">{entry.prompt || entry.characters.map(character => character.prompt).join('\n') || entry.note}</div>}
        <div className={`p-2.5 ${image ? 'gallery-card-caption' : ''}`}>{frostedCaption && image && (entry.images.length > 1 || partial) && <span className="gallery-card-meta mb-1 block text-micro">{partial ? `${t('部分已收藏')} · ` : ''}{t('{0}页', [entry.images.length])}</span>}<p data-safe-mode-title="true" className="truncate text-xs font-bold">{entry.title}</p><p className="gallery-card-meta mt-1 truncate text-micro text-gray-500">{mode === 'books' ? entry.path.join(' / ') || entry.bookTitle : entry.author || entry.path.join(' / ')}</p></div>
      </button>
      {image && <ImageShareOverlay imageUrl={getMobileOriginalUrl(image.originalUrl || image.url)} filename={`${entry.id}.png`} favorite={groupTarget(entry)} notify={notify} />}
    </MediaCardShell>;
  };
  const field = (label: string, content: React.ReactNode) => <label className="block text-xs font-semibold text-gray-500">{t(label)}{content}</label>;
  const select = (label: string, name: keyof Filters, values: [string, string][]) => field(label, <select aria-label={t(label)} className={TOOLBAR_FIELD_CLASS} value={String(filter[name])} onChange={event => changeFilter({ [name]: event.target.value })}>{values.map(([value, text]) => <option key={value} value={value}>{t(text)}</option>)}</select>);

  return <div className="flex h-full min-h-0 flex-col" data-agent-page-scope="codex" data-agent-page-title={t('法典')}>
    <WorkspaceToolbar>
      <div className="flex flex-none gap-1">{(['books', 'community'] as const).map(value => <ToolbarButton key={value} aria-pressed={mode === value} tone={mode === value ? 'primary' : 'neutral'} className="!px-2 text-xs" onClick={() => { setMode(value); setVisibleLimit(120); setImportEntry(undefined); }}>{t(value === 'books' ? '书目' : '共创广场')}</ToolbarButton>)}</div>
      {mode === 'books' && <ToolbarPopover label={boot?.books.find(book => book.id === bookId)?.title || '选择书目'} title={t('选择书目')} icon={<BookOpen />} width={440} className="hidden lg:block [&_button>span]:max-w-40 [&_button>span]:truncate">
        {close => <div className="space-y-2"><ToolbarSearch value={bookSearch} onChange={event => setBookSearch(event.target.value)} placeholder={t('搜索书目')} />{boot?.books.filter(book => [book.title, book.author, bookKinds[book.type]].join(' ').includes(bookSearch)).map(book => <button key={book.id} className={`block w-full rounded-lg p-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${book.id === bookId ? 'text-indigo-600 dark:text-indigo-300' : ''}`} onClick={() => { close(); selectBook(book.id); }}><span>{book.title}</span><span className="mt-1 block text-xs text-gray-500">{t(bookKinds[book.type] || '法典')} · {book.entryCount} · {book.version}</span></button>)}</div>}
      </ToolbarPopover>}
      <ToolbarSearch value={filter.query} onChange={event => changeFilter({ query: event.target.value })} placeholder={t('标题、提示词、作者或说明')} containerClassName="min-w-0 md:max-w-none!" />
      <ToolbarPopover title={t('法典筛选')} width={400} active={filter.scope === 'all' || Boolean(filter.path || filter.category || filter.update || filter.favorite || filter.rating !== 'all' || filter.images !== 'all')}>
        {close => <div className="space-y-4">
          {mode === 'books' ? <>
            {field('书目', <select aria-label={t('书目')} className={TOOLBAR_FIELD_CLASS} value={bookId} onChange={event => selectBook(event.target.value)}>{boot?.books.map(book => <option key={book.id} value={book.id}>{book.title}</option>)}</select>)}
            {select('检索范围', 'scope', [['book', '当前书目'], ['all', '全部书目']])}
            {field('目录', <><input type="search" aria-label={t('搜索目录')} className={TOOLBAR_FIELD_CLASS} placeholder={t('搜索目录')} value={directorySearch} onChange={event => setDirectorySearch(event.target.value)} /><div className="mt-2 max-h-40 overflow-auto"><button className="block min-h-10 w-full text-left" onClick={() => changeFilter({ path: '' })}>{t('全部目录')}</button>{paths.filter(path => path.includes(directorySearch)).map(path => <button key={path} className={`block min-h-10 w-full truncate text-left text-xs ${filter.path === path ? 'text-indigo-600 dark:text-indigo-300' : ''}`} onClick={() => changeFilter({ path })}>{path}</button>)}</div></>)}
            {select('内容更新', 'update', [['', '全部'], ['latest', '最近更新'], ...updates.map(update => [update, update] as [string, string])])}
          </> : select('分类', 'category', [['', '全部'], ...categories.map(category => [category, category] as [string, string])])}
          {select('内容分级', 'rating', [['all', '全部'], ['normal', '常规'], ['nsfw', '成人'], ['r18g', '重口']])}
          {select('图片', 'images', [['all', '全部'], ['image', '有配图'], ['original', '有可用原图'], ['none', '纯文本']])}
          {select('排序', 'sort', mode === 'community' ? [['default', '最新投稿'], ['likes', '站内点赞'], ['name', '名称 A → Z']] : [['default', '书目顺序'], ['name', '名称 A → Z']])}
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={filter.favorite} onChange={event => changeFilter({ favorite: event.target.checked })} />{t('本地已收藏')}</label>
          <div className="flex justify-between"><ToolbarButton onClick={() => changeFilter(defaults())}>{t('重置')}</ToolbarButton><ToolbarButton tone="primary" onClick={close}>{t('确认')}</ToolbarButton></div>
        </div>}
      </ToolbarPopover>
      <IconButton label={t('刷新')} disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw className={loading ? 'animate-spin' : ''} /></IconButton>
    </WorkspaceToolbar>
    {(error || result?.error || boot?.offline || progress) && <div role="status" className="flex-none border-b border-gray-200 px-3 py-2 text-xs text-amber-700 dark:border-gray-800 dark:text-amber-300">{progress || error || result?.error || boot?.error}{(result?.offline || boot?.offline) && ` · ${t('正在使用上次成功的数据')}`}</div>}
    <div className={`aitag-split relative grid min-h-0 flex-1 grid-cols-1 ${selected ? 'lg:grid-cols-[minmax(0,1fr)_460px]' : ''}`}>
      <div ref={scrollRef} onScroll={() => { scrollRestore(); anchor.onScroll(); }} className="min-h-0 overflow-y-auto p-3">
        <div ref={galleryRef}>
          {loading && !result ? <PageSpinner className="min-h-60" /> : !filtered.length ? <EmptyState className="min-h-60" icon={<BookOpen />} title={t(error ? '法典读取失败' : '没有符合条件的内容')} action={error ? <ToolbarButton onClick={() => setReload(value => value + 1)}>{t('重试')}</ToolbarButton> : undefined} /> : <>
            {display.layout === 'masonry' ? <ShortestColumnMasonry items={filtered.slice(0, visibleLimit)} columns={columns} getItemKey={entry => entry.key} estimateItemHeight={estimateHeight} renderItem={renderCard} stableColumns /> : <div className={mobileGalleryClassName(display)} style={mobileGalleryStyle(display)}>{filtered.slice(0, visibleLimit).map(renderCard)}</div>}
            {filtered.length > visibleLimit && <div className="flex justify-center py-4"><ToolbarButton onClick={() => setVisibleLimit(value => value + 120)}>{t('加载更多')}</ToolbarButton></div>}
          </>}
        </div>
      </div>
      <DetailSidePanel open={Boolean(selected)} title={selected?.title || ''} sensitiveTitle subInfo={selected ? [selected.bookTitle, selected.author, selected.images.length ? t('{0}页', [selected.images.length]) : t('纯文本')].filter(Boolean).join(' · ') : ''} sourceUrl={selected?.sourceUrl} onClose={closeDetail} onBack={closeDetail}>
        {selected && <div className="space-y-3">
          {selectedImage && <DetailImageStage pressResetKey={`${selected.key}:${page}`} pager={{ page, count: selected.images.length, onPrev: () => setPages(current => ({ ...current, [mode]: Math.max(0, page - 1) })), onNext: () => setPages(current => ({ ...current, [mode]: Math.min(selected.images.length - 1, page + 1) })) }}>
            <ViewableImage src={getMobileOriginalUrl(selectedImage.originalUrl || selectedImage.url)} alt={selected.title} className="max-h-[62vh] w-full object-contain" favorite={codexCollectionImage(selected, page)} notify={notify} />
            <ImageShareOverlay imageUrl={getMobileOriginalUrl(selectedImage.originalUrl || selectedImage.url)} filename={`${selected.id}-${page + 1}.png`} favorite={codexCollectionImage(selected, page)} notify={notify} />
          </DetailImageStage>}
          <div className="flex flex-wrap items-center gap-2"><ToolbarButton tone="primary" disabled={!selected.prompt && !selected.negative && !selected.characters.length} onClick={() => setImportEntry({ entry: selected })}>{t('送往实验室')}</ToolbarButton>
            {selectedImage?.originalUrl && <ToolbarButton disabled={reading} onClick={() => void readOriginal()}><Settings2 />{t(reading ? '读取中…' : '读取原图配置')}</ToolbarButton>}
            {selectedImage && <ToolbarPopover label="用作底图" title={t('用作底图')} icon={<BookOpen />} width={240}>{close => <div className="space-y-2">{([['image-to-image', '图生图'], ['inpaint', '局部重绘'], ['outpaint', '扩图']] as const).map(([operation, label]) => <ToolbarButton key={operation} className="w-full" onClick={() => { close(); sendBaseImage(operation); }}>{t(label)}</ToolbarButton>)}</div>}</ToolbarPopover>}
          </div>
          {selected.path.length > 0 && <p className="text-xs text-gray-500">{selected.path.join(' / ')}</p>}
          {selectedImage?.parameterSource && <p className="text-xs text-gray-500">{t('图片来源：{0}', [selectedImage.parameterSource])}</p>}
          {promptSection('正向提示词', selected.prompt, true)}
          {promptSection('负面提示词', selected.negative)}
          {selected.characters.map((character, i) => <div key={`${selected.key}:char:${i}`} className="space-y-2"><p className="text-xs font-semibold text-gray-500">{character.label}</p>{promptSection(t('角色 {0} 正向', [i + 1]), character.prompt)}{promptSection(t('角色 {0} 负面', [i + 1]), character.negative)}</div>)}
          {selectedImage?.raw && promptSection('当前图片原文', selectedImage.raw)}
          {selected.note && <div className="whitespace-pre-wrap break-words rounded-xl bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-950 dark:text-gray-300">{selected.note}</div>}
          {boot && <CodexPromptTools key={selected.key} entry={selected} boot={boot} onOpenEntry={async (id, entryId) => {
            const book = boot.books.find(item => item.id === id); if (!book) return;
            try { const next = await loadCodexBook(book, boot); setData(current => ({ ...current, books: next })); setBookId(id); setMode('books'); setFilters(current => ({ ...current, books: defaults() })); setSelectedKeys(current => ({ ...current, books: next.entries.find(entry => entry.id === entryId)?.key || null })); setPages(current => ({ ...current, books: 0 })); } catch (cause) { notify(String(cause), 'error'); }
          }} />}
          {mode === 'community' && <p className="text-xs text-gray-500">{selected.createdAt ? new Date(selected.createdAt).toLocaleDateString() : ''} · {t('站内点赞')} {selected.likeCount}</p>}
        </div>}
      </DetailSidePanel>
    </div>
    {active && importEntry && <CodexImportDialog key={`${importEntry.entry.key}:${Boolean(importEntry.metadata)}`} {...importEntry} onClose={() => setImportEntry(undefined)} onApply={applyImport} />}
  </div>;
};
