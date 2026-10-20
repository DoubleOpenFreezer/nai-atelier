// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { createLabWorkspaceSession, LAB_DEFAULT_PARAMS, loadLabWorkspaceSession, mergePromptSections,
  normalizeParams, resolvePromptSections, saveLabWorkspaceSession, serializeLabWorkspaceMemory } from '../../services/labWorkspace';
import { DEFAULT_GENERATION_MEMORY_PREFERENCES } from '../../services/appearancePreferences';

afterEach(() => { localStorage.clear(); sessionStorage.clear(); });
const sections = { appearance: 'silver_hair', wardrobe: 'blue_dress', pose: 'sitting', scene: 'rainy_street', camera: 'close_up', extra: 'none' };

it('分栏往返保留原文和合并顺序，旧数据与过期分栏不猜词', () => {
  const normalized = normalizeParams({ _promptSections: sections });
  const subject = mergePromptSections(sections);
  expect(resolvePromptSections(normalized._promptSections, subject)).toEqual(sections);
  expect(resolvePromptSections(sections, 'assistant changed everything')).toEqual({ appearance: '', wardrobe: '', pose: '', scene: '', camera: '', extra: 'assistant changed everything' });
  expect(resolvePromptSections(undefined, 'legacy prompt')).toHaveProperty('extra', 'legacy prompt');
  expect(resolvePromptSections(sections, '')).toHaveProperty('extra', '');
});

it.each([false, true])('分栏随全局提示词记忆保存和恢复，独立于参数开关 %s', parameters => {
  const session = createLabWorkspaceSession('artist', mergePromptSections(sections), '', { ...LAB_DEFAULT_PARAMS, _promptSections: sections }, {});
  const memory = { ...DEFAULT_GENERATION_MEMORY_PREFERENCES, parameters, globalPrompt: true };
  saveLabWorkspaceSession('playground', session, true, memory);
  sessionStorage.clear();
  const restored = loadLabWorkspaceSession('playground', createLabWorkspaceSession('', '', '', LAB_DEFAULT_PARAMS, {}), true, memory);
  expect(restored.textToImage.params._promptSections).toEqual(sections);
  expect(restored.textToImage.subjectPrompt).toBe(mergePromptSections(sections));
});

it('关闭全局词记忆时，参数副本不夹带分栏；旧全量副本也按当前偏好过滤', () => {
  const session = createLabWorkspaceSession('private artist', mergePromptSections(sections), '', { ...LAB_DEFAULT_PARAMS, _promptSections: sections }, {});
  const memory = { ...DEFAULT_GENERATION_MEMORY_PREFERENCES, parameters: true, globalPrompt: false };
  const serialized = serializeLabWorkspaceMemory(session, memory);
  expect(serialized).not.toContain('silver_hair'); expect(serialized).not.toContain('_promptSections');
  localStorage.setItem('nai-lab-workspace-v1:playground', JSON.stringify(session));
  const restored = loadLabWorkspaceSession('playground', createLabWorkspaceSession('', '', '', LAB_DEFAULT_PARAMS, {}), true, memory);
  expect(restored.textToImage.params._promptSections).toBeUndefined();
  expect(restored.textToImage.subjectPrompt).toBe('');
});
