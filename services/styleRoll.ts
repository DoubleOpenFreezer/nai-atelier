import type { NAIParams, PromptChain } from '../types';
import { createUuid } from './id';

export interface RollArtist { tag: string; weight: number; locked: boolean; excluded: boolean }
/** 候选只记录本次抽到的画师与权重，不保存来源关系或代数。 */
export interface RollTag { tag: string; weight: number }
export interface RollRules { minArtists: number; maxArtists: number; minWeight: number; maxWeight: number }
export interface RollTemplate { prompt: string; negativePrompt: string; params: NAIParams }
export interface RollCandidate {
  id: string;
  tags: RollTag[];
  createdAt: number;
  archived: boolean;
  savedChainId?: string;
}
export interface RollRound {
  id: string; candidateIds: string[]; createdAt: number; closedAt?: number;
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
  rounds: RollRound[];
  archived?: boolean;
}

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
export function resolveRollArtists(library: string[], overrides: RollArtist[]): RollArtist[] {
  const artists = new Map<string, RollArtist>();
  for (const tag of library) if (validTag(tag) && !artists.has(tagKey(tag))) artists.set(tagKey(tag), { tag, weight: 1, locked: false, excluded: false });
  for (const artist of overrides) artists.set(tagKey(artist.tag), artist);
  return [...artists.values()];
}

export const formatRollStyle = (tags: RollTag[]) => tags.map(item => `${item.weight.toFixed(1)}::artist:${item.tag} ::`).join(', ');
export const rollSignature = (tags: RollTag[]) => JSON.stringify(tags.map(item => [tagKey(item.tag), tenth(item.weight)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
export const rollSourceId = (experimentId: string) => `style-roll:${experimentId}`;
export const rollCandidateModuleId = (candidateId: string) => `style-roll:${candidateId}`;
export const rollPrompt = (template: RollTemplate, tags: RollTag[]) => template.prompt.replace('{style}', formatRollStyle(tags));

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

/** 保存／导入是信任边界，资料读坏时停止，不能用空数据覆盖。 */
export function validateRollExperiment(value: unknown): asserts value is RollExperiment {
  const e = value as RollExperiment;
  const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
  if (!e || e.version !== 1 || !validId(e.id) || typeof e.name !== 'string' || !e.name.trim() || e.name.length > 120 ||
    !Number.isSafeInteger(e.revision) || e.revision < 0 || ![e.createdAt, e.updatedAt].every(Number.isFinite) ||
    !Array.isArray(e.artists) || e.artists.length > 1000 || !Array.isArray(e.candidates) || e.candidates.length > ROLL_CANDIDATE_LIMIT ||
    (e.archived !== undefined && typeof e.archived !== 'boolean')) throw new Error('Roll 串实验资料无效');
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
    if (!candidate || !validId(candidate.id) || ids.has(candidate.id) || !Array.isArray(candidate.tags) || !candidate.tags.length || candidate.tags.length > 16 ||
      !candidate.tags.every(tag => tag && validTag(tag.tag) && validWeight(tag.weight)) || new Set(candidate.tags.map(tag => tagKey(tag.tag))).size !== candidate.tags.length ||
      !Number.isFinite(candidate.createdAt) || typeof candidate.archived !== 'boolean' ||
      (candidate.savedChainId !== undefined && !validId(candidate.savedChainId))) throw new Error('候选串资料无效');
    ids.add(candidate.id);
  }
  const rounds = new Set<string>();
  if (!Array.isArray(e.rounds) || e.rounds.length > ROLL_CANDIDATE_LIMIT) throw new Error('画风轮次资料无效');
  for (const round of e.rounds) {
    if (!round || !validId(round.id) || rounds.has(round.id) ||
      !Number.isFinite(round.createdAt) || (round.closedAt !== undefined && !Number.isFinite(round.closedAt)) ||
      !Array.isArray(round.candidateIds) || !round.candidateIds.length || round.candidateIds.length > 24 || new Set(round.candidateIds).size !== round.candidateIds.length || round.candidateIds.some(id => !ids.has(id))) throw new Error('画风轮次资料无效');
    rounds.add(round.id);
  }
}

export function rollCandidates(experiment: RollExperiment, count: number, options: { random?: () => number } = {}): RollCandidate[] {
  validateRollRules(experiment.artists, experiment.rules);
  if (!Number.isSafeInteger(count) || count < 1 || count > 24 || experiment.candidates.length + count > ROLL_CANDIDATE_LIMIT) throw new Error('每次可 Roll 1～24 串，每个实验最多 240 串');
  const random = options.random || Math.random, rules = experiment.rules;
  const pool = experiment.artists.filter(artist => !artist.excluded), locked = pool.filter(artist => artist.locked);
  const choose = <T,>(items: T[]): T => items[Math.min(items.length - 1, Math.floor(random() * items.length))];
  const integer = (min: number, max: number) => min + Math.min(max - min, Math.floor(random() * (max - min + 1)));
  const weight = () => integer(Math.round(rules.minWeight * 10), Math.round(rules.maxWeight * 10)) / 10;
  const signatures = new Set(experiment.candidates.map(candidate => rollSignature(candidate.tags))), result: RollCandidate[] = [];
  for (let attempts = 0; result.length < count && attempts < count * 100; attempts++) {
    const tags = locked.map(({ tag, weight: lockedWeight }) => ({ tag, weight: lockedWeight }));
    const target = integer(Math.max(rules.minArtists, locked.length), Math.min(rules.maxArtists, pool.length));
    const unused = pool.filter(artist => !tags.some(item => tagKey(item.tag) === tagKey(artist.tag)));
    while (tags.length < target && unused.length) { const artist = choose(unused); tags.push({ tag: artist.tag, weight: weight() }); unused.splice(unused.indexOf(artist), 1); }
    const signature = rollSignature(tags);
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    result.push({ id: createUuid(), tags, createdAt: Date.now() + result.length, archived: false });
  }
  if (!result.length) throw new Error('当前规则下没有新的组合，请调整画师数量、锁定项或权重范围');
  return result;
}

export function rollCandidateToChain(experiment: RollExperiment, candidate: RollCandidate, imageUrl?: string): PromptChain {
  return {
    id: '', userId: '', name: `${experiment.name} · ${experiment.candidates.indexOf(candidate) + 1}`, description: 'Roll 串',
    type: 'style', basePrompt: rollPrompt(experiment.template, candidate.tags), negativePrompt: experiment.template.negativePrompt,
    params: structuredClone(experiment.template.params), modules: [], variableValues: { subject: '' }, tags: [],
    previewImage: imageUrl, createdAt: Date.now(), updatedAt: Date.now(),
  };
}
