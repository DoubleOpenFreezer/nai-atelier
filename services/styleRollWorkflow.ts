import { createUuid } from './id';
import { rankRollCandidates, resolveRollArtists, rollCandidates, scoreRollCandidates, type RollCandidate, type RollExperiment, type RollRound, type RollVote } from './styleRoll';

export const rollVerificationIds = (e: RollExperiment) => new Set((e.rounds || []).filter(round => round.kind === 'verify').flatMap(round => round.candidateIds));
export const currentRollRound = (e: RollExperiment) => e.rounds?.at(-1);
const winner = (vote: RollVote) => vote.result === 'draw' ? null : vote.result === 'left' ? vote.left : vote.right;

/** 排位使用这一轮开始时的对手顺序，不让进行中的 Elo 变化挪动比较目标。 */
export function rollRoundProgress(e: RollExperiment, round: RollRound, ready: Set<string>, skipped = new Set<string>()) {
  const votes = e.votes.filter(vote => vote.roundId === round.id);
  const voted = (a: string, b: string) => votes.find(vote => (vote.left === a && vote.right === b) || (vote.left === b && vote.right === a));
  const canPair = (a: string, b: string) => ready.has(a) && ready.has(b) && !skipped.has([a, b].sort().join(':'));
  let pair: [string, string] | null = null, champion = round.parentId || '', settled = 0;
  const accepted: string[] = [], rejected: string[] = [];
  if (round.kind === 'batch') {
    settled = round.candidateIds.filter(id => ready.has(id)).length;
  } else if (round.kind === 'verify') {
    if (round.candidateIds.length === 3) settled = round.candidateIds.filter(id => ready.has(id)).length;
    else for (let index = 0; index < round.candidateIds.length; index += 2) {
      const a = round.candidateIds[index], b = round.candidateIds[index + 1], vote = voted(a, b);
      if (vote) { settled += 2; if (winner(vote) === b) accepted.push(b); else if (winner(vote) === a) rejected.push(b); }
      else if (!pair && canPair(a, b)) pair = [a, b];
    }
  } else if (round.kind === 'refine') {
    for (const id of round.candidateIds) {
      const vote = voted(champion, id);
      if (!vote) { if (canPair(champion, id)) pair = [champion, id]; break; }
      if (winner(vote) === id) { champion = id; accepted.push(id); } else rejected.push(id);
      settled++;
    }
  } else {
    const ladder = [...round.opponents];
    for (const id of round.candidateIds) {
      if (!ready.has(id)) continue;
      let low = 0, high = ladder.length, waiting = false;
      while (low < high) {
        const middle = Math.floor((low + high) / 2), rival = ladder[middle], vote = voted(id, rival);
        if (!vote) { if (!pair && canPair(id, rival)) pair = [id, rival]; waiting = true; break; }
        const chosen = winner(vote);
        if (!chosen) { low = high = middle; break; }
        if (chosen === id) high = middle; else low = middle + 1;
      }
      if (waiting) continue;
      settled++;
      if (round.kind === 'evolve') { if (low < ladder.length) accepted.push(id); else rejected.push(id); }
      else ladder.splice(low, 0, id);
    }
  }
  // 两侧随票数交换，配对与胜负判断均按候选 ID，而不是屏幕左右。
  if (pair && votes.length % 2) pair = [pair[1], pair[0]];
  return { pair, champion, settled, total: round.candidateIds.length, complete: settled === round.candidateIds.length, accepted, rejected,
    pending: round.candidateIds.filter(id => !ready.has(id)) };
}

export function beginRollRound(e: RollExperiment, library: string[], kind: RollRound['kind'], count: number, parentId?: string, ready = new Set<string>()): RollExperiment {
  const now = Date.now(), previous = currentRollRound(e), verification = rollVerificationIds(e);
  const ranked = rankRollCandidates(e).filter(candidate => !candidate.archived && !verification.has(candidate.id));
  const scores = scoreRollCandidates(e), rated = ranked.filter(candidate => scores.get(candidate.id)!.matches > 0);
  const parent = e.candidates.find(candidate => candidate.id === parentId);
  if (['refine', 'verify'].includes(kind) && !parent) throw new Error('请先选择喜欢的画风');
  let added: RollCandidate[];
  const round: RollRound = { id: createUuid(), kind, candidateIds: [], opponents: kind === 'batch' ? [] : kind === 'evolve' ? rated.slice(0, Math.max(1, Math.ceil(rated.length * 0.3))).map(candidate => candidate.id) : ranked.filter(candidate => scores.get(candidate.id)!.matches || ready.has(candidate.id)).map(candidate => candidate.id), createdAt: now };
  if (kind === 'refine' || kind === 'verify') {
    round.parentId = parent!.id;
    const continuesRefine = previous?.kind === 'refine' && (previous.parentId === parent!.id || previous.candidateIds.includes(parent!.id));
    round.baseId = continuesRefine ? previous.baseId : parent!.id;
    if (kind === 'verify') {
      const base = e.candidates.find(candidate => candidate.id === round.baseId)!;
      const seeds: number[] = [];
      for (let index = 0; index < 3; index++) { let seed = crypto.getRandomValues(new Uint32Array(1))[0]; while (seeds.includes(seed)) seed = (seed + 1) % 4294967296; seeds.push(seed); }
      added = seeds.flatMap(seed => (base.id === parent!.id ? [base] : [base, parent!]).map(source => ({ ...source,
        id: createUuid(), seed, genes: structuredClone(source.genes), parents: [source.id], method: 'manual' as const,
        generation: source.generation, createdAt: now, archived: false, savedChainId: undefined })));
    } else {
      round.jitter = continuesRefine ? Math.max(0.1, Math.round(((previous.jitter ?? 0.3) - 0.1) * 10) / 10) : 0.3;
      added = rollCandidates({ ...e, artists: resolveRollArtists(library, e.artists, parent!.genes) }, count, { mode: 'refine', parentId, jitter: round.jitter });
    }
  } else added = rollCandidates({ ...e, candidates: e.candidates.filter(candidate => !verification.has(candidate.id)), artists: resolveRollArtists(library, e.artists) }, count, { mode: kind === 'batch' ? 'saved' : kind === 'evolve' ? 'evolve' : 'random' });
  if (e.candidates.length + added.length > 240) throw new Error('本次画风记录已满，请开始新的画风探索');
  round.candidateIds = added.map(candidate => candidate.id);
  return { ...e, finalCandidateId: undefined, candidates: [...e.candidates, ...added], rounds: [...(e.rounds || []), round] };
}

/** 确认一代后才归档未胜出的新组合和等量旧低位；原图与投票始终保留。 */
export function finishRollRound(e: RollExperiment, ready: Set<string>): RollExperiment {
  const round = currentRollRound(e); if (!round || round.closedAt) return e;
  const progress = rollRoundProgress(e, round, ready);
  if (!progress.complete) throw new Error('请先完成本轮比较');
  const archive = new Set(round.kind === 'evolve' ? progress.rejected : []);
  if (round.kind === 'evolve') {
    const old = rankRollCandidates(e).filter(candidate => !candidate.archived && !round.candidateIds.includes(candidate.id) && !round.opponents.includes(candidate.id));
    old.reverse().slice(0, progress.accepted.length).forEach(candidate => archive.add(candidate.id));
  }
  return { ...e, rounds: e.rounds!.map(item => item.id === round.id ? { ...item, closedAt: Date.now() } : item),
    candidates: e.candidates.map(candidate => archive.has(candidate.id) ? { ...candidate, archived: true } : candidate) };
}

export function rollTier(rating: number, matches: number, rankedRatings: number[]) {
  if (!matches || !rankedRatings.length) return { tier: '待评', provisional: true };
  const rank = rankedRatings.filter(value => value > rating).length + 1, percentile = (rank - 0.5) / rankedRatings.length;
  const tier = percentile < 0.1 ? 'S' : percentile < 0.3 ? 'A' : percentile < 0.6 ? 'B' : percentile < 0.85 ? 'C' : 'D';
  return { tier, provisional: matches < Math.max(3, Math.ceil(Math.log2(rankedRatings.length + 1))) };
}
