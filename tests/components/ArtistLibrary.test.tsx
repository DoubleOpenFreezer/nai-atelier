// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtistLibrary } from '../../components/ArtistLibrary';
import { ARTIST_SAMPLES_CHANGED } from '../../services/artistSamples';
import { clearImageDisplayPageOverride, getMobileImageDisplayPreferences, setMobileImageDisplayPreferences } from '../../services/imageDisplayPreferences';
const mocks = vi.hoisted(() => ({ status: vi.fn(), catalog: vi.fn(), dictionary: vi.fn(), data: vi.fn(), prepare: vi.fn(), page: vi.fn(), search: vi.fn(), focus: vi.fn(), control: vi.fn() }));
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
vi.mock('../../services/artistSamples', async original => ({ ...await original<typeof import('../../services/artistSamples')>(), getArtistSampleStatus: mocks.status, getArtistSampleCatalog: mocks.catalog, getArtistSampleDictionary: mocks.dictionary, controlArtistSamplePack: mocks.control }));
vi.mock('../../services/artistSampleDrafts', async original => ({ ...await original<typeof import('../../services/artistSampleDrafts')>(), getArtistSampleData: mocks.data, prepareArtistSampleImport: mocks.prepare }));
vi.mock('../../components/ArtistSampleSettingsDialog', () => ({ ArtistSampleSettingsDialog: ({ tag, pack, enterAfterSave, onSaved, onClose }: any) => <div role="dialog" aria-label="补图生成设置"><span>{tag} {pack}</span><button onClick={() => onSaved({ prompt: 'artist:{artist}', negativePrompt: '', params: { model: pack === 'v45' ? 'nai-diffusion-4-5-full' : 'nai-diffusion-5-full', seed: 1 } })}>{enterAfterSave ? '保存并进入实验室' : '保存配置'}</button><button onClick={onClose}>取消</button></div> }));
vi.mock('../../services/tagDictionary', async original => ({ ...await original<typeof import('../../services/tagDictionary')>(), getArtistDictionaryPage: mocks.page, searchArtistDictionary: mocks.search }));
vi.mock('../../services/collectionFavorites', () => ({ collectionSnapshot: () => [], subscribeCollection: () => () => {} }));
vi.mock('../../components/ArtistSampleCover', () => ({ ArtistSampleCover: ({ tag, pack, hasPackSample, ownSamples, onSupplement, onSettings, imageClassName }: any) => <div data-testid={'cover-' + tag} data-pack={pack} data-own={ownSamples.length} data-image-class={imageClassName}>{(hasPackSample || ownSamples.length > 0) && <><img alt={tag} src={'/synthetic-' + pack + '.png'} /><div data-card-action="true" onClick={event => event.stopPropagation()}><button aria-label="收藏">收藏</button></div></>}{!hasPackSample && !ownSamples.length && <button data-card-action="true" onClick={event => { event.stopPropagation(); onSupplement(); }}>补充样张</button>}{!hasPackSample && !ownSamples.length && <button data-card-action="true" aria-label="补图生成设置" onClick={event => { event.stopPropagation(); onSettings(); }}>设置</button>}</div> }));
vi.mock('../../components/ShortestColumnMasonry', async original => ({ ...await original<typeof import('../../components/ShortestColumnMasonry')>(), ShortestColumnMasonry: ({ items, columns, renderItem }: any) => <div data-testid="masonry" data-columns={columns}>{items.map(renderItem)}</div> }));
vi.mock('../../components/useGallerySelectionAnchor', () => ({ useGallerySelectionAnchor: (_a: unknown, _b: unknown, focused: string | null) => { mocks.focus(focused); return { hasAnchor: false, onScroll: () => {} }; } }));
vi.mock('../../components/useKeepAliveScrollRestore', () => ({ useKeepAliveScrollRestore: () => () => {} }));
const entries = [
  { name: 'alpha artist', chinese: '画师甲', postCount: 30 },
  { name: 'beta artist', chinese: '画师乙', postCount: 20 },
  { name: 'missing artist', chinese: '缺图画师', postCount: 10 },
];
const template = { prompt: 'artist:{artist}', negativePrompt: '', params: { model: 'nai-diffusion-4-5-full', seed: 1, width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral' } };
const status = (phase = 'ready', error?: string) => ({ available: true, canManage: true, packs: ['v45', 'v5'].map(id => ({ id, label: id, filename: id + '.tar', phase, progress: 25, count: 2, revision: id + '-one', error })) });
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear();
  mocks.status.mockResolvedValue(status());
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, revision: pack + '-one', tags: pack === 'v45' ? ['alpha_artist', 'unknown archive key'] : ['alpha_artist', 'beta artist'] }));
  mocks.dictionary.mockResolvedValue(entries); mocks.data.mockResolvedValue({ templates: {}, samples: [] });
  mocks.page.mockResolvedValue({ entries, page: 0, pageCount: 1, pageSize: 100, total: entries.length });
  mocks.search.mockImplementation(async (query: string) => entries.filter(entry => entry.name.includes(query)));
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', (media: string) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo); else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo; });
const setup = () => { const notify = vi.fn(), navigate = vi.fn(); const view = render(<ArtistLibrary artistsData={[]} notify={notify} onNavigateToPlayground={navigate} />); return { ...view, notify, navigate }; };
const sampleCards = () => screen.queryAllByRole('button', { name: /^选择画师：/ });
const disableSampleFilter = () => { fireEvent.click(screen.getByRole('button', { name: /^筛选/ })); fireEvent.click(screen.getByRole('checkbox', { name: '只看有样张' })); fireEvent.keyDown(window, { key: 'Escape' }); };

it.each(['masonry', 'portrait', 'square'] as const)('%s画师布局跟随全局5列，角色覆盖不串页，自己的覆盖可清除', async layout => {
  setMobileImageDisplayPreferences({ layout, columns: 3, desktopColumns: 5 });
  setMobileImageDisplayPreferences({ layout: 'square', columns: 1, desktopColumns: 1 }, 'characters');
  const { container } = setup();
  await screen.findByTestId('cover-alpha artist');
  const expectColumns = (count: number) => {
    if (layout === 'masonry') expect(screen.getByTestId('masonry').getAttribute('data-columns')).toBe(String(count));
    else expect((container.querySelector('.workspace-artist-grid') as HTMLElement).style.getPropertyValue('--mobile-gallery-columns')).toBe(String(count));
  };
  expectColumns(5);
  act(() => setMobileImageDisplayPreferences({ layout, columns: 1, desktopColumns: 2 }, 'artists'));
  expectColumns(2);
  expect(getMobileImageDisplayPreferences('characters').desktopColumns).toBe(1);
  act(() => clearImageDisplayPageOverride('artists'));
  expectColumns(5);
});

it.each([390, 1280])('宽度 %s 默认只显示当前包与真实词库交集，model segmented常驻，旧封面和未知包key不冒充样张', async width => {
  vi.stubGlobal('innerWidth', width);
  const { container } = setup();
  await screen.findByTestId('cover-alpha artist');
  expect(sampleCards()).toHaveLength(1); expect(screen.queryByTestId('cover-unknown archive key')).toBeNull();
  const model = screen.getByRole('group', { name: '画师样张模型' }); expect(container.querySelector('header')!.contains(model)).toBe(true);
  expect(screen.getByRole('button', { name: 'V4.5' }).getAttribute('aria-pressed')).toBe('true');
  expect(mocks.dictionary).toHaveBeenCalledOnce(); expect(mocks.catalog).toHaveBeenCalledWith('v45');
});

it('来源切换保留搜索、选中Tag与focus，选择保存本端，匹配字典不会因第一页无图而空', async () => {
  mocks.page.mockResolvedValue({ entries: [entries[2]], total: 300, page: 0, pageCount: 3, pageSize: 100 });
  const { unmount } = setup();
  fireEvent.click(await screen.findByRole('button', { name: '选择画师：alpha artist' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'alpha' } });
  fireEvent.click(screen.getByRole('button', { name: '选择画师：alpha artist' }));
  fireEvent.click(screen.getByRole('button', { name: '选择画师：alpha artist' }));
  expect(mocks.focus).toHaveBeenLastCalledWith('alpha artist');
  fireEvent.click(screen.getByRole('button', { name: 'V5' }));
  await waitFor(() => expect(screen.getByTestId('cover-alpha artist').getAttribute('data-pack')).toBe('v5'));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('alpha');
  expect(screen.getByRole('button', { name: '选择画师：alpha artist' }).getAttribute('aria-pressed')).toBe('true');
  expect(mocks.focus).toHaveBeenLastCalledWith('alpha artist'); expect(localStorage.getItem('nai_artist_sample_pack')).toBe('v5');
  unmount(); setup(); expect(screen.getByRole('button', { name: 'V5' }).getAttribute('aria-pressed')).toBe('true');
});

it.each([390, 1280])('宽度%s时图包样张和自建样张点击都选择画师，分享控件不选择，抽卡列表仍可选择', async width => {
  vi.stubGlobal('innerWidth', width);
  localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout: 'masonry' }));
  mocks.data.mockResolvedValue({ templates: {}, samples: [{ id: 'own-beta', tag: 'beta artist', pack: 'v45', imageUrl: '/own.png', createdAt: 1, ...template }] });
  const { container } = setup();
  await screen.findByTestId('cover-alpha artist');
  expect(screen.getByTestId('cover-alpha artist').getAttribute('data-image-class')).toBe('h-full w-full object-contain');
  const alpha = screen.getByRole('button', { name: '选择画师：alpha artist' });
  fireEvent.click(screen.getByRole('img', { name: 'alpha artist' }));
  expect(alpha.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(alpha).getByText('alpha artist'));
  expect(alpha.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(screen.getByRole('img', { name: 'alpha artist' }));
  expect(alpha.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(alpha).getByRole('button', { name: '收藏' }));
  expect(alpha.getAttribute('aria-pressed')).toBe('true');
  const beta = screen.getByRole('button', { name: '选择画师：beta artist' });
  fireEvent.keyDown(beta, { key: 'Enter' }); expect(beta.getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(beta, { key: ' ' }); expect(beta.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: '随机抽卡' }));
  const gachaCard = sampleCards()[0];
  const gachaImage = within(gachaCard).queryByRole('img');
  const wasSelected = gachaCard.getAttribute('aria-pressed');
  if (gachaImage) fireEvent.click(gachaImage);
  else fireEvent.click(gachaCard);
  expect(gachaCard.getAttribute('aria-pressed')).not.toBe(wasSelected);
  expect(container.querySelectorAll('[data-testid^="cover-"]').length).toBeGreaterThan(0);
});

it('关闭只看样张可以发现缺图Tag，补充只导入用户已保存的当前模板，不提交生图', async () => {
  mocks.data.mockResolvedValue({ templates: { v45: template }, samples: [] });
  const { navigate } = setup(); await screen.findByTestId('cover-alpha artist'); disableSampleFilter();
  fireEvent.click((await screen.findByTestId('cover-missing artist')).querySelector('button')!);
  expect(mocks.prepare).toHaveBeenCalledWith('missing artist', 'v45', template); expect(navigate).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: '选择画师：missing artist' }).getAttribute('aria-pressed')).toBe('false');
});

it('没有模板首次配置后带入准确目标，打开和取消不自动生成', async () => {
  const { notify, navigate } = setup(); await screen.findByTestId('cover-alpha artist'); disableSampleFilter();
  fireEvent.click((await screen.findByTestId('cover-missing artist')).querySelector('button')!);
  expect(screen.getByRole('dialog', { name: '补图生成设置' })).toBeTruthy();
  expect(notify).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'V5' }));
  fireEvent.click(screen.getByRole('button', { name: '保存并进入实验室' }));
  expect(mocks.prepare).toHaveBeenCalledWith('missing artist', 'v45', expect.objectContaining({ params: expect.objectContaining({ model: 'nai-diffusion-4-5-full' }) }));
  expect(navigate).toHaveBeenCalledOnce();
});

it('未配置图包仍可显示当前pack自建样张，变更事件重新读取而不清搜索', async () => {
  mocks.status.mockResolvedValue(status('unconfigured'));
  mocks.data.mockResolvedValue({ templates: {}, samples: [{ id: 'own', tag: 'beta artist', pack: 'v45', imageUrl: '/synthetic.png', createdAt: 1, ...template }] });
  setup(); await screen.findByTestId('cover-beta artist');
  expect(sampleCards()).toHaveLength(1); expect(mocks.catalog).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'beta' } });
  fireEvent(window, new Event(ARTIST_SAMPLES_CHANGED));
  await waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(2));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('beta');
});

it.each(['indexing', 'error', 'unconfigured'])('来源%s状态清楚且不读未就绪图包目录', async phase => {
  mocks.status.mockResolvedValue(status(phase, phase === 'error' ? '合成索引损坏' : undefined));
  setup();
  await screen.findByText(phase === 'indexing' ? '样张索引中：25%' : phase === 'error' ? '合成索引损坏' : '该模型尚未配置样张图包');
  expect(mocks.catalog).not.toHaveBeenCalled(); expect(sampleCards()).toHaveLength(0);
});

it('超过100个样张时复用轻量分页，搜索和收藏可命中未展示的后续页，抽卡不发词库位置请求', async () => {
  const full = Array.from({ length: 150 }, (_, index) => ({ name: 'artist-' + index, chinese: '', postCount: 150 - index }));
  mocks.dictionary.mockResolvedValue(full); mocks.catalog.mockImplementation(async (pack: string) => ({ pack, revision: 'many', tags: full.map(entry => entry.name) }));
  setup(); await waitFor(() => expect(sampleCards()).toHaveLength(100));
  fireEvent.click(screen.getByRole('button', { name: '继续向下滚动加载更多' })); expect(sampleCards()).toHaveLength(150);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'artist-149' } }); expect(sampleCards()).toHaveLength(1);
  expect(screen.getByTestId('cover-artist-149')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } }); disableSampleFilter();
  fireEvent.click(screen.getByRole('button', { name: '随机抽卡' }));
  expect(sampleCards()).toHaveLength(12);
  expect(sampleCards().every(card => full.some(entry => card.getAttribute('aria-label') === '选择画师：' + entry.name))).toBe(true);
  expect(mocks.page).toHaveBeenCalledOnce();
});

it('无法读取图包时明确反馈，但关闭样张筛选仍能浏览Tag词库', async () => {
  mocks.status.mockRejectedValue(new Error('本地图包仅支持电脑端及局域网访问'));
  setup(); await screen.findByText('本地图包仅支持电脑端及局域网访问'); disableSampleFilter();
  expect(await screen.findByTestId('cover-missing artist')).toBeTruthy();
});

const downloadingStatus = (stage: 'downloading' | 'verifying' | 'paused' | 'error', phase = 'unconfigured') => ({
  ...status(phase), packs: status(phase).packs.map(pack => ({ ...pack, managed: true, download: { stage, receivedBytes: 25, totalBytes: 100, error: stage === 'error' ? '合成网络错误' : undefined } })),
});
const poll = () => act(async () => { await vi.advanceTimersByTimeAsync(2000); });

it('关闭设置无需广播，在库页跟随下载、校验、索引到就绪自动展示并停止轮询', async () => {
  mocks.status.mockResolvedValueOnce(downloadingStatus('downloading'))
    .mockResolvedValueOnce(downloadingStatus('verifying'))
    .mockResolvedValueOnce(status('indexing')).mockResolvedValue(status());
  vi.useFakeTimers(); await act(async () => { setup(); });
  expect(screen.getByText('图包下载中：25%')).toBeTruthy();
  expect(screen.queryByText('该模型尚未配置样张图包')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  expect(screen.getAllByText('图包下载中：25%')).toHaveLength(2);
  fireEvent.keyDown(window, { key: 'Escape' });
  await poll(); expect(screen.getByText('正在校验图包…')).toBeTruthy();
  expect(mocks.catalog).not.toHaveBeenCalled();
  await poll(); expect(screen.getByText('样张索引中：25%')).toBeTruthy();
  await poll(); expect(screen.getByTestId('cover-alpha artist')).toBeTruthy();
  expect(mocks.status).toHaveBeenCalledTimes(4); expect(mocks.catalog).toHaveBeenCalledOnce();
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(mocks.status).toHaveBeenCalledTimes(4); expect(mocks.control).not.toHaveBeenCalled();
});

it('任一包下载时轮询，短暂状态失败保留旧样张、搜索及多选，再读就绪后停止', async () => {
  const background = status();
  const working = { ...background, packs: background.packs.map(pack => pack.id === 'v5' ? { ...pack, phase: 'unconfigured', download: { stage: 'downloading', receivedBytes: 25, totalBytes: 100 } } : pack) };
  mocks.status.mockResolvedValueOnce(working).mockRejectedValueOnce(new Error('合成读取失败')).mockResolvedValue(status());
  vi.useFakeTimers(); await act(async () => { setup(); });
  fireEvent.click(screen.getByRole('button', { name: '选择画师：alpha artist' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'alpha' } });
  await poll();
  expect(screen.getByTestId('cover-alpha artist')).toBeTruthy();
  expect(screen.getByRole('button', { name: '选择画师：alpha artist' }).getAttribute('aria-pressed')).toBe('true');
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('alpha');
  await poll(); expect(mocks.status).toHaveBeenCalledTimes(3);
  await poll(); expect(mocks.status).toHaveBeenCalledTimes(3);
  expect(mocks.control).not.toHaveBeenCalled();
});

it.each(['paused', 'error'] as const)('图包下载%s显示真实状态，暂停与错误不轮询或自动启动下载', async stage => {
  mocks.status.mockResolvedValue(downloadingStatus(stage));
  vi.useFakeTimers(); await act(async () => { setup(); });
  const message = stage === 'paused' ? '图包下载已暂停：25%' : '图包下载失败：合成网络错误';
  expect(screen.getByText(message)).toBeTruthy();
  expect(screen.queryByText('该模型尚未配置样张图包')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  expect(screen.getAllByText(message)).toHaveLength(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(mocks.status).toHaveBeenCalledOnce(); expect(mocks.catalog).not.toHaveBeenCalled(); expect(mocks.control).not.toHaveBeenCalled();
});
it('缺图卡可修改已有设置并取消或保存，不进入实验室', async () => {
  mocks.data.mockResolvedValue({ templates: { v45: template }, samples: [] });
  const { navigate } = setup(); await screen.findByTestId('cover-alpha artist'); disableSampleFilter();
  fireEvent.click((await screen.findByTestId('cover-missing artist')).querySelector('button[aria-label]')!);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('dialog', { name: '补图生成设置' })).toBeNull();
  expect(mocks.prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('cover-missing artist').querySelector('button[aria-label]')!);
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  expect(navigate).not.toHaveBeenCalled();
  expect(mocks.prepare).not.toHaveBeenCalled();
});
