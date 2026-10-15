import { beforeEach, expect, it, vi } from 'vitest';
import { candidateFixture, rollFixture, rollImageFixture } from '../fixtures/styleRoll';
const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), getBrowseOrder: vi.fn(), getPage: vi.fn() }));
vi.mock('../../services/api', () => ({ api: { get: mocks.get, put: mocks.put } }));
vi.mock('../../services/localHistory', () => ({ localHistory: mocks }));
import { comparableRollImages, loadRollExperiments, loadRollHistory, rollCandidateImages, saveRollExperiment } from '../../services/styleRollApi';
beforeEach(() => vi.clearAllMocks());

it('只从匹配实验、候选、提示词和 Seed 的历史读取图片，固定首次结果不让重画改写投票依据', () => {
  const e = rollFixture(); e.candidates = [candidateFixture('a'), candidateFixture('b')];
  const first = rollImageFixture(e, e.candidates[0]), late = { ...first, id: 'later', createdAt: 2 };
  const wrongSeed = { ...rollImageFixture(e, e.candidates[1]), params: { ...e.template.params, seed: 9 } };
  const wrongPrompt = { ...rollImageFixture(e, e.candidates[1]), prompt: 'something else' };
  expect([...rollCandidateImages(e, [late, wrongSeed, wrongPrompt, first]).values()]).toEqual([first]);
  expect(rollCandidateImages(e, [{ ...first, sourceChainId: 'other' }]).size).toBe(0);
});
it('同 Seed 但实际模型或参数不同仍不可对比，参数键顺序不影响匹配', () => {
  const e = rollFixture(); e.candidates = ['a', 'b', 'c'].map(id => candidateFixture(id));
  const history = e.candidates.map(candidate => rollImageFixture(e, candidate));
  history[1].params = Object.fromEntries(Object.entries(history[1].params).reverse()) as typeof history[1]['params'];
  history[2].params.model = 'nai-diffusion-5-full';
  expect(comparableRollImages(rollCandidateImages(e, history))).toEqual(new Set(['a', 'b']));
});
it('已投票原图被删除时不替换成后来图片，不用新条件继续旧排名', () => {
  const e = rollFixture(); e.candidates = [candidateFixture('a'), candidateFixture('b')];
  e.votes = [{ id: 'v', left: 'a', right: 'b', leftImage: 'original-a', rightImage: 'original-b', result: 'left', createdAt: 1 }];
  const images = rollCandidateImages(e, [rollImageFixture(e, e.candidates[0], 'replacement-a'), rollImageFixture(e, e.candidates[1], 'original-b')]);
  expect(images.has('a')).toBe(false); expect(comparableRollImages(images, 'a').size).toBe(0);
});
it('读取全部候选历史时复用轻量索引分页，超过旧入口 200 张上限仍能完整恢复', async () => {
  const ids = Array.from({ length: 240 }, (_, index) => `image-${index}`); mocks.getBrowseOrder.mockResolvedValue({ ids });
  mocks.getPage.mockImplementation(async (page: number, size: number) => ({ items: ids.slice(page * size, (page + 1) * size).map(id => ({ id })) }));
  expect(await loadRollHistory('e')).toHaveLength(240); expect(mocks.getPage).toHaveBeenCalledTimes(3);
  expect(mocks.getBrowseOrder).toHaveBeenCalledWith({ source: 'style-roll:e', sort: 'oldest' });
});
it('坏响应不转为空实验，保存失败直接交给页面保留原状态', async () => {
  mocks.get.mockResolvedValue({ experiments: [null] }); await expect(loadRollExperiments()).rejects.toThrow();
  mocks.put.mockRejectedValue(new Error('冲突')); await expect(saveRollExperiment(rollFixture())).rejects.toThrow('冲突');
});

it('验证图按各自的Seed回读，不误用实验固定Seed的原图', () => {
  const e = rollFixture(); e.candidates = [{ ...candidateFixture('a'), seed: 123 }, { ...candidateFixture('b'), seed: 456 }];
  const images = e.candidates.map(candidate => rollImageFixture(e, candidate));
  expect(rollCandidateImages(e, images).size).toBe(2);
  expect(rollCandidateImages(e, [{ ...images[0], params: { ...images[0].params, seed: e.template.params.seed } }]).size).toBe(0);
  expect(comparableRollImages(rollCandidateImages(e, images)).size).toBe(1);
});
