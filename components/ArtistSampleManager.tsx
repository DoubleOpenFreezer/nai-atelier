import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Database, Download, FolderOpen, Pause, RotateCw, X } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import { ToolbarPopover, TOOLBAR_MENU_CLASS } from './ToolbarPopover';
import {
  broadcastArtistSamplesChanged, controlArtistSamplePack, getArtistSampleStatus,
  type ArtistSamplePack, type ArtistSamplePackAction, type ArtistSamplePackStatus, type ArtistSampleStatus,
} from '../services/artistSamples';

const PACKS: ArtistSamplePack[] = ['v45', 'v5'];
const PACKAGE_INFO = {
  v45: { filename: 'artist_thumbnail_nai', size: '2.73 GB' },
  v5: { filename: 'NAID5-33000-55000-Curated', size: '1.03 GB' },
} satisfies Record<ArtistSamplePack, { filename: string; size: string }>;

const emptyStatus: ArtistSampleStatus = { available: false, canManage: false, packs: [] };

export const ArtistSampleManager: React.FC = () => {
  useLanguage();
  const [status, setStatus] = useState<ArtistSampleStatus>(emptyStatus);
  const [statusError, setStatusError] = useState('');
  const [busy, setBusy] = useState<Partial<Record<ArtistSamplePack, string>>>({});
  const [actionErrors, setActionErrors] = useState<Partial<Record<ArtistSamplePack, string>>>({});
  const activeRef = useRef(true);
  const statusRef = useRef(status);

  const acceptStatus = useCallback((next: ArtistSampleStatus, notifyReady = false) => {
    const previous = statusRef.current;
    const becameReady = next.packs.some(pack => {
      if (pack.phase !== 'ready') return false;
      const prior = previous.packs.find(item => item.id === pack.id);
      return prior?.phase !== 'ready' || (pack.managed === true && prior.managed !== true);
    });
    statusRef.current = next;
    setStatus(next);
    setStatusError('');
    if (notifyReady && becameReady) broadcastArtistSamplesChanged();
  }, []);

  const readStatus = useCallback(async (signal?: AbortSignal, notifyReady = false) => {
    try {
      const next = await getArtistSampleStatus(signal);
      if (activeRef.current) acceptStatus(next, notifyReady);
      return next;
    } catch (error) {
      if (activeRef.current && !signal?.aborted) setStatusError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [acceptStatus]);

  useEffect(() => {
    activeRef.current = true;
    const controller = new AbortController();
    void readStatus(controller.signal).catch(() => {});
    return () => { activeRef.current = false; controller.abort(); };
  }, [readStatus]);

  useEffect(() => {
    const isDownloading = status.packs.some(pack => ['downloading', 'verifying'].includes(pack.download?.stage || ''));
    const isIndexing = status.packs.some(pack => pack.phase === 'indexing');
    if (!isDownloading && !isIndexing) return;
    let active = true;
    const controller = new AbortController();
    let timer: number;
    const delay = isDownloading ? 1000 : 1500;
    const poll = async () => {
      try { await readStatus(controller.signal, true); } catch { /* 读取失败后按正常间隔重试状态，不重启下载任务。 */ }
      if (active && !controller.signal.aborted) timer = window.setTimeout(() => void poll(), delay);
    };
    timer = window.setTimeout(() => void poll(), delay);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [status.packs.some(pack => pack.phase === 'indexing'), status.packs.some(pack => ['downloading', 'verifying'].includes(pack.download?.stage || '')), readStatus]);

  const act = async (action: ArtistSamplePackAction, pack: ArtistSamplePack) => {
    setBusy(current => ({ ...current, [pack]: action }));
    setActionErrors(current => ({ ...current, [pack]: undefined }));
    try {
      const result = await controlArtistSamplePack(action, pack);
      if (activeRef.current && result.status) acceptStatus(result.status, action === 'download');
    } catch (error) {
      if (activeRef.current) setActionErrors(current => ({ ...current, [pack]: error instanceof Error ? error.message : String(error) }));
    } finally { if (activeRef.current) setBusy(current => ({ ...current, [pack]: '' })); }
  };

  const title = t('画师预览图库');
  const packData = status.packs;
  const activeDownloadPack = packData.find(pack => ['downloading', 'verifying'].includes(pack.download?.stage || ''))?.id;
  const pickBusy = Object.values(busy).includes('pick');
  return <section aria-label={title} className="space-y-3 border-b border-gray-200 pb-5 dark:border-gray-700">
    <div className="flex items-start gap-2"><Database className="mt-0.5 h-4 w-4 flex-none text-indigo-500" /><div><h4 className="font-semibold text-gray-900 dark:text-white">{title}</h4></div></div>
    {status.canManage === false && status.available && <p className="text-xs text-gray-500 dark:text-gray-400">{t('图包下载与本地文件操作需在工坊电脑进行。')}</p>}
    {statusError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{statusError} <button type="button" className="mobile-touch font-semibold underline" onClick={() => void readStatus().catch(() => {})}>{t('重试读取状态')}</button></p>}
    {PACKS.map((pack, index) => {
      const item: ArtistSamplePackStatus | undefined = packData.find(entry => entry.id === pack);
      const canManageFiles = status.canManage;
      const pending = busy[pack];
      const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
      const path = item?.path || '';
      const linked = Boolean(item?.path);
      const packageInfo = PACKAGE_INFO[pack];
      const download = item?.download;
      const percent = download && download.totalBytes > 0 ? Math.min(100, Math.round(download.receivedBytes / download.totalBytes * 100)) : 0;
      const anotherDownload = Boolean(activeDownloadPack && activeDownloadPack !== pack);
      const downloading = download?.stage === 'downloading';
      const verifying = download?.stage === 'verifying';
      const packageReady = download?.stage === 'ready' && item?.managed === true;
      const mainAction: ArtistSamplePackAction | undefined = downloading || verifying ? 'pause' : (download?.stage === 'paused' || download?.stage === 'error' || download?.stage === 'ready' || !download || download.stage === 'missing') ? 'download' : undefined;
      const mainLabel = !canManageFiles ? t('仅工坊电脑可操作')
        : pending === 'download' ? t('正在启动下载…')
        : pending === 'pause' ? t('正在暂停…')
        : pending === 'pick' ? t('正在选择文件…')
        : item?.phase === 'indexing' ? t('正在建立索引…')
        : downloading || verifying ? t('暂停下载')
        : download?.stage === 'paused' ? t('继续下载')
        : download?.stage === 'error' ? t('重试下载')
        : packageReady && item?.phase === 'ready' ? t('已下载')
        : packageReady && item?.phase === 'error' ? t('重试下载')
        : download?.stage === 'ready' ? t('使用已下载图包')
        : t('下载图包 · 约 {0}', [packageInfo.size]);
      const mainDisabled = !canManageFiles || Boolean(pending) || anotherDownload || pickBusy || item?.phase === 'indexing' || (packageReady && item?.phase === 'ready');
      return <div key={pack} className={`${index === PACKS.length - 1 ? '' : 'border-b border-gray-100 pb-3 dark:border-gray-800'}`}>
        <div className="flex min-w-0 items-center gap-2"><div className="min-w-0 flex-1"><span className="text-sm font-bold text-gray-800 dark:text-gray-100">NovelAI {pack === 'v45' ? 'V4.5' : 'V5'}</span><p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{downloading || verifying ? (verifying ? t('正在校验图包…') : t('图包下载中：{0}%', [percent])) : item?.phase === 'ready' ? t('可用 · {0} 个画师 Tag', [item.count]) : item?.phase === 'indexing' ? t('样张索引中：{0}%', [Math.round(item.progress)]) : download?.stage === 'paused' ? t('已暂停') : item?.phase === 'error' ? t('索引失败') : download?.stage === 'ready' ? t('未启用') : t('未下载')}</p></div>
          <button type="button" className={`mobile-touch flex-none inline-flex items-center rounded-lg px-2.5 py-2 text-xs font-semibold ${mainDisabled ? 'appearance-group bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500' : 'bg-indigo-600 text-white hover:bg-indigo-500'}`} onClick={() => mainAction && void act(mainAction, pack)} disabled={mainDisabled} aria-label={mainLabel}>
          {mainAction === 'pause' ? <Pause className="mr-1 h-3.5 w-3.5" /> : <Download className="mr-1 h-3.5 w-3.5" />}{mainLabel}
          </button>
          {canManageFiles && <ToolbarPopover label={t('图包管理')} title={t('图包管理')} icon={<MoreHorizontal />} iconOnly width={300} disabled={Boolean(pending) || pickBusy}>
            {close => <div className="space-y-1"><p className="break-all px-3 py-2 text-xs text-gray-500">{path || packageInfo.filename}<br />{t('Hugging Face · 约 {0}', [packageInfo.size])}</p>
              <button type="button" className={TOOLBAR_MENU_CLASS} disabled={Boolean(activeDownloadPack) || item?.phase === 'indexing'} onClick={() => { close(); void act('pick', pack); }}><FolderOpen />{t('使用本地文件')}</button>
              {item?.phase === 'indexing' ? <button type="button" className={TOOLBAR_MENU_CLASS} onClick={() => { close(); void act('cancel', pack); }}><X />{t('取消索引')}</button> : <>
                <button type="button" className={TOOLBAR_MENU_CLASS} disabled={!linked || downloading || verifying} onClick={() => { close(); void act('reindex', pack); }}><RotateCw />{t('重新建立索引')}</button>
                <button type="button" className={TOOLBAR_MENU_CLASS + ' !text-red-600 dark:!text-red-300'} disabled={!linked || Boolean(activeDownloadPack)} onClick={() => { close(); void act('remove', pack); }}><X />{t('解除关联（不删文件）')}</button>
              </>}
            </div>}
          </ToolbarPopover>}
        </div>
        {download && ['downloading', 'verifying', 'paused'].includes(download.stage) && <div className="mt-2 text-xs text-gray-500 dark:text-gray-400"><div className="flex items-center justify-between gap-2"><span>{verifying ? t('正在校验图包…') : t('已接收 {0} / {1} · {2}%', [formatBytes(download.receivedBytes), download.totalBytes > 0 ? formatBytes(download.totalBytes) : t('未知大小'), percent])}</span>{download.stage === 'paused' && <span>{t('已暂停')}</span>}</div><div role="progressbar" aria-label={verifying ? t('正在校验图包…') : t('图包下载进度')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"><div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${percent}%` }} /></div></div>}
        {(download?.stage === 'error' && download.error || actionErrors[pack]) && <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-300">{actionErrors[pack] || download?.error}</p>}
        {item?.phase === 'error' && item.error && <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-300">{item.error}</p>}
        {item?.phase === 'indexing' && !downloading && !verifying && <div role="progressbar" aria-label={t('正在建立索引')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, item.progress))} className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"><div className="h-full bg-indigo-500" style={{ width: Math.max(0, Math.min(100, item.progress)) + '%' }} /></div>}
      </div>;
    })}
    {!status.available && !statusError && <p className="text-xs text-gray-500 dark:text-gray-400">{t('正在读取样张图库状态…')}</p>}
  </section>;
};
