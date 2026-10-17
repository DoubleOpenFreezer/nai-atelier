import { expect, it } from 'vitest';
import { legacyRollFixture, rollFixture } from '../fixtures/styleRoll';
import { validateRollExperiment } from '../../services/styleRoll';
import { beginRollRound, currentRollRound, rollVerificationIds } from '../../services/styleRollWorkflow';

it('新一轮自动从完整目录建普通批次，存档只保留覆盖项，不要求投票', () => {
  const e = rollFixture(); e.artists = [];
  const next = beginRollRound(e, ['alpha', 'beta', 'gamma', 'delta', 'eta'], 4);
  expect(next.artists).toEqual([]); expect(next.candidates).toHaveLength(4);
  expect(currentRollRound(next)).toMatchObject({ kind: 'batch', opponents: [], candidateIds: next.candidates.map(candidate => candidate.id) });
  expect(next.votes).toEqual([]); expect(() => validateRollExperiment(next)).not.toThrow();
  expect(e.candidates).toEqual([]); expect(e.rounds).toBeUndefined();
});

it('旧轮次无需完成比较即可再Roll，旧票、原图绑定、谱系与最终候选完整保留', () => {
  const e = legacyRollFixture(), before = structuredClone(e);
  const next = beginRollRound(e, e.artists.map(artist => artist.tag), 4);
  expect(next.candidates.slice(0, e.candidates.length)).toEqual(before.candidates);
  expect(next.rounds!.slice(0, e.rounds!.length)).toEqual(before.rounds); expect(next.votes).toEqual(before.votes);
  expect(next.finalCandidateId).toBe(before.finalCandidateId);
  expect(currentRollRound(next)).toMatchObject({ kind: 'batch', opponents: [] });
  expect(rollVerificationIds(next)).toEqual(new Set(['verify-1', 'verify-2', 'verify-3']));
  expect(() => validateRollExperiment(next)).not.toThrow(); expect(e).toEqual(before);
});

it('已保存的旧验证副本不作为下一轮偏好父代', () => {
  const e = legacyRollFixture(); e.candidates.find(candidate => candidate.id === 'verify-1')!.savedChainId = 'saved-copy';
  const next = beginRollRound(e, e.artists.map(artist => artist.tag), 4);
  const added = next.candidates.slice(e.candidates.length);
  expect(added.every(candidate => candidate.method === 'random' && !candidate.parents.length)).toBe(true);
});

it('旧投票的图片绑定验证继续拒绝替换原图', () => {
  const e = legacyRollFixture(); expect(() => validateRollExperiment(e)).not.toThrow();
  e.votes.push({ ...e.votes[0], id: 'replacement-vote', leftImage: 'replacement-base' });
  expect(() => validateRollExperiment(e)).toThrow('已评价候选的对照图不可替换');
});
