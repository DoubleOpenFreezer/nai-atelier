// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createLabWorkspaceSession, LAB_DEFAULT_PARAMS, loadLabWorkspaceSession, mergePromptSections,
  normalizeParams, resolvePromptSections, saveLabWorkspaceSession, serializeLabWorkspaceMemory, normalizePromptSections } from '../../services/labWorkspace';
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

describe('分区来源快照', () => {
  it('来源跟着栏位走：清空内容后对应来源一并丢弃，其余保持不变', () => {
    const sections = {
      appearance: 'silver_hair', wardrobe: '', pose: '', scene: '', camera: '', extra: '',
      sectionMeta: {
        appearance: { entryId: 'a-1', entryName: '银发少女', source: 'library' as const, mode: 'append' as const },
        wardrobe: { entryId: 'w-1', entryName: '白裙', source: 'library' as const },
      },
    };
    const normalized = normalizePromptSections(sections);
    expect(normalized?.sectionMeta).toEqual({ appearance: sections.sectionMeta.appearance });
    expect(normalized?.sectionMeta?.wardrobe).toBeUndefined();
  });
});
