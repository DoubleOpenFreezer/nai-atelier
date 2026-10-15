import { expect, it } from 'vitest';
import { candidateFixture, rollFixture } from '../fixtures/styleRoll';
import { validateRollExperiment, type RollExperiment, type RollRound } from '../../services/styleRoll';
import { beginRollRound, finishRollRound, rollRoundProgress, rollTier } from '../../services/styleRollWorkflow';

const vote = (e: RollExperiment, round: RollRound, a: string, b: string, chosen: string | null) => {
  e.votes.push({ id: `v${e.votes.length}`, roundId: round.id, left: a, right: b, leftImage: `img-${a}`, rightImage: `img-${b}`, result: chosen === null ? 'draw' : chosen === a ? 'left' : 'right', createdAt: e.votes.length });
};
it('新一轮自动从完整目录建配方，存档只保留覆盖项，未出图不安排投票', () => {
  const e = rollFixture(); e.artists = [];
  const next = beginRollRound(e, ['alpha', 'beta', 'gamma', 'delta', 'eta'], 'random', 4);
  expect(next.artists).toEqual([]); expect(next.candidates).toHaveLength(4); expect(next.rounds![0].candidateIds).toHaveLength(4);
  expect(rollRoundProgress(next, next.rounds![0], new Set()).pair).toBeNull(); expect(() => validateRollExperiment(next)).not.toThrow();
});
it('默认批次按出图完成，不安排必做PK，零投票也能完成并继续下一轮', () => {
  const e = beginRollRound(rollFixture(), ['alpha', 'beta', 'gamma', 'delta', 'eta'], 'batch', 4), round = e.rounds![0];
  expect(round.opponents).toEqual([]); expect(rollRoundProgress(e, round, new Set())).toMatchObject({ pair: null, complete: false, settled: 0 });
  const ready = new Set(round.candidateIds); expect(rollRoundProgress(e, round, ready)).toMatchObject({ pair: null, complete: true, settled: 4 });
  const closed = finishRollRound(e, ready); expect(closed.votes).toEqual([]); expect(closed.candidates.every(candidate => !candidate.archived)).toBe(true); expect(() => validateRollExperiment(closed)).not.toThrow();
});
it('新串二分排位有终点，依次完成所有画风；撤销最后一票恢复相同待评对手', () => {
  const e = rollFixture(); e.candidates = ['a', 'b', 'c', 'd', 'f'].map(id => candidateFixture(id));
  const round: RollRound = { id: 'round', kind: 'random', candidateIds: ['a', 'b', 'c', 'd', 'f'], opponents: [], createdAt: 1 }; e.rounds = [round];
  const ready = new Set(round.candidateIds);
  let last: [string, string] | null = null, total = 0;
  while (!rollRoundProgress(e, round, ready).complete && total++ < 20) {
    last = rollRoundProgress(e, round, ready).pair; expect(last).not.toBeNull(); vote(e, round, ...last!, last![0]);
  }
  expect(total).toBeLessThan(20); expect(rollRoundProgress(e, round, ready).settled).toBe(5);
  e.votes.pop(); expect(new Set(rollRoundProgress(e, round, ready).pair)).toEqual(new Set(last!));
  expect(() => finishRollRound(e, ready)).toThrow('请先完成本轮比较');
});
it('已有一张未评级图也能作为下一轮对手，不会每轮一张永远无法排位', () => {
  const e = rollFixture(); e.candidates = [candidateFixture('a')];
  const next = beginRollRound(e, e.artists.map(artist => artist.tag), 'random', 1, undefined, new Set(['a']));
  expect(next.rounds![0].opponents).toEqual(['a']);
  const id = next.rounds![0].candidateIds[0]; expect(new Set(rollRoundProgress(next, next.rounds![0], new Set(['a', id])).pair)).toEqual(new Set(['a', id]));
});
it('进化对照固定优胜组，确认结果后才归档失败和等量旧低位，不删除原候选', () => {
  const e = rollFixture(); e.candidates = ['top', 'low', 'child-win', 'child-lose'].map(id => candidateFixture(id));
  const round: RollRound = { id: 'round', kind: 'evolve', candidateIds: ['child-win', 'child-lose'], opponents: ['top'], createdAt: 1 }; e.rounds = [round];
  vote(e, round, 'child-win', 'top', 'child-win'); vote(e, round, 'child-lose', 'top', 'top');
  const ready = new Set(e.candidates.map(candidate => candidate.id)), p = rollRoundProgress(e, round, ready);
  expect(p.accepted).toEqual(['child-win']); expect(p.rejected).toEqual(['child-lose']); expect(e.candidates.every(candidate => !candidate.archived)).toBe(true);
  const result = finishRollRound(e, ready); expect(result.candidates.filter(candidate => candidate.archived).map(candidate => candidate.id).sort()).toEqual(['child-lose', 'low']);
  expect(result.candidates).toHaveLength(4); expect(result.votes).toEqual(e.votes); expect(result.rounds![0].closedAt).toBeGreaterThan(0);
});
it('精修始终由当前冠军迎战下一变体，胜者自动成为冠军，平局保留冠军', () => {
  const e = rollFixture(); e.candidates = ['base', 'v1', 'v2', 'v3'].map(id => candidateFixture(id));
  const round: RollRound = { id: 'round', kind: 'refine', candidateIds: ['v1', 'v2', 'v3'], opponents: [], baseId: 'base', parentId: 'base', jitter: 0.3, createdAt: 1 }; e.rounds = [round];
  const ready = new Set(e.candidates.map(candidate => candidate.id));
  expect(rollRoundProgress(e, round, ready).pair).toEqual(['base', 'v1']); vote(e, round, 'base', 'v1', 'v1');
  expect(new Set(rollRoundProgress(e, round, ready).pair)).toEqual(new Set(['v1', 'v2'])); vote(e, round, 'v1', 'v2', null); vote(e, round, 'v1', 'v3', 'v3');
  expect(rollRoundProgress(e, round, ready)).toMatchObject({ complete: true, champion: 'v3' });
  const next = beginRollRound(finishRollRound(e, ready), e.artists.map(artist => artist.tag), 'refine', 2, 'v3');
  expect(next.rounds!.at(-1)).toMatchObject({ baseId: 'base', parentId: 'v3', jitter: 0.2 });
});
it('三Seed验证只配同一Seed下的原版和精修图，票数独立且完整存档可校验', () => {
  const e = rollFixture(); e.candidates = [candidateFixture('base'), candidateFixture('champ')];
  e.rounds = [{ id: 'refine', kind: 'refine', candidateIds: ['champ'], opponents: [], baseId: 'base', parentId: 'base', jitter: 0.1, createdAt: 1, closedAt: 2 }];
  const next = beginRollRound(e, [], 'verify', 6, 'champ'), round = next.rounds!.at(-1)!;
  expect(round.candidateIds).toHaveLength(6); expect(() => validateRollExperiment(next)).not.toThrow();
  const ready = new Set(round.candidateIds);
  for (let index = 0; index < 3; index++) {
    const pair = rollRoundProgress(next, round, ready).pair!;
    const sides = pair.map(id => next.candidates.find(candidate => candidate.id === id)!);
    expect(sides[0].seed).toBe(sides[1].seed); vote(next, round, ...pair, pair[1]);
  }
  expect(rollRoundProgress(next, round, ready).complete).toBe(true);
});
it('跳过不计分，重新配对可恢复；等级问号随比较次数减少', () => {
  const e = rollFixture(); e.candidates = ['a', 'b'].map(id => candidateFixture(id));
  const round: RollRound = { id: 'r', kind: 'random', candidateIds: ['a', 'b'], opponents: [], createdAt: 1 }, ready = new Set(['a', 'b']);
  expect(rollRoundProgress(e, round, ready, new Set(['a:b'])).pair).toBeNull(); expect(rollRoundProgress(e, round, ready).pair).not.toBeNull(); expect(e.votes).toEqual([]);
  expect(rollTier(1100, 0, [1100, 1000]).tier).toBe('待评'); expect(rollTier(1200, 1, [1200, 1000]).provisional).toBe(true); expect(rollTier(1200, 10, [1200, 1000]).provisional).toBe(false);
});
it('原版仍为冠军时三个Seed只出三张，避免为相同配方重复消费', () => {
  const e = rollFixture(); e.candidates = [candidateFixture('base')];
  const next = beginRollRound(e, [], 'verify', 6, 'base'), round = next.rounds![0];
  expect(round.candidateIds).toHaveLength(3); expect(new Set(next.candidates.slice(1).map(candidate => candidate.seed)).size).toBe(3);
  expect(rollRoundProgress(next, round, new Set(round.candidateIds))).toMatchObject({ complete: true, pair: null });
  expect(() => validateRollExperiment(next)).not.toThrow();
});

it('改选另一套画风精修时重新建立基准，不沿用上一套的原版或调整幅度', () => {
  const e = rollFixture(); e.candidates = ['base', 'champ', 'other'].map(id => candidateFixture(id));
  e.rounds = [{ id: 'refine', kind: 'refine', candidateIds: ['champ'], opponents: [], baseId: 'base', parentId: 'base', jitter: 0.1, createdAt: 1, closedAt: 2 }];
  const next = beginRollRound(e, [], 'refine', 1, 'other');
  expect(next.rounds!.at(-1)).toMatchObject({ baseId: 'other', parentId: 'other', jitter: 0.3 });
});
