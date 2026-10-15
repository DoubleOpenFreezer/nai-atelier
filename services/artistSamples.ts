import type { NAIParams } from '../types';
import { notifyLanAccessRequired, parseErrorResponse } from './api';
import { t } from './i18n';
import { getArtistDictionaryEntriesAt, getArtistDictionaryPage, type ArtistDictionaryEntry } from './tagDictionary';

export type ArtistSamplePack = 'v45' | 'v5';
export interface ArtistSampleTemplate { prompt: string; negativePrompt: string; params: NAIParams }
export interface ArtistOwnSample extends ArtistSampleTemplate { id: string; tag: string; pack: ArtistSamplePack; imageUrl: string; createdAt: number }
export interface ArtistSamplePackStatus {
  id: ArtistSamplePack;
  label: string;
  filename: string;
  path?: string;
  phase: 'unconfigured' | 'indexing' | 'ready' | 'error';
  progress: number;
  processedBytes: number;
  totalBytes: number;
  count: number;
  revision: string;
  error?: string;
  managed?: boolean;
  download?: {
    stage: 'missing' | 'downloading' | 'verifying' | 'paused' | 'error' | 'ready';
    receivedBytes: number;
    totalBytes: number;
    error?: string;
  };
}
export interface ArtistSampleStatus { available: boolean; canManage: boolean; packs: ArtistSamplePackStatus[]; downloadDirectory?: string }
export interface ArtistSampleCatalog { pack: ArtistSamplePack; revision: string; tags: string[] }
export interface ArtistSampleLookup { pack: ArtistSamplePack; revision: string; tag: string; imageCount: number; sourceUrl: string }
export const ARTIST_SAMPLES_CHANGED = 'nai-artist-samples-changed';
export const broadcastArtistSamplesChanged = () => { window.dispatchEvent(new Event(ARTIST_SAMPLES_CHANGED)); };

const request = async <T>(path: string, init: RequestInit = {}, timeout = 15_000): Promise<T> => {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  init.signal?.addEventListener('abort', cancel, { once: true });
  if (init.signal?.aborted) cancel();
  const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  try {
    const response = await fetch(`/api/artist-samples/${path}`, { ...init, signal: controller.signal });
    notifyLanAccessRequired(response);
    if (!response.ok) {
      if (path === 'status' && response.status === 404) throw new Error(t('本地图包仅支持电脑端及局域网访问'));
      throw await parseErrorResponse(response);
    }
    return await response.json() as T;
  } catch (error) {
    if (timedOut) throw new Error(t('读取画师样张超时，请重试'));
    throw error;
  } finally { window.clearTimeout(timer); init.signal?.removeEventListener('abort', cancel); }
};

export const getArtistSampleStatus = (signal?: AbortSignal) => request<ArtistSampleStatus>('status', { signal });
export const getArtistSampleCatalog = (pack: ArtistSamplePack) => request<ArtistSampleCatalog>(`catalog?${new URLSearchParams({ pack })}`);
export const getArtistSampleLookup = (pack: ArtistSamplePack, tag: string, signal?: AbortSignal) => request<ArtistSampleLookup>(`lookup?${new URLSearchParams({ pack, tag })}`, { signal });
export const buildArtistSampleImageUrl = (pack: ArtistSamplePack, tag: string, index: number, revision: string) => `/api/artist-samples/image?${new URLSearchParams({ pack, tag, index: String(index), revision })}`;
export type ArtistSamplePackAction = 'pick' | 'cancel' | 'reindex' | 'remove' | 'download' | 'pause';
export const controlArtistSamplePack = async (action: ArtistSamplePackAction, pack: ArtistSamplePack) => {
  const result = await request<{ cancelled?: boolean; status: ArtistSampleStatus }>('control', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nai-local-control': 'true' }, body: JSON.stringify({ action, pack }),
  }, action === 'pick' ? 310_000 : 15_000);
  if (!result.cancelled) broadcastArtistSamplesChanged();
  return result;
};

export const normalizeArtistSampleTag = (tag: string) => tag.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
let dictionaryPromise: Promise<ArtistDictionaryEntry[]> | undefined;
/** 一次读取轻量目录，底层仍复用词库分片缓存；样张交集不受列表已加载页数限制。 */
export const getArtistSampleDictionary = () => {
  if (!dictionaryPromise) dictionaryPromise = getArtistDictionaryPage(0).then(first => getArtistDictionaryEntriesAt(Array.from({ length: first.total }, (_, index) => index)))
    .catch(error => { dictionaryPromise = undefined; throw error; });
  return dictionaryPromise;
};

/** 精确匹配唯一名称；冲突条目不通过归一化猜测归属。 */
export const matchArtistSampleTags = (entries: ArtistDictionaryEntry[], tags: string[]) => {
  const unique = (names: string[]) => {
    const matches = new Map<string, Set<string>>();
    names.forEach(name => { const key = normalizeArtistSampleTag(name); if (!matches.has(key)) matches.set(key, new Set()); matches.get(key)!.add(name); });
    return new Set([...matches].filter(([key, names]) => key && names.size === 1).map(([key]) => key));
  };
  const exact = new Set(tags);
  const known = unique(entries.map(entry => entry.name)), samples = unique(tags);
  return entries.filter(entry => exact.has(entry.name) || (known.has(normalizeArtistSampleTag(entry.name)) && samples.has(normalizeArtistSampleTag(entry.name))));
};
