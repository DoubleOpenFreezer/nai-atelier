import type { CharacterParams, PromptChain } from '../types';

export interface ComparisonField {
  id: string;
  kind: 'base' | 'subject' | 'negative' | 'module';
  moduleId?: string;
  original: string;
  kept: string;
  replaced: string;
  reviewed: boolean;
}
export interface ComparisonEntry { id: string; source: PromptChain; fields: ComparisonField[] }
export interface ComparisonDraft { characters: CharacterParams[]; seed: number | null; entries: ComparisonEntry[] }
export interface ComparisonRound { id: string; createdAt: number; draft: ComparisonDraft }
export interface ChainComparison {
  id: string; name: string; revision: number; createdAt: number; updatedAt: number;
  draft: ComparisonDraft; rounds: ComparisonRound[];
}
export const comparisonSourceId = (id: string) => `chain-compare:${id}`;
export const comparisonModuleId = (round: string, entry: string) => `chain-compare:${round}:${entry}`;

export function comparisonFields(source: PromptChain): ComparisonField[] {
  const field = (id: string, kind: ComparisonField['kind'], original: string, moduleId?: string): ComparisonField =>
    ({ id, kind, ...(moduleId ? { moduleId } : {}), original, kept: original, replaced: '', reviewed: !original.trim() });
  return [field('base', 'base', source.basePrompt), field('subject', 'subject', source.variableValues?.subject || ''),
    field('negative', 'negative', source.negativePrompt),
    ...source.modules.filter(module => module.isActive).map(module => field(`module:${module.id}`, 'module', module.content, module.id))];
}

export function createComparison(chains: PromptChain[], id: string, now = Date.now()): ChainComparison {
  return { id, name: '统一角色对比', revision: 0, createdAt: now, updatedAt: now,
    draft: { seed: null, characters: [{ id: 'common-character', prompt: '', negativePrompt: '', x: 0.5, y: 0.5 }],
      entries: chains.map(source => ({ id: source.id, source: structuredClone(source), fields: comparisonFields(source) })) }, rounds: [] };
}

export function comparisonChain(entry: ComparisonEntry, draft: ComparisonDraft): PromptChain {
  const source = structuredClone(entry.source);
  const read = (id: string) => entry.fields.find(field => field.id === id)?.kept ?? '';
  return { ...source, basePrompt: read('base'), negativePrompt: read('negative'), variableValues: { ...source.variableValues, subject: read('subject') },
    modules: source.modules.map(module => module.isActive ? { ...module, content: read(`module:${module.id}`) } : module),
    params: { ...source.params, characters: structuredClone(draft.characters), ...(draft.seed === null ? {} : { seed: draft.seed }) } };
}

export const comparisonReady = (draft: ComparisonDraft) => draft.entries.length > 0 &&
  draft.characters.some(character => character.enabled !== false && character.prompt.trim()) && draft.entries.every(entry => entry.fields.every(field => field.reviewed));

/** 私人settings与页面共用的边界校验，不读取或修补旧记录。 */
export function validateChainComparison(value: unknown): asserts value is ChainComparison {
  const fail = () => { throw new Error('对比记录无效'); };
  const object = (item: unknown): item is Record<string, any> => Boolean(item && typeof item === 'object' && !Array.isArray(item));
  const text = (item: unknown, max = 50000) => typeof item === 'string' && item.length <= max;
  const id = (item: unknown) => typeof item === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(item);
  const draft = (item: unknown): item is ComparisonDraft => {
    if (!object(item) || !Array.isArray(item.entries) || item.entries.length > 24 || !Array.isArray(item.characters) || !item.characters.length || item.characters.length > 6 ||
      !(item.seed === null || Number.isSafeInteger(item.seed) && item.seed >= 0 && item.seed <= 4294967295)) return false;
    if (!item.characters.every((character: unknown) => object(character) && text(character.id, 200) && text(character.prompt) && (character.negativePrompt === undefined || text(character.negativePrompt)) &&
      [character.x, character.y].every(number => Number.isFinite(number) && number >= 0 && number <= 1) && (character.enabled === undefined || typeof character.enabled === 'boolean'))) return false;
    const ids = new Set<string>();
    return item.entries.every((entry: unknown) => {
      if (!object(entry) || !text(entry.id, 200) || ids.has(entry.id) || !object(entry.source)) return false;
      ids.add(entry.id);
      const source = entry.source;
      if (source.id !== entry.id || source.type !== 'style' || !text(source.name, 200) || !text(source.basePrompt) || !text(source.negativePrompt) ||
        !Array.isArray(source.modules) || source.modules.length > 100 || !source.modules.every((module: any) => object(module) && text(module.id, 200) && text(module.content) && typeof module.isActive === 'boolean') ||
        !object(source.params) || ![source.params.width, source.params.height, source.params.steps, source.params.scale].every(number => Number.isFinite(number) && number > 0) ||
        (source.variableValues !== undefined && (!object(source.variableValues) || source.variableValues.subject !== undefined && !text(source.variableValues.subject)))) return false;
      const expected = comparisonFields(source as PromptChain);
      return Array.isArray(entry.fields) && entry.fields.length === expected.length && entry.fields.every((field: any, index: number) => object(field) &&
        field.id === expected[index].id && field.kind === expected[index].kind && field.moduleId === expected[index].moduleId && field.original === expected[index].original &&
        text(field.kept) && text(field.replaced) && typeof field.reviewed === 'boolean');
    });
  };
  if (!object(value) || !id(value.id) || !text(value.name, 160) || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
    !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt) || !draft(value.draft) || !Array.isArray(value.rounds) || value.rounds.length > 100) return fail();
  const rounds = new Set<string>();
  for (const round of value.rounds) {
    if (!object(round) || !id(round.id) || rounds.has(round.id) || !Number.isFinite(round.createdAt) || !draft(round.draft) || !comparisonReady(round.draft)) return fail();
    rounds.add(round.id);
  }
}
