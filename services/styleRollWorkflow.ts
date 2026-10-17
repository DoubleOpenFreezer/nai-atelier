import { createUuid } from './id';
import { resolveRollArtists, rollCandidates, type RollExperiment, type RollRound } from './styleRoll';

export const rollVerificationIds = (e: RollExperiment) => new Set((e.rounds || []).filter(round => round.kind === 'verify').flatMap(round => round.candidateIds));
export const currentRollRound = (e: RollExperiment) => e.rounds?.at(-1);

export function beginRollRound(e: RollExperiment, library: string[], count: number): RollExperiment {
  const verification = rollVerificationIds(e);
  const added = rollCandidates({ ...e, candidates: e.candidates.filter(candidate => !verification.has(candidate.id)), artists: resolveRollArtists(library, e.artists) }, count, { mode: 'saved' });
  if (e.candidates.length + added.length > 240) throw new Error('本次画风记录已满，请开始新的画风探索');
  const round: RollRound = { id: createUuid(), kind: 'batch', candidateIds: added.map(candidate => candidate.id), opponents: [], createdAt: Date.now() };
  return { ...e, candidates: [...e.candidates, ...added], rounds: [...(e.rounds || []), round] };
}
