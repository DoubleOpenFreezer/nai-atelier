import type { LocalGenItem } from '../types';
import { scoreRollCandidates, type RollExperiment } from './styleRoll';
import { currentRollRound, rollVerificationIds } from './styleRollWorkflow';

export interface RollWorkspaceView { filter: string; roundId: string; query: string; sort: string }

export function rollWorkspaceCandidates(experiment: RollExperiment, images: Map<string, LocalGenItem>, view: RollWorkspaceView) {
  const verification = rollVerificationIds(experiment);
  const round = experiment.rounds?.find(item => item.id === view.roundId);
  const query = view.query.trim().toLowerCase().replaceAll('_', ' ');
  const scores = view.sort === 'rating' ? scoreRollCandidates(experiment) : null;
  return experiment.candidates.filter((candidate, index) => {
    if (verification.has(candidate.id) || (view.roundId && !round?.candidateIds.includes(candidate.id))) return false;
    if (view.filter === 'archived' ? !candidate.archived : candidate.archived) return false;
    if (view.filter === 'saved' && !candidate.savedChainId || view.filter === 'pending' && images.has(candidate.id)) return false;
    if (view.filter === 'originals' && (candidate.method === 'refine' || (candidate.parents && candidate.parents.length > 0))) return false;
    if (view.filter === 'variants' && candidate.method !== 'refine' && (!candidate.parents || candidate.parents.length === 0)) return false;
    return !query || String(index + 1) === query || `#${index + 1}` === query || candidate.genes.some(gene => gene.tag.toLowerCase().replaceAll('_', ' ').includes(query));
  }).sort((a, b) => scores ? scores.get(b.id)!.rating - scores.get(a.id)!.rating
    : view.sort === 'old' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt || experiment.candidates.indexOf(b) - experiment.candidates.indexOf(a));
}

/** 展示按钮与实际提交使用同一范围，不把历史缺图冒充成本轮待生成。 */
export function rollPendingCandidates(experiment: RollExperiment, images: Map<string, LocalGenItem>, ids?: readonly string[]) {
  const scope = ids ?? (currentRollRound(experiment)?.closedAt ? [] : currentRollRound(experiment)?.candidateIds ?? []);
  const voted = new Set(experiment.votes.flatMap(vote => [vote.left, vote.right]));
  return experiment.candidates.filter(candidate => scope.includes(candidate.id) && !candidate.archived && !images.has(candidate.id) && !voted.has(candidate.id));
}
