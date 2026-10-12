// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { preserveUpdateDrafts, restoreUpdateDrafts } from '../../services/appUpdate';
import { DEFAULT_APPEARANCE_PREFERENCES, saveAppearancePreferences, type GenerationMemoryPreferences } from '../../services/appearancePreferences';
import { createLabWorkspaceSession, LAB_DEFAULT_PARAMS, loadLabWorkspaceSession, saveLabWorkspaceSession } from '../../services/labWorkspace';

const key = 'nai-lab-workspace-v1:playground';
const draft = () => createLabWorkspaceSession('合成文字草稿', '', '', LAB_DEFAULT_PARAMS, {});

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
it('更新只暂存实验室草稿，不带 Key；重启恢复一次且不覆盖后来编辑', () => {
  const session = draft(); session.edits.inpaint.maskRef = 'synthetic-do-not-copy-mask';
  sessionStorage.setItem(key, JSON.stringify(session)); sessionStorage.setItem('nai_api_key', 'synthetic-do-not-copy');
  preserveUpdateDrafts();
  expect(localStorage.getItem('nai-update-lab-drafts')).not.toContain('synthetic-do-not-copy');
  sessionStorage.clear(); restoreUpdateDrafts();
  expect(loadLabWorkspaceSession('playground', draft()).textToImage.basePrompt).toBe('合成文字草稿'); expect(sessionStorage.getItem('nai_api_key')).toBeNull();
  expect(loadLabWorkspaceSession('playground', draft()).edits.inpaint.maskRef).toBeUndefined();
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(localStorage.getItem('nai-update-lab-drafts')).toBeNull();
  preserveUpdateDrafts(); sessionStorage.setItem(key, '后来编辑'); restoreUpdateDrafts();
  expect(sessionStorage.getItem(key)).toBe('后来编辑');
});
it.each(['parameters', 'globalPrompt', 'negativePrompt', 'characterPrompt', 'characterNegativePrompt'] as const)('更新只暂存并恢复勾选的 %s，禁用文字不会进入快照', field => {
  const memory: GenerationMemoryPreferences = { parameters: false, globalPrompt: false, negativePrompt: false, characterPrompt: false, characterNegativePrompt: false, [field]: true };
  saveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, generationMemory: memory });
  const session = createLabWorkspaceSession('private-global', 'private-subject', 'private-negative', { ...LAB_DEFAULT_PARAMS, seed: 1234,
    characters: [{ id: 'role', prompt: 'private-role-positive', negativePrompt: 'private-role-negative', x: 0.1, y: 0.2 }] }, { module: false });
  session.activeMode = 'outpaint'; sessionStorage.setItem(key, JSON.stringify(session));
  preserveUpdateDrafts();
  const raw = localStorage.getItem('nai-update-lab-drafts')!;
  for (const [name, word] of [['globalPrompt', 'private-global'], ['negativePrompt', 'private-negative'],
    ['characterPrompt', 'private-role-positive'], ['characterNegativePrompt', 'private-role-negative']] as const) expect(raw.includes(word)).toBe(name === field);
  expect(raw.includes('1234')).toBe(field === 'parameters');
  sessionStorage.clear(); restoreUpdateDrafts();
  expect(sessionStorage.getItem(key)).toBeNull();
  const fallback = createLabWorkspaceSession('', '', '', LAB_DEFAULT_PARAMS, {});
  const restored = loadLabWorkspaceSession('playground', fallback, true, memory);
  expect(restored.textToImage.basePrompt).toBe(field === 'globalPrompt' ? 'private-global' : '');
  expect(restored.textToImage.negativePrompt).toBe(field === 'negativePrompt' ? 'private-negative' : '');
  expect(restored.textToImage.params.seed).toBe(field === 'parameters' ? 1234 : undefined);
  expect(restored.activeMode).toBe(field === 'parameters' ? 'outpaint' : 'text-to-image');
  const role = restored.textToImage.params.characters?.[0];
  if (field === 'characterPrompt') expect(role).toMatchObject({ id: 'role', prompt: 'private-role-positive', x: 0.5, y: 0.5 });
  if (field === 'characterNegativePrompt') expect(role).toMatchObject({ id: 'role', prompt: '', negativePrompt: 'private-role-negative', x: 0.5, y: 0.5 });
});
it('旧全量更新归档按当前范围过滤后进入持久副本，不以会话草稿绕过预设fallback', () => {
  const session = createLabWorkspaceSession('private-global', 'private-subject', 'private-negative', { ...LAB_DEFAULT_PARAMS, seed: 1234 }, { module: false });
  const memory: GenerationMemoryPreferences = { parameters: true, globalPrompt: false, negativePrompt: false, characterPrompt: false, characterNegativePrompt: false };
  saveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, generationMemory: memory });
  localStorage.setItem('nai-update-lab-drafts', JSON.stringify({ savedAt: Date.now(), entries: { [key]: JSON.stringify(session) } }));
  restoreUpdateDrafts();
  expect(localStorage.getItem(key)).not.toContain('private-');
  expect(sessionStorage.getItem(key)).toBeNull();
  const fallback = createLabWorkspaceSession('preset global', 'preset subject', 'preset negative', LAB_DEFAULT_PARAMS, { module: true });
  expect(loadLabWorkspaceSession('playground', fallback, true, memory).textToImage).toMatchObject({
    basePrompt: 'preset global', subjectPrompt: 'preset subject', negativePrompt: 'preset negative', activeModules: { module: true }, params: { seed: 1234 },
  });
});
it('关闭记住上次设置时更新不暂存、不恢复旧记录，保留当前会话', () => {
  saveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, rememberGenerationSettings: false });
  sessionStorage.setItem(key, JSON.stringify(draft()));
  preserveUpdateDrafts();
  expect(localStorage.getItem('nai-update-lab-drafts')).toBeNull();
  localStorage.setItem('nai-update-lab-drafts', JSON.stringify({ savedAt: Date.now(), entries: { [key]: JSON.stringify(draft()) } }));
  sessionStorage.clear(); restoreUpdateDrafts();
  expect(sessionStorage.length).toBe(0);
  expect(localStorage.getItem('nai-update-lab-drafts')).toBeNull();
  sessionStorage.setItem(key, '当前会话'); preserveUpdateDrafts();
  expect(sessionStorage.getItem(key)).toBe('当前会话');
});
it('旧更新归档不能覆盖较新持久记忆，损坏条目不能变成当前草稿', () => {
  const old = draft(); old.updatedAt = 1;
  localStorage.setItem('nai-update-lab-drafts', JSON.stringify({ savedAt: Date.now(), entries: { [key]: JSON.stringify(old),
    'nai-lab-workspace-v1:broken': 'invalid', 'nai-lab-workspace-v1:empty': '{}' } }));
  const current = draft(); current.textToImage.basePrompt = '新记忆'; saveLabWorkspaceSession('playground', current);
  sessionStorage.clear(); restoreUpdateDrafts();
  expect(sessionStorage.length).toBe(0);
  expect(JSON.parse(localStorage.getItem(key)!).textToImage.basePrompt).toBe('新记忆');
});
it('过期或损坏的恢复记录不能覆盖现有会话', () => {
  localStorage.setItem('nai-update-lab-drafts', JSON.stringify({ savedAt: Date.now() - 25 * 60 * 60 * 1000, entries: { 'nai-lab-workspace-v1:playground': '旧内容' } }));
  restoreUpdateDrafts(); expect(sessionStorage.length).toBe(0);
  localStorage.setItem('nai-update-lab-drafts', 'invalid'); restoreUpdateDrafts(); expect(sessionStorage.length).toBe(0);
});
