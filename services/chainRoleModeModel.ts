import type { CharacterParams, PromptChain } from '../types';
import { comparisonFields, validateChainComparison, type ComparisonField } from './chainComparison';
import { getActiveCharacters } from './characterPrompts';

export interface RoleModeConfig { revision: number; characters: CharacterParams[] }
export interface RoleModeCopy { sourceId: string; revision: number; characterRevision: number; source: PromptChain; fields: ComparisonField[]; chain: PromptChain }
export interface RoleModeState { config: RoleModeConfig; copies: RoleModeCopy[] }
const prefix = 'chain-role:';
export const isRoleModeChain = (value: PromptChain | string) => (typeof value === 'string' ? value : value.id).startsWith(prefix);
export const roleModeSourceId = (id: string) => id.startsWith(prefix) ? id.slice(prefix.length) : id;
export const emptyRoleModeConfig = (): RoleModeConfig => ({ revision: 0, characters: [{ id: 'common-character', prompt: '', negativePrompt: '', x: 0.5, y: 0.5 }] });
export function createRoleModeCopy(source: PromptChain, config: RoleModeConfig): RoleModeCopy {
  const original = { ...structuredClone(source), type: 'style' as const };
  const fields = comparisonFields(original);
  const mixedText = !getActiveCharacters(original.params.characters).length && fields.some(field => field.kind !== 'negative' && field.original.trim());
  const copy: RoleModeCopy = { sourceId: source.id, revision: 0, characterRevision: config.revision, source: original, fields: fields.map(field => ({ ...field, reviewed: !mixedText || field.reviewed })), chain: { ...structuredClone(original), id: prefix + source.id, previewImage: '' } };
  return { ...copy, chain: materializeRoleModeCopy(copy, config) };
}
/** 共享角色变化只替换角色；已编辑的参数、风格和封面继续属于副本。 */
export function materializeRoleModeCopy(copy: RoleModeCopy, config: RoleModeConfig): PromptChain {
  return { ...structuredClone(copy.chain), id: prefix + copy.sourceId, params: { ...structuredClone(copy.chain.params), characters: structuredClone(config.characters) } };
}
export function applyRoleModeFields(copy: RoleModeCopy, fields: ComparisonField[], config: RoleModeConfig): RoleModeCopy {
  const read = (id: string, fallback: string) => fields.find(field => field.id === id)?.kept ?? fallback;
  const chain = materializeRoleModeCopy(copy, config);
  return { ...copy, fields, characterRevision: config.revision, chain: { ...chain, basePrompt: read('base', chain.basePrompt), negativePrompt: read('negative', chain.negativePrompt),
    variableValues: { ...chain.variableValues, subject: read('subject', chain.variableValues?.subject || '') }, modules: chain.modules.map(module => ({ ...module, content: read(`module:${module.id}`, module.content) })) } };
}
export function validateRoleModeConfig(value: unknown): asserts value is RoleModeConfig {
  const c = value as RoleModeConfig;
  if (!c || !Number.isSafeInteger(c.revision) || c.revision < 0 || !Array.isArray(c.characters) || c.characters.length !== 1 || !c.characters.every(character => character && typeof character.id === 'string' && typeof character.prompt === 'string' && character.prompt.length <= 50000 && typeof character.negativePrompt === 'string' && character.negativePrompt.length <= 50000 && [character.x, character.y].every(number => Number.isFinite(number) && number >= 0 && number <= 1))) throw new Error('统一角色配置无效');
}
export function validateRoleModeCopy(value: unknown): asserts value is RoleModeCopy {
  const c = value as RoleModeCopy;
  if (!c || typeof c.sourceId !== 'string' || !c.sourceId || c.sourceId.length > 160 || c.source?.id !== c.sourceId || c.chain?.id !== prefix + c.sourceId || !Number.isSafeInteger(c.revision) || c.revision < 0 || !Number.isSafeInteger(c.characterRevision) || c.characterRevision < 0) throw new Error('统一角色副本无效');
  const check = (source: PromptChain, fields: ComparisonField[]) => validateChainComparison({ id: 'role-copy', name: '', revision: 0, createdAt: 0, updatedAt: 0, draft: { seed: null, characters: emptyRoleModeConfig().characters, entries: [{ id: source.id, source, fields }] }, rounds: [] });
  check(c.source, c.fields);
  const chain = { ...c.chain, id: c.sourceId };
  check(chain, comparisonFields(chain));
}
