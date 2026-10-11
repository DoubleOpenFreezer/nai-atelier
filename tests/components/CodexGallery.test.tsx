// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CodexBootstrap, CodexEntry, CodexImageMetadata } from '../../services/codexService';
const mocks = vi.hoisted(() => ({ bootstrap: vi.fn(), book: vi.fn(), community: vi.fn(), file: vi.fn(), metadata: vi.fn(), notify: vi.fn(), navigate: vi.fn() }));
vi.mock('../../services/codexService', async original => ({ ...await original<typeof import('../../services/codexService')>(), loadCodexBootstrap: mocks.bootstrap, loadCodexBook: mocks.book, loadCodexCommunity: mocks.community, readCodexImageFile: mocks.file, readCodexImageMetadata: mocks.metadata }));
vi.mock('../../services/collectionFavorites', () => ({ collectionRevision: () => 0, subscribeCollection: () => () => {}, collectionTargetActive: () => false }));
vi.mock('../../components/ImageShareActions', () => ({ ImageShareOverlay: () => null }));
vi.mock('../../components/ImageLightbox', () => ({ ViewableImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock('../../components/SmartImage', async original => ({ ...await original<typeof import('../../components/SmartImage')>(), SmartImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
import { CodexGallery, codexCollectionImage } from '../../components/CodexGallery';
import { CodexImportDialog } from '../../components/CodexImportDialog';
import { IMPORT_SESSION_KEY } from '../../services/metadataService';

const book = { id: 'synthetic', title: '合成书目', hasOriginal: true, type: 'codex', author: '作者', version: 'V5', entryCount: 1, originalSections: [], nsfw: false, exampleModel: '', dataUrl: '', assetBaseUrl: '', assetPathMode: '' };
const boot: CodexBootstrap = { release: 'r-abc', books: [book], media: {}, baseUrl: 'https://assets.quicktagcloud.com/data/releases/r-abc', files: {} };
const entry: CodexEntry = { key: 'codex:synthetic:one', id: 'one', source: 'codex', bookId: 'synthetic', bookTitle: '合成书目', title: '合成词条', path: ['绘画'], prompt: 'weighted prompt', negative: 'source negative', characters: [{ label: '角色', prompt: 'girl', negative: 'boy' }], note: '说明', author: '作者', sourceUrl: 'https://novelai.quicktagcloud.com/share/synthetic/one',
  images: [0, 1].map(page => ({ id: `image-${page}`, url: `https://assets.quicktagcloud.com/images/synthetic/${page}.jpg`, originalUrl: `https://assets.quicktagcloud.com/originals/synthetic/${page}.png`, width: 640, height: 960, raw: '', parameterSource: '' })), coverIndex: 0, nsfw: false, r18g: false, createdAt: 1000, likeCount: 10, updates: [], isNew: false };
const metadata: CodexImageMetadata = { prompt: 'image prompt', negativePrompt: 'image negative', rawPrompt: 'image raw prompt', rawNegative: 'image raw negative', params: { steps: 20, seed: 88, width: 640, height: 960, model: 'nai-diffusion-4-5-full' } };
const setup = (active = true) => render(<CodexGallery active={active} currentUser={{ id: 'owner', username: 'user', role: 'admin', createdAt: 1 }} notify={mocks.notify} onNavigateToPlayground={mocks.navigate} />);
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout: 'portrait', columns: 2 }));
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', (media: string) => ({ media, matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  mocks.bootstrap.mockResolvedValue(boot); mocks.book.mockResolvedValue({ release: boot.release, entries: [entry] });
  mocks.community.mockResolvedValue({ entries: [{ ...entry, key: 'community:old', title: '旧投稿', createdAt: 1 }, { ...entry, key: 'community:new', title: '新投稿', createdAt: 2 }] });
  mocks.file.mockResolvedValue(new File(['synthetic'], 'source.png')); mocks.metadata.mockResolvedValue(metadata);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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
it('未进入页面不读取法典；取用默认追加正向和角色，负面需明确选择', async () => {
  const view = setup(false); expect(mocks.bootstrap).not.toHaveBeenCalled();
  view.rerender(<CodexGallery active currentUser={{ id: 'owner', username: 'user', role: 'admin', createdAt: 1 }} notify={mocks.notify} onNavigateToPlayground={mocks.navigate} />);
  fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  fireEvent.click(screen.getByRole('button', { name: '送往实验室' }));
  const dialog = screen.getByRole('dialog', { name: '送往实验室' });
  expect((within(dialog).getByRole('checkbox', { name: '负面提示词' }) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(within(dialog).getByRole('button', { name: '送往实验室' }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toMatchObject({ mode: 'prompt-fragments', prompt: 'weighted prompt', replace: false, characters: [{ prompt: 'girl', negativePrompt: 'boy' }] });
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).not.toHaveProperty('params'); expect(mocks.navigate).toHaveBeenCalledOnce();
});
it('共创广场默认按投稿时间排序，并保留书目返回状态', async () => {
  setup(); await screen.findByRole('button', { name: /合成词条/ });
  fireEvent.click(screen.getByRole('button', { name: '共创广场' }));
  await screen.findByRole('button', { name: /新投稿/ });
  const cards = screen.getAllByRole('button').filter(button => /新投稿|旧投稿/.test(button.textContent || ''));
  expect(cards.map(button => button.textContent)).toEqual([expect.stringContaining('新投稿'), expect.stringContaining('旧投稿')]);
  fireEvent.click(screen.getByRole('button', { name: '书目' })); await screen.findByRole('button', { name: /合成词条/ });
});
it('原图参数读取迟到时不会打开另一页的取用窗口', async () => {
  let finish!: (value: CodexImageMetadata) => void; mocks.metadata.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  setup(); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  fireEvent.click(screen.getByRole('button', { name: '读取原图配置' }));
  await waitFor(() => expect(mocks.metadata).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  await act(async () => finish(metadata));
  expect(screen.queryByRole('dialog', { name: '取用原图配置' })).toBeNull();
});
it('仅取文本时保留原图原文，Seed 与模型默认不选', () => {
  const apply = vi.fn(); render(<CodexImportDialog entry={entry} metadata={metadata} onClose={() => {}} onApply={apply} />);
  expect((screen.getByRole('checkbox', { name: 'Seed' }) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('checkbox', { name: '生成参数' }));
  fireEvent.click(screen.getByRole('button', { name: '送往实验室' }));
  expect(apply.mock.calls[0][0]).toMatchObject({ prompt: 'image raw prompt', negativePrompt: 'image raw negative', importSettings: false, importSeed: false, importModel: false });
});
it('多图收藏用稳定文件编号去重，保留展示词与当前图片的来源快照', () => {
  const image = codexCollectionImage(entry, 1);
  expect(image).toMatchObject({ sourceId: 'synthetic:one', imageId: 'image-1', analysis: { externalSourcePage: 1, collectionGroupSize: 2, codex: { prompt: 'weighted prompt', note: '说明' } } });
});
