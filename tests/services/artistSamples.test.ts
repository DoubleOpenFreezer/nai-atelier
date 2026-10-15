// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ARTIST_SAMPLES_CHANGED, buildArtistSampleImageUrl, controlArtistSamplePack, getArtistSampleCatalog, getArtistSampleDictionary, getArtistSampleLookup, getArtistSampleStatus, matchArtistSampleTags, normalizeArtistSampleTag } from '../../services/artistSamples';
import { getArtistDictionaryEntriesAt, getArtistDictionaryPage } from '../../services/tagDictionary';
vi.mock('../../services/tagDictionary', () => ({ getArtistDictionaryPage: vi.fn(), getArtistDictionaryEntriesAt: vi.fn() }));
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('状态、目录、lookup与图片URL保留原Tag、模型包和revision，查询只走本地接口', async () => {
  vi.mocked(fetch).mockImplementation(async url => response({ endpoint: String(url) }));
  await getArtistSampleStatus(); await getArtistSampleCatalog('v5'); await getArtistSampleLookup('v45', 'artist name (x)');
  expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual(['/api/artist-samples/status', '/api/artist-samples/catalog?pack=v5', '/api/artist-samples/lookup?pack=v45&tag=artist+name+%28x%29']);
  const url = new URL(buildArtistSampleImageUrl('v5', 'artist name (x)', 2, 'revision & one'), 'http://synthetic.local');
  expect(url.pathname).toBe('/api/artist-samples/image');
  expect(Object.fromEntries(url.searchParams)).toEqual({ pack: 'v5', tag: 'artist name (x)', index: '2', revision: 'revision & one' });
});

it('控制接口只有显式动作与local-control头，取消选择不广播变更', async () => {
  const changed = vi.fn(); window.addEventListener(ARTIST_SAMPLES_CHANGED, changed);
  try {
    vi.mocked(fetch).mockResolvedValueOnce(response({ status: { packs: [] } })).mockResolvedValueOnce(response({ cancelled: true, status: { packs: [] } }));
    await controlArtistSamplePack('reindex', 'v5'); await controlArtistSamplePack('pick', 'v45');
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/artist-samples/control', expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nai-local-control': 'true' }, body: JSON.stringify({ action: 'reindex', pack: 'v5' }) }));
    expect(changed).toHaveBeenCalledOnce();
  } finally { window.removeEventListener(ARTIST_SAMPLES_CHANGED, changed); }
});

it('后台下载与暂停使用control动作，并广播设置状态变化', async () => {
  const changed = vi.fn(); window.addEventListener(ARTIST_SAMPLES_CHANGED, changed);
  try {
    vi.mocked(fetch).mockResolvedValueOnce(response({ status: { packs: [] } })).mockResolvedValueOnce(response({ status: { packs: [] } }));
    await controlArtistSamplePack('download', 'v45');
    await controlArtistSamplePack('pause', 'v45');
    expect(vi.mocked(fetch).mock.calls.map(([url, init]) => ({ url: String(url), body: (init as RequestInit).body }))).toEqual([
      { url: '/api/artist-samples/control', body: JSON.stringify({ action: 'download', pack: 'v45' }) },
      { url: '/api/artist-samples/control', body: JSON.stringify({ action: 'pause', pack: 'v45' }) },
    ]);
    expect(changed).toHaveBeenCalledTimes(2);
  } finally { window.removeEventListener(ARTIST_SAMPLES_CHANGED, changed); }
});

it('后端错误保留具体原因，不伪装为无样张', async () => {
  vi.mocked(fetch).mockResolvedValue(response({ error: '合成索引损坏', code: 'SYNTHETIC_INDEX' }, 409));
  await expect(getArtistSampleCatalog('v5')).rejects.toMatchObject({ message: '合成索引损坏', status: 409, code: 'SYNTHETIC_INDEX' });
});

it('未提供图包能力的状态404提示支持平台，不把NotFound当成已配置的空目录', async () => {
  vi.mocked(fetch).mockResolvedValue(response({ error: 'Not Found' }, 404));
  await expect(getArtistSampleStatus()).rejects.toThrow('本地图包仅支持电脑端及局域网访问');
});

it.each([['lookup', 15_000], ['picker', 310_000]] as const)('%s 请求使用确定的超时，选择窗口不会被15秒提前取消', async (kind, timeout) => {
  vi.useFakeTimers();
  let signal!: AbortSignal;
  vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => { signal = init!.signal as AbortSignal; signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); }));
  const pending = kind === 'picker' ? controlArtistSamplePack('pick', 'v5') : getArtistSampleLookup('v5', 'sample');
  const rejected = expect(pending).rejects.toThrow('读取画师样张超时，请重试');
  if (kind === 'picker') { await vi.advanceTimersByTimeAsync(15_000); expect(signal.aborted).toBe(false); }
  await vi.advanceTimersByTimeAsync(kind === 'picker' ? timeout - 15_000 : timeout); await rejected;
});

it('外部取消可终止状态与lookup，取消不改成超时', async () => {
  vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); }));
  const controller = new AbortController();
  const status = getArtistSampleStatus(controller.signal), lookup = getArtistSampleLookup('v5', 'sample', controller.signal);
  const checks = [expect(status).rejects.toMatchObject({ name: 'AbortError' }), expect(lookup).rejects.toMatchObject({ name: 'AbortError' })];
  controller.abort(); await Promise.all(checks);
});

it('完整轻量目录通过既有分片入口加载一次，包含首个分页之外的画师', async () => {
  vi.mocked(getArtistDictionaryPage).mockResolvedValue({ page: 0, pageCount: 2, pageSize: 100, total: 101, entries: [] });
  vi.mocked(getArtistDictionaryEntriesAt).mockResolvedValue([{ name: 'last artist', chinese: '', postCount: 1 }]);
  const first = getArtistSampleDictionary(), second = getArtistSampleDictionary();
  expect(first).toBe(second); await expect(first).resolves.toEqual([{ name: 'last artist', chinese: '', postCount: 1 }]);
  expect(getArtistDictionaryEntriesAt).toHaveBeenCalledWith(Array.from({ length: 101 }, (_, index) => index));
  expect(getArtistDictionaryPage).toHaveBeenCalledOnce();
});

it('原名精确匹配优先；下划线、空白与大小写唯一匹配，冲突或未知包键不造画师', () => {
  expect(normalizeArtistSampleTag('  Artist__Name \t ')).toBe('artist name');
  const entries = ['foo_bar', 'foo bar', 'mizu', 'missing'].map(name => ({ name, chinese: '', postCount: 1 }));
  expect(matchArtistSampleTags(entries, ['foo_bar', 'MIZU', 'not in dictionary']).map(entry => entry.name)).toEqual(['foo_bar', 'mizu']);
  expect(matchArtistSampleTags([{ name: 'artist name', chinese: '', postCount: 1 }], ['Artist__Name']).map(entry => entry.name)).toEqual(['artist name']);
  expect(matchArtistSampleTags([{ name: 'mizu', chinese: '', postCount: 1 }], ['Mizu', 'MIZU'])).toEqual([]);
});
