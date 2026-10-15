import { expect, it } from 'vitest';
import { candidateFixture, rollFixture, rollImageFixture } from '../fixtures/styleRoll';
import { rollPendingCandidates, rollWorkspaceCandidates } from '../../services/styleRollWorkspace';

const fixture = () => {
  const e = rollFixture();
  e.candidates = [candidateFixture('old', 'old_artist'), { ...candidateFixture('saved', 'saved_artist'), savedChainId: 'chain' }, candidateFixture('pending'), { ...candidateFixture('trash'), archived: true }];
  e.rounds = [{ id: 'old-round', kind: 'batch', candidateIds: ['old'], opponents: [], createdAt: 1, closedAt: 2 }, { id: 'current', kind: 'batch', candidateIds: ['saved', 'pending'], opponents: [], createdAt: 3 }];
  return { e, images: new Map([['saved', rollImageFixture(e, e.candidates[1])]]) };
};
const view = { filter: 'all', roundId: '', query: '', sort: 'new' };

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
