// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../types';
import { ChainList } from '../../components/ChainList';
import { ImageActivityContext } from '../../components/SmartImage';

const { confirmAction, syncSelection } = vi.hoisted(() => ({
  confirmAction: vi.fn(async () => false),
  syncSelection: {
    open: false, view: 'pending', recordFilter: 'all', entries: new Map(), available: new Set(), selected: new Set(),
    selecting: false, busy: false, savedCount: 0,
    accepts: vi.fn(() => true), begin: vi.fn(), cancel: vi.fn(), toggle: vi.fn(), actOnEntries: vi.fn(),
  },
}));
const role = vi.hoisted(() => ({ state: { config: { revision: 1, characters: [{ id: 'common', prompt: 'shared character', negativePrompt: '', x: 0.5, y: 0.5 }] }, copies: [] as any[] }, ensure: vi.fn(), load: vi.fn() }));
vi.mock('../../services/chainRoleMode', () => ({
  roleModeSnapshot: () => role.state, subscribeRoleMode: () => () => {}, loadRoleModeState: role.load,
  materializeRoleModeCopy: (copy: any) => copy.chain, ensureRoleModeCopy: role.ensure,
}));

vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => confirmAction }));
vi.mock('../../services/collectionFavorites', () => ({
  collectionTargetActive: () => false, readLegacyFavoriteIds: (key: string) => new Set(JSON.parse(localStorage.getItem(key) || '[]')), subscribeCollection: () => () => {},
}));
vi.mock('../../services/stChatu8Preferences', () => ({ useStChatu8Preferences: () => ({ enabled: false }) }));
vi.mock('../../services/stChatu8Sync', () => ({ useStChatu8Selection: () => syncSelection, wisdomEntryLabel: () => '' }));
vi.mock('../../services/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../services/appearancePreferences', () => ({ useGalleryFrostedCaption: () => false }));
vi.mock('../../services/naiRuntime', () => ({ useNaiRuntime: () => ({}) }));
vi.mock('../../services/naiModels', () => ({ DEFAULT_NAI_MODEL: 'nai-diffusion-4-5-full', getNaiModelDisplayLabel: () => 'V4.5', getSelectableNaiModels: () => [] }));
vi.mock('../../services/imageDisplayPreferences', () => ({
  useMobileImageDisplayPreferences: () => ({ layout: 'masonry' }),
  mobileGalleryClassName: () => '', mobileGalleryStyle: () => ({}),
}));
vi.mock('../../components/StyleCollectorControl', () => ({ StyleCollectorControl: () => null }));
vi.mock('../../components/chain/FolderBatchImportModal', () => ({ FolderBatchImportModal: () => null }));
vi.mock('../../components/ImageTaggerPanel', () => ({ ImageTaggerAction: () => null }));
vi.mock('../../components/ImageShareActions', () => ({ IMAGE_CARD_ACTION_CLASS: '', ImageShareActions: () => null }));
vi.mock('../../components/SmartImage', () => ({
  ImageActivityContext: React.createContext(true),
  SmartImage: ({ src, alt, onLoad }: { src: string; alt: string; onLoad?: React.ReactEventHandler<HTMLImageElement> }) => <img src={src} alt={alt} data-testid={`preview-${alt}`} onLoad={onLoad} />,
}));
vi.mock('../../components/ShortestColumnMasonry', async importOriginal => {
  const actual = await importOriginal<typeof import('../../components/ShortestColumnMasonry')>();
  return { ...actual, useMasonryColumnCount: () => 5 };
});

class FixedResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, contentRect: { width: 1000 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

class GalleryIntersectionObserver {
  static instances: GalleryIntersectionObserver[] = [];
  targets: Element[] = [];
  constructor(private callback: IntersectionObserverCallback, readonly options: IntersectionObserverInit) {
    GalleryIntersectionObserver.instances.push(this);
  }
  observe(target: Element) { this.targets.push(target); }
  disconnect() { this.targets = []; }
  intersect(states: boolean[]) {
    this.callback(this.targets.map((target, index) => ({ target, isIntersecting: states[index] ?? false } as IntersectionObserverEntry)), this as unknown as IntersectionObserver);
  }
}

const chain = (index: number, options: { untested?: boolean; image?: boolean } = {}): PromptChain => ({
  id: `chain-${index}`,
  userId: 'synthetic-owner',
  name: `风格 ${index}`,
  type: 'style',
  description: '',
  tags: options.untested ? ['待实测'] : [],
  basePrompt: '',
  negativePrompt: '',
  modules: [],
  params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: index, qualityToggle: true, ucPreset: 4 },
  createdAt: 1,
  updatedAt: 1,
  ...(options.image ? { previewImage: `/synthetic/cover-${index}.png` } : {}),
});

const props = (chains: PromptChain[]) => ({
  chains, type: 'style' as const, onCreate: vi.fn(), onSelect: vi.fn(), onDelete: vi.fn(), onRefresh: vi.fn(),
  onUpdateChain: vi.fn(), isLoading: false, notify: vi.fn(),
});

const columnIds = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('.chain-masonry-column'))
  .map(column => Array.from(column.querySelectorAll<HTMLElement>('[data-return-item-id]')).map(card => card.dataset.returnItemId));

const expectBalanced = (container: HTMLElement, count: number) => {
  const columns = columnIds(container);
  expect(columns).toHaveLength(5);
  expect(columns.flat()).toHaveLength(count);
  const sizes = columns.map(column => column.length);
  expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
};

beforeEach(() => {
  localStorage.clear();
  GalleryIntersectionObserver.instances = [];
  confirmAction.mockReset(); confirmAction.mockResolvedValue(false);
  role.state.config = { revision: 1, characters: [{ id: 'common', prompt: 'shared character', negativePrompt: '', x: 0.5, y: 0.5 }] };
  role.state.copies = []; role.ensure.mockReset().mockImplementation(async (source: PromptChain) => ({ ...source, id: `chain-role:${source.id}`, previewImage: '', params: { ...source.params, characters: role.state.config.characters } }));
  role.load.mockReset().mockImplementation(async () => role.state);
  vi.stubGlobal('ResizeObserver', FixedResizeObserver);
  vi.stubGlobal('IntersectionObserver', GalleryIntersectionObserver);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, '');
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('ChainList 最短列筛选与加载', () => {
  it('统一角色保持原图片卡片/筛选/滚动，全部串可按需打开独立副本', async () => {
    const items = Array.from({ length: 80 }, (_, index) => chain(index, { image: true }));
    const viewProps = props(items), onSelectRoleCopy = vi.fn();
    const { container } = render(<ChainList {...viewProps} onSelectRoleCopy={onSelectRoleCopy} />);
    await waitFor(() => expect(columnIds(container).flat()).toHaveLength(60));
    const original = container.querySelector('[data-return-item-id="chain-0"]');
    const root = container.querySelector<HTMLElement>('.min-h-0.flex-1.overflow-y-auto')!;
    Object.defineProperties(root, { clientHeight: { configurable: true, value: 500 }, scrollHeight: { configurable: true, value: 3000 } });
    root.scrollTop = 900; fireEvent.scroll(root);
    fireEvent.click(screen.getByRole('button', { name: '统一角色' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '统一角色' }).getAttribute('aria-pressed')).toBe('true'));
    expect(container.querySelector('[data-return-item-id="chain-0"]')).toBe(original);
    expect(screen.queryByTestId('preview-风格 0')).toBeNull(); expect(screen.queryByText('原封面参考')).toBeNull();
    expect(role.ensure).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: '生成本轮' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '加载更多（20）' }));
    fireEvent.click(container.querySelector('[data-return-item-id="chain-79"]')!);
    await waitFor(() => expect(onSelectRoleCopy).toHaveBeenCalledWith(expect.objectContaining({ id: 'chain-role:chain-79', previewImage: '' })));
    expect(role.ensure).toHaveBeenCalledTimes(1); expect(viewProps.onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '统一角色' }));
    expect(container.querySelector('[data-return-item-id="chain-0"]')).toBe(original); expect(root.scrollTop).toBe(900);
    fireEvent.click(original!); expect(viewProps.onSelect).toHaveBeenCalledWith('chain-0');
  });
  it('模式只展示已有模式图片，未持久化卡即时留空并区分可替换角色/待处理文本', async () => {
    const commonParams = { ...chain(0).params, characters: [{ id: 'old', prompt: 'old role', negativePrompt: '', x: 0.5, y: 0.5 }] };
    const items = [{ ...chain(0, { image: true }), basePrompt: 'artist style', params: commonParams }, { ...chain(1, { image: true }), basePrompt: 'style, old character' }, chain(2, { image: true })];
    role.state.copies = [{ sourceId: 'chain-2', fields: [], chain: { ...chain(2), id: 'chain-role:chain-2', previewImage: '/role-result.png' } }];
    const { container } = render(<ChainList {...props(items)} onSelectRoleCopy={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '统一角色' })); await waitFor(() => expect(screen.getByRole('button', { name: '统一角色' }).getAttribute('aria-pressed')).toBe('true'));
    const card = (id: number) => container.querySelector<HTMLElement>(`[data-return-item-id="chain-${id}"]`)!;
    expect(card(0).querySelector('img')).toBeNull(); expect(within(card(0)).queryByText('混合词待审查')).toBeNull();
    expect(card(1).querySelector('img')).toBeNull(); expect(within(card(1)).getByText('混合词待审查')).toBeTruthy();
    expect(card(2).querySelector('img')?.getAttribute('src')).toBe('/role-result.png'); expect(role.ensure).not.toHaveBeenCalled();
  });
  it('等待创建副本时离开前景不会迟到跳回工作台', async () => {
    const viewProps = props([chain(0)]), onSelectRoleCopy = vi.fn();
    let finish!: (value: PromptChain) => void; role.ensure.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = (active: boolean) => <ImageActivityContext.Provider value={active}><ChainList {...viewProps} onSelectRoleCopy={onSelectRoleCopy} /></ImageActivityContext.Provider>;
    const { container, rerender } = render(view(true));
    fireEvent.click(screen.getByRole('button', { name: '统一角色' })); await waitFor(() => expect(screen.getByRole('button', { name: '统一角色' }).getAttribute('aria-pressed')).toBe('true'));
    fireEvent.click(container.querySelector('[data-return-item-id="chain-0"]')!); await waitFor(() => expect(role.ensure).toHaveBeenCalled());
    rerender(view(false)); await act(async () => finish({ ...chain(0), id: 'chain-role:chain-0' }));
    expect(onSelectRoleCopy).not.toHaveBeenCalled();
  });
  it('等待加载公共角色时离开前景不会迟到启用模式或弹设置', async () => {
    let finish!: (value: typeof role.state) => void; role.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const viewProps = props([chain(0)]), view = (active: boolean) => <ImageActivityContext.Provider value={active}><ChainList {...viewProps} onSelectRoleCopy={vi.fn()} /></ImageActivityContext.Provider>;
    const { rerender } = render(view(true)); fireEvent.click(screen.getByRole('button', { name: '统一角色' }));
    rerender(view(false)); await act(async () => finish(role.state)); rerender(view(true));
    expect(screen.getByRole('button', { name: '统一角色' }).getAttribute('aria-pressed')).toBe('false'); expect(screen.queryByRole('dialog', { name: '统一角色设置' })).toBeNull();
  });
  it('公共角色词为空也能浏览已有模式卡片，手动打开设置后取消仍留在模式', async () => {
    role.state.config = { revision: 1, characters: [{ id: 'common', prompt: '', negativePrompt: '', x: 0.5, y: 0.5 }] };
    role.state.copies = [{ sourceId: 'chain-0', fields: [], chain: { ...chain(0), id: 'chain-role:chain-0', previewImage: '/role-result.png' } }];
    const source = chain(0, { image: true }), { container } = render(<ChainList {...props([source])} onSelectRoleCopy={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '统一角色' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '统一角色' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.queryByRole('dialog', { name: '统一角色设置' })).toBeNull();
    expect(container.querySelector('[data-return-item-id="chain-0"] img')?.getAttribute('src')).toBe('/role-result.png');
    expect(role.ensure).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '统一角色设置' }));
    const dialog = await screen.findByRole('dialog', { name: '统一角色设置' });
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(screen.getByRole('button', { name: '统一角色' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('dialog', { name: '统一角色设置' })).toBeNull();
  });
  it('取消筛选不会被此前未找到的旧返回目标拉到第60项以后，新的编辑返回仍展开目标', async () => {
    const items = Array.from({ length: 130 }, (_, index) => chain(index));
    const viewProps = props(items);
    const { container, rerender } = render(<ChainList {...viewProps} />);
    await waitFor(() => expect(columnIds(container).flat()).toHaveLength(60));
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    const dialog = screen.getByRole('dialog', { name: '筛选与排序' });
    const favoriteToggle = within(dialog).getByRole('button', { name: '只看收藏' });
    fireEvent.click(favoriteToggle);
    await waitFor(() => expect(columnIds(container).flat()).toHaveLength(0));
    rerender(<ChainList {...viewProps} returnTargetId="chain-100" />);
    const root = container.querySelector<HTMLElement>('.min-h-0.flex-1.overflow-y-auto')!;
    root.scrollTop = 2000;
    fireEvent.click(favoriteToggle);
    await waitFor(() => expect(columnIds(container).flat()).toHaveLength(60));
    expect(root.scrollTop).toBe(0);
    expect(container.querySelector('[data-return-item-id="chain-100"]')).toBeNull();
    rerender(<ChainList {...viewProps} />);
    rerender(<ChainList {...viewProps} returnTargetId="chain-100" />);
    await waitFor(() => expect(container.querySelector('[data-return-item-id="chain-100"]')).not.toBeNull());
  });
  it('收藏与待实测控件连续切换后按新集合重新均衡，并可恢复完整列表', async () => {
    const items = Array.from({ length: 60 }, (_, index) => chain(index, { untested: index < 5 || index % 5 === 0 }));
    const favorites = items.filter((item, index) => index < 5 || index % 5 === 0).map(item => item.id);
    localStorage.setItem('nai_chain_favs', JSON.stringify(favorites));
    const { container } = render(<ChainList {...props(items)} />);
    await waitFor(() => expectBalanced(container, 60));

    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    const dialog = screen.getByRole('dialog', { name: '筛选与排序' });
    const favoriteToggle = within(dialog).getByRole('button', { name: '只看收藏' });
    const root = container.querySelector<HTMLElement>('.min-h-0.flex-1.overflow-y-auto')!;
    root.scrollTop = 2400;
    fireEvent.click(favoriteToggle);
    await waitFor(() => expectBalanced(container, favorites.length));
    expect(root.scrollTop).toBe(0);
    expect(favoriteToggle.getAttribute('aria-pressed')).toBe('true');

    root.scrollTop = 1600;
    fireEvent.click(favoriteToggle);
    await waitFor(() => expectBalanced(container, 60));
    expect(root.scrollTop).toBe(0);
    const untestedToggle = within(dialog).getByRole('button', { name: '只看待实测' });
    fireEvent.click(untestedToggle);
    await waitFor(() => expectBalanced(container, favorites.length));
    expect(untestedToggle.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(within(dialog).getByRole('button', { name: '重置筛选' }));
    await waitFor(() => expectBalanced(container, 60));
    expect(untestedToggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('列尾相交追加下一批但不观察全局底部；同轮只请求一次且保留旧卡片节点与图片比例更新', async () => {
    const items = Array.from({ length: 130 }, (_, index) => chain(index, { image: true }));
    const { container } = render(<ChainList {...props(items)} />);
    const root = container.querySelector('.min-h-0.flex-1.overflow-y-auto')!;
    await waitFor(() => expect(columnIds(container).flat()).toHaveLength(60));
    const card = container.querySelector<HTMLElement>('[data-return-item-id="chain-0"]')!;
    const originalIds = columnIds(container).flat();
    expect(originalIds).toHaveLength(60);
    const initialObserver = GalleryIntersectionObserver.instances.at(-1)!;
    await waitFor(() => expect(initialObserver.targets).toHaveLength(5));
    expect(initialObserver.targets.every(target => target.hasAttribute('data-masonry-load-end'))).toBe(true);
    expect(initialObserver.targets).not.toContain(root.querySelector('.flex.justify-center.py-6'));

    const image = screen.getByTestId('preview-风格 0') as HTMLImageElement;
    Object.defineProperties(image, { naturalWidth: { configurable: true, value: 1200 }, naturalHeight: { configurable: true, value: 600 } });
    fireEvent.load(image);
    await waitFor(() => expect(card.querySelector('.mobile-gallery-frame')?.getAttribute('style')).toContain('--mobile-image-ratio: 2'));
    expect(container.querySelector('[data-return-item-id="chain-0"]')).toBe(card);
    (root as HTMLElement).scrollTop = 700;

    const activeObserver = GalleryIntersectionObserver.instances.at(-1)!;
    await waitFor(() => expect(activeObserver.targets).toHaveLength(5));
    act(() => activeObserver.intersect([false, false, true, false, false]));
    await waitFor(() => expect(columnIds(container).flat()).toHaveLength(120));
    expect(container.querySelector('[data-return-item-id="chain-0"]')).toBe(card);
    expect(root.scrollTop).toBe(700);
    act(() => activeObserver.intersect([true, true, true, true, true]));
    expect(columnIds(container).flat()).toHaveLength(120);
  });

  it('迟到的横竖图与无封面混合时，下一批补实际短列；数据刷新不缩回第一页或滚回顶部', async () => {
    const items = Array.from({ length: 130 }, (_, index) => chain(index, { image: index % 5 !== 4 }));
    const viewProps = props(items);
    const { container, rerender } = render(<ChainList {...viewProps} />);
    await waitFor(() => expect(columnIds(container).flat()).toHaveLength(60));
    const columns = Array.from(container.querySelectorAll<HTMLElement>('.chain-masonry-column'));
    const oldCards = Array.from(container.querySelectorAll<HTMLElement>('[data-return-item-id]'));
    const parents = oldCards.map(card => card.parentElement);
    expect(container.querySelector('[data-return-item-id="chain-0"] .mobile-gallery-frame')?.getAttribute('style')).toContain(`--mobile-image-ratio: ${832 / 1216}`);
    expect(container.querySelector('[data-return-item-id="chain-4"] .mobile-gallery-frame')?.getAttribute('style')).toContain(`--mobile-image-ratio: ${4 / 3}`);
    // 有封面先用生成比例预留，无封面仍4:3；随后不同横/竖图返回，旧节点不搬列。
    for (const [index, size] of [[0, [600, 1400]], [1, [1500, 600]], [2, [700, 1300]]] as const) {
      const image = screen.getByTestId(`preview-风格 ${index}`);
      Object.defineProperties(image, { naturalWidth: { configurable: true, value: size[0] }, naturalHeight: { configurable: true, value: size[1] } });
      fireEvent.load(image);
      expect(container.querySelector(`[data-return-item-id="chain-${index}"] .mobile-gallery-frame`)?.getAttribute('style')).toContain(`--mobile-image-ratio: ${size[0] / size[1]}`);
    }
    // 使用浏览器列高，而不是图片估算值；右列都是4:3无封面卡，已经实际结束得更早。
    columns.forEach((column, index) => vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({ height: index === 4 ? 1200 : 20000 } as DOMRect));
    const root = container.querySelector<HTMLElement>('.min-h-0.flex-1.overflow-y-auto')!;
    root.scrollTop = 900;
    const observer = GalleryIntersectionObserver.instances.at(-1)!;
    act(() => observer.intersect([false, false, false, false, true]));
    await waitFor(() => expect(columnIds(container).flat()).toHaveLength(120));
    expect(container.querySelector('[data-return-item-id="chain-60"]')?.parentElement).toBe(columns[4]);
    oldCards.forEach((card, index) => {
      expect(container.querySelector(`[data-return-item-id="${card.dataset.returnItemId}"]`)).toBe(card);
      expect(card.parentElement).toBe(parents[index]);
    });
    expect(root.scrollTop).toBe(900);
    rerender(<ChainList {...viewProps} chains={items.map(item => ({ ...item }))} />);
    expect(columnIds(container).flat()).toHaveLength(120);
    expect(root.scrollTop).toBe(900);
  });
});
