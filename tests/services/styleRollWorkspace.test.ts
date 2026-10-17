import { expect, it } from 'vitest';
import type { RollCandidate } from '../../services/styleRoll';
import { candidateFixture, rollFixture, rollImageFixture } from '../fixtures/styleRoll';
import { rollPendingCandidates, rollWorkspaceCandidates } from '../../services/styleRollWorkspace';

const fixture = () => {
  const e = rollFixture();
  e.candidates = [candidateFixture('old', 'old_artist'), { ...candidateFixture('saved', 'saved_artist'), savedChainId: 'chain' }, candidateFixture('pending'), { ...candidateFixture('trash'), archived: true }];
  e.rounds = [{ id: 'old-round', candidateIds: ['old'], createdAt: 1, closedAt: 2 }, { id: 'current', candidateIds: ['saved', 'pending'], createdAt: 3 }];
  return { e, images: new Map([['saved', rollImageFixture(e, e.candidates[1])]]) };
};
const view = { filter: 'all', roundId: '', query: '', sort: 'new' };

it('纯新探索与衍生变体按父代划分，和轮次、搜索、回收站规则交叉', () => {
  const e = rollFixture();
  const variant = (id: string, method: RollCandidate['method']): RollCandidate => ({ ...candidateFixture(id, `artist_${id}`), method, parents: ['original'] });
  e.candidates = [candidateFixture('original', 'original_artist'), variant('mutate', 'mutate'), variant('manual', 'manual'),
    { ...variant('trash', 'manual'), archived: true }, candidateFixture('old')];
  e.rounds = [{ id: 'current', candidateIds: ['original', 'mutate', 'manual', 'trash'], createdAt: 1 }];
  const images = new Map();
  const ids = (filter: string, roundId = '', query = '') => rollWorkspaceCandidates(e, images, { ...view, filter, roundId, query }).map(item => item.id);
  expect(ids('originals')).toEqual(['old', 'original']);
  expect(ids('variants')).toEqual(['manual', 'mutate']);
  expect(ids('originals', 'current')).toEqual(['original']);
  expect(ids('variants', 'current', 'artist mutate')).toEqual(['mutate']);
  expect(ids('variants', 'current', '#3')).toEqual(['manual']);
  expect(ids('originals', 'missing')).toEqual([]);
  expect(ids('variants', 'current', 'trash')).toEqual([]);
  expect(ids('archived', 'current')).toEqual(['trash']);
});

it('全部如实展示成图与待生成，编号、画师与轮次筛选一致，并按新旧排序', () => {
  const { e, images } = fixture();
  expect(rollWorkspaceCandidates(e, images, view).map(item => item.id)).toEqual(['pending', 'saved', 'old']);
  expect(rollWorkspaceCandidates(e, images, { ...view, sort: 'old' }).map(item => item.id)).toEqual(['old', 'saved', 'pending']);
  expect(rollWorkspaceCandidates(e, images, { ...view, filter: 'archived' }).map(item => item.id)).toEqual(['trash']);
  expect(rollWorkspaceCandidates(e, images, { ...view, query: 'OLD artist' }).map(item => item.id)).toEqual(['old']);
  expect(rollWorkspaceCandidates(e, images, { ...view, query: '#2' }).map(item => item.id)).toEqual(['saved']);
  expect(rollWorkspaceCandidates(e, images, { ...view, query: '2' }).map(item => item.id)).toEqual(['saved']);
  expect(rollWorkspaceCandidates(e, images, { ...view, roundId: 'current', filter: 'saved' }).map(item => item.id)).toEqual(['saved']);
  expect(rollWorkspaceCandidates(e, images, { ...view, roundId: 'missing' })).toEqual([]);
});

it('补齐仅取当前未结束轮次，不混入历史缺图，关闭轮次后仍可手选生成', () => {
  const { e, images } = fixture();
  expect(rollPendingCandidates(e, images).map(item => item.id)).toEqual(['pending']);
  e.rounds[1].closedAt = 4;
  expect(rollPendingCandidates(e, images)).toEqual([]);
  expect(rollPendingCandidates(e, images, ['old']).map(item => item.id)).toEqual(['old']);
});

it('手选补图排除已出图和回收站项', () => {
  const { e, images } = fixture();
  expect(rollPendingCandidates(e, images, e.candidates.map(item => item.id)).map(item => item.id)).toEqual(['old', 'pending']);
});
