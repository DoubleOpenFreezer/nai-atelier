import React, { useContext, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ImageIcon, Settings2 } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import { buildArtistSampleImageUrl, getArtistSampleLookup, type ArtistOwnSample, type ArtistSampleLookup, type ArtistSamplePack } from '../services/artistSamples';
import { ImageActivityContext, SmartImage } from './SmartImage';
import { ImageShareOverlay } from './ImageShareActions';
import { ToolbarPopover, TOOLBAR_MENU_CLASS } from './ToolbarPopover';

export const ArtistSampleCover: React.FC<{
  tag: string;
  pack: ArtistSamplePack;
  revision: string;
  hasPackSample: boolean;
  ownSamples: ArtistOwnSample[];
  alt: string;
  imageClassName?: string;
  onPackChange: (pack: ArtistSamplePack) => void;
  sampleStatusText?: string;
  onSupplement: () => void;
  onSettings?: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
  onFavoriteChange?: (active: boolean) => void;
  onImageLoad?: (width: number, height: number) => void;
}> = ({ tag, pack, revision, hasPackSample, ownSamples, alt, imageClassName, onPackChange, sampleStatusText, onSupplement, onSettings, notify, onFavoriteChange, onImageLoad }) => {
  useLanguage();
  const active = useContext(ImageActivityContext);
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [lookupResult, setLookupResult] = useState<{ identity: string; data: ArtistSampleLookup }>();
  const [error, setError] = useState('');
  const [imageError, setImageError] = useState(false);
  const [index, setIndex] = useState(0);
  const [retry, setRetry] = useState(0);
  const identity = JSON.stringify([pack, tag, revision, ownSamples.map(sample => sample.id)]);
  const lookup = lookupResult?.identity === identity ? lookupResult.data : undefined;
  useEffect(() => {
    setLookupResult(undefined); setError(''); setImageError(false); setIndex(0);
  }, [identity]);
  useEffect(() => {
    if (!active) { setVisible(false); return; }
    const node = rootRef.current;
    if (!node || !('IntersectionObserver' in window)) { setVisible(true); return; }
    let root = node.parentElement;
    while (root && !/auto|scroll|overlay/.test(getComputedStyle(root).overflowY)) root = root.parentElement;
    const observer = new IntersectionObserver(entries => setVisible(Boolean(entries[entries.length - 1]?.isIntersecting)), { root });
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, identity]);
  useEffect(() => {
    if (!active || !visible || !hasPackSample || lookup) return;
    const controller = new AbortController();
    setError('');
    void getArtistSampleLookup(pack, tag, controller.signal).then(result => {
      if (!controller.signal.aborted) setLookupResult({ identity, data: result });
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('样张读取失败')); });
    return () => controller.abort();
  }, [active, visible, hasPackSample, identity, retry, lookup]);
  const own = ownSamples[index];
  const packIndex = index - ownSamples.length;
  const imageUrl = own?.imageUrl || (lookup && packIndex >= 0 && packIndex < lookup.imageCount ? buildArtistSampleImageUrl(pack, tag, packIndex, lookup.revision) : '');
  const total = ownSamples.length + (lookup?.imageCount || 0);
  const sampleRevision = own?.id || lookup?.revision || revision;
  const favorite = { imageUrl, title: alt || tag, sourceType: 'artist' as const, sourceId: tag,
    imageId: JSON.stringify([pack, sampleRevision, tag, own ? 0 : packIndex]), sourceUrl: own ? undefined : lookup?.sourceUrl,
    prompt: own?.prompt, negativePrompt: own?.negativePrompt, params: own?.params,
    analysis: { artistSample: { pack, tag, revision: sampleRevision, index: own ? 0 : packIndex, ...(own ? { ownSampleId: own.id, model: own.params.model } : {}) } },
  };
  const filename = `artist-${pack}-${tag}-${own?.id || packIndex}.png`;
  const move = (direction: number) => { setIndex(current => Math.max(0, Math.min(total - 1, current + direction))); setImageError(false); };
  const stopCardAction = (event: React.SyntheticEvent) => event.stopPropagation();
  const runAfterClose = (close: () => void, action: () => void) => {
    close();
    window.setTimeout(action, 0);
  };
  return <div ref={rootRef} className="absolute inset-0">
    <div data-card-action="true" className="absolute left-2 top-2 z-20" onClick={stopCardAction} onPointerDown={stopCardAction} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}>
      <ToolbarPopover
        label={t('样张版本与补图：{0}', [pack === 'v45' ? 'V4.5' : 'V5'])}
        title={t('画师样张模型')}
        icon={<><span className="text-[11px] font-bold leading-none">{pack === 'v45' ? 'V4.5' : 'V5'}</span><ChevronDown className="!h-2.5 !w-2.5" /></>}
        iconOnly
        width={256}
        className="[&>button]:!h-11 [&>button]:!w-11 [&>button]:!rounded-lg [&>button]:!border-white/60 [&>button]:!bg-black/55 [&>button]:!text-white [&>button:hover]:!bg-black/70 md:[&>button]:!h-8"
      >{(close) => <div data-card-action="true" onClick={stopCardAction} onPointerDown={stopCardAction} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }} className="space-y-2">
        {sampleStatusText && <p role="status" className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">{sampleStatusText}</p>}
        <p className="px-2 pt-1 text-xs font-semibold text-gray-500 dark:text-gray-400">{t('画师样张模型')}</p>
        <div className="grid grid-cols-2 gap-2">
          {(['v45', 'v5'] as const).map(option => <button key={option} type="button" aria-pressed={pack === option} onClick={() => runAfterClose(close, () => onPackChange(option))} className={`${TOOLBAR_MENU_CLASS} min-h-11 justify-center ${pack === option ? 'bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' : ''}`}>{option === 'v45' ? 'V4.5' : 'V5'}</button>)}
        </div>
        <div className="border-t border-gray-200 pt-1 dark:border-gray-700">
          <button type="button" onClick={() => runAfterClose(close, onSupplement)} className={`${TOOLBAR_MENU_CLASS} min-h-11`}><ImageIcon />{t('补充样张')}</button>
          {onSettings && <button type="button" onClick={() => runAfterClose(close, onSettings)} className={`${TOOLBAR_MENU_CLASS} min-h-11`}><Settings2 />{t('补图生成设置')}</button>}
        </div>
      </div>}</ToolbarPopover>
    </div>
    {imageUrl && !imageError ? <>
      <SmartImage key={`${imageUrl}:${retry}`} src={imageUrl} alt={alt} eager={visible} className={imageClassName} previewTransform={!own && imageUrl.startsWith('/api/artist-samples/image?') ? 'artist-sample-padding-v1' : undefined} onError={() => setImageError(true)} onLoad={event => { if (event.currentTarget.naturalWidth && event.currentTarget.naturalHeight) onImageLoad?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight); }} />
      <ImageShareOverlay imageUrl={imageUrl} filename={filename} favorite={favorite} notify={notify} onFavoriteChange={onFavoriteChange} />
      {own && <span className="pointer-events-none absolute bottom-14 left-2 rounded-full bg-black/60 px-2 py-1 text-mini font-bold text-white backdrop-blur">{t('自建样张')}</span>}
      {total > 1 && <>
        <button data-card-action="true" type="button" aria-label={t('上一张')} disabled={index === 0} onClick={event => { event.stopPropagation(); move(-1); }} className="gallery-cover-navigation hover-reveal-touch mobile-touch absolute bottom-2 left-2 rounded-full bg-black/65 p-2 text-white backdrop-blur disabled:opacity-35"><ChevronLeft className="h-4 w-4" /></button>
        <button data-card-action="true" type="button" aria-label={t('下一张')} disabled={index >= total - 1} onClick={event => { event.stopPropagation(); move(1); }} className="gallery-cover-navigation hover-reveal-touch mobile-touch absolute bottom-2 right-2 rounded-full bg-black/65 p-2 text-white backdrop-blur disabled:opacity-35"><ChevronRight className="h-4 w-4" /></button>
      </>}
    </> : <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center text-gray-400">
      <ImageIcon className="h-6 w-6" />
      <span className="text-micro">{imageError ? t('样张图片加载失败') : error || sampleStatusText || t('暂无样张')}</span>
      {(error || imageError) && <button type="button" data-card-action="true" onClick={event => { event.stopPropagation(); setLookupResult(undefined); setImageError(false); setRetry(current => current + 1); }} className="mobile-touch rounded-lg border border-gray-300 px-2 py-1 text-xs dark:border-gray-700">{t('重试')}</button>}
      {(!hasPackSample || lookup?.imageCount === 0) && !ownSamples.length && <div className="flex items-center gap-1"><button type="button" data-card-action="true" onClick={event => { event.stopPropagation(); onSupplement(); }} className="mobile-touch rounded-lg border border-gray-300 px-2 py-1 text-xs hover:border-indigo-400 hover:text-indigo-500 dark:border-gray-700">{t('补充样张')}</button>{onSettings && <button type="button" data-card-action="true" aria-label={t('补图生成设置')} title={t('补图生成设置')} onClick={event => { event.stopPropagation(); onSettings(); }} className="mobile-touch rounded-lg p-2 hover:text-indigo-500"><Settings2 className="h-4 w-4" /></button>}</div>}
    </div>}
  </div>;
};
