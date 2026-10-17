import { createUuid } from './id';
import { resolveRollArtists, rollCandidates, type RollExperiment, type RollRound } from './styleRoll';

export const currentRollRound = (e: RollExperiment) => e.rounds.at(-1);

export function beginRollRound(e: RollExperiment, library: string[], count: number): RollExperiment {
  const added = rollCandidates({ ...e, artists: resolveRollArtists(library, e.artists) }, count, { mode: 'saved' });
  const round: RollRound = { id: createUuid(), candidateIds: added.map(candidate => candidate.id), createdAt: Date.now() };
  return { ...e, candidates: [...e.candidates, ...added], rounds: [...e.rounds, round] };
}
