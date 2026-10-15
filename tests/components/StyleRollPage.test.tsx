// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { candidateFixture, rollFixture, rollImageFixture } from '../fixtures/styleRoll';
import type { RollExperiment } from '../../services/styleRoll';
import { StyleRollPage } from '../../components/StyleRollPage';
import { setLanguage } from '../../services/i18n';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), history: vi.fn(), dictionary: vi.fn(), generate: vi.fn(), confirm: vi.fn(), upload: vi.fn(), export: vi.fn(), stop: vi.fn(), approve: vi.fn(), pause: vi.fn(), session: null as any, key: 'synthetic-key', cost: 0, mobile: false }));
vi.mock('../../services/artistSamples', () => ({ getArtistSampleDictionary: mocks.dictionary }));
vi.mock('../../services/styleRollApi', async original => ({ ...await original<typeof import('../../services/styleRollApi')>(), loadRollExperiments: mocks.load, saveRollExperiment: mocks.save, loadRollHistory: mocks.history }));
vi.mock('../../services/styleRollGeneration', () => ({ beginRollGeneration: mocks.generate, readRollApiKey: () => mocks.key }));
vi.mock('../../services/localHistory', () => ({ localHistory: { subscribe: () => () => {} } }));
vi.mock('../../services/generationSeries', () => ({ getGenerationSeriesSession: () => mocks.session, subscribeGenerationSeries: () => () => {}, stopGenerationSeriesSession: mocks.stop, approveGenerationSeries: mocks.approve }));
vi.mock('../../services/generationTask', () => ({ setGenerationQueuePaused: mocks.pause }));
vi.mock('../../services/naiRuntime', async original => { const actual = await original<typeof import('../../services/naiRuntime')>(); return { ...actual, useNaiRuntime: () => actual.DEFAULT_NAI_RUNTIME }; });
vi.mock('../../services/naiUsage', () => ({ useNovelaiUsage: () => ({ info: { tier: 3 }, refreshIfStale: vi.fn() }), isActiveOpusSubscription: () => true }));
vi.mock('../../services/anlasBudget', () => ({ useAnlasBudget: () => ({ remaining: 100 }), applyEstimatorRuntime: () => {}, estimateV45GenerationCost: () => mocks.cost, formatGenerationCostLabel: (cost: number) => cost > 0 ? `${cost} Anlas` : '免费' }));
vi.mock('../../services/exportLocation', () => ({ saveExportBlob: mocks.export }));
vi.mock('../../services/api', async original => ({ ...await original<typeof import('../../services/api')>(), api: { uploadFile: mocks.upload } }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => mocks.confirm }));
vi.mock('../../components/ImageShareActions', () => ({ ImageShareActions: () => null, IMAGE_CARD_ACTION_CLASS: 'image-action' }));
vi.mock('../../components/ImageLightbox', () => ({ ImageLightbox: () => null }));
vi.mock('../../components/SmartImage', async original => ({ ...await original<typeof import('../../components/SmartImage')>(), SmartImage: ({ src, alt }: any) => <img src={src} alt={alt} />, OriginalImage: (props: any) => <img {...props} /> }));
vi.mock('../../components/roll/StyleRollSetup', () => ({ StyleRollSetup: ({ initial, onSave, onClose }: any) => <div role="dialog"><button onClick={async () => { await onSave(initial); onClose(); }}>保存合成实验</button></div> }));

let experiment: RollExperiment;
const rows = (e: RollExperiment) => e.candidates.map(candidate => rollImageFixture(e, candidate));
beforeEach(() => {
  vi.clearAllMocks(); mocks.cost = 0; mocks.mobile = false; mocks.session = null; mocks.key = 'synthetic-key'; localStorage.clear(); sessionStorage.clear();
  experiment = rollFixture(); experiment.candidates = [candidateFixture('a', 'alpha'), candidateFixture('b', 'beta')];
  mocks.dictionary.mockResolvedValue(experiment.artists.map(artist => ({ name: artist.tag, chinese: '', postCount: 1 })));
  mocks.load.mockImplementation(async () => [structuredClone(experiment)]);
  mocks.save.mockImplementation(async value => ({ ...structuredClone(value), revision: value.revision + 1 }));
  mocks.history.mockResolvedValue(rows(experiment)); mocks.confirm.mockResolvedValue(true); mocks.export.mockResolvedValue({});
  mocks.generate.mockResolvedValue({ session: {}, settle: Promise.resolve({ success: true }) });
  mocks.upload.mockResolvedValue({ url: '/api/assets/covers/synthetic.png' });
  vi.stubGlobal('matchMedia', (query: string) => ({ media: query, matches: mocks.mobile && query.includes('max-width'), addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { callback: ResizeObserverCallback; constructor(callback: ResizeObserverCallback) { this.callback = callback; } observe(target: Element) { this.callback([{ target, contentRect: { width: 1024 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['synthetic-image'], { type: 'image/png' }) })));
});
afterEach(() => { cleanup(); setLanguage('zh-CN'); vi.unstubAllGlobals(); });
const setup = async (options = {}) => {
  const onSaveChain = vi.fn(async chain => ({ ...chain, id: 'saved-chain' })), onNavigateToPlayground = vi.fn();
  const props = { active: true, chains: [], enforceFreeStepLimit: true, generationStreamPreview: true, notify: vi.fn(), onSaveChain, onNavigateToPlayground, onOpenChain: vi.fn(), ...options };
  const view = render(<StyleRollPage {...props} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByRole('combobox', { name: '切换画风记录' })?.getAttribute('disabled')).toBeNull());
  if (experiment.candidates.length) await waitFor(() => expect(mocks.history).toHaveBeenCalled());
  return { ...view, props };
};
const filterBy = (name: string) => { fireEvent.click(screen.getByRole('button', { name: /^筛选/ })); fireEvent.click(screen.getByRole('button', { name })); };
const pending = () => filterBy('待生成');
const configure = (name: string, value: string) => { fireEvent.click(screen.getByRole('button', { name: '本轮设置' })); fireEvent.change(screen.getByRole('spinbutton', { name }), { target: { value } }); fireEvent.keyDown(window, { key: 'Escape' }); };
const reloadRecords = () => { fireEvent.click(screen.getByRole('button', { name: '管理记录' })); fireEvent.click(screen.getByRole('button', { name: '重新加载实验' })); };
const details = () => fireEvent.click(screen.getByText('更多操作', { exact: true }));
const duel = () => { fireEvent.click(screen.getByRole('button', { name: '可选工具' })); fireEvent.click(screen.getByRole('button', { name: '画风对比' })); };
const loadPair = () => { fireEvent.load(screen.getByAltText('左侧候选')); fireEvent.load(screen.getByAltText('右侧候选')); };

it('首次使用直接设置人数与张数开始一轮，无需先建实验或手填名单；多配方一次提交', async () => {
  experiment.candidates = []; experiment.artists = []; mocks.load.mockResolvedValue([]);
  const names = Array.from({ length: 1205 }, (_, index) => `catalog-${index}`); mocks.dictionary.mockResolvedValue(names.map(name => ({ name, chinese: '', postCount: 1 })));
  await setup(); configure('每串画师数', '4');
  configure('本轮生成张数', '3');
  fireEvent.click(screen.getAllByRole('button', { name: '开始 Roll' })[0]); await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  const [saved, candidates] = mocks.generate.mock.calls[0]; expect(saved.artists).toEqual([]); expect(candidates).toHaveLength(3);
  expect(candidates.every((candidate: any) => candidate.genes.length === 4 && candidate.genes.every((gene: any) => names.includes(gene.tag)))).toBe(true);
  expect(saved.rounds[0].candidateIds).toHaveLength(3); expect(saved.rounds[0].kind).toBe('batch'); expect(saved.votes).toEqual([]);
  expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByAltText('左侧候选')).toBeNull(); expect(screen.queryByRole('list', { name: '画风探索进度' })).toBeNull();
});
it('整轮按总费用确认，拒绝不提交，随后仅生成本轮原配方而不重新Roll', async () => {
  mocks.cost = 7; await setup(); configure('本轮生成张数', '2');
  mocks.confirm.mockResolvedValueOnce(false); fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce()); expect(mocks.confirm.mock.calls[0][0].message).toContain('预计共消耗 14 Anlas'); expect(mocks.generate).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: '补齐剩余 2 张' })); await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  expect(mocks.generate.mock.calls[0][1]).toHaveLength(2); expect(mocks.save).toHaveBeenCalledOnce();
});
it.each(['batch', 'refine'] as const)('%s轮次第六张失败后仅手动补缺图，保留五张成品和投票，不显示无效刷新操作', async kind => {
  experiment.candidates = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => candidateFixture(id));
  experiment.rounds = [{ id: 'partial-round', kind, candidateIds: ['a', 'b', 'c', 'd', 'e', 'f'], opponents: [], createdAt: 1,
    ...(kind === 'refine' ? { parentId: 'a', baseId: 'a', jitter: 0.3 } : {}) }];
  experiment.votes = [{ id: 'kept-vote', left: 'a', right: 'b', leftImage: 'history-a', rightImage: 'history-b', result: 'left', createdAt: 1 }];
  const before = structuredClone(experiment);
  mocks.history.mockResolvedValue(rows(experiment).slice(0, 5));
  mocks.generate.mockResolvedValueOnce({ session: {}, settle: Promise.resolve({ success: false, outcome: 'failed', error: '<!DOCTYPE html><html><title>502 Bad Gateway</title><body>synthetic-ray</body></html>' }) });
  await setup(); expect(screen.getByText('本轮已出图 5/6')).toBeTruthy(); expect(mocks.generate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '补齐剩余 1 张' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('服务返回了错误页面，请稍后重试'); expect(alert.textContent).not.toMatch(/DOCTYPE|synthetic-ray|<html/);
  expect(screen.queryByRole('button', { name: '重新加载' })).toBeNull();
  expect(mocks.generate).toHaveBeenCalledOnce(); expect(mocks.generate.mock.calls[0][0]).toEqual(before);
  expect(mocks.generate.mock.calls[0][1]).toEqual(before.candidates[5]); expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' }));
  expect(screen.queryByRole('alert')).toBeNull(); expect(mocks.generate).toHaveBeenCalledOnce();
  mocks.generate.mockImplementationOnce(async () => { mocks.history.mockResolvedValue(rows(experiment)); return { session: {}, settle: Promise.resolve({ success: true }) }; });
  fireEvent.click(screen.getByRole('button', { name: '补齐剩余 1 张' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '补齐剩余 1 张' })).toBeNull());
  expect(mocks.generate).toHaveBeenCalledTimes(2); expect(mocks.generate.mock.calls[1][0]).toEqual(before);
  expect(mocks.generate.mock.calls[1][1]).toEqual(before.candidates[5]); expect(mocks.save).not.toHaveBeenCalled();
});
it('保存轮次冲突不提交生图，保留现有图片和候选', async () => {
  await setup(); mocks.save.mockRejectedValueOnce(new Error('合成保存冲突'));
  fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' })); expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('合成保存冲突'));
  expect(mocks.generate).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: '查看候选 1' })).toBeTruthy();
});
it('词库读取失败禁止抽取，重试后恢复；关闭连续生成不提交多张', async () => {
  mocks.dictionary.mockRejectedValueOnce(new Error('合成词库读取失败')); const view = await setup({ continuousGenerationEnabled: false });
  expect(await screen.findByText('合成词库读取失败')).toBeTruthy(); expect((screen.getByRole('button', { name: '再 Roll 一轮' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新加载' })); await waitFor(() => expect((screen.getByRole('button', { name: '再 Roll 一轮' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' })); await screen.findByText('连续生成已关闭，请开启后生成本轮'); expect(mocks.generate).not.toHaveBeenCalled(); view.unmount();
});
it('重新加载期间不从旧版本提交，失败继续保留当前画风', async () => {
  await setup(); let reject!: (reason: Error) => void; mocks.load.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  reloadRecords(); expect((screen.getByRole('button', { name: '再 Roll 一轮' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => reject(new Error('合成读取失败'))); expect(screen.getByRole('button', { name: '查看候选 1' })).toBeTruthy();
});
it('连续生成关闭时仍可按一张开始一轮，不强制开启连续请求', async () => {
  await setup({ continuousGenerationEnabled: false }); configure('本轮生成张数', '1');
  fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' })); await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  expect(mocks.generate.mock.calls[0][1]).toEqual(expect.objectContaining({ id: expect.any(String), genes: expect.any(Array) }));
});
it('切换语言后单张费用同步翻译，固定参数生成入口保留', async () => {
  mocks.history.mockResolvedValue([]); await setup(); pending(); act(() => setLanguage('en'));
  fireEvent.click(screen.getByRole('button', { name: 'View candidate 1' })); expect(screen.getByRole('button', { name: 'Generate test image · Free' })).toBeTruthy();
});
it.each([true, false])('后台费用上涨确认=%s，取消停止任务，授权按原Key补充', async approved => {
  mocks.session = { scope: 'style-roll:synthetic-experiment', key: 'synthetic-key', state: 'awaiting_confirmation', awaiting: { cost: 9, requestedCount: 6, completedCount: 1 }, progress: { current: 1, total: 6 } };
  mocks.confirm.mockResolvedValueOnce(approved); await setup(); fireEvent.click(screen.getByRole('button', { name: '确认费用' }));
  await waitFor(() => expect(approved ? mocks.approve : mocks.stop).toHaveBeenCalledOnce());
  expect(mocks.confirm.mock.calls[0][0].message).toContain('剩余 5 张'); expect(mocks.confirm.mock.calls[0][0].message).toContain('共 45 Anlas');
  if (approved) expect(mocks.approve).toHaveBeenCalledWith(mocks.session, 9);
});
it('确认期间切Key不授权旧任务；暂停后只在主动继续时恢复', async () => {
  mocks.session = { scope: 'style-roll:synthetic-experiment', key: 'synthetic-key', state: 'awaiting_confirmation', awaiting: { cost: 9, requestedCount: 6, completedCount: 0 }, progress: { current: 0, total: 6 } };
  mocks.confirm.mockImplementationOnce(async () => { mocks.key = 'another-key'; return true; }); await setup(); fireEvent.click(screen.getByRole('button', { name: '确认费用' })); await screen.findByRole('alert'); expect(mocks.approve).not.toHaveBeenCalled();
  cleanup(); mocks.key = 'synthetic-key'; mocks.session = { ...mocks.session, state: 'paused', awaiting: undefined }; await setup(); expect(mocks.pause).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '继续' })); await waitFor(() => expect(mocks.pause).toHaveBeenCalledWith('synthetic-key', false));
});
it('双图就绪才接受投票，连按只记一次，盲选不泄露画师，撤销恢复记录', async () => {
  await setup(); fireEvent.click(screen.getByRole('button', { name: '可选工具' }));
  const compare = screen.getByRole('button', { name: '画风对比' });
  expect(document.getElementById(compare.getAttribute('aria-describedby')!)?.textContent).toBe('对比已有图片，选出偏好的画风；不会生成新图。');
  fireEvent.click(compare); expect(mocks.generate).not.toHaveBeenCalled();
  const left = screen.getByRole('button', { name: /更喜欢左边/ }) as HTMLButtonElement; expect(left.disabled).toBe(true);
  fireEvent.load(screen.getByAltText('左侧候选')); expect(left.disabled).toBe(true); fireEvent.load(screen.getByAltText('右侧候选')); expect(left.disabled).toBe(false); expect(screen.queryByText(/artist:alpha/)).toBeNull();
  let resolve!: () => void; mocks.save.mockImplementationOnce(value => new Promise(done => { resolve = () => done({ ...value, revision: value.revision + 1 }); }));
  fireEvent.click(left); fireEvent.click(left); expect(mocks.save).toHaveBeenCalledOnce(); await act(async () => resolve());
  expect(screen.getByText('已对比 1 次')).toBeTruthy(); expect(mocks.save.mock.calls[0][0].votes[0]).toEqual(expect.objectContaining({ leftImage: expect.stringMatching(/^history-/), rightImage: expect.stringMatching(/^history-/) }));
  fireEvent.click(screen.getByRole('button', { name: '撤销上次对比' })); await screen.findByText('已对比 0 次');
});
it('开始下一轮后不能撤销上一轮已确认的投票', async () => {
  experiment.rounds = [{ id: 'old', kind: 'random', candidateIds: ['a', 'b'], opponents: [], createdAt: 1, closedAt: 2 }, { id: 'new', kind: 'random', candidateIds: ['c'], opponents: ['a', 'b'], createdAt: 3 }];
  experiment.candidates.push(candidateFixture('c', 'gamma'));
  experiment.votes = [{ id: 'vote', roundId: 'old', left: 'a', right: 'b', leftImage: 'history-a', rightImage: 'history-b', result: 'left', createdAt: 1 }];
  mocks.history.mockResolvedValue(rows(experiment)); await setup(); duel(); loadPair();
  expect((screen.getByRole('button', { name: '撤销上次对比' }) as HTMLButtonElement).disabled).toBe(true); fireEvent.keyDown(window, { key: 'Backspace' }); expect(mocks.save).not.toHaveBeenCalled();
});
it('对照图失败只读重试，隐藏页不响应快捷键', async () => {
  const view = await setup(); duel(); fireEvent.error(screen.getByAltText('左侧候选')); expect(screen.getByText('对照图加载失败')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试' })); loadPair(); view.rerender(<StyleRollPage {...view.props} active={false} />); fireEvent.keyDown(window, { key: 'ArrowLeft' }); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
});
it('画风库按范围浏览，待生成可筛选；全局选择聚焦和关闭详情仍有效', async () => {
  const view = await setup(); fireEvent.click(screen.getByRole('button', { name: '查看候选 1' })); expect(screen.getByRole('button', { name: '查看候选 2' }).className).toContain('brightness-[.7]');
  view.rerender(<StyleRollPage {...view.props} selectionFocusEnabled={false} />); expect(screen.getByRole('button', { name: '查看候选 2' }).className).not.toContain('brightness-[.7]');
  pending(); expect(screen.queryByRole('button', { name: '关闭候选详情' })).toBeNull(); expect(screen.queryByRole('button', { name: '查看候选 1' })).toBeNull();
});
it('精确权重变体放在更多操作中，保存新候选，原图及评分不变', async () => {
  await setup(); fireEvent.click(screen.getByRole('button', { name: '查看候选 1' })); details(); fireEvent.click(screen.getByRole('button', { name: '手动调整权重' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: '候选权重：alpha' }), { target: { value: '1.2' } }); fireEvent.click(screen.getByRole('button', { name: '保存为新变体' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce()); const saved = mocks.save.mock.calls[0][0]; expect(saved.candidates[0]).toEqual(experiment.candidates[0]); expect(saved.candidates[2].genes).toEqual([{ tag: 'alpha', weight: 1.2 }]); expect(mocks.generate).not.toHaveBeenCalled();
});
it('权重测试保持画师不变，出图后由用户选择，胜出的变体显示在本轮结果，并衔接换Seed验证', async () => {
  mocks.generate.mockImplementation(async (e: RollExperiment) => { mocks.history.mockResolvedValue(rows(e)); return { session: {}, settle: Promise.resolve({ success: true }) }; });
  await setup(); configure('本轮生成张数', '1');
  fireEvent.click(screen.getByRole('button', { name: '查看候选 1' })); details();
  const testWeights = screen.getByRole('button', { name: '权重测试' });
  expect(document.getElementById(testWeights.getAttribute('aria-describedby')!)?.textContent).toBe('保持画师不变，自动生成不同权重的图片，再由你选择。');
  fireEvent.click(testWeights);
  await screen.findByAltText('左侧候选'); expect(screen.getByText('权重测试 · ±0.3 · 剩余 1 套')).toBeTruthy();
  const [source, candidate] = mocks.generate.mock.calls[0];
  expect(candidate.genes.map((gene: any) => gene.tag)).toEqual(source.candidates[0].genes.map((gene: any) => gene.tag));
  expect(candidate.genes).not.toEqual(source.candidates[0].genes);
  loadPair(); fireEvent.click(screen.getByRole('button', { name: /更喜欢右边/ }));
  await screen.findByText('本轮评价完成'); expect(screen.getByAltText('当前最佳画风')).toBeTruthy();
  expect(screen.getByRole('button', { name: '继续测试权重' })).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: '换 Seed 验证' })[0]); await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(2)); expect(mocks.generate.mock.calls[1][1]).toHaveLength(6);
  const last = mocks.save.mock.calls.at(-1)![0] as RollExperiment; expect(last.rounds!.at(-1)!.kind).toBe('verify');
});
it('手机详情置于工作区之外，返回保留画风库', async () => {
  mocks.mobile = true; await setup(); fireEvent.click(screen.getByRole('button', { name: '查看候选 1' })); const dialog = await screen.findByRole('dialog', { name: '候选 1' }); expect(dialog.closest('[data-roll-page]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '返回' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(screen.getByRole('button', { name: '查看候选 1' })).toBeTruthy();
});
it('原评价图缺失保留记录并禁止重画替代，无图仍可撤销旧票', async () => {
  experiment.votes = [{ id: 'v', left: 'a', right: 'b', leftImage: 'missing-a', rightImage: 'missing-b', result: 'left', createdAt: 1 }]; mocks.history.mockResolvedValue([]);
  await setup(); pending(); fireEvent.click(screen.getByRole('button', { name: '查看候选 1' })); expect(screen.getByText('已评价的对照图在历史中不可用，请恢复原历史或新建复测实验。')).toBeTruthy(); expect(screen.queryByRole('button', { name: /生成对照图/ })).toBeNull();
  duel(); fireEvent.click(screen.getByRole('button', { name: '撤销上次对比' })); await screen.findByText('已对比 0 次'); expect(mocks.generate).not.toHaveBeenCalled();
});
it('历史读取失败阻止未知状态重复消费，任务保存回执仍保留', async () => {
  mocks.history.mockRejectedValue(new Error('合成历史读取失败')); await setup(); pending(); fireEvent.click(screen.getByRole('button', { name: '查看候选 1' }));
  expect(screen.getAllByText('历史暂不可用')).toHaveLength(2);
  expect((screen.getByRole('button', { name: /生成对照图/ }) as HTMLButtonElement).disabled).toBe(true); expect(mocks.generate).not.toHaveBeenCalled();
});
it('存为风格串保留实际参数，关联失败后重试不重复创建链或封面', async () => {
  const item = rollImageFixture(experiment, experiment.candidates[0]); item.params.steps = 23; mocks.history.mockResolvedValue([item]); const { props } = await setup(); fireEvent.click(screen.getByRole('button', { name: '查看候选 1' }));
  mocks.save.mockRejectedValueOnce(new Error('合成保存失败')); fireEvent.click(screen.getByRole('button', { name: '存为风格串' })); await screen.findByRole('alert');
  expect(props.onSaveChain).toHaveBeenCalledWith(expect.objectContaining({ previewImage: '/api/assets/covers/synthetic.png', params: item.params }));
  fireEvent.click(screen.getByRole('button', { name: '存为风格串' })); await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2)); expect(props.onSaveChain).toHaveBeenCalledOnce(); expect(mocks.upload).toHaveBeenCalledOnce();
});
it('实验室入口在详情直接可达，导入完整草稿而不生图', async () => {
  const { props } = await setup(); fireEvent.click(screen.getByRole('button', { name: '查看候选 1' })); details(); fireEvent.click(screen.getByRole('button', { name: '送往实验室' }));
  expect(props.onNavigateToPlayground).toHaveBeenCalledOnce(); expect(JSON.parse(sessionStorage.getItem('nai_pending_import')!)).toEqual(expect.objectContaining({ fullMetadata: true, targetMode: 'text-to-image', params: experiment.template.params, importSeed: true })); expect(mocks.generate).not.toHaveBeenCalled();
});

it('卡片直接保存、不进入PK；下一轮优先围绕本记录保存的组合抽取', async () => {
  const { props } = await setup(); fireEvent.click(screen.getByRole('button', { name: '保存画风 1' }));
  await screen.findByLabelText('已保存画风 1');
  expect(props.onSaveChain).toHaveBeenCalledOnce(); expect(screen.queryByRole('button', { name: '关闭候选详情' })).toBeNull(); expect(screen.queryByAltText('左侧候选')).toBeNull();
  filterBy('已保存'); expect(screen.queryByRole('button', { name: '查看候选 2' })).toBeNull();
  configure('本轮生成张数', '4'); fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce()); const [e, candidates] = mocks.generate.mock.calls[0];
  expect(e.votes).toEqual([]); expect(candidates.filter((candidate: any) => candidate.parents.includes('a'))).toHaveLength(3);
  expect(candidates.filter((candidate: any) => candidate.parents.length === 0)).toHaveLength(1); expect(screen.queryByAltText('左侧候选')).toBeNull();
});

it.each(['random', 'refine'] as const)('未完成的%s流程也可直接再Roll，不强制完成PK，不归档原图', async kind => {
  experiment.rounds = [kind === 'random' ? { id: 'unfinished', kind, candidateIds: ['a', 'b'], opponents: [], createdAt: 1 } : { id: 'unfinished', kind, candidateIds: ['b'], opponents: [], parentId: 'a', baseId: 'a', jitter: 0.3, createdAt: 1 }];
  await setup(); fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' })); await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  const e = mocks.generate.mock.calls[0][0]; expect(e.rounds[0].closedAt).toBeGreaterThan(0); expect(e.rounds.at(-1).kind).toBe('batch'); expect(e.candidates.slice(0, 2)).toEqual(experiment.candidates); expect(e.votes).toEqual([]);
});
it('批量管理原位替换工具栏，按当前搜索全选，保存成功后退出仍能打开风格串', async () => {
  const { props } = await setup();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索画师或编号' }), { target: { value: 'alpha' } });
  expect(screen.queryByRole('button', { name: '查看候选 2' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '批量选择画风' }));
  expect(screen.queryByRole('searchbox')).toBeNull(); expect(screen.queryByRole('button', { name: '再 Roll 一轮' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
  expect(screen.getByRole('checkbox', { name: '选择画风 1' }).getAttribute('aria-checked')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '保存所选' }));
  await waitFor(() => expect(props.onSaveChain).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByText('已选 0 套')).toBeTruthy());
  expect(mocks.save.mock.calls[0][0].candidates[0].savedChainId).toBe('saved-chain');
  expect(mocks.save.mock.calls[0][0].candidates[1].savedChainId).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: '退出多选' })); expect(screen.getByRole('searchbox').getAttribute('value')).toBe('alpha');
});

it('批量保存逐项落盘，第二项关联失败保留选择，重试不重复保存封面和风格串', async () => {
  const { props } = await setup();
  fireEvent.click(screen.getByRole('button', { name: '批量选择画风' })); fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
  mocks.save.mockImplementationOnce(async value => ({ ...value, revision: value.revision + 1 })).mockRejectedValueOnce(new Error('第二项合成冲突'));
  fireEvent.click(screen.getByRole('button', { name: '保存所选' }));
  await screen.findByText('第二项合成冲突'); expect(screen.getByText('已选 1 套')).toBeTruthy();
  expect(props.onSaveChain).toHaveBeenCalledTimes(2); expect(mocks.upload).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '保存所选' })); await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(3));
  expect(props.onSaveChain).toHaveBeenCalledTimes(2); expect(mocks.upload).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(screen.getByText('已选 0 套')).toBeTruthy());
});

it('单项与批量丢弃共用可恢复状态，不删除原图、保存的风格串和投票', async () => {
  experiment.candidates[0].savedChainId = 'existing';
  await setup(); fireEvent.click(screen.getByRole('button', { name: '丢弃画风 1' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '查看候选 1' })).toBeNull());
  expect(mocks.save.mock.calls[0][0].candidates[0]).toEqual({ ...experiment.candidates[0], archived: true });
  filterBy('回收站'); expect(screen.getByRole('button', { name: '查看候选 1' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '批量选择画风' })); fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' })); fireEvent.click(screen.getByRole('button', { name: '恢复所选' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2)); expect(mocks.save.mock.calls[1][0].candidates[0]).toEqual(experiment.candidates[0]); expect(mocks.generate).not.toHaveBeenCalled();
});

it('完整轮次不显示伪补图入口，旧轮缺图可按轮次查到并手选补齐', async () => {
  experiment.rounds = [{ id: 'old', kind: 'batch', candidateIds: ['a'], opponents: [], createdAt: 1, closedAt: 2 }, { id: 'new', kind: 'batch', candidateIds: ['b'], opponents: [], createdAt: 3 }];
  mocks.history.mockResolvedValue([rollImageFixture(experiment, experiment.candidates[1])]);
  await setup(); expect(screen.queryByRole('button', { name: /补齐剩余/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ })); fireEvent.change(screen.getByRole('combobox', { name: '查看轮次' }), { target: { value: 'old' } }); fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.getByText('第 1 轮 · 显示 1 套')).toBeTruthy(); expect(screen.queryByRole('button', { name: '查看候选 2' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '批量选择画风' })); fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' })); fireEvent.click(screen.getByRole('button', { name: '生成所选 · 1' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce()); expect(mocks.generate.mock.calls[0][1].id).toBe('a');
  const saved = mocks.save.mock.calls[0][0]; expect(saved.rounds[1].closedAt).toBeGreaterThan(0); expect(saved.rounds[2].candidateIds).toEqual(['a']);
});

it('记录可重命名、移入与恢复回收站，全部收起后仍保留恢复入口', async () => {
  await setup(); fireEvent.click(screen.getByRole('button', { name: '管理记录' }));
  fireEvent.change(screen.getByRole('textbox', { name: '记录名称' }), { target: { value: '新的画风记录' } }); fireEvent.submit(screen.getByRole('textbox', { name: '记录名称' }).closest('form')!);
  await screen.findByRole('option', { name: '新的画风记录' });
  fireEvent.click(screen.getByRole('button', { name: '管理记录' })); fireEvent.click(screen.getByRole('button', { name: '将记录移入回收站' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '查看候选 1' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '管理记录' })); fireEvent.click(screen.getByRole('button', { name: '恢复记录：新的画风记录' }));
  await screen.findByRole('button', { name: '查看候选 1' }); expect(mocks.save.mock.calls.at(-1)![0].archived).toBe(false);
  expect(mocks.save.mock.calls.at(-1)![0].candidates).toEqual(experiment.candidates); expect(mocks.generate).not.toHaveBeenCalled();
});

it('生成设置从本轮菜单打开时关闭原弹层，避免两个模态窗口叠盖', async () => {
  await setup(); fireEvent.click(screen.getByRole('button', { name: '本轮设置' })); fireEvent.click(screen.getByRole('button', { name: '提示词与生成设置' }));
  expect(screen.queryByRole('dialog', { name: '本轮设置' })).toBeNull(); expect(screen.getByRole('button', { name: '保存合成实验' })).toBeTruthy();
});
it.each([false, true])('多选补图显示实际提交张数，遵循连续生成开关与每轮24张上限：%s', async continuous => {
  experiment.candidates = Array.from({ length: 25 }, (_, index) => candidateFixture('pending-' + index, 'artist-' + index)); mocks.history.mockResolvedValue([]);
  await setup({ continuousGenerationEnabled: continuous }); fireEvent.click(screen.getByRole('button', { name: '批量选择画风' })); fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
  fireEvent.click(screen.getByRole('button', { name: continuous ? '生成所选 · 24' : '生成所选 · 1' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  expect(continuous ? mocks.generate.mock.calls[0][1].length : 1).toBe(continuous ? 24 : 1);
  expect(mocks.generate.mock.calls[0][0].rounds.at(-1).candidateIds).toHaveLength(continuous ? 24 : 1);
});
