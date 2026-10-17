import type { LocalGenItem } from '../../types';
import { DEFAULT_ROLL_RULES, parseRollArtists, rollCandidateModuleId, rollPrompt, rollSourceId, type RollCandidate, type RollExperiment } from '../../services/styleRoll';

export const rollFixture = (): RollExperiment => ({
  version: 1, id: 'synthetic-experiment', name: '合成实验', revision: 1, createdAt: 1, updatedAt: 1,
  template: { prompt: '{style}, synthetic subject', negativePrompt: 'synthetic negative', params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 0, qualityToggle: false, ucPreset: 4 } },
  artists: parseRollArtists('alpha, beta, gamma, delta, epsilon, zeta, eta, theta'), rules: { ...DEFAULT_ROLL_RULES }, candidates: [], votes: [],
});
export const candidateFixture = (id: string, tag = id): RollCandidate => ({ id, genes: [{ tag, weight: 1 }], method: 'random', parents: [], generation: 0, createdAt: 1, archived: false });
export const legacyRollFixture = (): RollExperiment => {
  const e = rollFixture();
  e.candidates = [candidateFixture('base', 'alpha'),
    { ...candidateFixture('mutated', 'beta'), method: 'mutate', parents: ['base'], generation: 1 },
    { ...candidateFixture('crossed', 'gamma'), method: 'crossover', parents: ['base', 'mutated'], generation: 2 },
    { ...candidateFixture('refined', 'delta'), method: 'refine', parents: ['mutated'], generation: 2 },
    { ...candidateFixture('manual', 'epsilon'), method: 'manual', parents: ['base'], generation: 1 },
    ...[1, 2, 3].map(seed => ({ ...candidateFixture(`verify-${seed}`, 'alpha'), method: 'manual' as const, parents: ['base'], seed }))];
  e.rounds = [
    { id: 'random', kind: 'random', candidateIds: ['base'], opponents: ['mutated'], createdAt: 1 },
    { id: 'evolve', kind: 'evolve', candidateIds: ['crossed'], opponents: ['base'], createdAt: 2 },
    { id: 'refine', kind: 'refine', candidateIds: ['refined'], opponents: [], baseId: 'base', parentId: 'mutated', jitter: 0.2, createdAt: 3 },
    { id: 'batch', kind: 'batch', candidateIds: ['manual'], opponents: [], createdAt: 4 },
    { id: 'verify', kind: 'verify', candidateIds: ['verify-1', 'verify-2', 'verify-3'], opponents: [], baseId: 'base', parentId: 'base', createdAt: 5 },
  ];
  e.votes = [{ id: 'old-vote', roundId: 'random', left: 'base', right: 'mutated', leftImage: 'original-base', rightImage: 'original-mutated', result: 'left', createdAt: 1 }];
  e.finalCandidateId = 'refined';
  return e;
};
export const rollImageFixture = (experiment: RollExperiment, candidate: RollCandidate, id = `history-${candidate.id}`): LocalGenItem => ({
  id, imageUrl: `/api/local-history/${id}/image`, prompt: rollPrompt(experiment.template, candidate.genes), negativePrompt: experiment.template.negativePrompt,
  params: { ...structuredClone(experiment.template.params), ...(candidate.seed === undefined ? {} : { seed: candidate.seed }) }, createdAt: 1, sourceChainId: rollSourceId(experiment.id), sourceChainName: experiment.name, sourceChainType: 'style',
  modules: [{ id: rollCandidateModuleId(candidate.id), name: 'Roll 串', content: '', isActive: false }],
});
export const seededRandom = () => { let value = 42; return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; }; };
