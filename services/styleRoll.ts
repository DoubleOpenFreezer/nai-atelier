import type { NAIParams, PromptChain } from '../types';
import { createUuid } from './id';

export interface RollArtist { tag: string; weight: number; locked: boolean; excluded: boolean }
export interface RollGene { tag: string; weight: number }
export interface RollRules { minArtists: number; maxArtists: number; minWeight: number; maxWeight: number }
export interface RollTemplate { prompt: string; negativePrompt: string; params: NAIParams }
export type RollMethod = 'random' | 'mutate' | 'crossover' | 'refine' | 'manual';
export interface RollCandidate {
  id: string;
  genes: RollGene[];
  method: RollMethod;
  parents: string[];
  generation: number;
  createdAt: number;
  archived: boolean;
  savedChainId?: string;
  seed?: number;
}
export interface RollVote { id: string; left: string; right: string; leftImage: string; rightImage: string; result: 'left' | 'right' | 'draw'; createdAt: number; roundId?: string }
export interface RollRound {
  id: string; kind: 'batch' | 'random' | 'evolve' | 'refine' | 'verify'; candidateIds: string[]; opponents: string[];
  createdAt: number; closedAt?: number; baseId?: string; parentId?: string; jitter?: number;
}
export interface RollExperiment {
  version: 1;
  id: string;
  name: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  template: RollTemplate;
  artists: RollArtist[];
  rules: RollRules;
  candidates: RollCandidate[];
  votes: RollVote[];
  rounds?: RollRound[];
  finalCandidateId?: string;
  archived?: boolean;
}
export interface RollScore { rating: number; matches: number; wins: number; draws: number }

export const DEFAULT_ROLL_RULES: RollRules = { minArtists: 3, maxArtists: 6, minWeight: 0.7, maxWeight: 1.4 };
export const ROLL_CANDIDATE_LIMIT = 240;
const tenth = (value: number) => Math.round(value * 10) / 10;
const tagKey = (tag: string) => tag.trim().replaceAll('_', ' ').replace(/\s+/g, ' ').toLowerCase();
const validTag = (tag: unknown): tag is string => typeof tag === 'string' && tag.trim().length > 0 && tag.length <= 200 && !/[,\n\r:{}\[\]<>]/.test(tag);
const validWeight = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0.1 && value <= 3 && Math.abs(value * 10 - Math.round(value * 10)) < 1e-8;

/** 指定画师只覆盖抽取规则，数值权重作为锁定时的初始值，不混入主体提示词。 */
export function parseRollArtists(text: string): RollArtist[] {
  const result: RollArtist[] = [], seen = new Set<string>();
  for (const part of text.split(/[,，\n\r]+/).map(value => value.trim()).filter(Boolean)) {
    const weighted = part.match(/^([\d.]+)::\s*(.*?)\s*::$/);
    const tag = (weighted ? weighted[2] : part).replace(/^artist\s*:\s*/i, '').trim();
    const weight = weighted ? Number(weighted[1]) : 1;
    if (!validTag(tag) || !validWeight(weight)) throw new Error('请填写画师 Tag，权重使用 0.1～3.0 的一位小数');
    if (!seen.has(tagKey(tag))) { seen.add(tagKey(tag)); result.push({ tag, weight, locked: false, excluded: false }); }
  }
  if (result.length > 1000) throw new Error('每个实验最多指定 1000 位画师');
  return result;
}

export function mergeRollArtists(current: RollArtist[], incoming: RollArtist[]): RollArtist[] {
  const keys = new Set(current.map(artist => tagKey(artist.tag)));
  const added = incoming.filter(artist => { const key = tagKey(artist.tag); if (keys.has(key)) return false; keys.add(key); return true; });
  if (current.length + added.length > 1000) throw new Error('每个实验最多指定 1000 位画师');
  return [...current, ...added];
}

/** 直接从完整画师词库抽取；实验只保存锁定／排除等覆盖项，不复制整份词库。 */
export function resolveRollArtists(library: string[], overrides: RollArtist[], parent: RollGene[] = []): RollArtist[] {
  const artists = new Map<string, RollArtist>();
  for (const tag of library) if (validTag(tag) && !artists.has(tagKey(tag))) artists.set(tagKey(tag), { tag, weight: 1, locked: false, excluded: false });
  // 已有候选可继续微调权重，即使后来词库移除了这个名字。
  for (const gene of parent) if (!artists.has(tagKey(gene.tag))) artists.set(tagKey(gene.tag), { ...gene, locked: false, excluded: false });
  for (const artist of overrides) artists.set(tagKey(artist.tag), artist);
  return [...artists.values()];
}

export const formatRollStyle = (genes: RollGene[]) => genes.map(gene => `${gene.weight.toFixed(1)}::artist:${gene.tag} ::`).join(', ');
export const rollSignature = (genes: RollGene[]) => JSON.stringify(genes.map(gene => [tagKey(gene.tag), tenth(gene.weight)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
export const rollSourceId = (experimentId: string) => `style-roll:${experimentId}`;
export const rollCandidateModuleId = (candidateId: string) => `style-roll:${candidateId}`;
export const rollPrompt = (template: RollTemplate, genes: RollGene[]) => template.prompt.replace('{style}', formatRollStyle(genes));

export function validateRollTemplate(template: RollTemplate): void {
  if (!template || typeof template.prompt !== 'string' || template.prompt.length > 32000 || template.prompt.split('{style}').length !== 2 ||
    typeof template.negativePrompt !== 'string' || template.negativePrompt.length > 32000) throw new Error('公共提示词需要且只能包含一个 {style} 占位符');
  const p = template.params;
  if (!p || typeof p.model !== 'string' || !/^nai-diffusion-(?:4|4-5|5)-/.test(p.model) || p.model.endsWith('-inpainting') ||
    !Number.isSafeInteger(p.seed) || p.seed! < 0 || p.seed! > 4294967295 ||
    ![p.width, p.height].every(value => Number.isSafeInteger(value) && value >= 64 && value <= 4096 && value % 64 === 0) ||
    !Number.isSafeInteger(p.steps) || p.steps < 1 || p.steps > 50 || !Number.isFinite(p.scale) || p.scale < 0 || p.scale > 10 ||
    typeof p.sampler !== 'string' || p.sampler.length > 100) throw new Error('请设置有效的文生图参数与固定 Seed');
}

function validateRuleRanges(rules: RollRules): void {
  if (!rules || !Number.isSafeInteger(rules.minArtists) || !Number.isSafeInteger(rules.maxArtists) ||
    rules.minArtists < 1 || rules.maxArtists > 16 || rules.minArtists > rules.maxArtists ||
    !validWeight(rules.minWeight) || !validWeight(rules.maxWeight) || rules.minWeight > rules.maxWeight) throw new Error('请检查画师数量和权重范围');
}

export function validateRollRules(artists: RollArtist[], rules: RollRules): void {
  validateRuleRanges(rules);
  const usable = artists.filter(artist => !artist.excluded), locked = usable.filter(artist => artist.locked);
  if (usable.length < rules.minArtists) throw new Error('可用画师不足，请调整锁定／排除项或降低最少画师数');
  if (locked.length > rules.maxArtists) throw new Error('锁定画师数量超过每串上限');
}

/** 保存／导入是信任边界，旧实验读坏时停止，不能用空数据覆盖。 */
export function validateRollExperiment(value: unknown): asserts value is RollExperiment {
  const e = value as RollExperiment;
  const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
  if (!e || e.version !== 1 || !validId(e.id) || typeof e.name !== 'string' || !e.name.trim() || e.name.length > 120 ||
    !Number.isSafeInteger(e.revision) || e.revision < 0 || ![e.createdAt, e.updatedAt].every(Number.isFinite) ||
    !Array.isArray(e.artists) || e.artists.length > 1000 || !Array.isArray(e.candidates) || e.candidates.length > ROLL_CANDIDATE_LIMIT ||
    !Array.isArray(e.votes) || e.votes.length > 10000 || (e.archived !== undefined && typeof e.archived !== 'boolean')) throw new Error('Roll 串实验资料无效');
  validateRollTemplate(e.template);
  const keys = new Set<string>();
  for (const artist of e.artists) {
    if (!artist || !validTag(artist.tag) || !validWeight(artist.weight) || typeof artist.locked !== 'boolean' || typeof artist.excluded !== 'boolean' ||
      keys.has(tagKey(artist.tag))) throw new Error('指定画师包含无效或重复条目');
    keys.add(tagKey(artist.tag));
  }
  // 未指定覆盖项时直接使用画师库；实际组串时再检查可用数量。
  validateRuleRanges(e.rules);
  const ids = new Set<string>();
  for (const candidate of e.candidates) {
    if (!candidate || !validId(candidate.id) || ids.has(candidate.id) || !Array.isArray(candidate.genes) || !candidate.genes.length || candidate.genes.length > 16 ||
      !candidate.genes.every(gene => gene && validTag(gene.tag) && validWeight(gene.weight)) || new Set(candidate.genes.map(gene => tagKey(gene.tag))).size !== candidate.genes.length ||
      !['random', 'mutate', 'crossover', 'refine', 'manual'].includes(candidate.method) || !Number.isSafeInteger(candidate.generation) || candidate.generation < 0 ||
      !Number.isFinite(candidate.createdAt) || (candidate.seed !== undefined && (!Number.isSafeInteger(candidate.seed) || candidate.seed < 0 || candidate.seed > 4294967295)) || typeof candidate.archived !== 'boolean' || !Array.isArray(candidate.parents) || candidate.parents.length > 2 ||
      candidate.parents.some(id => !ids.has(id)) || (candidate.savedChainId !== undefined && !validId(candidate.savedChainId))) throw new Error('候选串或谱系资料无效');
    ids.add(candidate.id);
  }
  const rounds = new Set<string>();
  if (e.rounds !== undefined && (!Array.isArray(e.rounds) || e.rounds.length > ROLL_CANDIDATE_LIMIT)) throw new Error('画风轮次资料无效');
  for (const round of e.rounds || []) {
    if (!round || !validId(round.id) || rounds.has(round.id) || !['batch', 'random', 'evolve', 'refine', 'verify'].includes(round.kind) ||
      !Number.isFinite(round.createdAt) || (round.closedAt !== undefined && !Number.isFinite(round.closedAt)) ||
      !Array.isArray(round.candidateIds) || !round.candidateIds.length || round.candidateIds.length > 24 || new Set(round.candidateIds).size !== round.candidateIds.length || round.candidateIds.some(id => !ids.has(id)) ||
      !Array.isArray(round.opponents) || round.opponents.length > ROLL_CANDIDATE_LIMIT || new Set(round.opponents).size !== round.opponents.length || round.opponents.some(id => !ids.has(id) || round.candidateIds.includes(id)) ||
      (round.baseId !== undefined && !ids.has(round.baseId)) || (round.parentId !== undefined && !ids.has(round.parentId)) ||
      (round.jitter !== undefined && ![0.1, 0.2, 0.3].includes(round.jitter)) ||
      (round.kind === 'refine' && (!round.baseId || !round.parentId || round.jitter === undefined)) ||
      (round.kind === 'verify' && (!round.baseId || !round.parentId || ![3, 6].includes(round.candidateIds.length)))) throw new Error('画风轮次资料无效');
    rounds.add(round.id);
  }
  if (e.finalCandidateId !== undefined && !ids.has(e.finalCandidateId)) throw new Error('最终画风资料无效');
  const voteIds = new Set<string>(), votedImages = new Map<string, string>();
  for (const vote of e.votes) {
    if (!vote || !validId(vote.id) || voteIds.has(vote.id) || !ids.has(vote.left) || !ids.has(vote.right) || vote.left === vote.right ||
      !validId(vote.leftImage) || !validId(vote.rightImage) || vote.leftImage === vote.rightImage ||
      !['left', 'right', 'draw'].includes(vote.result) || !Number.isFinite(vote.createdAt) || (vote.roundId !== undefined && !rounds.has(vote.roundId))) throw new Error('对比记录无效');
    for (const [candidate, image] of [[vote.left, vote.leftImage], [vote.right, vote.rightImage]]) {
      if (votedImages.has(candidate) && votedImages.get(candidate) !== image) throw new Error('已评价候选的对照图不可替换');
      votedImages.set(candidate, image);
    }
    voteIds.add(vote.id);
  }
}

/** Elo 只表达这个实验内的相对偏好，分数由投票重放，撤销不积累舍入误差。 */
export function scoreRollCandidates(experiment: Pick<RollExperiment, 'candidates' | 'votes'>): Map<string, RollScore> {
  const scores = new Map(experiment.candidates.map(candidate => [candidate.id, { rating: 1000, matches: 0, wins: 0, draws: 0 }]));
  for (const vote of experiment.votes) {
    const left = scores.get(vote.left), right = scores.get(vote.right);
    if (!left || !right) continue;
    const result = vote.result === 'draw' ? 0.5 : vote.result === 'left' ? 1 : 0;
    const delta = 32 * (result - 1 / (1 + 10 ** ((right.rating - left.rating) / 400)));
    left.rating += delta; right.rating -= delta;
    left.matches++; right.matches++;
    if (result === 1) left.wins++; else if (result === 0) right.wins++; else { left.draws++; right.draws++; }
  }
  return scores;
}

export function rankRollCandidates(experiment: Pick<RollExperiment, 'candidates' | 'votes'>): RollCandidate[] {
  const scores = scoreRollCandidates(experiment);
  return [...experiment.candidates].sort((a, b) => Number(scores.get(b.id)!.matches > 0) - Number(scores.get(a.id)!.matches > 0) || scores.get(b.id)!.rating - scores.get(a.id)!.rating || scores.get(b.id)!.matches - scores.get(a.id)!.matches || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export const rollPairKey = (left: string, right: string) => [left, right].sort().join(':');

/** 优先补足未评候选，再选择接近分数的少见组合；跳过不被算成平局。 */
export function nextRollPair(experiment: RollExperiment, ready: Set<string>, skipped = new Set<string>()): [string, string] | null {
  const scores = scoreRollCandidates(experiment), eligible = experiment.candidates.filter(candidate => !candidate.archived && ready.has(candidate.id));
  const counts = new Map<string, number>();
  for (const vote of experiment.votes) { const key = rollPairKey(vote.left, vote.right); counts.set(key, (counts.get(key) || 0) + 1); }
  const last = experiment.votes.at(-1);
  let best: [string, string] | null = null, cost = Infinity;
  for (let i = 0; i < eligible.length; i++) for (let j = i + 1; j < eligible.length; j++) {
    const a = eligible[i].id, b = eligible[j].id, key = rollPairKey(a, b);
    if (skipped.has(key)) continue;
    const left = scores.get(a)!, right = scores.get(b)!;
    const candidateCost = (counts.get(key) || 0) * 10000 + Math.min(left.matches, right.matches) * 1000 + Math.max(left.matches, right.matches) * 20 +
      Math.abs(left.rating - right.rating) + (last && rollPairKey(last.left, last.right) === key ? 5000 : 0);
    if (candidateCost < cost) { cost = candidateCost; best = (experiment.votes.length + i + j) % 2 ? [a, b] : [b, a]; }
  }
  return best;
}

export function rollCandidates(experiment: RollExperiment, count: number, options: { mode?: 'random' | 'saved' | 'evolve' | 'mutate' | 'refine'; parentId?: string; jitter?: number; random?: () => number } = {}): RollCandidate[] {
  validateRollRules(experiment.artists, experiment.rules);
  if (!Number.isSafeInteger(count) || count < 1 || count > 24 || experiment.candidates.length + count > ROLL_CANDIDATE_LIMIT) throw new Error('每次可 Roll 1～24 串，每个实验最多 240 串');
  const random = options.random || Math.random, rules = experiment.rules;
  const pool = experiment.artists.filter(artist => !artist.excluded), locked = pool.filter(artist => artist.locked);
  const poolKeys = new Set(pool.map(artist => tagKey(artist.tag))), lockedKeys = new Set(locked.map(artist => tagKey(artist.tag)));
  const choose = <T,>(items: T[]): T => items[Math.min(items.length - 1, Math.floor(random() * items.length))];
  const integer = (min: number, max: number) => min + Math.min(max - min, Math.floor(random() * (max - min + 1)));
  const weight = () => integer(Math.round(rules.minWeight * 10), Math.round(rules.maxWeight * 10)) / 10;
  const clamp = (value: number) => tenth(Math.max(rules.minWeight, Math.min(rules.maxWeight, value)));
  const scores = scoreRollCandidates(experiment);
  const rated = rankRollCandidates(experiment).filter(candidate => !candidate.archived && scores.get(candidate.id)!.matches > 0);
  const parents = options.mode === 'saved' ? experiment.candidates.filter(candidate => candidate.savedChainId && !candidate.archived && candidate.genes.some(gene => poolKeys.has(tagKey(gene.tag))))
    : options.parentId ? experiment.candidates.filter(candidate => candidate.id === options.parentId && !candidate.archived) : rated.slice(0, Math.max(1, Math.ceil(rated.length * 0.3)));
  if (options.mode !== undefined && !['random', 'saved'].includes(options.mode) && !parents.length) throw new Error('请先选择一个候选，或完成对比后使用排名靠前的候选');
  const signatures = new Set(experiment.candidates.map(candidate => rollSignature(candidate.genes))), result: RollCandidate[] = [];
  for (let attempts = 0; result.length < count && attempts < count * 100; attempts++) {
    let method: RollMethod = 'random', lineage: RollCandidate[] = [], inherited: RollGene[] = [];
    if (options.mode === 'refine') {
      const parent = parents[0], jitter = options.jitter ?? 0.3;
      if (![0.1, 0.2, 0.3].includes(jitter)) throw new Error('权重微调幅度需要为 ±0.1、±0.2 或 ±0.3');
      method = 'refine'; lineage = [parent];
      // 权重微调保留全部画师；排除／锁定变化由用户先通过变异建立新候选。
      if (parent.genes.some(gene => !poolKeys.has(tagKey(gene.tag))) || locked.some(artist => !parent.genes.some(gene => tagKey(gene.tag) === tagKey(artist.tag)))) throw new Error('抽取条件已变化，请先变异候选，再微调权重');
      inherited = parent.genes.map(gene => ({ ...gene, weight: lockedKeys.has(tagKey(gene.tag)) ? locked.find(artist => tagKey(artist.tag) === tagKey(gene.tag))!.weight : clamp(gene.weight + integer(-Math.round(jitter * 10), Math.round(jitter * 10)) / 10) }));
    } else if (options.mode === 'evolve' || options.mode === 'mutate' || options.mode === 'saved') {
      // 保存就是偏好信号；每四套留一套全新探索，不要求先投票。
      method = options.mode === 'saved' ? parents.length && result.length % 4 !== 3 ? 'mutate' : 'random'
        : options.mode === 'mutate' ? 'mutate' : choose<RollMethod>(['mutate', 'crossover', 'random']);
      if (method !== 'random') {
        const first = choose(parents); lineage = [first]; inherited = first.genes.map(gene => ({ ...gene }));
        const others = parents.filter(candidate => candidate.id !== first.id);
        if (method === 'crossover' && others.length) {
          const second = choose(others); lineage.push(second);
          const byTag = new Map(inherited.map(gene => [tagKey(gene.tag), gene]));
          second.genes.forEach(gene => { if (!byTag.has(tagKey(gene.tag)) || random() < 0.5) byTag.set(tagKey(gene.tag), { ...gene }); });
          inherited = [...byTag.values()];
        } else if (options.mode === 'saved') {
          const available = inherited.filter(gene => poolKeys.has(tagKey(gene.tag)) && !lockedKeys.has(tagKey(gene.tag)));
          const keep = Math.ceil(available.length * 0.65); inherited = [];
          while (inherited.length < keep) { const gene = choose(available); inherited.push({ ...gene, weight: clamp(gene.weight + integer(-3, 3) / 10) }); available.splice(available.indexOf(gene), 1); }
        } else {
          method = 'mutate';
          inherited = inherited.filter(gene => lockedKeys.has(tagKey(gene.tag)) || random() >= 0.35)
            .map(gene => ({ ...gene, weight: clamp(gene.weight + integer(-3, 3) / 10) }));
        }
      }
    }
    let genes: RollGene[];
    if (method === 'refine') genes = inherited;
    else {
      genes = locked.map(({ tag, weight: lockedWeight }) => ({ tag, weight: lockedWeight }));
      const target = integer(Math.max(rules.minArtists, locked.length), Math.min(rules.maxArtists, pool.length));
      const available = inherited.filter(gene => poolKeys.has(tagKey(gene.tag)) && !lockedKeys.has(tagKey(gene.tag)));
      while (available.length && genes.length < target) { const selected = choose(available); genes.push({ ...selected, weight: clamp(selected.weight) }); available.splice(available.indexOf(selected), 1); }
      const unused = pool.filter(artist => !genes.some(gene => tagKey(gene.tag) === tagKey(artist.tag)));
      while (genes.length < target && unused.length) { const artist = choose(unused); genes.push({ tag: artist.tag, weight: weight() }); unused.splice(unused.indexOf(artist), 1); }
    }
    const signature = rollSignature(genes);
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    const generation = options.mode === 'evolve' ? Math.max(0, ...experiment.candidates.map(candidate => candidate.generation)) + 1 : lineage.length ? Math.max(...lineage.map(parent => parent.generation)) + 1 : 0;
    result.push({ id: createUuid(), genes, method, parents: lineage.map(parent => parent.id), generation, createdAt: Date.now() + result.length, archived: false });
  }
  if (!result.length) throw new Error('当前规则下没有新的组合，请调整画师数量、锁定项或权重范围');
  return result;
}

export function rollCandidateToChain(experiment: RollExperiment, candidate: RollCandidate, imageUrl?: string): PromptChain {
  return {
    id: '', userId: '', name: `${experiment.name} · ${experiment.candidates.indexOf(candidate) + 1}`, description: `Roll 串 · ${candidate.method} · ${candidate.generation}`,
    type: 'style', basePrompt: rollPrompt(experiment.template, candidate.genes), negativePrompt: experiment.template.negativePrompt,
    params: { ...structuredClone(experiment.template.params), ...(candidate.seed === undefined ? {} : { seed: candidate.seed }) }, modules: [], variableValues: { subject: '' }, tags: [],
    previewImage: imageUrl, createdAt: Date.now(), updatedAt: Date.now(),
  };
}

/** 精确改权重也建立新候选，不能让旧图和旧评分跟着文字发生变化。 */
export function manualRollVariant(experiment: RollExperiment, parent: RollCandidate, weights: number[]): RollCandidate {
  if (!experiment.candidates.some(candidate => candidate.id === parent.id) || parent.archived || weights.length !== parent.genes.length) throw new Error('请先选择一个有效候选');
  if (experiment.candidates.length >= ROLL_CANDIDATE_LIMIT) throw new Error('每次可 Roll 1～24 串，每个实验最多 240 串');
  const genes = parent.genes.map((gene, index) => {
    const artist = experiment.artists.find(item => tagKey(item.tag) === tagKey(gene.tag));
    if (!artist || artist.excluded) throw new Error('抽取条件已变化，请先变异候选，再微调权重');
    const weight = artist.locked ? artist.weight : weights[index];
    if (!validWeight(weight) || (!artist.locked && (weight < experiment.rules.minWeight || weight > experiment.rules.maxWeight))) throw new Error('手动权重需要在当前范围内，并使用一位小数');
    return { tag: gene.tag, weight };
  });
  const missingLocked = experiment.artists.some(artist => artist.locked && !artist.excluded && !genes.some(gene => tagKey(gene.tag) === tagKey(artist.tag)));
  if (missingLocked) throw new Error('抽取条件已变化，请先变异候选，再微调权重');
  if (experiment.candidates.some(candidate => rollSignature(candidate.genes) === rollSignature(genes))) throw new Error('该画师与权重组合已经存在');
  return { id: createUuid(), genes, parents: [parent.id], method: 'manual', generation: parent.generation + 1, createdAt: Date.now(), archived: false };
}
