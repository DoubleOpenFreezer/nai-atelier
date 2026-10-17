import type { PromptChain } from '../types';
import { api } from './api';
import { applyComparisonAgent } from './chainComparisonApi';
import { compilePrompt } from './promptUtils';
import { applyRoleModeFields, createRoleModeCopy, emptyRoleModeConfig, isRoleModeChain, materializeRoleModeCopy, roleModeSourceId, validateRoleModeConfig, validateRoleModeCopy, type RoleModeConfig, type RoleModeCopy, type RoleModeState } from './chainRoleModeModel';
export { isRoleModeChain, roleModeSourceId, createRoleModeCopy, materializeRoleModeCopy } from './chainRoleModeModel';
export type { RoleModeConfig, RoleModeCopy, RoleModeState } from './chainRoleModeModel';
const endpoint = '/chain-comparisons/role-mode';
let state: RoleModeState = { config: emptyRoleModeConfig(), copies: [] };
const listeners = new Set<() => void>();
export const roleModeSnapshot = () => state;
export const subscribeRoleMode = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = () => listeners.forEach(listener => listener());
export async function loadRoleModeState(): Promise<RoleModeState> {
  const next = await api.get(endpoint, { cache: 'no-store' }) as RoleModeState;
  validateRoleModeConfig(next.config); if (!Array.isArray(next.copies)) throw new Error('统一角色副本无效'); next.copies.forEach(validateRoleModeCopy);
  state = next; publish(); return state;
}
export async function saveRoleModeConfig(config: RoleModeConfig): Promise<RoleModeConfig> {
  validateRoleModeConfig(config); const result = await api.put(endpoint, { kind: 'config', config }); validateRoleModeConfig(result.config);
  state = { ...state, config: result.config }; publish(); return result.config;
}
export async function saveRoleModeCopy(copy: RoleModeCopy): Promise<PromptChain> {
  validateRoleModeCopy(copy); const result = await api.put(endpoint, { kind: 'copy', copy }); validateRoleModeCopy(result.copy);
  state = { ...state, copies: [...state.copies.filter(item => item.sourceId !== copy.sourceId), result.copy] }; publish();
  return materializeRoleModeCopy(result.copy, state.config);
}
export function getRoleModeCopy(id: string): PromptChain | null {
  const copy = state.copies.find(item => item.sourceId === roleModeSourceId(id)); return copy ? materializeRoleModeCopy(copy, state.config) : null;
}
export async function loadRoleModeChain(id: string): Promise<PromptChain | null> { await loadRoleModeState(); return getRoleModeCopy(id); }
export async function ensureRoleModeCopy(source: PromptChain): Promise<PromptChain> {
  await loadRoleModeState();
  const copy = state.copies.find(item => item.sourceId === source.id);
  return copy ? materializeRoleModeCopy(copy, state.config) : saveRoleModeCopy(createRoleModeCopy(source, state.config));
}
export async function saveRoleModeChain(chain: PromptChain): Promise<PromptChain> {
  if (!isRoleModeChain(chain)) throw new Error('统一角色副本无效');
  const copy = state.copies.find(item => item.sourceId === roleModeSourceId(chain.id));
  if (!copy) throw new Error('统一角色副本无效');
  const fields = applyComparisonAgent({ id: copy.sourceId, source: copy.source, fields: copy.fields }, { basePrompt: chain.basePrompt, subjectPrompt: chain.variableValues?.subject || '', negativePrompt: chain.negativePrompt, modules: chain.modules, params: chain.params }).fields;
  return saveRoleModeCopy({ ...copy, chain: structuredClone(chain), fields, characterRevision: state.config.revision });
}
export async function saveRoleModeReview(copy: RoleModeCopy): Promise<PromptChain> {
  const before = copy.chain, saved = await saveRoleModeCopy(applyRoleModeFields(copy, copy.fields, state.config));
  const [{ createLabWorkspaceSession, loadLabWorkspaceSession, saveLabWorkspaceSession }, { loadAppearancePreferences }] = await Promise.all([import('./labWorkspace'), import('./appearancePreferences')]);
  const preferences = loadAppearancePreferences();
  const fallback = createLabWorkspaceSession(before.basePrompt, before.variableValues?.subject || '', before.negativePrompt, before.params, Object.fromEntries(before.modules.map(module => [module.id, module.isActive])));
  const session = loadLabWorkspaceSession(saved.id, fallback, preferences.rememberGenerationSettings, preferences.generationMemory);
  // 明确保存的拆分更新同一副本文字；其他模式自行编辑过的词、参数和工作图保留。
  if (before.basePrompt !== saved.basePrompt) session.textToImage.basePrompt = saved.basePrompt;
  if ((before.variableValues?.subject || '') !== (saved.variableValues?.subject || '')) session.textToImage.subjectPrompt = saved.variableValues?.subject || '';
  if (before.negativePrompt !== saved.negativePrompt) session.textToImage.negativePrompt = saved.negativePrompt;
  const previousPrompt = compilePrompt(before, before.variableValues?.subject || ''), nextPrompt = compilePrompt(saved, saved.variableValues?.subject || '');
  for (const draft of Object.values(session.edits)) {
    if (draft.prompt === previousPrompt) draft.prompt = nextPrompt;
    if (draft.negativePrompt === before.negativePrompt) draft.negativePrompt = saved.negativePrompt;
  }
  saveLabWorkspaceSession(saved.id, session, preferences.rememberGenerationSettings, preferences.generationMemory);
  return saved;
}
