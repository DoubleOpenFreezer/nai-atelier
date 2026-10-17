import { expect, it } from 'vitest';
import type { RollCandidate } from '../../services/styleRoll';
import { candidateFixture, legacyRollFixture, rollFixture, rollImageFixture } from '../fixtures/styleRoll';
import { rollPendingCandidates, rollWorkspaceCandidates } from '../../services/styleRollWorkspace';

const fixture = () => {
  const e = rollFixture();
  e.candidates = [candidateFixture('old', 'old_artist'), { ...candidateFixture('saved', 'saved_artist'), savedChainId: 'chain' }, candidateFixture('pending'), { ...candidateFixture('trash'), archived: true }];
  e.rounds = [{ id: 'old-round', kind: 'batch', candidateIds: ['old'], opponents: [], createdAt: 1, closedAt: 2 }, { id: 'current', kind: 'batch', candidateIds: ['saved', 'pending'], opponents: [], createdAt: 3 }];
  return { e, images: new Map([['saved', rollImageFixture(e, e.candidates[1])]]) };
};
const view = { filter: 'all', roundId: '', query: '', sort: 'new' };

it('纯新探索与衍生变体按来源划分，和轮次/搜索/回收站规则交叉且不包含验证副本', () => {
  const e = rollFixture();
  const variant = (id: string, method: RollCandidate['method']): RollCandidate => ({ ...candidateFixture(id, `artist_${id}`), method, parents: ['original'] });
  e.candidates = [candidateFixture('original', 'original_artist'), variant('refine', 'refine'), variant('mutate', 'mutate'), variant('crossover', 'crossover'), variant('manual', 'manual'),
    { ...variant('trash', 'refine'), archived: true }, variant('verification', 'manual'), candidateFixture('old')];
  e.rounds = [{ id: 'current', kind: 'batch', candidateIds: ['original', 'refine', 'mutate', 'crossover', 'manual', 'trash'], opponents: [], createdAt: 1 },
    { id: 'verification-round', kind: 'verify', candidateIds: ['verification'], opponents: [], createdAt: 2 }];
  const images = new Map();
  const ids = (filter: string, roundId = '', query = '') => rollWorkspaceCandidates(e, images, { ...view, filter, roundId, query }).map(item => item.id);
  expect(ids('originals')).toEqual(['old', 'original']);
  expect(ids('variants')).toEqual(['manual', 'crossover', 'mutate', 'refine']);
  expect(ids('originals', 'current')).toEqual(['original']);
  expect(ids('variants', 'current', 'artist mutate')).toEqual(['mutate']);
  expect(ids('variants', 'current', '#2')).toEqual(['refine']);
  expect(ids('originals', 'missing')).toEqual([]);
  expect(ids('variants', 'current', 'trash')).toEqual([]);
  expect(ids('archived', 'current')).toEqual(['trash']);
});

it('全部如实展示成图与待生成，回收站独立；编号与归一化画师查询可交叉轮次', () => {
  const { e, images } = fixture();
  expect(rollWorkspaceCandidates(e, images, view).map(item => item.id)).toEqual(['pending', 'saved', 'old']);
  expect(rollWorkspaceCandidates(e, images, { ...view, filter: 'archived' }).map(item => item.id)).toEqual(['trash']);
  expect(rollWorkspaceCandidates(e, images, { ...view, query: 'OLD artist' }).map(item => item.id)).toEqual(['old']);
  expect(rollWorkspaceCandidates(e, images, { ...view, query: '#2' }).map(item => item.id)).toEqual(['saved']);
  expect(rollWorkspaceCandidates(e, images, { ...view, query: '2' }).map(item => item.id)).toEqual(['saved']);
  expect(rollWorkspaceCandidates(e, images, { ...view, roundId: 'current', filter: 'saved' }).map(item => item.id)).toEqual(['saved']);
  expect(rollWorkspaceCandidates(e, images, { ...view, roundId: 'missing' })).toEqual([]);
});

it('补齐仅取当前未结束轮次可生成项，不混入历史缺图，关闭轮次不再显示补齐', () => {
  const { e, images } = fixture();
  expect(rollPendingCandidates(e, images).map(item => item.id)).toEqual(['pending']);
  e.rounds![1].closedAt = 4;
  expect(rollPendingCandidates(e, images)).toEqual([]);
  expect(rollPendingCandidates(e, images, ['old']).map(item => item.id)).toEqual(['old']);
});

it('手选补图仍排除已出图、已评价原图丢失及回收站项', () => {
  const { e, images } = fixture();
  e.votes = [{ id: 'vote', left: 'old', right: 'saved', leftImage: 'missing', rightImage: 'history-saved', result: 'left', createdAt: 1 }];
  expect(rollPendingCandidates(e, images, e.candidates.map(item => item.id)).map(item => item.id)).toEqual(['pending']);
});

it('旧进阶轮次不自动补齐，未评价原配方可主动选中普通生成，验证副本始终排除', () => {
  const e = legacyRollFixture(), images = new Map();
  expect(rollPendingCandidates(e, images)).toEqual([]);
  expect(rollPendingCandidates(e, images, e.candidates.map(candidate => candidate.id)).map(candidate => candidate.id)).toEqual(['crossed', 'refined', 'manual']);
  e.votes = [];
  for (const kind of ['random', 'evolve', 'refine']) {
    const round = e.rounds!.find(item => item.kind === kind)!;
    e.rounds = [...e.rounds!.filter(item => item.id !== round.id), round];
    expect(rollPendingCandidates(e, images)).toEqual([]);
    expect(rollPendingCandidates(e, images, round.candidateIds).map(candidate => candidate.id)).toEqual(round.candidateIds);
  }
});

it('旧评分排序值退回正常新旧顺序，不再由投票改变结果顺序', () => {
  const { e, images } = fixture();
  e.votes = [{ id: 'vote', left: 'old', right: 'saved', leftImage: 'old-image', rightImage: 'saved-image', result: 'left', createdAt: 1 }];
  expect(rollWorkspaceCandidates(e, images, { ...view, sort: 'rating' }).map(candidate => candidate.id)).toEqual(['pending', 'saved', 'old']);
  expect(rollWorkspaceCandidates(e, images, { ...view, sort: 'old' }).map(candidate => candidate.id)).toEqual(['old', 'saved', 'pending']);
});
