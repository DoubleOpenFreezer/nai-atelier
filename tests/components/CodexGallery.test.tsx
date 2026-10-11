// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CodexBootstrap, CodexEntry, CodexImageMetadata } from '../../services/codexService';
const mocks = vi.hoisted(() => ({ bootstrap: vi.fn(), book: vi.fn(), community: vi.fn(), file: vi.fn(), metadata: vi.fn(), notify: vi.fn(), navigate: vi.fn(), create: vi.fn() }));
vi.mock('../../services/codexService', async original => ({ ...await original<typeof import('../../services/codexService')>(), loadCodexBootstrap: mocks.bootstrap, loadCodexBook: mocks.book, loadCodexCommunity: mocks.community, readCodexImageFile: mocks.file, readCodexImageMetadata: mocks.metadata }));
vi.mock('../../services/collectionFavorites', () => ({ collectionRevision: () => 0, subscribeCollection: () => () => {}, collectionTargetActive: () => false }));
vi.mock('../../components/ImageShareActions', () => ({ ImageShareOverlay: () => null }));
vi.mock('../../components/ImageLightbox', () => ({ ViewableImage: ({ src, alt, width, height, className }: React.ImgHTMLAttributes<HTMLImageElement>) => <img src={src} alt={alt} width={width} height={height} className={className} /> }));
vi.mock('../../components/SmartImage', async original => ({ ...await original<typeof import('../../components/SmartImage')>(), SmartImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
import { CodexGallery, codexCollectionImage } from '../../components/CodexGallery';
import { IMPORT_SESSION_KEY } from '../../services/metadataService';

const book = { id: 'synthetic', title: '合成书目', hasOriginal: true, type: 'codex', author: '作者', version: 'V5', entryCount: 1, originalSections: [], nsfw: false, exampleModel: '', dataUrl: '', assetBaseUrl: '', assetPathMode: '' };
const boot: CodexBootstrap = { release: 'r-abc', books: [book], media: {}, baseUrl: 'https://assets.quicktagcloud.com/data/releases/r-abc', files: {} };
const entry: CodexEntry = { key: 'codex:synthetic:one', id: 'one', source: 'codex', bookId: 'synthetic', bookTitle: '合成书目', title: '合成词条', path: ['绘画'], prompt: 'weighted prompt', negative: 'source negative', characters: [{ label: '角色', prompt: 'girl', negative: 'boy' }], note: '说明', author: '作者', sourceUrl: 'https://novelai.quicktagcloud.com/share/synthetic/one',
  images: [0, 1].map(page => ({ id: `image-${page}`, url: `https://assets.quicktagcloud.com/images/synthetic/${page}.jpg`, originalUrl: `https://assets.quicktagcloud.com/originals/synthetic/${page}.png`, width: 640, height: 960, raw: '', parameterSource: '' })), coverIndex: 0, nsfw: false, r18g: false, createdAt: 1000, likeCount: 10, updates: [], isNew: false };
const metadata: CodexImageMetadata = { prompt: 'image prompt, 1girl, bikini, standing', negativePrompt: 'image negative', rawPrompt: 'image raw prompt', rawNegative: 'image raw negative', params: { steps: 28, scale: 3, sampler: 'k_euler_ancestral', seed: 88, width: 832, height: 1216, model: 'nai-diffusion-5-full', characters: [{ id: 'original-role', prompt: 'original girl', negativePrompt: 'original boy', x: 0.2, y: 0.8 }], qualityToggle: false, ucPreset: 4 } };
const setup = (active = true, role: 'admin' | 'guest' = 'admin') => render(<CodexGallery active={active} currentUser={{ id: 'owner', username: 'user', role, createdAt: 1 }} notify={mocks.notify} onNavigateToPlayground={mocks.navigate} onCreateArtistChain={mocks.create} />);
const openOptions = () => { fireEvent.click(screen.getByRole('button', { name: '更多操作' })); return screen.getByRole('dialog', { name: '更多操作' }); };
const closeOptions = () => fireEvent.keyDown(window, { key: 'Escape' });
const ready = () => screen.findByText('image raw prompt');
const chooseSource = (name: string | RegExp) => {
  fireEvent.click(screen.getByTitle('法典来源'));
  fireEvent.click(within(screen.getByRole('dialog', { name: '法典来源' })).getByRole('button', { name }));
};
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout: 'portrait', columns: 2 }));
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', (media: string) => ({ media, matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  mocks.bootstrap.mockResolvedValue(boot); mocks.book.mockResolvedValue({ release: boot.release, entries: [entry] });
  mocks.community.mockResolvedValue({ entries: [{ ...entry, key: 'community:old', title: '旧投稿', createdAt: 1 }, { ...entry, key: 'community:new', title: '新投稿', createdAt: 2 }] });
  mocks.file.mockResolvedValue(new File(['synthetic'], 'source.png')); mocks.metadata.mockReset().mockResolvedValue(metadata);
  mocks.create.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('手机明确当前来源，全书卡片保留书名，目录和筛选独立可达并可清空结果条件', async () => {
  vi.stubGlobal('innerWidth', 390);
  mocks.bootstrap.mockResolvedValue({ ...boot, books: [book, { ...book, id: 'second', title: '另一本书' }] });
  mocks.book.mockImplementation(async value => ({ entries: [{ ...entry, key: value.id, bookId: value.id, bookTitle: value.title, title: value.id === 'second' ? '另一个词条' : entry.title, path: ['绘画', value.id === 'second' ? '白天' : '夜景'] }] }));
  setup(); await screen.findByRole('status', { name: '1 条结果' });
  expect(screen.getByTitle('法典来源').textContent).toBe('合成书目');
  expect(screen.getByTitle('法典来源').parentElement!.className).toContain('[&>button>span]:inline');
  expect(screen.getByRole('button', { name: '刷新' }).parentElement!.className).toBe('hidden sm:block');
  chooseSource('全部书目');
  await screen.findByRole('status', { name: '2 条结果' });
  expect(screen.getByTitle('法典来源').textContent).toBe('全部书目');
  expect(screen.getByText('合成书目 · 绘画 / 夜景')).toBeTruthy();
  expect(screen.getByText('另一本书 · 绘画 / 白天')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '目录' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '目录' })).getByRole('button', { name: '绘画/夜景' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('status', { name: '1 条结果' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /另一个词条/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.change(screen.getByRole('combobox', { name: '图片' }), { target: { value: 'none' } });
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  expect(screen.getByRole('button', { name: '筛选 1' })).toBeTruthy();
  expect(screen.getByRole('status', { name: '0 条结果' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
  expect(screen.getByRole('status', { name: '2 条结果' })).toBeTruthy();
  expect(screen.getByTitle('法典来源').textContent).toBe('全部书目');
  expect(screen.getByRole('button', { name: '目录' })).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText('标题、提示词、作者或说明'), { target: { value: '不存在的词' } });
  fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
  expect((screen.getByPlaceholderText('标题、提示词、作者或说明') as HTMLInputElement).value).toBe('');
  chooseSource('共创广场'); await screen.findByRole('button', { name: /新投稿/ });
  expect(screen.getByTitle('法典来源').textContent).toBe('共创广场');
  chooseSource(/另一本书/); await screen.findByRole('status', { name: '1 条结果' });
  expect(screen.getByTitle('法典来源').textContent).toBe('另一本书');
});
it('图片尚未加载或失败时仍预留比例空间，错误旁可明确改用条目提示词', async () => {
  mocks.metadata.mockRejectedValueOnce(new Error('原图不可用'));
  setup(); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  const preview = screen.getAllByAltText('合成词条').find(image => image.getAttribute('src')?.includes('originals'))!;
  const stage = preview.closest<HTMLElement>('.press-reveal-surface')!;
  expect(stage.style.aspectRatio).toBe('640 / 960');
  expect(stage.className).toContain('max-h-[42vh]');
  expect(preview.className).toContain('absolute');
  expect(preview.getAttribute('width')).toBe('640'); expect(preview.getAttribute('height')).toBe('960');
  fireEvent.error(preview); fireEvent.load(preview);
  expect(stage.style.aspectRatio).toBe('640 / 960');
  await screen.findByRole('alert');
  expect((screen.getByRole('button', { name: '导入实验室' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '使用条目提示词' }));
  expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toMatchObject({ prompt: entry.prompt, negativePrompt: entry.negative });
});
it('图片词条叠放图文，纯文本词条保留正文和独立信息栏', async () => {
  mocks.book.mockResolvedValue({ release: boot.release, entries: [entry, { ...entry, key: 'codex:synthetic:text', title: '纯文本词条', images: [], prompt: 'text-only prompt' }] });
  setup();
  const imageTitle = await screen.findByText('合成词条');
  const textTitle = await screen.findByText('纯文本词条');
  const caption = imageTitle.closest('.gallery-card-caption')!;
  expect(caption.parentElement?.classList.contains('gallery-card-visual')).toBe(true);
  expect(caption.parentElement?.querySelector(':scope > .mobile-gallery-frame')).toBeTruthy();
  expect(textTitle.closest('.gallery-card-caption')).toBeNull();
  expect(textTitle.closest('.gallery-image-card')).toBeNull();
  expect(screen.getByText('text-only prompt')).toBeTruthy();
});
it('未进入页面不读取法典；紧凑图标一键导入，不打开确认窗口', async () => {
  const view = setup(false); expect(mocks.bootstrap).not.toHaveBeenCalled();
  view.rerender(<CodexGallery active currentUser={{ id: 'owner', username: 'user', role: 'admin', createdAt: 1 }} notify={mocks.notify} onNavigateToPlayground={mocks.navigate} onCreateArtistChain={mocks.create} />);
  fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  await ready();
  const button = screen.getByRole('button', { name: '导入实验室' });
  expect(button.textContent).toBe(''); expect(screen.getByRole('button', { name: '保存到风格串' }).textContent).toBe('');
  fireEvent.click(button); expect(screen.queryByRole('dialog')).toBeNull();
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toMatchObject({ mode: 'prompt-fragments', fullMetadata: true, prompt: metadata.prompt, negativePrompt: metadata.negativePrompt,
    replace: true, importSettings: true, importSeed: true, importModel: true, params: metadata.params, characters: metadata.params.characters });
  expect(mocks.navigate).toHaveBeenCalledOnce(); expect(mocks.file).toHaveBeenCalledOnce();
});
it('共创广场默认按投稿时间排序，并保留书目返回状态', async () => {
  setup(); await screen.findByRole('button', { name: /合成词条/ });
  fireEvent.change(screen.getByPlaceholderText('标题、提示词、作者或说明'), { target: { value: 'weighted prompt' } });
  fireEvent.click(screen.getByRole('button', { name: '目录' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '目录' })).getByRole('button', { name: '绘画' }));
  chooseSource('共创广场');
  await screen.findByRole('button', { name: /新投稿/ });
  const cards = screen.getAllByRole('button').filter(button => /新投稿|旧投稿/.test(button.textContent || ''));
  expect(cards.map(button => button.textContent)).toEqual([expect.stringContaining('新投稿'), expect.stringContaining('旧投稿')]);
  chooseSource(/合成书目/); await screen.findByRole('button', { name: /合成词条/ });
  expect((screen.getByPlaceholderText('标题、提示词、作者或说明') as HTMLInputElement).value).toBe('weighted prompt');
  expect(screen.getByRole('button', { name: '绘画' }).getAttribute('title')).toBe('绘画');
});
it('原图参数读取迟到时不会改写另一页的默认导入', async () => {
  let finish!: (value: CodexImageMetadata) => void; mocks.metadata.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  mocks.metadata.mockResolvedValueOnce({ ...metadata, prompt: 'next image', rawPrompt: 'next raw', params: { ...metadata.params, seed: 99 } });
  setup(); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  await waitFor(() => expect(mocks.metadata).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '下一页' })); await screen.findByText('next raw');
  await act(async () => finish(metadata));
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toMatchObject({ prompt: 'next image', replace: true, params: { seed: 99 } });
});
it('完整元数据默认全选，次级字段选择只有用户主动调整后才生效', async () => {
  setup(); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ })); await ready();
  expect(screen.queryByRole('button', { name: '读取原图配置' })).toBeNull();
  openOptions();
  await screen.findByRole('checkbox', { name: 'Seed' });
  expect((screen.getByRole('checkbox', { name: 'Seed' }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('checkbox', { name: /模型：/ }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Seed' })); fireEvent.click(screen.getByRole('checkbox', { name: /模型：/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: '生成参数' }));
  closeOptions(); fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toMatchObject({ fullMetadata: false, prompt: 'image raw prompt', negativePrompt: 'image raw negative', importSettings: false, importSeed: false, importModel: false });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(mocks.navigate).toHaveBeenCalledOnce();
});
it('多图收藏用稳定文件编号去重，保留展示词与当前图片的来源快照', () => {
  const image = codexCollectionImage(entry, 1);
  expect(image).toMatchObject({ sourceId: 'synthetic:one', imageId: 'image-1', analysis: { externalSourcePage: 1, collectionGroupSize: 2, codex: { prompt: 'weighted prompt', note: '说明' } } });
});

it.each(['books', 'community'] as const)('%s 的保存图标一键创建风格串，保留来源、当前图片及角色，不执行生图', async mode => {
  setup(); await screen.findByRole('button', { name: /合成词条/ });
  if (mode === 'community') chooseSource('共创广场');
  fireEvent.click(await screen.findByRole('button', { name: mode === 'community' ? /新投稿/ : /合成词条/ }));
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '保存到风格串' }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  const chain = mocks.create.mock.calls[0][0];
  expect(chain).toMatchObject({ userId: 'owner', type: 'style', basePrompt: metadata.prompt, negativePrompt: metadata.negativePrompt, description: entry.sourceUrl,
    previewImage: entry.images[0].originalUrl, modules: [], tags: [], params: metadata.params });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(mocks.file).toHaveBeenCalledOnce(); expect(mocks.navigate).not.toHaveBeenCalled();
});

it('次级字段选择在收起后保留，导入和保存共用当前选择，翻页后恢复默认值', async () => {
  setup(); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ })); await ready();
  const panel = openOptions();
  fireEvent.click(within(panel).getByRole('button', { name: '使用条目提示词' }));
  expect((within(panel).getByRole('checkbox', { name: '负面提示词' }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(within(panel).getByRole('checkbox', { name: '负面提示词' }));
  fireEvent.click(within(panel).getByRole('checkbox', { name: '角色 1' }));
  fireEvent.click(within(panel).getByRole('button', { name: '替换所选字段' }));
  closeOptions(); fireEvent.click(screen.getByRole('button', { name: '保存到风格串' }));
  await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith('已保存到风格串'));
  expect(mocks.create.mock.calls[0][0]).toMatchObject({ negativePrompt: '', params: { characters: [] } });
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toMatchObject({ prompt: 'weighted prompt', replace: true });
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).not.toHaveProperty('negativePrompt');
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).not.toHaveProperty('characters');
  fireEvent.click(screen.getByRole('button', { name: '下一页' })); await ready();
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toMatchObject({ fullMetadata: true, replace: true, prompt: metadata.prompt, negativePrompt: metadata.negativePrompt });
});

it.each(['图生图', '局部重绘', '扩图'])('底图%s只在次级选项中提供，直接投递目标模式，不混入参数', async label => {
  setup(); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  expect(screen.queryByRole('button', { name: label })).toBeNull();
  const panel = openOptions(); fireEvent.click(within(panel).getByRole('button', { name: label }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toEqual({ mode: 'base-image', imageEditOperation: { '图生图': 'image-to-image', '局部重绘': 'inpaint', '扩图': 'outpaint' }[label], baseImageUrl: expect.stringContaining(encodeURIComponent(entry.images[0].originalUrl)) });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(mocks.navigate).toHaveBeenCalledOnce();
});

it('保存中不重复创建，失败保留详情并可重试；纯文本条目也能保存', async () => {
  mocks.book.mockResolvedValue({ release: boot.release, entries: [{ ...entry, images: [] }] });
  let reject!: (error: Error) => void;
  mocks.create.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  setup(); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  const save = screen.getByRole('button', { name: '保存到风格串' });
  fireEvent.click(save); fireEvent.click(save); expect(mocks.create).toHaveBeenCalledOnce();
  await act(async () => reject(new Error('合成保存失败')));
  expect(mocks.notify).toHaveBeenCalledWith('合成保存失败', 'error'); expect((save as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(save); await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
  expect(mocks.create.mock.calls[1][0].previewImage).toBeUndefined();
});

it.each(['admin', 'guest'] as const)('%s 查看当前图片独立展示词并取用同一页，访客不能保存', async role => {
  const perImage = { ...entry, images: entry.images.map((image, page) => ({ ...image, originalUrl: '', prompt: `page ${page}`, negative: `negative ${page}`, characters: [] })) };
  mocks.book.mockResolvedValue({ release: boot.release, entries: [perImage] });
  setup(true, role); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(screen.getByText('page 1')).toBeTruthy(); expect(screen.getByText('negative 1')).toBeTruthy();
  expect(screen.queryByText('weighted prompt')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toMatchObject({ prompt: 'page 1' });
  const save = screen.getByRole('button', { name: '保存到风格串' });
  expect((save as HTMLButtonElement).disabled).toBe(role === 'guest'); fireEvent.click(save);
  if (role === 'guest') expect(mocks.create).not.toHaveBeenCalled();
  else {
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ basePrompt: 'page 1', previewImage: entry.images[1].url, params: { characters: [] } });
  }
});

it('原图读取失败时阻止导入和保存，不悄悄回退展示词；重读后恢复完整导入', async () => {
  mocks.metadata.mockRejectedValueOnce(new Error('合成读取失败'));
  setup(); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '合成读取失败');
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' })); fireEvent.click(screen.getByRole('button', { name: '保存到风格串' }));
  expect(mocks.navigate).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(sessionStorage.getItem(IMPORT_SESSION_KEY)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重试' })); await ready();
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toMatchObject({ fullMetadata: true, params: metadata.params });
  mocks.metadata.mockRejectedValueOnce(new Error('再次读取失败'));
  openOptions(); fireEvent.click(screen.getByRole('button', { name: '读取原图配置' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '再次读取失败'); closeOptions();
  expect((screen.getByRole('button', { name: '导入实验室' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '保存到风格串' }) as HTMLButtonElement).disabled).toBe(true);
});

it('原图可读但不含 NAI 元数据时显示条目来源，直接导入已知正负词和角色', async () => {
  mocks.metadata.mockResolvedValueOnce(null);
  setup(); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  await screen.findByText('无可用原图配置，取用条目内容');
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  const value = JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!);
  expect(value).toMatchObject({ prompt: entry.prompt, negativePrompt: entry.negative, replace: false, characters: [{ prompt: 'girl', negativePrompt: 'boy' }] });
  expect(value.params).toBeUndefined(); expect(value.fullMetadata).toBeUndefined(); expect(mocks.navigate).toHaveBeenCalledOnce();
});

it('部分原图元数据仍一键取用所有已知字段，并标明未提供的参数保留当前设置', async () => {
  const partial = { ...metadata, negativePrompt: undefined, rawNegative: '', params: { steps: 20, sampler: 'k_euler', seed: 0 } };
  mocks.metadata.mockResolvedValueOnce(partial);
  setup(); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  await screen.findByText('部分元数据，缺失参数保留当前设置');
  openOptions();
  expect((screen.getByRole('checkbox', { name: '模型' }) as HTMLInputElement).disabled).toBe(true);
  closeOptions(); fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toMatchObject({ fullMetadata: true, partialMetadata: true, params: partial.params, importSettings: true, importSeed: true, importModel: false });
});
